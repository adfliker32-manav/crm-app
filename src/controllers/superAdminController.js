const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const Lead = require('../models/Lead');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const AgencySettings = require('../models/AgencySettings');
const GlobalSetting = require('../models/GlobalSetting');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
const WhatsAppLog = require('../models/WhatsAppLog');
const EmailLog = require('../models/EmailLog');
const EmailTemplate = require('../models/EmailTemplate');
const { escapeRegex } = require('../utils/controllerHelpers');
const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const Stage = require('../models/Stage');
const ActivityLog = require('../models/ActivityLog');
const AuditLog = require('../models/AuditLog');
const SystemSetting = require('../models/SystemSetting');
const UsageLog = require('../models/UsageLog');
const { invalidateConfigCache } = require('../utils/systemConfig');
const auditLogger = require('../services/auditLogger');
const VoiceTemplate = require('../models/VoiceTemplate');
const Plan = require('../models/Plan');
const { FEATURE_REGISTRY, resolveValues, diffOverrides, resolveEffective, encodeOverrides } = require('../constants/featureRegistry');
const mongoose = require('mongoose');
const { deleteOwnedRecords } = require('../services/accountCleanupService');
const {
    STRONG_PASSWORD_MESSAGE,
    normalizeEmail,
    hasStrongPassword,
    parseBoundedInteger
} = require('../utils/controllerHelpers');

const COMPANY_ROLE_FILTER = { $in: ['manager', 'agency'] };
// Trial-provisioning constants are shared with the public self-registration flow
// (authController.register) so both paths spin up an identical 14-day trial.
const { TRIAL_DURATION_MS, DEFAULT_AGENT_LIMIT, DEFAULT_ACTIVE_MODULES, SIGNUP_AI_CREDITS } = require('../constants/trial');

const findCompanyById = (id) => User.findOne({ _id: id, role: COMPANY_ROLE_FILTER });

const getAgentLimitValue = (workspace) => workspace?.agentLimit || DEFAULT_AGENT_LIMIT;

// Helper for Token Generation (match authController logic)
const generateToken = (id, role) => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET, {
        expiresIn: '1d' // Impersonation session
    });
};

// Internal Helper: Join User with WorkspaceSettings
const joinWorkspaceSettings = async (query = {}, options = {}) => {
    const { sort = { createdAt: -1 }, limit = 500, skip = 0 } = options;

    return await User.aggregate([
        { $match: query },
        {
            $lookup: {
                from: 'workspacesettings',
                localField: '_id',
                foreignField: 'userId',
                as: 'workspace'
            }
        },
        { $unwind: { path: '$workspace', preserveNullAndEmptyArrays: true } },
        { $sort: sort },
        { $skip: skip },
        { $limit: limit },
        {
            $project: {
                password: 0,
                'workspace._id': 0,
                'workspace.userId': 0
            }
        }
    ]);
};

