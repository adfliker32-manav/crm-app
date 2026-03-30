const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const AgencySettings = require('../models/AgencySettings');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const auditLogger = require('../services/auditLogger');
const mongoose = require('mongoose');

// @desc    Impersonate Client
// @route   GET /api/agency/impersonate/:clientId
// @access  Private (Agency Only)
const impersonateClient = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const { clientId } = req.params;

        // 1. Verify that the requested Client actually belongs to this Agency
        const client = await User.findOne({ _id: clientId, parentId: agencyId, role: 'manager' });

        if (!client) {
            return res.status(404).json({ message: "Client not found or unassigned to your Agency." });
        }

        // 2. Generate a specialized JWT.
        const payload = {
            userId: client._id,
            role: client.role,
            tenantId: client._id,
            permissions: client.permissions || {}
        };

        const impersonationToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '2h' });

        // 3. AUDIT: Log every impersonation for forensic accountability
        auditLogger.log({
            actor: req.user,
            actionCategory: 'AGENCY_MANAGEMENT',
            action: 'AGENCY_IMPERSONATION',
            targetType: 'Client',
            targetId: client._id,
            targetName: client.companyName || client.name,
            details: {
                agencyId,
                agencyName: req.user.companyName || req.user.name || 'Unknown Agency',
                clientEmail: client.email,
                sessionDuration: '2h'
            },
            req
        });

        res.status(200).json({
            success: true,
            message: `Securely hijacking session for ${client.companyName || client.name}...`,
            token: impersonationToken,
            user: {
                _id: client._id,
                name: client.name,
                email: client.email,
                role: client.role,
                companyName: client.companyName,
                permissions: client.permissions,
                isImpersonated: true
            }
        });

    } catch (error) {
        console.error("Impersonation Error:", error);
        res.status(500).json({ message: "Server error during session impersonation." });
    }
};

// @desc    Get All Sub-Clients for the Agency
// @route   GET /api/agency/clients
// @access  Private (Agency Only)
const getAgencyClients = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        
        const clients = await User.aggregate([
            { $match: { parentId: new mongoose.Types.ObjectId(agencyId), role: 'manager' } },
            {
                $lookup: {
                    from: 'workspacesettings',
                    localField: '_id',
                    foreignField: 'userId',
                    as: 'settings'
                }
            },
            { $unwind: { path: '$settings', preserveNullAndEmptyArrays: true } },
            { $sort: { createdAt: -1 } },
            {
                $project: {
                    _id: 1,
                    companyName: { $ifNull: ["$companyName", "$name"] },
                    name: 1,
                    email: 1,
                    phone: 1,
                    // New approval-based fields
                    is_active: 1,
                    approved_by_admin: 1,
                    status: 1,
                    accountStatus: 1,
                    frozenBy: 1,
                    createdAt: 1,
                    activeModules: "$settings.activeModules",
                    planFeatures: "$settings.planFeatures",
                    agentLimit: "$settings.agentLimit",
                    users: { $literal: 1 }
                }
            }
        ]);

        res.status(200).json({ success: true, clients });
    } catch (error) {
        console.error("Get Agency Clients Error:", error);
        res.status(500).json({ message: "Failed to fetch clients." });
    }
};


// @desc    Get Agency Analytics Dashboard Data
// @route   GET /api/agency/analytics
// @access  Private (Agency Only)
const getAgencyAnalytics = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        
        const analyticsData = await User.aggregate([
            { $match: { parentId: new mongoose.Types.ObjectId(agencyId), role: 'manager' } },
            {
                $facet: {
                    stats: [
                        {
                            $group: {
                                _id: null,
                                totalClients: { $sum: 1 },
                                activeClients: { 
                                    $sum: { $cond: [{ $eq: ["$is_active", true] }, 1, 0] } 
                                },
                                pendingClients: { 
                                    $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } 
                                },
                                approvedClients: { 
                                    $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } 
                                }
                            }
                        }
                    ],
                    recentSignups: [
                        { $sort: { createdAt: -1 } },
                        { $limit: 5 },
                        {
                            $project: {
                                _id: 1,
                                companyName: { $ifNull: ["$companyName", "$name"] },
                                createdAt: 1,
                                status: 1,
                                is_active: 1,
                                accountStatus: 1
                            }
                        }
                    ]
                }
            }
        ]);

        const statsResult = analyticsData[0]?.stats[0] || { totalClients: 0, activeClients: 0, pendingClients: 0, approvedClients: 0 };
        const recentSignups = analyticsData[0]?.recentSignups || [];

        res.status(200).json({
            success: true,
            stats: {
                totalClients: statsResult.totalClients,
                activeClients: statsResult.activeClients,
                pendingClients: statsResult.pendingClients,
                approvedClients: statsResult.approvedClients,
                recentSignups
            }
        });
    } catch (error) {
        console.error("Get Agency Analytics Error:", error);
        res.status(500).json({ message: "Failed to fetch analytics." });
    }
};

