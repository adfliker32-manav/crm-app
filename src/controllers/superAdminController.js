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
const DEFAULT_AGENT_LIMIT = 5;
const DEFAULT_ACTIVE_MODULES = ['leads', 'team', 'reports', 'settings'];
const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

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

        const hashedPassword = await bcrypt.hash(password, 10);
        const newCompany = await User.create({
            companyName,
            name,
            email: normalizedEmail,
            password: hashedPassword,
            phone,
            role: req.body.role === 'agency' ? 'agency' : 'manager',
            isOnboarded: true,
            accountStatus: 'Active',
            // Super Admin creates accounts already approved — no pending flow needed
            is_active: true,
            approved_by_admin: true,
            status: 'approved'
        });

        await Promise.all([
            WorkspaceSettings.create({
                userId: newCompany._id,
                subscriptionStatus: 'Trial',
                subscriptionPlan: 'Free',
                billingType: 'trial',
                planExpiryDate: new Date(Date.now() + TRIAL_DURATION_MS),
                agentLimit: DEFAULT_AGENT_LIMIT,
                activeModules: DEFAULT_ACTIVE_MODULES
            }),
            IntegrationConfig.create({
                userId: newCompany._id
            })
        ]);

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
            Lead.countDocuments(),
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
const getAllCompanies = async (req, res) => {
    try {
        const companies = await joinWorkspaceSettings({ role: COMPANY_ROLE_FILTER });

        // Get additional stats for each company
        const companiesWithStats = await Promise.all(
            companies.map(async (company) => {
                const agentsCount = await User.countDocuments({ parentId: company._id, role: 'agent' });
                const leadsCount = await Lead.countDocuments({ userId: company._id });

                return {
                    ...company,
                    // Flatten workspace settings for frontend compatibility
                    ...(company.workspace || {}),
                    agentsCount,
                    leadsCount
                };
            })
        );

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
        const { name, email, companyName, contactPerson, phone, activeModules, leadLimit, agentLimit } = req.body;

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

        // Update settings in WorkspaceSettings
        const updateFields = {};
        if (activeModules !== undefined && Array.isArray(activeModules)) updateFields.activeModules = activeModules;
        if (leadLimit !== undefined) updateFields['planFeatures.leadLimit'] = Number.parseInt(leadLimit, 10);
        if (agentLimit !== undefined) updateFields.agentLimit = Number.parseInt(agentLimit, 10);

        if (Object.keys(updateFields).length > 0) {
            await WorkspaceSettings.findOneAndUpdate(
                { userId: id },
                { $set: updateFields },
                { upsert: true }
            );
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

// Delete company (and all its agents and leads)
const deleteCompany = async (req, res) => {
    try {
        const { id } = req.params;

        const company = await findCompanyById(id);
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const agents = await User.find({ parentId: id, role: 'agent' });
        const agentIds = agents.map(a => a._id);
        const allUserIds = [id, ...agentIds];

        await Promise.all([
            deleteOwnedRecords(allUserIds, { companyId: id }),
            User.deleteMany({ parentId: id, role: 'agent' })
        ]);

        // Delete the company manager
        await User.findByIdAndDelete(id);

        auditLogger.log({
            actor: req.user,
            actionCategory: 'COMPANY_MANAGEMENT',
            action: 'COMPANY_DELETED',
            targetType: 'Company',
            targetId: id,
            targetName: company.companyName || company.email,
            req
        });

        res.json({
            success: true,
            message: "Company and all associated data deleted successfully"
        });
    } catch (error) {
        console.error("Delete Company Error:", error);
        res.status(500).json({ message: "Server Error" });
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
        const leads = await Lead.find({ userId: id })
            .sort({ createdAt: -1 })
            .limit(parsedLimit)
            .skip(skip);

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

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(id, { password: hashedPassword });

        res.json({
            success: true,
            message: "Password updated successfully"
        });
    } catch (error) {
        console.error("Change Password Error:", error);
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

        const hashedPassword = await bcrypt.hash(password, 10);
        const newAgent = await User.create({
            name,
            email: normalizedEmail,
            password: hashedPassword,
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
            updateData.password = await bcrypt.hash(password, 10);
        }

        const updatedAgent = await User.findByIdAndUpdate(agentId, updateData, { new: true })
            .select('-password');

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
const getDashboardStats = async (req, res) => {
    try {
        const [totalCompanies, totalLeads, totalAgents] = await Promise.all([
            User.countDocuments({ role: { $in: ['manager', 'agency'] } }),
            Lead.countDocuments(),
            User.countDocuments({ role: 'agent' })
        ]);

        const activeSubscriptions = await WorkspaceSettings.countDocuments({
            subscriptionStatus: 'Active'
        });

        res.json({
            totalCompanies,
            totalLeads,
            totalAgents,
            activeSubscriptions
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

        // Convert array to object for easier frontend consumption
        const settingsMap = {};
        settings.forEach(item => {
            settingsMap[item.key] = item.value;
        });

        res.json({
            success: true,
            settings: settingsMap,
            raw: settings
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

        const updates = [];
        for (const [key, value] of Object.entries(settings)) {
            updates.push({
                updateOne: {
                    filter: { key },
                    update: {
                        key,
                        value,
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

        res.json({
            success: true,
            message: `Impersonating ${targetUser.name}`,
            token,
            user: {
                _id: targetUser._id,
                name: targetUser.name,
                email: targetUser.email,
                role: targetUser.role
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
        const agencySettings = await AgencySettings.find().select('usage planLimits');
        
        let totalWhatsapp = 0;
        let totalEmails = 0;
        let totalWhatsappLimit = 0;
        let totalEmailLimit = 0;

        agencySettings.forEach(setting => {
            totalWhatsapp += setting.usage?.whatsappSent || 0;
            totalEmails += setting.usage?.emailsSent || 0;
            totalWhatsappLimit += setting.planLimits?.whatsappMessagesPerMonth || 1000;
            totalEmailLimit += setting.planLimits?.emailsPerMonth || 5000;
        });

        res.json({
            success: true,
            usage: {
                whatsapp: {
                    sent: totalWhatsapp,
                    limit: totalWhatsappLimit
                },
                email: {
                    sent: totalEmails,
                    limit: totalEmailLimit
                }
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
            query.$or = [
                { actorName: { $regex: search, $options: 'i' } },
                { targetName: { $regex: search, $options: 'i' } },
                { action: { $regex: search, $options: 'i' } }
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
        await User.findByIdAndUpdate(id, {
            $set: {
                accountStatus: newAccountStatus,
                frozenBy: isFrozen ? 'superadmin' : null,
                frozenAt: isFrozen ? new Date() : null
            }
        });

        // Also update WorkspaceSettings mirror so authMiddleware's tri-state check fires
        await WorkspaceSettings.findOneAndUpdate(
            { userId: id },
            { $set: { accountStatus: newAccountStatus } }
        );

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

    // 5️⃣ Messaging Delivery Health
    const wa = metrics.delivery.whatsapp;
    if (wa.successRate < 93 && wa.totalAttempts > 10) escalate('critical', `WhatsApp Deliverability Failing (${wa.successRate}%)`);

    // 6️⃣ Infrastructure Crashes
    const memoryUsagePercent = (metrics.server.memoryUsageMB / metrics.server.totalMemoryMB) * 100;
    if (memoryUsagePercent > 90) escalate('critical', `Memory Saturation > 90% (${Math.round(memoryUsagePercent)}%)`);
    
    // CPU Load > 85% sustained (approximation)
    const cpuCores = os.cpus().length;
    if (metrics.server.loadAverage[0] / cpuCores > 0.85) escalate('warning', `Sustained High CPU Load`);

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
            const dbStats = await mongoose.connection.db.admin().serverStatus();
            health.database = {
                connections: dbStats.connections.current,
                activeQueries: dbStats.globalLock.activeClients.total,
                documentQueries: dbStats.opcounters.query,
                inserts: dbStats.opcounters.insert,
                updates: dbStats.opcounters.update
            };
        } catch (dbErr) {
            console.error("DB Stat Error:", dbErr.message);
            health.database = { connections: 0, error: "Unable to retrieve DB stats." };
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

const updateAgencyLimits = async (req, res) => {
    try {
        const { id } = req.params; // The Agency ID
        const { maxClients, whatsappMessagesPerMonth, emailsPerMonth } = req.body;

        const agency = await User.findOne({ _id: id, role: 'agency' });
        if (!agency) return res.status(404).json({ message: "Agency not found" });

        const updatedSettings = await AgencySettings.findOneAndUpdate(
            { agencyId: agency._id },
            { 
                $set: { 
                    'planLimits.maxClients': maxClients,
                    'planLimits.whatsappMessagesPerMonth': whatsappMessagesPerMonth,
                    'planLimits.emailsPerMonth': emailsPerMonth
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
            details: { maxClients, whatsappMessagesPerMonth, emailsPerMonth },
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
                leadsCreated:   acc.leadsCreated   + (day.leadsCreated   || 0),
                whatsappSent:   acc.whatsappSent   + (day.whatsappSent   || 0),
                emailsSent:     acc.emailsSent     + (day.emailsSent     || 0),
                automationRuns: acc.automationRuns + (day.automationRuns || 0),
                agentLogins:    acc.agentLogins    + (day.agentLogins    || 0),
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
                workspaceId:          wsId,
                name:                 ws.name,
                email:                ws.email,
                companyName:          ws.companyName,
                accountType:          ws.accountType,
                plan:                 ws.workspace?.subscriptionPlan,
                planStatus:           ws.workspace?.subscriptionStatus,
                trialStartedAt:       ws.trialActivatedAt,
                trialExpiresAt:       ws.workspace?.planExpiryDate,
                daysRemainingInTrial: daysRemaining,
                metaSyncEnabled:      ws.workspace?.planFeatures?.metaSync === true,
                totalLeads:           leadCount,
                leadLimit:            ws.workspace?.planFeatures?.leadLimit || 100,
                totalAgents:          agentCount,
                agentLimit:           ws.workspace?.agentLimit || ws.workspace?.planFeatures?.agentLimit || 5,
                lastLogin:            ws.lastLogin,
                joinedAt:             ws.createdAt,
                usage30Days:          usage,
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
const getPendingRequests = async (req, res) => {
    try {
        const accounts = await User.find({ 
            role: { $in: ['manager', 'agency'] },
            status: 'pending'
        })
        .select('-password')
        .sort({ createdAt: -1 })
        .lean();

        // Enrich with agency name if sub-client
        const enriched = await Promise.all(accounts.map(async (acc) => {
            if (acc.parentId) {
                const agency = await User.findById(acc.parentId).select('companyName name email').lean();
                acc.agencyName = agency?.companyName || agency?.name || 'Unknown Agency';
                acc.agencyEmail = agency?.email;
            }
            return acc;
        }));

        res.json({ success: true, accounts: enriched, total: enriched.length });
    } catch (error) {
        console.error('getPendingRequests Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc  Get all approved & active accounts
// @route GET /api/superadmin/accounts/active
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

        const enriched = await Promise.all(accounts.map(async (acc) => {
            if (acc.parentId) {
                const agency = await User.findById(acc.parentId).select('companyName name').lean();
                acc.agencyName = agency?.companyName || agency?.name;
            }
            const agentCount = await User.countDocuments({ parentId: acc._id, role: 'agent' });
            acc.agentCount = agentCount;
            return acc;
        }));

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

        const enriched = await Promise.all(accounts.map(async (acc) => {
            if (acc.parentId) {
                const agency = await User.findById(acc.parentId).select('companyName name').lean();
                acc.agencyName = agency?.companyName || agency?.name;
            }
            return acc;
        }));

        res.json({ success: true, accounts: enriched, total: enriched.length });
    } catch (error) {
        console.error('getRejectedAccounts Error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// @desc  Approve an account — sets it live and usable
// @route PUT /api/superadmin/accounts/:id/approve
const approveAccount = async (req, res) => {
    try {
        const { id } = req.params;

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

        // Also ensure WorkspaceSettings exists
        await WorkspaceSettings.findOneAndUpdate(
            { userId: id },
            { $setOnInsert: { 
                userId: id,
                activeModules: ['leads', 'team', 'reports', 'email', 'whatsapp', 'settings'],
                agentLimit: 5
            }},
            { upsert: true }
        );

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'ACCOUNT_APPROVED',
            targetType: 'User',
            targetId: user._id,
            targetName: user.companyName || user.name,
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
    updateAgencyLimits,
    getWorkspaceAnalytics,
    // ✅ Approval-Based Access Control
    getPendingRequests,
    getActiveAccounts,
    getRejectedAccounts,
    approveAccount,
    rejectAccount,
    deactivateAccount
};