// Create new company (Manager)
const createCompany = async (req, res) => {
    try {
        const { companyName, name, email, password, phone } = req.body;

        if (!companyName || !name || !email || !password) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const normalizedEmail = normalizeEmail(email);
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use" });
        }

        const newCompany = await User.create({
            companyName,
            name,
            email: normalizedEmail,
            password: password,
            phone,
            role: req.body.role === 'agency' ? 'agency' : 'manager',
            isOnboarded: true,
            accountStatus: 'Active',
            // Super Admin creates accounts already approved — no pending flow needed
            is_active: true,
            approved_by_admin: true,
            status: 'approved'
        });

        // Agencies get lifetime free access — no trial, no expiry. They're our
        // distribution partners, not paying customers. Only direct managers
        // (and agency-created sub-clients) go through the trial → paid lifecycle.
        const isAgency = newCompany.role === 'agency';
        const workspacePayload = {
            userId: newCompany._id,
            agentLimit: DEFAULT_AGENT_LIMIT,
            activeModules: DEFAULT_ACTIVE_MODULES,
            subscriptionPlan: isAgency ? 'Lifetime Free' : 'Free Trial',
            subscriptionStatus: isAgency ? 'active' : 'trial',
            billingType: isAgency ? 'paid_by_agency' : 'trial',
            // planExpiryDate left null for agencies — they never expire.
            ...(isAgency ? {} : { planExpiryDate: new Date(Date.now() + TRIAL_DURATION_MS) })
        };

        const createPromises = [
            WorkspaceSettings.create(workspacePayload),
            IntegrationConfig.create({ userId: newCompany._id })
        ];

        if (isAgency) {
            createPromises.push(AgencySettings.create({ agencyId: newCompany._id }));
        }

        await Promise.all(createPromises);

        // Signup AI credits — managers only (agencies are lifetime-free partners,
        // not AI-consuming tenants). Best-effort: a failure must not break company
        // creation. Matches the self-serve register flow.
        if (!isAgency) {
            try {
                const aiCreditService = require('../services/aiCreditService');
                await aiCreditService.grant(newCompany._id, SIGNUP_AI_CREDITS, {
                    feature: 'signup_bonus',
                    note: 'Welcome credits — new account',
                    adminId: req.user?.userId
                });
            } catch (creditErr) {
                console.error('Signup credit grant failed (non-fatal):', creditErr.message);
            }
        }

        res.status(201).json({
            success: true,
            message: "Company created successfully",
            company: {
                _id: newCompany._id,
                companyName: newCompany.companyName,
                email: newCompany.email,
                role: newCompany.role
            }
        });
    } catch (error) {
        console.error("Create Create Company Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

const getSaaSAnalytics = async (req, res) => {
    try {
        // Optimized: Use Promise.all to run queries in parallel instead of sequentially
        // This reduces total query time significantly
        const [totalCompanies, totalAgents, totalLeads, recentUsers] = await Promise.all([
            User.countDocuments({ role: { $in: ['manager', 'agency'] } }),
            User.countDocuments({ role: 'agent' }),
            Lead.estimatedDocumentCount(), // O(1) metadata count — no full-collection scan
            User.find({ role: { $in: ['manager', 'agency'] } })
                .select('name email createdAt')
                .sort({ createdAt: -1 })
                .limit(5)
                .lean() // Use lean() for better performance
        ]);

        res.json({
            success: true,
            totalCompanies,
            totalAgents,
            totalLeads,
            recentUsers
        });

    } catch (error) {
        console.error("Analytics Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get all companies (managers)
// ⚠️ PRODUCTION NOTE:
// Avoid N+1 queries — they scale linearly and will destroy DB performance at scale.
// This aggregation replaces multiple per-document queries with a single pipeline.
// Any future changes must NOT reintroduce per-item queries inside loops.
const getAllCompanies = async (req, res) => {
    try {
        // Single aggregation pipeline replaces N+1 individual countDocuments calls
        const companies = await User.aggregate([
            { $match: { role: COMPANY_ROLE_FILTER, deletedAt: null } },
            {
                $lookup: {
                    from: 'workspacesettings',
                    localField: '_id',
                    foreignField: 'userId',
                    as: 'workspace'
                }
            },
            { $unwind: { path: '$workspace', preserveNullAndEmptyArrays: true } },
            // Count agents via lookup
            {
                $lookup: {
                    from: 'users',
                    let: { companyId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$parentId', '$$companyId'] },
                                        { $eq: ['$role', 'agent'] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: '_agents'
                }
            },
            // Count leads via lookup
            {
                $lookup: {
                    from: 'leads',
                    let: { companyId: '$_id' },
                    pipeline: [
                        { $match: { $expr: { $eq: ['$userId', '$$companyId'] } } },
                        { $count: 'count' }
                    ],
                    as: '_leadCount'
                }
            },
            // Count sub-clients (managers under this agency, if role=agency)
            {
                $lookup: {
                    from: 'users',
                    let: { companyId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$parentId', '$$companyId'] },
                                        { $eq: ['$role', 'manager'] }
                                    ]
                                }
                            }
                        },
                        { $count: 'count' }
                    ],
                    as: '_subClients'
                }
            },
            { $sort: { createdAt: -1 } },
            { $limit: 500 },
            {
                $project: {
                    password: 0,
                    'workspace._id': 0,
                    'workspace.userId': 0
                }
            },
            {
                $addFields: {
                    agentsCount: { $size: '$_agents' },
                    leadsCount: { $ifNull: [{ $arrayElemAt: ['$_leadCount.count', 0] }, 0] },
                    registeredClients: { $ifNull: [{ $arrayElemAt: ['$_subClients.count', 0] }, 0] },
                    // Derived flags for frontend — `accountStatus` is the source of truth.
                    // Suspended = SuperAdmin freeze; Frozen = Agency freeze.
                    isFrozen: { $in: ['$accountStatus', ['Frozen', 'Suspended']] },
                    isSuspended: { $eq: ['$accountStatus', 'Suspended'] }
                }
            },
            { $project: { _agents: 0, _leadCount: 0, _subClients: 0 } }
        ]);

        // Flatten workspace settings for frontend compatibility, but preserve top-level
        // derived flags (isFrozen / isSuspended / accountStatus) — workspace.accountStatus
        // can shadow user.accountStatus and break freeze toggles.
        const companiesWithStats = companies.map(company => {
            const { workspace, ...userFields } = company;
            return {
                ...(workspace || {}),
                ...userFields // user fields take precedence over workspace fields
            };
        });

        res.json({
            success: true,
            companies: companiesWithStats
        });
    } catch (error) {
        console.error("Get Companies Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get single company details
const getCompanyById = async (req, res) => {
    try {
        const { id } = req.params;

        const results = await joinWorkspaceSettings({ _id: new mongoose.Types.ObjectId(id), role: COMPANY_ROLE_FILTER });
        const company = results[0];

        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        // Get company stats
        const agentsCount = await User.countDocuments({ parentId: id, role: 'agent' });
        const leadsCount = await Lead.countDocuments({ userId: id });
        const agents = await User.find({ parentId: id, role: 'agent' })
            .select('name email createdAt');

        res.json({
            success: true,
            company: {
                ...company,
                ...(company.workspace || {}),
                agentsCount,
                leadsCount,
                agents
            }
        });
    } catch (error) {
        console.error("Get Company Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Update company
const updateCompany = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, email, companyName, contactPerson, phone,
            activeModules,
            planFeatures   // sub-permission overrides (aiChatbot, metaSync, etc.)
        } = req.body;

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const normalizedEmail = email ? normalizeEmail(email) : email;

        if (normalizedEmail && normalizedEmail !== company.email) {
            const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: id } });
            if (existingUser) {
                return res.status(400).json({ message: "Email already in use" });
            }
        }

        // Update identity in User
        const updatedUser = await User.findByIdAndUpdate(
            id,
            {
                ...(name && { name }),
                ...(normalizedEmail && { email: normalizedEmail }),
                ...(companyName !== undefined && { companyName }),
                ...(contactPerson !== undefined && { contactPerson }),
                ...(phone !== undefined && { phone })
            },
            { new: true, runValidators: true }
        ).select('-password').lean();

        // Update settings in WorkspaceSettings — use $set with dotted paths so
        // we never blow away other planFeatures keys when only a few change.
        const updateFields = {};
        if (activeModules !== undefined && Array.isArray(activeModules)) updateFields.activeModules = activeModules;

        // Sub-permissions: only honor known keys to prevent arbitrary writes
        const SUB_PERMISSION_KEYS = [
            'aiChatbot', 'whatsappAutomation', 'emailAutomation', 'metaSync',
            'campaigns', 'advancedAnalytics', 'aiModel', 'webhooks'
        ];

        if (planFeatures && typeof planFeatures === 'object') {
            for (const key of SUB_PERMISSION_KEYS) {
                if (planFeatures[key] !== undefined) {
                    if (key === 'aiModel') {
                        updateFields[`planFeatures.${key}`] = planFeatures[key];
                    } else {
                        updateFields[`planFeatures.${key}`] = !!planFeatures[key];
                    }
                }
            }
        }

        if (Object.keys(updateFields).length > 0) {
            await WorkspaceSettings.findOneAndUpdate(
                { userId: id },
                { $set: updateFields },
                { upsert: true }
            );
            // Bust the tenant's cached workspace so module/feature changes take effect
            // on the very next request instead of waiting out the 5-min tenantCache TTL.
            try {
                const { clearTenantCache } = require('../middleware/authMiddleware');
                clearTenantCache(id);
            } catch { /* cache module optional */ }
        }

        const workspace = await WorkspaceSettings.findOne({ userId: id }).lean();

        res.json({
            success: true,
            message: "Company updated successfully",
            company: {
                ...updatedUser,
                ...(workspace || {})
            }
        });
    } catch (error) {
        console.error("Update Company Error:", error);
        res.status(500).json({ message: error.message || "Server Error" });
    }
};

// Delete company (and all its agents, leads, and — if it's an agency — every sub-client too).
//
// Cascade rules:
//   - Direct client (manager, no parentId): delete the company + its agents + owned data.
//   - Agency: delete the agency + its agents + every sub-client manager under it
//     + each sub-client's agents + each sub-client's owned data.
// This prevents orphaned sub-clients (a manager whose parentId points at a deleted agency).
const deleteCompany = async (req, res) => {
    try {
        const { id } = req.params;

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        // Build list of every "company" to wipe — main + sub-clients (only if agency)
        const companiesToWipe = [id];
        let subClientIds = [];
        if (company.role === 'agency') {
            const subClients = await User.find({ parentId: id, role: 'manager' }).select('_id').lean();
            subClientIds = subClients.map(c => c._id);
            companiesToWipe.push(...subClientIds);
        }

        // Per-company cleanup: each tenant gets its agents and owned records wiped
        // with the right `companyId` scope so ActivityLog rows are properly removed.
        let totalAgentsDeleted = 0;
        for (const companyId of companiesToWipe) {
            const agents = await User.find({ parentId: companyId, role: 'agent' }).select('_id').lean();
            const agentIds = agents.map(a => a._id);
            totalAgentsDeleted += agentIds.length;

            await deleteOwnedRecords([companyId, ...agentIds], { companyId });
            if (agentIds.length > 0) {
                await User.deleteMany({ _id: { $in: agentIds } });
            }
        }

        // Delete sub-client user docs (their data is already wiped above)
        if (subClientIds.length > 0) {
            await User.deleteMany({ _id: { $in: subClientIds } });
        }

        // Finally delete the company/agency itself
        await User.findByIdAndDelete(id);

        auditLogger.log({
            actor: req.user,
            actionCategory: 'COMPANY_MANAGEMENT',
            action: company.role === 'agency' ? 'AGENCY_DELETED_CASCADE' : 'COMPANY_DELETED',
            targetType: 'Company',
            targetId: id,
            targetName: company.companyName || company.email,
            details: {
                role: company.role,
                subClientsDeleted: subClientIds.length,
                agentsDeleted: totalAgentsDeleted
            },
            req
        });

        const summary = company.role === 'agency' && subClientIds.length > 0
            ? `Agency deleted along with ${subClientIds.length} sub-client${subClientIds.length === 1 ? '' : 's'} and ${totalAgentsDeleted} agent${totalAgentsDeleted === 1 ? '' : 's'}.`
            : `Company deleted along with ${totalAgentsDeleted} agent${totalAgentsDeleted === 1 ? '' : 's'} and all associated data.`;

        res.json({
            success: true,
            message: summary,
            cascade: {
                subClientsDeleted: subClientIds.length,
                agentsDeleted: totalAgentsDeleted
            }
        });
    } catch (error) {
        console.error("Delete Company Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// ==========================================
// 🧹 NORMALIZE AGENCIES — strip stale trial/expiry state from agency workspaces.
// Agencies are lifetime-free; earlier code paths incorrectly assigned them a
// 14-day trial. Runs automatically on every orphan cleanup invocation but is
// also safe to call standalone.
// ==========================================
const normalizeAgencyWorkspaces = async () => {
    const agencies = await User.find({ role: 'agency' }).select('_id').lean();
    const agencyIds = agencies.map(a => a._id);
    if (agencyIds.length === 0) return { agenciesNormalized: 0 };

    const result = await WorkspaceSettings.updateMany(
        {
            userId: { $in: agencyIds },
            $or: [
                { planExpiryDate: { $ne: null } },
                { subscriptionStatus: 'trial' },
                { billingType: 'trial' }
            ]
        },
        {
            $set: {
                planExpiryDate: null,
                subscriptionPlan: 'Lifetime Free',
                subscriptionStatus: 'active',
                billingType: 'paid_by_agency'
            }
        }
    );

    return { agenciesNormalized: result.modifiedCount || 0 };
};

// ==========================================
// 🧹 ORPHAN CLEANUP
// ==========================================
// Find managers whose parentId points to a User that no longer exists
// (left over when an agency is deleted before this cascade-delete fix existed).
// Wipes them and all their data using the same per-tenant cleanup as deleteCompany.
// Also normalizes any agency workspaces that still carry stale trial state.
const cleanupOrphanedAccounts = async (req, res) => {
    try {
        // First, normalize any agency workspace that still carries stale trial state
        // from earlier code paths. Runs every time — idempotent and cheap.
        const { agenciesNormalized } = await normalizeAgencyWorkspaces();

        // Find all sub-clients (managers with a parentId)
        const subClients = await User.find({ role: 'manager', parentId: { $ne: null } })
            .select('_id companyName email parentId')
            .lean();

        if (subClients.length === 0) {
            return res.json({
                success: true,
                deleted: 0,
                agenciesNormalized,
                message: agenciesNormalized > 0
                    ? `No orphan accounts. Normalized ${agenciesNormalized} agency workspace${agenciesNormalized === 1 ? '' : 's'}.`
                    : 'No orphan accounts to clean up.'
            });
        }

        // Batch-look up parents that exist
        const parentIds = subClients.map(c => c.parentId);
        const existingParents = await User.find({ _id: { $in: parentIds } }).select('_id').lean();
        const existingParentIds = new Set(existingParents.map(p => p._id.toString()));

        // Orphans = sub-clients whose parent ID isn't in the existing set
        const orphans = subClients.filter(c => !existingParentIds.has(c.parentId.toString()));

        if (orphans.length === 0) {
            return res.json({
                success: true,
                deleted: 0,
                agenciesNormalized,
                message: agenciesNormalized > 0
                    ? `No orphan accounts. Normalized ${agenciesNormalized} agency workspace${agenciesNormalized === 1 ? '' : 's'}.`
                    : 'No orphan accounts to clean up.'
            });
        }

        // Wipe each orphan with full per-tenant cleanup
        let totalAgentsDeleted = 0;
        const wipedNames = [];
        for (const orphan of orphans) {
            const agents = await User.find({ parentId: orphan._id, role: 'agent' }).select('_id').lean();
            const agentIds = agents.map(a => a._id);
            totalAgentsDeleted += agentIds.length;

            await deleteOwnedRecords([orphan._id, ...agentIds], { companyId: orphan._id });
            if (agentIds.length > 0) {
                await User.deleteMany({ _id: { $in: agentIds } });
            }
            await User.findByIdAndDelete(orphan._id);
            wipedNames.push(orphan.companyName || orphan.email);
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'COMPANY_MANAGEMENT',
            action: 'ORPHAN_CLEANUP',
            details: {
                deletedAccounts: orphans.length,
                deletedAgents: totalAgentsDeleted,
                names: wipedNames
            },
            req
        });

        res.json({
            success: true,
            deleted: orphans.length,
            agentsDeleted: totalAgentsDeleted,
            agenciesNormalized,
            names: wipedNames,
            message: `Removed ${orphans.length} orphan account${orphans.length === 1 ? '' : 's'} and ${totalAgentsDeleted} associated agent${totalAgentsDeleted === 1 ? '' : 's'}${agenciesNormalized > 0 ? `. Also normalized ${agenciesNormalized} agency workspace${agenciesNormalized === 1 ? '' : 's'}.` : '.'}`
        });
    } catch (error) {
        console.error('Orphan Cleanup Error:', error);
        res.status(500).json({ message: 'Failed to clean up orphan accounts.' });
    }
};

// Get company leads
const getCompanyLeads = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 50 } = req.query;

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const parsedPage = parseBoundedInteger(page, 1, { min: 1 });
        const parsedLimit = parseBoundedInteger(limit, 50, { min: 1, max: 200 });
        const skip = (parsedPage - 1) * parsedLimit;
        // ⚠️ PRODUCTION NOTE:
        // Always use `.lean()` for read-only queries to avoid Mongoose overhead.
        // Use `.select()` to limit fields — returning full documents increases memory + network cost.
        // Never return large nested arrays unless explicitly required.
        const leads = await Lead.find({ userId: id })
            .select('name phone email status source dealValue tags assignedTo createdAt updatedAt')
            .sort({ createdAt: -1 })
            .limit(parsedLimit)
            .skip(skip)
            .lean();

        const totalLeads = await Lead.countDocuments({ userId: id });

        res.json({
            success: true,
            leads,
            totalLeads,
            currentPage: parsedPage,
            totalPages: Math.ceil(totalLeads / parsedLimit)
        });
    } catch (error) {
        console.error("Get Company Leads Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Change company password
const changeCompanyPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || !hasStrongPassword(newPassword)) {
            return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
        }

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        // Password hashing is handled automatically by User model's pre('findOneAndUpdate') hook
        await User.findByIdAndUpdate(id, { password: newPassword });

        res.json({
            success: true,
            message: "Password updated successfully"
        });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get agency sub-clients (managers)
const getAgencySubClients = async (req, res) => {
    try {
        const { id } = req.params;

        const subClients = await User.aggregate([
            { $match: { parentId: new mongoose.Types.ObjectId(id), role: 'manager', deletedAt: null } },
            {
                $lookup: {
                    from: 'workspacesettings',
                    localField: '_id',
                    foreignField: 'userId',
                    as: 'workspace'
                }
            },
            { $unwind: { path: '$workspace', preserveNullAndEmptyArrays: true } },
            // Count agents via lookup
            {
                $lookup: {
                    from: 'users',
                    let: { companyId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$parentId', '$$companyId'] },
                                        { $eq: ['$role', 'agent'] }
                                    ]
                                }
                            }
                        },
                        { $count: 'count' }
                    ],
                    as: '_agents'
                }
            },
            { $sort: { createdAt: -1 } },
            {
                $project: {
                    password: 0,
                    'workspace._id': 0,
                    'workspace.userId': 0
                }
            },
            {
                $addFields: {
                    agentsCount: { $ifNull: [{ $arrayElemAt: ['$_agents.count', 0] }, 0] },
                    isFrozen: { $in: ['$accountStatus', ['Frozen', 'Suspended']] },
                    isSuspended: { $eq: ['$accountStatus', 'Suspended'] }
                }
            },
            { $project: { _agents: 0 } }
        ]);

        const clientsWithStats = subClients.map(client => {
            const { workspace, ...userFields } = client;
            return {
                ...(workspace || {}),
                ...userFields
            };
        });

        res.json({ success: true, clients: clientsWithStats });
    } catch (error) {
        console.error("Get Agency Sub-Clients Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get company agents
const getCompanyAgents = async (req, res) => {
    try {
        const { id } = req.params;

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const agents = await User.find({ parentId: id, role: 'agent' })
            .select('-password')
            .sort({ createdAt: -1 });

        const workspace = await WorkspaceSettings.findOne({ userId: id }).select('agentLimit');

        res.json({
            success: true,
            agents,
            agentLimit: getAgentLimitValue(workspace),
            currentAgentsCount: agents.length
        });
    } catch (error) {
        console.error("Get Company Agents Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Create agent for company
const createCompanyAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: "Name, email, and password are required" });
        }

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const currentAgentsCount = await User.countDocuments({ parentId: id, role: 'agent' });
        const workspace = await WorkspaceSettings.findOne({ userId: id }).select('agentLimit');
        const agentLimit = getAgentLimitValue(workspace);

        if (currentAgentsCount >= agentLimit) {
            return res.status(400).json({
                message: `Agent limit reached. Current limit: ${agentLimit}. Please upgrade plan or contact admin.`
            });
        }

        const normalizedEmail = normalizeEmail(email);
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use" });
        }

        const newAgent = await User.create({
            name,
            email: normalizedEmail,
            password: password,
            role: 'agent',
            parentId: id
        });

        res.json({
            success: true,
            message: "Agent created successfully",
            agent: {
                _id: newAgent._id,
                name: newAgent.name,
                email: newAgent.email,
                createdAt: newAgent.createdAt
            }
        });
    } catch (error) {
        console.error("Create Agent Error:", error);
        res.status(500).json({ message: error.message || "Server Error" });
    }
};