// ==========================================
// AGENCY FREEZE: Toggle Client Freeze
// ==========================================
const toggleClientFreeze = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const { clientId } = req.params;
        const { freeze } = req.body;

        // 1. Verify ownership
        const client = await User.findOne({ _id: clientId, parentId: agencyId, role: 'manager' });
        if (!client) {
            return res.status(404).json({ message: "Client not found under your agency." });
        }

        // 2. GOVERNANCE RULE: Agency CANNOT unfreeze a Super Admin suspension
        if (!freeze && client.accountStatus === 'Suspended') {
            return res.status(403).json({ 
                message: "This account was suspended by Platform Administration. You cannot unfreeze it. Contact support." 
            });
        }

        // 3. Apply the state change
        client.accountStatus = freeze ? 'Frozen' : 'Active';
        client.frozenBy = freeze ? 'agency' : null;
        client.frozenAt = freeze ? new Date() : null;
        await client.save();

        // 4. Audit trail
        auditLogger.log({
            actor: req.user,
            actionCategory: 'AGENCY_MANAGEMENT',
            action: freeze ? 'AGENCY_CLIENT_FROZEN' : 'AGENCY_CLIENT_UNFROZEN',
            targetType: 'Client',
            targetId: client._id,
            targetName: client.companyName || client.name,
            details: { agencyId, reason: req.body.reason || 'No reason provided' },
            req
        });

        res.json({
            success: true,
            message: `Client ${freeze ? 'frozen' : 'unfrozen'} successfully.`,
            accountStatus: client.accountStatus
        });
    } catch (error) {
        console.error("Toggle Client Freeze Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// ==========================================
// CREATE CLIENT (Approval-Based — Replaces provisionTrial)
// ==========================================
// @desc    Agency creates a client account — goes to PENDING until Super Admin approves
// @route   POST /api/agency/clients
// @access  Private (Agency Only)
const createClient = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const { companyName, adminEmail, adminName, phone, password } = req.body;

        if (!companyName || !adminEmail) {
            return res.status(400).json({ message: 'Company name and admin email are required.' });
        }

        // 1. Ensure email is not already taken
        const existing = await User.findOne({ email: adminEmail.toLowerCase() });
        if (existing) {
            return res.status(409).json({ message: 'An account with this email already exists.' });
        }

        // 2. Generate password (use provided or auto-generate)
        const rawPassword = password || crypto.randomBytes(5).toString('hex');
        const hashedPassword = await bcrypt.hash(rawPassword, 10);

        // 3. Create sub-client with PENDING status — requires Super Admin approval
        const newClient = await User.create({
            name: adminName || companyName,
            email: adminEmail.toLowerCase().trim(),
            password: hashedPassword,
            phone: phone || null,
            role: 'manager',
            parentId: agencyId,
            companyName: companyName.trim(),
            authProvider: 'local',
            isOnboarded: true,
            accountStatus: 'Active',
            // ✅ Approval-based fields — MUST be approved by Super Admin before use
            is_active: false,
            approved_by_admin: false,
            status: 'pending'
        });

        // 4. Initialize Workspace
        await WorkspaceSettings.create({
            userId: newClient._id,
            activeModules: ['leads', 'team', 'reports', 'settings'], // Minimal defaults
            agentLimit: 2, // Minimal initial limit
            'planFeatures.leadLimit': 100 // Minimal initial limit
        });

        await IntegrationConfig.create({ userId: newClient._id });
        await AgencySettings.create({ agencyId: newClient._id });

        // 5. Audit log
        auditLogger.log({
            actor: req.user,
            actionCategory: 'AGENCY_MANAGEMENT',
            action: 'AGENCY_CLIENT_CREATED_PENDING',
            targetType: 'Client',
            targetId: newClient._id,
            targetName: newClient.companyName,
            details: { agencyId, adminEmail, status: 'pending' },
            req
        });

        res.status(201).json({
            success: true,
            message: `Account created for ${companyName}. Pending Super Admin approval.`,
            client: {
                _id: newClient._id,
                companyName: newClient.companyName,
                email: newClient.email,
                status: 'pending',
                is_active: false,
                approved_by_admin: false
            },
            credentials: { email: adminEmail, tempPassword: rawPassword }
        });

    } catch (error) {
        console.error('Create Client Error:', error);
        res.status(500).json({ message: 'Failed to create client account.' });
    }
};

