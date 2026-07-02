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
const mongoose = require('mongoose');
const os = require('os');
const telemetryService = require('../services/telemetryService');
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
const { TRIAL_DURATION_MS, DEFAULT_AGENT_LIMIT, DEFAULT_ACTIVE_MODULES } = require('../constants/trial');

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
                    isFrozen:    { $in: ['$accountStatus', ['Frozen', 'Suspended']] },
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
        const weekStart  = new Date(); weekStart.setDate(weekStart.getDate() - 7);

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
                        totalEmail:    { $sum: { $ifNull: ['$planLimits.emailsPerMonth', 5000] } },
                        count:         { $sum: 1 }
                    }
                }
            ]).catch(() => [])
        ]);

        const agg = limitAgg[0] || null;
        const totalWhatsappLimit = agg ? agg.totalWhatsapp : 6000;
        const totalEmailLimit    = agg ? agg.totalEmail    : 30000;

        res.json({
            success: true,
            usage: {
                whatsapp: { sent: whatsappSent, limit: totalWhatsappLimit },
                email:    { sent: emailsSent,   limit: totalEmailLimit }
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
// 🚨 CORE CRITICAL MONITORING (ALERT LOGIC)
// ==========================================
const analyzeHealthStatus = (metrics) => {
    // Return Format: { level: 'healthy' | 'warning' | 'critical' | 'outage', triggers: [] }
    let level = 'healthy';
    const triggers = [];

    const escalate = (newLevel, reason) => {
        const levels = { 'healthy': 0, 'warning': 1, 'critical': 2, 'outage': 3 };
        if (levels[newLevel] > levels[level]) level = newLevel;
        triggers.push(reason);
    };

    // 1️⃣ API Failure Rate
    if (metrics.api.errorRatePercent > 3) escalate('critical', `API Error Rate > 3% (${metrics.api.errorRatePercent}%)`);
    else if (metrics.api.errorRatePercent > 1) escalate('warning', `Elevated API Errors (${metrics.api.errorRatePercent}%)`);
    if (metrics.api.authFailurePercent > 20) escalate('critical', `Auth Spike > 20% (${metrics.api.authFailurePercent}%)`);

    // 2️⃣ Webhook Processing
    if (metrics.webhook.successRatePercent < 95) escalate('critical', `Webhook Success Dropped < 95% (${metrics.webhook.successRatePercent}%)`);
    if (metrics.webhook.avgLatencyMs > 10000) escalate('critical', `Webhook Delay Over 10s (${metrics.webhook.avgLatencyMs}ms)`);

    // 3️⃣ Automation Engine & Queue Backlog
    const q = metrics.queue.agenda;
    if (q.automationFailures > 5) escalate('warning', `Automation Failures Detected (${q.automationFailures})`);
    if (q.automationFailures > 25) escalate('critical', `High Automation Malfunctions (${q.automationFailures})`);
    if (q.pending > 100 && q.active === 0) escalate('critical', `Queue Deadlock! ${q.pending} pending but 0 active workers.`);

    // 4️⃣ Database Performance
    const maxConnectionsAllowed = 500; // Assuming typical Mongo pool
    if (metrics.database.connections > (maxConnectionsAllowed * 0.85)) escalate('critical', `DB Connections saturated (>85%)`);

    if (metrics.database.storageLimitBytes > 0) {
        const storageUsagePercent = (metrics.database.totalUsedBytes / metrics.database.storageLimitBytes) * 100;
        if (storageUsagePercent > 95) escalate('critical', `DB Storage Critically Low (>95%)`);
        else if (storageUsagePercent > 80) escalate('warning', `DB Storage Filling Up (>80%)`);
    }


    // 5️⃣ Messaging Delivery Health
    const wa = metrics.delivery.whatsapp;
    if (wa.successRate < 93 && wa.totalAttempts > 10) escalate('critical', `WhatsApp Deliverability Failing (${wa.successRate}%)`);

    // 6️⃣ Infrastructure Crashes
    const memoryUsagePercent = (metrics.server.memoryUsageMB / metrics.server.totalMemoryMB) * 100;
    if (memoryUsagePercent > 90) escalate('critical', `Memory Saturation > 90% (${Math.round(memoryUsagePercent)}%)`);

    // CPU Load check — uses per-core load ratio to avoid false positives on low-core servers.
    // Rule: warn only if 1-min load average exceeds 1.5× the core count (genuinely busy),
    //       critical if it exceeds 3× core count (severely overloaded).
    // A ratio of 1.0 means every core is fully utilized — 0.85 fires on virtually every server.
    const cpuCores = os.cpus().length || 1;
    const cpuRatio = metrics.server.loadAverage[0] / cpuCores;
    if (cpuRatio > 3.0) escalate('critical', `CPU Critically Overloaded (${cpuRatio.toFixed(1)}× cores)`);
    else if (cpuRatio > 1.5) escalate('warning', `Sustained High CPU Load (${cpuRatio.toFixed(1)}× cores)`);

    // 7️⃣ Abuse Detection
    if (metrics.topTenant && metrics.topTenant.requestCount > 5000) {
        escalate('warning', `Abnormal Traffic Spike from Tenant ${metrics.topTenant.tenantId}`);
    }

    return { level, triggers };
};

// ==========================================
// 🩺 SYSTEM HEALTH TELEMETRY
// ==========================================
const getSystemHealth = async (req, res) => {
    try {
        const health = {};

        // In-Memory Red Alert Stats
        health.api = telemetryService.getApiStats();
        health.webhook = telemetryService.getWebhookStats();
        health.topTenant = telemetryService.getTopTenantUsage();

        // 1. Server Memory & Load
        health.server = {
            uptimeSeconds: process.uptime(),
            memoryUsageMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
            freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
            loadAverage: os.loadavg(), // [1-min, 5-min, 15-min]
            apiLatencyMs: health.api.avgLatencyMs
        };

        // 2. Database Telemetry
        try {
            const serverStatus = await mongoose.connection.db.admin().serverStatus();
            const dbStats = await mongoose.connection.db.stats();

            const totalUsedBytes = (dbStats.dataSize || 0) + (dbStats.indexSize || 0);

            health.database = {
                connections: serverStatus.connections?.current || 0,
                activeQueries: serverStatus.globalLock?.activeClients?.total || 0,
                documentQueries: serverStatus.opcounters?.query || 0,
                inserts: serverStatus.opcounters?.insert || 0,
                updates: serverStatus.opcounters?.update || 0,

                // Storage Stats
                dataSize: dbStats.dataSize || 0,
                indexSize: dbStats.indexSize || 0,
                totalUsedBytes: totalUsedBytes,
                storageLimitBytes: 536870912 // 512 MB (M0 Free Tier limit)
            };
        } catch (dbErr) {
            console.error("DB Stat Error:", dbErr.message);
            health.database = { connections: 0, error: "Unable to retrieve DB stats: " + dbErr.message };
        }

        // 3. Queue Health (Agenda)
        try {
            const jobsCollection = mongoose.connection.db.collection('agendaJobs');
            const totalJobs = await jobsCollection.countDocuments();
            const failedJobs = await jobsCollection.countDocuments({ failedAt: { $exists: true } });
            const pendingJobs = await jobsCollection.countDocuments({
                nextRunAt: { $exists: true, $ne: null },
                lockedAt: null
            });
            const activeJobs = await jobsCollection.countDocuments({ lockedAt: { $exists: true, $ne: null } });

            const automationFailures = await jobsCollection.countDocuments({
                name: 'EXECUTE_AUTOMATION_ACTION',
                failedAt: { $exists: true }
            });

            health.queue = {
                agenda: {
                    total: totalJobs,
                    failed: failedJobs,
                    pending: pendingJobs,
                    active: activeJobs,
                    automationFailures
                }
            };
        } catch (qErr) {
            health.queue = { agenda: { failed: 0, pending: 0, active: 0, automationFailures: 0 }, error: "Failed to read Agenda collection." };
        }

        // 4. Message Delivery Health
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1); // Only check last 24h

        const whatsappSentPromise = WhatsAppLog.countDocuments({ status: 'sent', createdAt: { $gte: yesterday } });
        const whatsappFailedPromise = WhatsAppLog.countDocuments({ status: 'failed', createdAt: { $gte: yesterday } });

        const emailSentPromise = EmailLog.countDocuments({ status: 'sent', createdAt: { $gte: yesterday } });
        const emailFailedPromise = EmailLog.countDocuments({ status: 'failed', createdAt: { $gte: yesterday } });

        const [waSent, waFailed, emSent, emFailed] = await Promise.all([
            whatsappSentPromise, whatsappFailedPromise,
            emailSentPromise, emailFailedPromise
        ]);

        health.delivery = {
            whatsapp: {
                sent24h: waSent,
                failed24h: waFailed,
                totalAttempts: waSent + waFailed,
                successRate: waSent + waFailed === 0 ? 100 : Math.round((waSent / (waSent + waFailed)) * 100)
            },
            email: {
                sent24h: emSent,
                failed24h: emFailed,
                totalAttempts: emSent + emFailed,
                successRate: emSent + emFailed === 0 ? 100 : Math.round((emSent / (emSent + emFailed)) * 100)
            }
        };

        // Execute Intelligence Analysis
        health.alertStatus = analyzeHealthStatus(health);

        res.json({ success: true, health });

    } catch (error) {
        console.error("Health Check Error:", error);
        res.status(500).json({ success: false, message: "Failed to gather system health telemetry" });
    }
};

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
    getSystemHealth,
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
    // 🧹 Maintenance
    cleanupOrphanedAccounts
};