// Update agent
const updateCompanyAgent = async (req, res) => {
    try {
        const { id, agentId } = req.params;
        const { name, email, password } = req.body;

        // Verify agent belongs to company
        const agent = await User.findOne({ _id: agentId, parentId: id, role: 'agent' });
        if (!agent) {
            return res.status(404).json({ message: "Agent not found" });
        }

        const updateData = {};
        if (name) updateData.name = name;
        const normalizedEmail = email ? normalizeEmail(email) : email;
        if (normalizedEmail && normalizedEmail !== agent.email) {
            const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: agentId } });
            if (existingUser) {
                return res.status(400).json({ message: "Email already in use" });
            }
            updateData.email = normalizedEmail;
        }
        if (password) {
            if (!hasStrongPassword(password)) {
                return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
            }
            updateData.password = password;
        }

        const updatedAgent = await User.findByIdAndUpdate(agentId, updateData, { new: true })
            .select('-password');

        // Evict agent permission cache so revocation takes effect immediately.
        if (updateData.password !== undefined || updateData.permissions !== undefined) {
            try {
                const { clearAgentPermCache } = require('../middleware/authMiddleware');
                clearAgentPermCache(agentId);
            } catch { /* cache module optional */ }
        }

        res.json({
            success: true,
            message: "Agent updated successfully",
            agent: updatedAgent
        });
    } catch (error) {
        console.error("Update Agent Error:", error);
        res.status(500).json({ message: error.message || "Server Error" });
    }
};