// @desc    Update Agency Sub-Client Properties and Modules
// @route   PUT /api/agency/clients/:clientId
// @access  Private (Agency Only)
const updateClient = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const { clientId } = req.params;
        const { companyName, name, email, phone, activeModules, leadLimit, agentLimit } = req.body;

        // 1. Verify ownership
        const client = await User.findOne({ _id: clientId, parentId: agencyId, role: 'manager' });
        if (!client) {
            return res.status(404).json({ message: "Client not found or access denied." });
        }

        // 2. 🔐 SECURITY: Module Inheritance Check
        // Agency can ONLY give modules that they themselves possess.
        if (activeModules && Array.isArray(activeModules)) {
            const agencyWorkspace = await WorkspaceSettings.findOne({ userId: agencyId }).select('activeModules').lean();
            const allowedModules = agencyWorkspace?.activeModules || [];

            // Find modules requested but not owned by the Agency
            const unauthorizedModules = activeModules.filter(mod => !allowedModules.includes(mod));

            if (unauthorizedModules.length > 0) {
                return res.status(403).json({
                    success: false,
                    error: 'module_locked',
                    message: `Security violation: You cannot grant the following modules as you do not have them yourself: ${unauthorizedModules.join(', ')}`
                });
            }
        }

        // 3. Update User Identity
        const updateData = {};
        if (companyName) updateData.companyName = companyName;
        if (name) updateData.name = name;
        if (email) {
            // Check if email already exists
            const existing = await User.findOne({ email: email.toLowerCase(), _id: { $ne: clientId } });
            if (existing) {
                return res.status(409).json({ message: 'Email already in use by another account.' });
            }
            updateData.email = email.toLowerCase();
        }
        if (phone !== undefined) updateData.phone = phone;

        const updatedUser = await User.findByIdAndUpdate(clientId, { $set: updateData }, { new: true }).select('-password').lean();

        // 4. Update WorkspaceSettings (Modules & Limits)
        const workspaceUpdate = {};
        if (activeModules !== undefined) workspaceUpdate.activeModules = activeModules;
        if (leadLimit !== undefined) workspaceUpdate['planFeatures.leadLimit'] = parseInt(leadLimit);
        if (agentLimit !== undefined) workspaceUpdate.agentLimit = parseInt(agentLimit);

        if (Object.keys(workspaceUpdate).length > 0) {
            await WorkspaceSettings.findOneAndUpdate(
                { userId: clientId },
                { $set: workspaceUpdate },
                { upsert: true }
            );
        }

        const workspace = await WorkspaceSettings.findOne({ userId: clientId }).lean();

        res.status(200).json({
            success: true,
            message: "Client identity and workspace permissions updated.",
            client: {
                ...updatedUser,
                ...(workspace || {})
            }
        });

    } catch (error) {
        console.error('Update Agency Client Error:', error);
        res.status(500).json({ message: 'Internal server error updating client permissions.' });
    }
};

module.exports = {
    impersonateClient,
    getAgencyClients,
    getAgencyAnalytics,
    toggleClientFreeze,
    createClient,
    updateClient
};