// Delete agent
const deleteCompanyAgent = async (req, res) => {
    try {
        const { id, agentId } = req.params;

        // Verify agent belongs to company
        const agent = await User.findOne({ _id: agentId, parentId: id, role: 'agent' });
        if (!agent) {
            return res.status(404).json({ message: "Agent not found" });
        }

        await deleteOwnedRecords(agentId);
        await User.findByIdAndDelete(agentId);

        res.json({
            success: true,
            message: "Agent and all associated data deleted successfully"
        });
    } catch (error) {
        console.error("Delete Agent Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Update company agent limit
const updateAgentLimit = async (req, res) => {
    try {
        const { id } = req.params;
        const { agentLimit } = req.body;

        if (!agentLimit || agentLimit < 0) {
            return res.status(400).json({ message: "Valid agent limit is required" });
        }

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const updatedWorkspace = await WorkspaceSettings.findOneAndUpdate(
            { userId: id },
            { $set: { agentLimit: Number.parseInt(agentLimit, 10) } },
            { new: true, upsert: true }
        ).lean();

        const user = await User.findById(id).select('-password').lean();

        res.json({
            success: true,
            message: "Agent limit updated successfully",
            company: {
                ...user,
                ...(updatedWorkspace || {})
            }
        });
    } catch (error) {
        console.error("Update Agent Limit Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Billing tracking removed

// Get dashboard stats (for frontend dashboard)
//
// Rich metrics covering platform health from a SuperAdmin's perspective.
// Replaces the previous `activeSubscriptions` query which was buggy
// (looked for `'Active'` but the schema enum stores lowercase `'active'`).
const getDashboardStats = async (req, res) => {
    try {
        const SupportTicket = require('../models/SupportTicket');
        const WhatsAppLog = require('../models/WhatsAppLog');

        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);

        // 🧮 Math invariants (must hold for the dashboard breakdown to add up):
        //   totalCompanies = totalAgencies + totalDirectClients + totalSubClients
        //   totalCompanies = approvedAccounts + pendingApprovals + rejectedAccounts + deactivatedAccounts
        //
        // `approvedAccounts` = approved AND currently active. `deactivatedAccounts` covers
        // approved-but-disabled accounts plus any legacy rows whose status was never set
        // (e.g. accounts created before the approval-based system existed).
        const COMPANY_FILTER = { role: { $in: ['manager', 'agency'] } };

        const [
            totalCompanies,
            totalAgencies,
            totalDirectClients,
            totalSubClients,
            totalAgents,
            totalLeads,
            approvedAccounts,
            pendingApprovals,
            rejectedAccounts,
            frozenAccounts,
            suspendedAccounts,
            newSignupsToday,
            newSignupsThisWeek,
            leadsToday,
            leadsThisWeek,
            whatsappToday,
            emailsToday,
            openSupportTickets,
            orphanedAccounts
        ] = await Promise.all([
            User.countDocuments(COMPANY_FILTER),
            User.countDocuments({ role: 'agency' }),
            User.countDocuments({ role: 'manager', parentId: null }),
            User.countDocuments({ role: 'manager', parentId: { $ne: null } }),
            User.countDocuments({ role: 'agent' }),
            Lead.estimatedDocumentCount(), // O(1) metadata count — no full-collection scan
            User.countDocuments({ ...COMPANY_FILTER, status: 'approved', is_active: true }),
            User.countDocuments({ ...COMPANY_FILTER, status: 'pending' }),
            User.countDocuments({ ...COMPANY_FILTER, status: 'rejected' }),
            User.countDocuments({ ...COMPANY_FILTER, accountStatus: 'Frozen' }),
            User.countDocuments({ ...COMPANY_FILTER, accountStatus: 'Suspended' }),
            User.countDocuments({ ...COMPANY_FILTER, createdAt: { $gte: todayStart } }),
            User.countDocuments({ ...COMPANY_FILTER, createdAt: { $gte: weekStart } }),
            Lead.countDocuments({ createdAt: { $gte: todayStart } }),
            Lead.countDocuments({ createdAt: { $gte: weekStart } }),
            WhatsAppLog.countDocuments({ createdAt: { $gte: todayStart } }).catch(() => 0),
            EmailLog.countDocuments({ createdAt: { $gte: todayStart } }).catch(() => 0),
            SupportTicket.countDocuments({ status: { $in: ['open', 'user_replied'] } }).catch(() => 0),
            // Orphans: managers whose parentId points to a User row that no longer exists.
            // Single-aggregation approach via $lookup so we don't N+1 the DB.
            User.aggregate([
                { $match: { role: 'manager', parentId: { $ne: null } } },
                { $lookup: { from: 'users', localField: 'parentId', foreignField: '_id', as: '_parent' } },
                { $match: { _parent: { $size: 0 } } },
                { $count: 'count' }
            ]).then(r => r[0]?.count || 0).catch(() => 0)
        ]);

        // Whatever isn't in one of the three named buckets ends up here.
        // Most commonly: approved-but-deactivated accounts, or legacy rows missing the
        // status field. Surfacing this prevents silent under-count on the UI.
        const deactivatedAccounts = Math.max(
            0,
            totalCompanies - approvedAccounts - pendingApprovals - rejectedAccounts
        );

        res.json({
            // Headline counts (totalCompanies = agencies + direct + sub)
            totalCompanies,
            totalAgencies,
            totalDirectClients,
            totalSubClients,
            totalAgents,
            totalLeads,

            // Approval-state counts (replaces buggy activeSubscriptions)
            // These four sum to totalCompanies.
            approvedAccounts,
            pendingApprovals,
            rejectedAccounts,
            deactivatedAccounts,

            // Lifecycle states (orthogonal to approval status)
            frozenAccounts,
            suspendedAccounts,

            // Orphans — sub-clients whose parent agency was deleted
            orphanedAccounts,

            // Activity (today + this week)
            newSignupsToday,
            newSignupsThisWeek,
            leadsToday,
            leadsThisWeek,
            whatsappToday,
            emailsToday,

            // Support
            openSupportTickets,

            // Backwards-compat for any frontend still reading this
            activeSubscriptions: approvedAccounts
        });
    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get recent signups
const getRecentSignups = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const recentCompanies = await User.find({ role: { $in: ['manager', 'agency'] } })
            .select('companyName email createdAt')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        res.json(recentCompanies);
    } catch (error) {
        console.error("Recent Signups Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get growth data for charts (last 30 days)
const getGrowthData = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Efficient: Use MongoDB aggregation pipeline instead of in-memory filter
        const companiesAgg = await User.aggregate([
            { $match: { role: 'manager', createdAt: { $gte: startDate, $lte: endDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            }
        ]);
        const leadsAgg = await Lead.aggregate([
            { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    count: { $sum: 1 }
                }
            }
        ]);

        const companyMap = {};
        companiesAgg.forEach(item => { companyMap[item._id] = item.count; });
        const leadMap = {};
        leadsAgg.forEach(item => { leadMap[item._id] = item.count; });

        // Create date labels and count data
        const labels = [];
        const companyCounts = [];
        const leadCounts = [];

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const isoStr = date.toISOString().split('T')[0];
            labels.push(dateStr);
            companyCounts.push(companyMap[isoStr] || 0);
            leadCounts.push(leadMap[isoStr] || 0);
        }

        res.json({
            labels,
            companies: companyCounts,
            leads: leadCounts
        });
    } catch (error) {
        console.error("Growth Data Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Subscription getters removed

// ==========================================
// 🌍 GLOBAL SETTINGS
// ==========================================

// Get all system settings
const getSettings = async (req, res) => {
    try {
        const settings = await GlobalSetting.find().sort({ key: 1 });

        const { encryptToken, decryptToken } = require('../utils/encryptionUtils');

        // Convert array to object for easier frontend consumption
        const settingsMap = {};
        settings.forEach(item => {
            let val = item.value;
            if (item.key.endsWith('_api_key') && typeof val === 'string' && val) {
                val = '••••••••••••••••'; // Mask for frontend
            }
            settingsMap[item.key] = val;
        });

        // Ensure raw doesn't leak it either
        const rawMasked = settings.map(item => {
            if (item.key.endsWith('_api_key') && typeof item.value === 'string' && item.value) {
                return { ...item.toObject(), value: '••••••••••••••••' };
            }
            return item;
        });

        res.json({
            success: true,
            settings: settingsMap,
            raw: rawMasked
        });
    } catch (error) {
        console.error("Get Settings Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Update system settings (Bulk or Single)
const updateSettings = async (req, res) => {
    try {
        const { settings } = req.body; // Expect object: { 'maintenance_mode': true, 'app_name': 'MyCRM' }

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ message: "Invalid settings format" });
        }

        const { encryptToken } = require('../utils/encryptionUtils');
        const updates = [];
        for (const [key, value] of Object.entries(settings)) {
            // Ignore API key updates if they are masked (unchanged)
            if (key.endsWith('_api_key') && value === '••••••••••••••••') {
                continue;
            }

            let finalValue = value;
            if (key.endsWith('_api_key') && typeof value === 'string' && value.trim() !== '') {
                finalValue = encryptToken(value.trim());
            }

            updates.push({
                updateOne: {
                    filter: { key },
                    update: {
                        key,
                        value: finalValue,
                        updatedBy: req.user.id,
                        updatedAt: new Date()
                    },
                    upsert: true
                }
            });
        }

        if (updates.length > 0) {
            await GlobalSetting.bulkWrite(updates);
            auditLogger.log({
                actor: req.user,
                actionCategory: 'SYSTEM',
                action: 'SETTINGS_UPDATED',
                details: settings,
                req
            });
        }

        res.json({
            success: true,
            message: "Settings updated successfully"
        });
    } catch (error) {
        console.error("Update Settings Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};


// ==========================================
// 🕵️ IMPERSONATION
// ==========================================

// Login as specific user (Impersonation)
const impersonateUser = async (req, res) => {
    try {
        const { userId } = req.body; // Target ID

        const targetUser = await User.findById(userId);
        if (!targetUser) {
            return res.status(404).json({ message: "User to impersonate not found" });
        }

        // Prevent impersonating another Super Admin (Security)
        if (targetUser.role === 'superadmin') {
            return res.status(403).json({ message: "Cannot impersonate a Super Admin" });
        }

        // Generate token for that user
        const token = generateToken(targetUser._id, targetUser.role);

        // Security Log
        console.log(`🚨 ALERT: Super Admin (${req.user.email}) is impersonating ${targetUser.email}`);

        auditLogger.log({
            actor: req.user,
            actionCategory: 'IMPERSONATION',
            action: 'IMPERSONATE_START',
            targetType: 'User',
            targetId: targetUser._id,
            targetName: targetUser.email,
            req
        });

        const workspace = await WorkspaceSettings.findOne({ userId: targetUser._id }).lean();

        res.json({
            success: true,
            message: `Impersonating ${targetUser.name}`,
            token,
            user: {
                _id: targetUser._id,
                name: targetUser.name,
                email: targetUser.email,
                role: targetUser.role,
                companyName: targetUser.companyName,
                permissions: targetUser.permissions,
                activeModules: workspace?.activeModules || [],
                planFeatures: workspace?.planFeatures || {},
                isImpersonated: true
            }
        });

    } catch (error) {
        console.error("Impersonation Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// ==========================================
// ☁️ CLOUD USAGE ANALYTICS
// ==========================================

// Get aggregated platform-wide cloud usage
const getCloudUsage = async (req, res) => {
    try {
        // Current billing cycle = 1st of current month to now
        const now = new Date();
        const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // Count ACTUAL logs from this billing cycle across ALL tenants
        // + aggregate plan limit totals — all in parallel
        const [whatsappSent, emailsSent, limitAgg] = await Promise.all([
            WhatsAppLog.countDocuments({ createdAt: { $gte: cycleStart } }).catch(() => 0),
            EmailLog.countDocuments({ createdAt: { $gte: cycleStart } }).catch(() => 0),
            // ── FIX: replaced AgencySettings.find() full scan with a server-side $group ──
            // Previously: fetched every AgencySettings doc → summed in JS (O(n) docs).
            // Now: single aggregate round-trip regardless of agency count.
            AgencySettings.aggregate([
                {
                    $group: {
                        _id: null,
                        totalWhatsapp: { $sum: { $ifNull: ['$planLimits.whatsappMessagesPerMonth', 1000] } },
                        totalEmail: { $sum: { $ifNull: ['$planLimits.emailsPerMonth', 5000] } },
                        count: { $sum: 1 }
                    }
                }
            ]).catch(() => [])
        ]);

        const agg = limitAgg[0] || null;
        const totalWhatsappLimit = agg ? agg.totalWhatsapp : 6000;
        const totalEmailLimit = agg ? agg.totalEmail : 30000;

        res.json({
            success: true,
            usage: {
                whatsapp: { sent: whatsappSent, limit: totalWhatsappLimit },
                email: { sent: emailsSent, limit: totalEmailLimit }
            }
        });
    } catch (error) {
        console.error("Get Cloud Usage Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};


// ==========================================
// 🛡️ COMMAND CENTER AUDIT LOGS
// ==========================================
const getAuditLogs = async (req, res) => {
    try {
        const { page = 1, limit = 50, category, action, search } = req.query;
        const query = {};

        if (category) query.actionCategory = category;
        if (action) query.action = action;

        if (search) {
            const safe = escapeRegex(search);
            query.$or = [
                { actorName: { $regex: safe, $options: 'i' } },
                { targetName: { $regex: safe, $options: 'i' } },
                { action: { $regex: safe, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const logs = await AuditLog.find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await AuditLog.countDocuments(query);

        res.json({
            success: true,
            logs,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        console.error("Get Audit Logs Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// ==========================================
// ❄️ EMERGENCY: FREEZE TENANT
// ==========================================
const freezeTenant = async (req, res) => {
    try {
        const { id } = req.params;
        const { isFrozen } = req.body;

        const company = await User.findById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const newAccountStatus = isFrozen ? 'Suspended' : 'Active';
        const userUpdate = {
            accountStatus: newAccountStatus,
            frozenBy: isFrozen ? 'superadmin' : null,
            frozenAt: isFrozen ? new Date() : null
        };
        // Resume = full reactivation: also clear the legacy is_active flag so accounts
        // stuck with is_active=false (from the old Deactivate flow) recover with one click.
        if (!isFrozen) userUpdate.is_active = true;
        await User.findByIdAndUpdate(id, { $set: userUpdate });

        // Also update WorkspaceSettings mirror so authMiddleware's tri-state check fires
        await WorkspaceSettings.findOneAndUpdate(
            { userId: id },
            { $set: { accountStatus: newAccountStatus } }
        );

        // Invalidate the in-memory tenant cache so the next request from this
        // user sees the new status immediately, instead of waiting up to 5
        // minutes for the cache TTL to expire.
        try {
            const { clearTenantCache } = require('../middleware/authMiddleware');
            clearTenantCache(id);
        } catch (cacheErr) {
            console.warn('[Suspend] Cache invalidation failed:', cacheErr.message);
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'COMPANY_MANAGEMENT',
            action: isFrozen ? 'TENANT_SUSPENDED' : 'TENANT_UNSUSPENDED',
            targetType: 'Company',
            targetId: company._id,
            targetName: company.companyName || company.email,
            req
        });

        res.json({
            success: true,
            message: `Tenant ${isFrozen ? 'suspended' : 'reactivated'} successfully`,
            isFrozen: !!isFrozen,
            accountStatus: newAccountStatus
        });
    } catch (err) {
        console.error("Freeze Tenant Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ==========================================
// 🛑 EMERGENCY: GLOBAL KILL SWITCHES
// ==========================================
const getSystemSettings = async (req, res) => {
    try {
        const settings = await SystemSetting.find().lean();
        const settingsMap = {};
        settings.forEach(s => settingsMap[s.key] = s.value);
        res.json({ success: true, settings: settingsMap });
    } catch (err) {
        console.error("Get System Settings Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

const updateSystemSettings = async (req, res) => {
    try {
        const { settings } = req.body;

        const updates = Object.keys(settings).map(key => ({
            updateOne: {
                filter: { key },
                update: {
                    $set: {
                        value: settings[key],
                        updatedBy: req.user.userId,
                        updatedAt: new Date()
                    }
                },
                upsert: true
            }
        }));

        if (updates.length > 0) {
            await SystemSetting.bulkWrite(updates);
            invalidateConfigCache();

            auditLogger.log({
                actor: req.user,
                actionCategory: 'SYSTEM',
                action: 'SYSTEM_KILL_SWITCH_UPDATED',
                details: settings,
                req
            });
        }
        res.json({ success: true, message: "Emergency system settings successfully applied" });
    } catch (err) {
        console.error("Update System Settings Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

// ==========================================
// 🩺 SYSTEM HEALTH TELEMETRY
// ==========================================
// Moved to src/controllers/systemHealthController.js
// All tab-specific handlers (Overview, API, Database, Redis, Queues,
// Workers, Webhooks, Logs, Alerts, SystemInfo) are now in that file.
// Routes are registered in superAdminRoutes.js.
// ==========================================


// ==========================================
// 🏢 AGENCY GOVERNANCE: Allocate Plan Limits
// ==========================================
// @desc    Super Admin allocates limits for an Agency
// @route   PUT /api/superadmin/agencies/:id/limits
// @access  Private (Super Admin)
// ==========================================
// Removed Dynamic Subscription Plan Management functions

// @desc    Get current allocated limits for an Agency (Super Admin)
// @route   GET /api/superadmin/agencies/:id/limits
// @access  Private (Super Admin)
// Added because ManageAgencyLimitsModal had a stub fetch — modal always
// opened with hardcoded defaults instead of the saved values.
const getAgencyLimits = async (req, res) => {
    try {
        const { id } = req.params;
        const agency = await User.findOne({ _id: id, role: 'agency' });
        if (!agency) return res.status(404).json({ message: "Agency not found" });

        const settings = await AgencySettings.findOne({ agencyId: id }).select('planLimits usage allowNewSignups').lean();

        // If no settings yet, return defaults so the modal still works
        const limits = settings?.planLimits || {
            maxClients: 5
        };
        limits.allowNewSignups = settings?.allowNewSignups ?? true;

        const usage = settings?.usage || {};
        usage.registeredClients = await User.countDocuments({ parentId: id, role: 'manager' });

        res.json({ success: true, limits, usage });
    } catch (err) {
        console.error("Get Agency Limits Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};

const updateAgencyLimits = async (req, res) => {
    try {
        const { id } = req.params; // The Agency ID
        const { maxClients, allowNewSignups } = req.body;

        const agency = await User.findOne({ _id: id, role: 'agency' });
        if (!agency) return res.status(404).json({ message: "Agency not found" });

        const updatedSettings = await AgencySettings.findOneAndUpdate(
            { agencyId: agency._id },
            {
                $set: {
                    'planLimits.maxClients': maxClients,
                    'allowNewSignups': allowNewSignups !== undefined ? allowNewSignups : true
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'AGENCY_LIMITS_UPDATED',
            targetType: 'Agency',
            targetId: agency._id,
            targetName: agency.companyName || agency.email,
            details: { maxClients },
            req
        });

        res.json({ success: true, message: "Agency limits updated successfully", limits: updatedSettings.planLimits });
    } catch (err) {
        console.error("Update Agency Limits Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
};


// ============================================================
// 🔭 SUPER ADMIN — WORKSPACE ANALYTICS COCKPIT
// GET /api/super-admin/workspace-analytics
// Per-workspace: plan, usage logs, lead count, upgrade pressure
// ============================================================
const getWorkspaceAnalytics = async (req, res) => {
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

        // All tenant owners joined with workspace settings
        const workspaces = await joinWorkspaceSettings({ role: { $in: ['manager', 'agency'] } });

        const results = await Promise.all(workspaces.map(async (ws) => {
            const wsId = ws._id;

            // Parallel data fetch
            const [leadCount, agentCount, usageLogs] = await Promise.all([
                Lead.countDocuments({ userId: wsId }),
                User.countDocuments({ parentId: wsId, role: 'agent' }),
                UsageLog.find({ workspaceId: wsId, date: { $gte: thirtyDaysAgoStr } }).lean()
            ]);

            // Aggregate 30-day usage totals
            const usage = usageLogs.reduce((acc, day) => ({
                leadsCreated: acc.leadsCreated + (day.leadsCreated || 0),
                whatsappSent: acc.whatsappSent + (day.whatsappSent || 0),
                emailsSent: acc.emailsSent + (day.emailsSent || 0),
                automationRuns: acc.automationRuns + (day.automationRuns || 0),
                agentLogins: acc.agentLogins + (day.agentLogins || 0),
            }), { leadsCreated: 0, whatsappSent: 0, emailsSent: 0, automationRuns: 0, agentLogins: 0 });

            // Upgrade pressure score: more activity = more likely to convert
            const upgradePressureScore = Math.min(100,
                Math.round((leadCount * 1.5) + (usage.whatsappSent * 0.5) + (usage.automationRuns * 2))
            );

            // Days remaining in trial
            const now = new Date();
            const daysRemaining = ws.workspace?.planExpiryDate
                ? Math.max(0, Math.ceil((new Date(ws.workspace.planExpiryDate) - now) / (1000 * 60 * 60 * 24)))
                : null;

            return {
                workspaceId: wsId,
                name: ws.name,
                email: ws.email,
                companyName: ws.companyName,
                accountType: ws.accountType,
                plan: ws.workspace?.subscriptionPlan,
                planStatus: ws.workspace?.subscriptionStatus,
                trialStartedAt: ws.trialActivatedAt,
                trialExpiresAt: ws.workspace?.planExpiryDate,
                daysRemainingInTrial: daysRemaining,
                metaSyncEnabled: ws.workspace?.planFeatures?.metaSync === true,
                totalLeads: leadCount,
                leadLimit: ws.workspace?.planFeatures?.leadLimit || 100,
                totalAgents: agentCount,
                agentLimit: ws.workspace?.agentLimit || ws.workspace?.planFeatures?.agentLimit || 5,
                lastLogin: ws.lastLogin,
                joinedAt: ws.createdAt,
                usage30Days: usage,
                upgradePressureScore, // 0-100
            };
        }));

        // Sort by upgrade pressure descending (hottest leads first)
        results.sort((a, b) => b.upgradePressureScore - a.upgradePressureScore);

        res.json({ success: true, total: results.length, workspaces: results });
    } catch (err) {
        console.error('getWorkspaceAnalytics error:', err);
        res.status(500).json({ message: 'Failed to fetch workspace analytics' });
    }
};

// ==============================================================
// ✅ APPROVAL-BASED ACCESS CONTROL (Core System)
// Replaces all payment/subscription logic.
// Super Admin manually gates every account.
// ==============================================================

// @desc  Get all accounts pending Super Admin approval
// @route GET /api/superadmin/accounts/pending
//
// Returns each pending account joined with its WorkspaceSettings so the admin
// can see exactly what the agency requested (modules, limits, sub-permissions)
// before approving.
const getPendingRequests = async (req, res) => {
    try {
        const accounts = await User.aggregate([
            { $match: { role: { $in: ['manager', 'agency'] }, status: 'pending' } },
            {
                $lookup: {
                    from: 'workspacesettings',
                    localField: '_id',
                    foreignField: 'userId',
                    as: 'workspace'
                }
            },
            { $unwind: { path: '$workspace', preserveNullAndEmptyArrays: true } },
            { $sort: { createdAt: -1 } },
            { $project: { password: 0 } }
        ]);

        const parentIds = [...new Set(accounts.filter(a => a.parentId).map(a => a.parentId.toString()))];
        const agencies = parentIds.length > 0
            ? await User.find({ _id: { $in: parentIds } }).select('companyName name email').lean()
            : [];
        const agencyMap = {};
        agencies.forEach(a => { agencyMap[a._id.toString()] = a; });

        const enriched = accounts.map(acc => {
            if (acc.parentId) {
                const agency = agencyMap[acc.parentId.toString()];
                acc.agencyName = agency?.companyName || agency?.name || 'Unknown Agency';
                acc.agencyEmail = agency?.email;
            }
            // Surface requested config at top level for easy frontend consumption
            acc.requestedActiveModules = acc.workspace?.activeModules || [];
            acc.requestedAgentLimit = acc.workspace?.agentLimit || acc.workspace?.planFeatures?.agentLimit || 5;
            acc.requestedLeadLimit = acc.workspace?.planFeatures?.leadLimit || 100;
            acc.requestedPlanFeatures = acc.workspace?.planFeatures || {};
            return acc;
        });

        res.json({ success: true, accounts: enriched, total: enriched.length });
    } catch (error) {
        console.error('getPendingRequests Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc  Get all approved & active accounts
// @route GET /api/superadmin/accounts/active
// ⚠️ PRODUCTION NOTE:
// Avoid N+1 queries — use batched lookups instead of per-account queries.
const getActiveAccounts = async (req, res) => {
    try {
        const accounts = await User.find({
            role: { $in: ['manager', 'agency'] },
            status: 'approved',
            is_active: true
        })
            .select('-password')
            .sort({ createdAt: -1 })
            .lean();

        // Batch-fetch all parent IDs and agent counts in two queries instead of N
        const parentIds = [...new Set(accounts.filter(a => a.parentId).map(a => a.parentId.toString()))];
        const accountIds = accounts.map(a => a._id);

        const [agencies, agentCounts] = await Promise.all([
            parentIds.length > 0
                ? User.find({ _id: { $in: parentIds } }).select('companyName name').lean()
                : [],
            User.aggregate([
                { $match: { parentId: { $in: accountIds }, role: 'agent' } },
                { $group: { _id: '$parentId', count: { $sum: 1 } } }
            ])
        ]);

        const agencyMap = {};
        agencies.forEach(a => { agencyMap[a._id.toString()] = a; });
        const agentCountMap = {};
        agentCounts.forEach(a => { agentCountMap[a._id.toString()] = a.count; });

        const enriched = accounts.map(acc => {
            if (acc.parentId) {
                const agency = agencyMap[acc.parentId.toString()];
                acc.agencyName = agency?.companyName || agency?.name;
            }
            acc.agentCount = agentCountMap[acc._id.toString()] || 0;
            return acc;
        });

        res.json({ success: true, accounts: enriched, total: enriched.length });
    } catch (error) {
        console.error('getActiveAccounts Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc  Get all rejected accounts
// @route GET /api/superadmin/accounts/rejected
const getRejectedAccounts = async (req, res) => {
    try {
        const accounts = await User.find({
            role: { $in: ['manager', 'agency'] },
            status: 'rejected'
        })
            .select('-password')
            .sort({ createdAt: -1 })
            .lean();

        const parentIds = [...new Set(accounts.filter(a => a.parentId).map(a => a.parentId.toString()))];
        const agencies = parentIds.length > 0
            ? await User.find({ _id: { $in: parentIds } }).select('companyName name').lean()
            : [];
        const agencyMap = {};
        agencies.forEach(a => { agencyMap[a._id.toString()] = a; });

        const enriched = accounts.map(acc => {
            if (acc.parentId) {
                const agency = agencyMap[acc.parentId.toString()];
                acc.agencyName = agency?.companyName || agency?.name;
            }
            return acc;
        });

        res.json({ success: true, accounts: enriched, total: enriched.length });
    } catch (error) {
        console.error('getRejectedAccounts Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc  Approve an account — sets it live and usable
// @route PUT /api/superadmin/accounts/:id/approve
//
// Optional body (admin overrides — applied on top of what the agency requested):
//   activeModules: string[]
//   leadLimit: number
//   agentLimit: number
//   planFeatures: object  — sub-permissions (aiChatbot, webhooks, etc.)
//
// If no overrides are sent, the existing WorkspaceSettings (set during create) is preserved
// — i.e. the agency-requested config goes live as-is.
const approveAccount = async (req, res) => {
    try {
        const { id } = req.params;
        const { activeModules, leadLimit, agentLimit, planFeatures } = req.body || {};

        const user = await User.findOneAndUpdate(
            { _id: id, role: { $in: ['manager', 'agency'] } },
            {
                $set: {
                    approved_by_admin: true,
                    is_active: true,
                    status: 'approved',
                    accountStatus: 'Active'
                }
            },
            { new: true }
        ).select('-password');

        if (!user) return res.status(404).json({ message: 'Account not found' });

        // 🎁 TRIAL RESET ON APPROVAL — agencies are lifetime-free, managers always
        // get a fresh 14-day trial counted FROM APPROVAL (not from creation). This
        // is important because the account is unusable until approved — counting
        // trial days while it sat in the pending queue would shortchange the client.
        //
        // Exception: if the manager is already on a paid plan (subscriptionStatus
        // === 'active'), we preserve their expiry. This handles re-approvals after
        // a prior deactivation — don't reset their paid time.
        const isAgency = user.role === 'agency';
        const existingWorkspace = await WorkspaceSettings.findOne({ userId: id })
            .select('subscriptionStatus planExpiryDate').lean();
        const isAlreadyPaid = existingWorkspace?.subscriptionStatus === 'active'
            && existingWorkspace?.planExpiryDate
            && new Date(existingWorkspace.planExpiryDate).getTime() > Date.now();

        if (isAgency) {
            // Wipe any stale trial state — agencies never expire.
            await WorkspaceSettings.findOneAndUpdate(
                { userId: id },
                {
                    $set: {
                        planExpiryDate: null,
                        subscriptionPlan: 'Lifetime Free',
                        subscriptionStatus: 'active',
                        billingType: 'paid_by_agency'
                    }
                },
                { upsert: true, setDefaultsOnInsert: true }
            );
        } else if (!isAlreadyPaid) {
            // Manager on trial / pending / lapsed — start fresh 14-day trial from now.
            const trialExpiry = new Date(Date.now() + TRIAL_DURATION_MS);
            await WorkspaceSettings.findOneAndUpdate(
                { userId: id },
                {
                    $set: {
                        planExpiryDate: trialExpiry,
                        subscriptionPlan: 'Free Trial',
                        subscriptionStatus: 'trial',
                        billingType: 'trial'
                    }
                },
                { upsert: true, setDefaultsOnInsert: true }
            );
        }

        // Build override set — only include fields the admin actually sent
        const workspaceSet = {};
        if (Array.isArray(activeModules)) workspaceSet.activeModules = activeModules;
        if (leadLimit !== undefined) workspaceSet['planFeatures.leadLimit'] = parseInt(leadLimit, 10);
        if (agentLimit !== undefined) workspaceSet.agentLimit = parseInt(agentLimit, 10);

        // Sub-permissions: only honor known keys
        const SUB_PERMISSION_KEYS = [
            'aiChatbot', 'whatsappAutomation', 'emailAutomation', 'metaSync',
            'campaigns', 'advancedAnalytics', 'webhooks'
        ];
        if (planFeatures && typeof planFeatures === 'object') {
            for (const key of SUB_PERMISSION_KEYS) {
                if (planFeatures[key] !== undefined) {
                    workspaceSet[`planFeatures.${key}`] = !!planFeatures[key];
                }
            }
        }

        // If admin sent overrides, apply them. If not, leave WorkspaceSettings untouched
        // (the agency-requested config from createClient stays in place).
        if (Object.keys(workspaceSet).length > 0) {
            await WorkspaceSettings.findOneAndUpdate(
                { userId: id },
                { $set: workspaceSet },
                { upsert: true, setDefaultsOnInsert: true }
            );
        } else {
            // Safety: ensure a WorkspaceSettings row exists with sane defaults if somehow missing
            await WorkspaceSettings.findOneAndUpdate(
                { userId: id },
                {
                    $setOnInsert: {
                        userId: id,
                        activeModules: DEFAULT_ACTIVE_MODULES,
                        agentLimit: 5
                    }
                },
                { upsert: true }
            );
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'ACCOUNT_APPROVED',
            targetType: 'User',
            targetId: user._id,
            targetName: user.companyName || user.name,
            details: Object.keys(workspaceSet).length > 0 ? { overrides: workspaceSet } : undefined,
            req
        });

        res.json({
            success: true,
            message: `Account for "${user.companyName || user.name}" has been approved and activated.`,
            user
        });
    } catch (error) {
        console.error('approveAccount Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc  Reject an account
// @route PUT /api/superadmin/accounts/:id/reject
const rejectAccount = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;

        const user = await User.findOneAndUpdate(
            { _id: id, role: { $in: ['manager', 'agency'] } },
            {
                $set: {
                    approved_by_admin: false,
                    is_active: false,
                    status: 'rejected'
                }
            },
            { new: true }
        ).select('-password');

        if (!user) return res.status(404).json({ message: 'Account not found' });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'ACCOUNT_REJECTED',
            targetType: 'User',
            targetId: user._id,
            targetName: user.companyName || user.name,
            details: { reason: reason || 'No reason provided' },
            req
        });

        res.json({
            success: true,
            message: `Account for "${user.companyName || user.name}" has been rejected.`,
            user
        });
    } catch (error) {
        console.error('rejectAccount Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc  Deactivate an active account (without rejecting)
// @route PUT /api/superadmin/accounts/:id/deactivate
const deactivateAccount = async (req, res) => {
    try {
        const { id } = req.params;

        const user = await User.findOneAndUpdate(
            { _id: id, role: { $in: ['manager', 'agency'] } },
            { $set: { is_active: false } },
            { new: true }
        ).select('-password');

        if (!user) return res.status(404).json({ message: 'Account not found' });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'ACCOUNT_DEACTIVATED',
            targetType: 'User',
            targetId: user._id,
            targetName: user.companyName || user.name,
            req
        });

        res.json({ success: true, message: `Account deactivated.`, user });
    } catch (error) {
        console.error('deactivateAccount Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

const topUpAiCredits = async (req, res) => {
    try {
        const { id } = req.params;
        const { amount } = req.body;

        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ message: "Valid amount is required." });
        }

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }

        const creditsToAdd = parseInt(amount, 10);
        const adminId = req.user?.userId || req.user?.id || null;
        const note = req.body.note || 'Super-admin top-up';

        // Route through the credit service so the top-up lands in the ledger as a
        // signed +credit row (the customer's statement), not just a raw balance bump.
        const aiCreditService = require('../services/aiCreditService');
        const { granted, balanceAfter, ledgerLogged } = await aiCreditService.grant(id, creditsToAdd, {
            feature: 'topup',
            note,
            adminId
        });

        // Also record it in AiCreditTopup so this manual grant shows in the SAME
        // top-up history as paid Razorpay purchases — on both the client Billing page
        // and the SuperAdmin top-up panel. source='manual' + amountInr=0 keeps it OUT
        // of ₹-revenue rollups (it's free credits, not a sale). Only record when the
        // grant actually applied, so we never show a top-up that didn't move the
        // balance. Non-fatal: credits are already granted, so a record-write hiccup
        // must not fail the request.
        if (granted) try {
            const AiCreditTopup = require('../models/AiCreditTopup');
            await AiCreditTopup.create({
                userId: id,
                // Synthetic non-colliding ids so the unique paymentId index is happy.
                razorpayOrderId: 'manual',
                razorpayPaymentId: `manual_${new mongoose.Types.ObjectId()}`,
                amountInr: 0,
                credits: creditsToAdd,
                balanceAfter: typeof balanceAfter === 'number' ? balanceAfter : null,
                status: 'granted',
                source: 'manual',
                adminId,
                note
            });
        } catch (recErr) {
            console.error('[SuperAdmin] Failed to record manual top-up in AiCreditTopup:', recErr.message);
        }

        // Log the manual credit addition
        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'AI_CREDITS_TOPUP',
            targetType: 'User',
            targetId: id,
            targetName: user.companyName || user.name || user.email,
            details: { amount: parseInt(amount, 10), newBalance: balanceAfter },
            req
        });

        res.json({
            success: true,
            // Credits were added (balance is authoritative); flag if the statement
            // entry couldn't be written so the admin knows the ledger needs a look.
            message: ledgerLogged
                ? "AI Credits added successfully."
                : "AI Credits added, but the ledger entry failed to record — check logs to reconcile.",
            ledgerLogged,
            aiCreditsBalance: balanceAfter
        });
    } catch (err) {
        console.error("[SuperAdmin] topUpAiCredits error:", err);
        res.status(500).json({ message: "Failed to top up AI credits." });
    }
};

// @desc  List the AI model rate table (credits per 1K tokens, admin-editable)
// @route GET /api/superadmin/ai-model-rates
const getAiModelRates = async (req, res) => {
    try {
        const aiCreditService = require('../services/aiCreditService');
        const rates = await aiCreditService.listRates();
        res.json({ rates, creditValueInr: aiCreditService.CREDIT_VALUE_INR, defaultRatePer1k: aiCreditService.DEFAULT_RATE_PER_1K });
    } catch (err) {
        console.error('[SuperAdmin] getAiModelRates error:', err);
        res.status(500).json({ message: 'Failed to load AI model rates.' });
    }
};

// @desc  Create or update one model's credit rate (takes effect immediately)
// @route PUT /api/superadmin/ai-model-rates
const updateAiModelRate = async (req, res) => {
    try {
        const { model, provider, label, creditsPer1kTokens, active } = req.body;
        if (!model) return res.status(400).json({ message: 'model is required.' });

        const aiCreditService = require('../services/aiCreditService');
        const row = await aiCreditService.upsertRate({
            model, provider, label, creditsPer1kTokens, active,
            adminId: req.user?.userId || req.user?.id || null
        });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'AI_MODEL_RATE_UPDATE',
            targetType: 'AiModelRate',
            targetId: row._id,
            targetName: model,
            details: { creditsPer1kTokens: row.creditsPer1kTokens, active: row.active },
            req
        });

        res.json({ success: true, rate: row });
    } catch (err) {
        console.error('[SuperAdmin] updateAiModelRate error:', err);
        res.status(500).json({ message: 'Failed to update AI model rate.' });
    }
};

// @desc  AI credit ledger for a specific tenant (super-admin statement view)
// @route GET /api/superadmin/accounts/:id/ai-ledger
const getTenantAiLedger = async (req, res) => {
    try {
        const { id } = req.params;
        const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
        const skip = parseInt(req.query.skip, 10) || 0;

        const aiCreditService = require('../services/aiCreditService');
        const [entries, summary, wallet] = await Promise.all([
            aiCreditService.getLedger(id, { limit, skip }),
            aiCreditService.getUsageSummary(id),
            aiCreditService.getWallet(id)
        ]);
        res.json({ entries, summary, wallet });
    } catch (err) {
        console.error('[SuperAdmin] getTenantAiLedger error:', err);
        res.status(500).json({ message: 'Failed to load tenant AI ledger.' });
    }
};

// @route GET /api/superadmin/ai-credit-topups
// Self-serve AI credit purchases (Razorpay one-time Orders), per client. Deliberately
// SEPARATE from the subscription Payment/finance ledger so credit-sale revenue is
// tracked without distorting subscription MRR. Returns a per-client rollup + recent
// rows + grand totals.
const listAiCreditTopups = async (req, res) => {
    try {
        const AiCreditTopup = require('../models/AiCreditTopup');
        const limit = Math.min(500, parseInt(req.query.limit, 10) || 100);

        // Recent granted top-ups, newest first, with client identity.
        const rows = await AiCreditTopup.find({ status: 'granted' })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('userId', 'name companyName email')
            .lean();

        const topups = rows.map(t => ({
            _id: t._id,
            clientId: t.userId?._id || t.userId || null,
            clientName: t.userId?.companyName || t.userId?.name || '—',
            clientEmail: t.userId?.email || '',
            source: t.source || 'razorpay',   // 'razorpay' (paid) | 'manual' (admin grant)
            amountInr: t.amountInr,
            credits: t.credits,
            note: t.note || '',
            razorpayPaymentId: t.razorpayPaymentId,
            razorpayOrderId: t.razorpayOrderId,
            createdAt: t.createdAt
        }));

        // Conditional sums so PAID (razorpay) revenue is never mixed with free MANUAL
        // (admin) grants. ₹ totals count paid only; manual is tracked as its own stat.
        const paidAmt = { $cond: [{ $eq: ['$source', 'manual'] }, 0, '$amountInr'] };
        const paidCr = { $cond: [{ $eq: ['$source', 'manual'] }, 0, '$credits'] };
        const paidOne = { $cond: [{ $eq: ['$source', 'manual'] }, 0, 1] };
        const manualCr = { $cond: [{ $eq: ['$source', 'manual'] }, '$credits', 0] };
        const manualOne = { $cond: [{ $eq: ['$source', 'manual'] }, 1, 0] };

        // Grand totals across ALL granted top-ups (not just the returned page).
        const totalsAgg = await AiCreditTopup.aggregate([
            { $match: { status: 'granted' } },
            {
                $group: {
                    _id: null,
                    amountInr: { $sum: paidAmt },
                    credits: { $sum: paidCr },
                    count: { $sum: paidOne },
                    manualCredits: { $sum: manualCr },
                    manualCount: { $sum: manualOne }
                }
            }
        ]);
        const totals = {
            amountInr: totalsAgg[0]?.amountInr || 0,      // ₹ from paid purchases only
            credits: totalsAgg[0]?.credits || 0,        // credits sold (paid)
            count: totalsAgg[0]?.count || 0,          // paid purchases
            manualCredits: totalsAgg[0]?.manualCredits || 0,  // free admin-granted credits
            manualCount: totalsAgg[0]?.manualCount || 0     // number of admin grants
        };

        // Per-client rollup — "clean per client" view: paid ₹/credits AND admin grants.
        const byClientAgg = await AiCreditTopup.aggregate([
            { $match: { status: 'granted' } },
            {
                $group: {
                    _id: '$userId',
                    amountInr: { $sum: paidAmt },
                    paidCredits: { $sum: paidCr },
                    manualCredits: { $sum: manualCr },
                    count: { $sum: 1 },
                    lastAt: { $max: '$createdAt' }
                }
            },
            { $sort: { amountInr: -1, lastAt: -1 } },
            { $limit: 100 }
        ]);
        const clientIds = byClientAgg.map(c => c._id).filter(Boolean);
        const users = await User.find({ _id: { $in: clientIds } }).select('name companyName email').lean();
        const userMap = new Map(users.map(u => [String(u._id), u]));
        const byClient = byClientAgg.map(c => {
            const u = userMap.get(String(c._id));
            return {
                clientId: c._id,
                clientName: u?.companyName || u?.name || '—',
                clientEmail: u?.email || '',
                amountInr: c.amountInr,
                paidCredits: c.paidCredits,
                manualCredits: c.manualCredits,
                count: c.count,
                lastAt: c.lastAt
            };
        });

        res.json({ topups, byClient, totals });
    } catch (err) {
        console.error('[SuperAdmin] listAiCreditTopups error:', err);
        res.status(500).json({ message: 'Failed to load AI credit top-ups.' });
    }
};

// ── AI Support Assistant (platform-owned, super-admin controlled) ────────────
// Config + usage counters live in GlobalSetting under this key.
const AI_SUPPORT_KEY = 'ai_support_config';
const AI_SUPPORT_DEFAULTS = {
    enabled: false,
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    agentName: 'AI Support',
    systemPrompt: '',
    // usage counters (updated by the support flow, read-only here)
    creditsUsedThisMonth: 0,
    creditsUsedTotal: 0,
    repliesTotal: 0,
    usageMonth: ''
};

// @desc  Get the platform AI Support config + usage stats
// @route GET /api/superadmin/ai-support-config
const getAiSupportConfig = async (req, res) => {
    try {
        const doc = await GlobalSetting.findOne({ key: AI_SUPPORT_KEY }).lean();
        const cfg = { ...AI_SUPPORT_DEFAULTS, ...(doc?.value || {}) };
        const aiCreditService = require('../services/aiCreditService');
        res.json({
            config: {
                enabled: !!cfg.enabled,
                provider: cfg.provider,
                model: cfg.model,
                agentName: cfg.agentName,
                systemPrompt: cfg.systemPrompt
            },
            usage: {
                creditsUsedThisMonth: cfg.creditsUsedThisMonth || 0,
                creditsUsedTotal: cfg.creditsUsedTotal || 0,
                repliesTotal: cfg.repliesTotal || 0,
                inrThisMonth: aiCreditService.creditsToInr(cfg.creditsUsedThisMonth || 0),
                inrTotal: aiCreditService.creditsToInr(cfg.creditsUsedTotal || 0),
                creditValueInr: aiCreditService.CREDIT_VALUE_INR
            }
        });
    } catch (err) {
        console.error('[SuperAdmin] getAiSupportConfig error:', err);
        res.status(500).json({ message: 'Failed to load AI support config.' });
    }
};

// @desc  Update the platform AI Support config (never touches usage counters)
// @route PUT /api/superadmin/ai-support-config
const updateAiSupportConfig = async (req, res) => {
    try {
        const { enabled, provider, model, agentName, systemPrompt } = req.body;
        if (provider !== undefined && !['gemini', 'openai'].includes(provider)) {
            return res.status(400).json({ message: 'Invalid provider — must be "gemini" or "openai".' });
        }
        const doc = await GlobalSetting.findOne({ key: AI_SUPPORT_KEY });
        const current = doc?.value || { ...AI_SUPPORT_DEFAULTS };

        const merged = {
            ...AI_SUPPORT_DEFAULTS,
            ...current,
            ...(enabled !== undefined ? { enabled: !!enabled } : {}),
            ...(provider !== undefined ? { provider } : {}),
            ...(model !== undefined ? { model } : {}),
            ...(agentName !== undefined ? { agentName } : {}),
            ...(systemPrompt !== undefined ? { systemPrompt: String(systemPrompt).substring(0, 2000) } : {})
        };

        await GlobalSetting.updateOne(
            { key: AI_SUPPORT_KEY },
            { $set: { value: merged, updatedBy: req.user?.userId || req.user?.id || null, updatedAt: new Date() } },
            { upsert: true }
        );

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'AI_SUPPORT_CONFIG_UPDATE',
            targetType: 'GlobalSetting',
            targetName: AI_SUPPORT_KEY,
            details: { enabled: merged.enabled, provider: merged.provider, model: merged.model },
            req
        });

        res.json({
            success: true,
            config: {
                enabled: merged.enabled, provider: merged.provider, model: merged.model,
                agentName: merged.agentName, systemPrompt: merged.systemPrompt
            }
        });
    } catch (err) {
        console.error('[SuperAdmin] updateAiSupportConfig error:', err);
        res.status(500).json({ message: 'Failed to update AI support config.' });
    }
};

// @desc  Update granular permissions (e.g., AI Voice Access override)
// @route PUT /api/superadmin/accounts/:id/permissions
const updateAccountPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const { aiVoiceAccess } = req.body;

        const user = await User.findById(id);
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (aiVoiceAccess !== undefined) {
            user.permissions.aiVoiceAccess = aiVoiceAccess;
        }

        await user.save();

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'ACCOUNT_PERMISSIONS_UPDATED',
            targetType: 'User',
            targetId: id,
            targetName: user.companyName || user.name || user.email,
            details: { newPermissions: user.permissions },
            req
        });

        res.json({ success: true, message: `Permissions updated successfully.`, permissions: user.permissions });
    } catch (error) {
        console.error('updateAccountPermissions Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// ==========================================
// 🌳 CLIENT MODULE PERMISSIONS (Feature Registry tree)
// ==========================================

// GET /api/superadmin/companies/:id/permissions
// Returns the canonical feature registry + this client's resolved on/off state.
// The entitlement baseline a client's overrides layer on top of: their current
// plan, or the trial defaults when they aren't on a paid plan yet. Returned as a
// plan-like { activeModules, planFeatures, featureFlags } object.
const getBaselineSource = async (ws) => {
    if (ws?.currentPlanCode) {
        const plan = await Plan.findOne({ code: ws.currentPlanCode }).lean();
        if (plan) return plan;
    }
    return { activeModules: DEFAULT_ACTIVE_MODULES, planFeatures: {}, featureFlags: {} };
};

const getClientPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const company = await User.findById(id).select('_id name companyName email role').lean();
        if (!company) return res.status(404).json({ message: 'Company not found' });

        const ws = await WorkspaceSettings.findOne({ userId: id }).lean() || {};
        res.json({
            success: true,
            registry: FEATURE_REGISTRY,
            // Effective (plan baseline + overrides) is exactly what the materialized
            // WorkspaceSettings fields hold, so resolveValues(ws) is the display state.
            values: resolveValues(ws),
        });
    } catch (error) {
        console.error('getClientPermissions Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// PUT /api/superadmin/companies/:id/permissions
// Body: { values: { [nodeKey]: boolean } }
// Persists the admin's selection as a sparse OVERRIDE map (only deviations from the
// tenant's plan baseline), then materializes plan+overrides into the enforced
// activeModules / planFeatures / featureFlags. Storing overrides separately is what
// lets them survive plan renewals & catalog edits (every plan-apply re-layers them).
const updateClientPermissions = async (req, res) => {
    try {
        const { id } = req.params;
        const { values } = req.body || {};
        if (!values || typeof values !== 'object') {
            return res.status(400).json({ message: 'values object is required' });
        }

        // Create a workspace on demand if the account doesn't have one yet (e.g. an
        // agency), so the permission manager works uniformly for every account type.
        let ws = await WorkspaceSettings.findOne({ userId: id });
        if (!ws) ws = new WorkspaceSettings({ userId: id });

        // Overrides = only the nodes the admin set differently from the plan baseline.
        const baselineSource = await getBaselineSource(ws);
        const baselineValues = resolveValues(baselineSource);
        const overrides = encodeOverrides(diffOverrides(values, baselineValues));

        // Materialize plan baseline + overrides into the enforced buckets, preserving
        // this workspace's numeric limits and any non-tree planFeatures (base = ws).
        const eff = resolveEffective(baselineSource, overrides, ws.toObject());

        ws.overrides = overrides;
        ws.activeModules = eff.activeModules;
        Object.assign(ws.planFeatures, eff.planFeatures);
        ws.featureFlags = eff.featureFlags;
        // Mixed/subdoc fields need an explicit dirty flag to persist mutations.
        ws.markModified('overrides');
        ws.markModified('featureFlags');
        ws.markModified('planFeatures');
        await ws.save(); // post-save hook busts the tenant cache

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'CLIENT_PERMISSIONS_UPDATED',
            targetType: 'WorkspaceSettings',
            targetId: id,
            targetName: (await User.findById(id).select('companyName name email').lean())?.companyName || id,
            details: { activeModules: ws.activeModules, planFeatures: ws.planFeatures, featureFlags: ws.featureFlags, overrides: ws.overrides },
            req
        });

        res.json({ success: true, message: 'Permissions updated successfully', values: resolveValues(ws.toObject()) });
    } catch (error) {
        console.error('updateClientPermissions Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// ==========================================
// 🎙️ GLOBAL VOICE TEMPLATES
// ==========================================

const getGlobalVoiceTemplates = async (req, res) => {
    try {
        const templates = await VoiceTemplate.find({ isGlobal: true }).sort({ createdAt: -1 });
        res.json({ success: true, templates });
    } catch (error) {
        console.error('[SuperAdmin] Error fetching global voice templates:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch global templates' });
    }
};

const createGlobalVoiceTemplate = async (req, res) => {
    try {
        const tenantId = req.user.userId || req.user.id; // Super admin's ID
        const templateData = {
            ...req.body,
            tenantId,
            isGlobal: true // Force to global
        };

        const template = await VoiceTemplate.create(templateData);

        // Log action
        await auditLogger.log({
            actor: req.user,
            actionCategory: 'SYSTEM_SETTINGS',
            action: 'GLOBAL_VOICE_TEMPLATE_CREATED',
            targetType: 'VoiceTemplate',
            targetId: template._id,
            targetName: template.name,
            req
        });

        res.status(201).json({ success: true, template });
    } catch (error) {
        console.error('[SuperAdmin] Error creating global voice template:', error);
        res.status(500).json({ success: false, error: 'Failed to create global template' });
    }
};

const deleteGlobalVoiceTemplate = async (req, res) => {
    try {
        const { id } = req.params;

        const template = await VoiceTemplate.findOneAndDelete({ _id: id, isGlobal: true });
        if (!template) {
            return res.status(404).json({ success: false, error: 'Global template not found' });
        }

        // Log action
        await auditLogger.log({
            actor: req.user,
            actionCategory: 'SYSTEM_SETTINGS',
            action: 'GLOBAL_VOICE_TEMPLATE_DELETED',
            targetType: 'VoiceTemplate',
            targetId: template._id,
            targetName: template.name,
            req
        });

        res.json({ success: true, message: 'Global template deleted' });
    } catch (error) {
        console.error('[SuperAdmin] Error deleting global voice template:', error);
        res.status(500).json({ success: false, error: 'Failed to delete global template' });
    }
};

module.exports = {
    getSaaSAnalytics,
    getAllCompanies,
    getCompanyById,
    updateCompany,
    deleteCompany,
    freezeTenant,
    getCompanyLeads,
    changeCompanyPassword,
    getCompanyAgents,
    getAgencySubClients,
    createCompanyAgent,
    updateCompanyAgent,
    deleteCompanyAgent,
    updateAgentLimit,
    getDashboardStats,
    getRecentSignups,
    getGrowthData,
    createCompany,
    getSettings,
    updateSettings,
    getSystemSettings,
    updateSystemSettings,
    impersonateUser,
    getCloudUsage,
    getAuditLogs,
    getAgencyLimits,
    updateAgencyLimits,
    getWorkspaceAnalytics,
    // ✅ Approval-Based Access Control
    getPendingRequests,
    getActiveAccounts,
    getRejectedAccounts,
    approveAccount,
    rejectAccount,
    deactivateAccount,
    topUpAiCredits,
    getAiModelRates,
    updateAiModelRate,
    getTenantAiLedger,
    listAiCreditTopups,
    getAiSupportConfig,
    updateAiSupportConfig,
    updateAccountPermissions,
    getClientPermissions,
    updateClientPermissions,
    // 🧹 Maintenance
    cleanupOrphanedAccounts,
    // 🎙️ Global Voice Templates
    getGlobalVoiceTemplates,
    createGlobalVoiceTemplate,
    deleteGlobalVoiceTemplate
};
