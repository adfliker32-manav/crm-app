const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const Lead = require('../models/Lead');
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
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const auditLogger = require('../services/auditLogger');

// 2. LOGIN (Purana User)
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // SECURITY FIX: Input validation
        if (!email || !password) {
            return res.status(400).json({ message: "Email and password are required" });
        }

        // User dhundo
        const user = await User.findOne({ email: email.toLowerCase().trim() });
        if (!user) {
            auditLogger.log({
                actionCategory: 'SECURITY',
                action: 'LOGIN_FAILED',
                details: { reason: 'User not found', emailAttempted: email },
                req
            });
            return res.status(400).json({ message: "Invalid Email or Password" });
        }

        // If user signed up via Google and has no password
        if (user.authProvider === 'google' && !user.password) {
            return res.status(400).json({ message: "This account uses Google Sign-In. Please use the 'Sign in with Google' button." });
        }

        // Password match karo
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            auditLogger.log({
                actionCategory: 'SECURITY',
                action: 'LOGIN_FAILED',
                details: { reason: 'Invalid password', emailAttempted: email },
                req
            });
            return res.status(400).json({ message: "Invalid Email or Password" });
        }

        // ==========================================
        // ✅ APPROVAL-BASED ACCESS CONTROL CHECK
        // ==========================================
        // Superadmin always gets in. Everyone else needs approval.
        if (user.role !== 'superadmin') {
            if (!user.approved_by_admin) {
                return res.status(403).json({ 
                    message: "Account not approved yet. Please wait for admin approval.",
                    status: 'pending_approval'
                });
            }
            if (!user.is_active) {
                return res.status(403).json({ 
                    message: "Account has been deactivated. Please contact your administrator.",
                    status: 'deactivated'
                });
            }
            if (user.status === 'rejected') {
                return res.status(403).json({ 
                    message: "Account application was rejected. Please contact support.",
                    status: 'rejected'
                });
            }
        }

        const ownerId = user.role === 'agent' ? user.parentId : user._id;
        const workspace = await WorkspaceSettings.findOne({ userId: ownerId });

        // 🔥 Token Payload (Yahan Magic Hoga)
        // Hum Token ke andar likh rahe hain ki ye banda 'superadmin' hai ya 'manager'
        const payload = {
            userId: user._id,
            role: user.role,
            name: user.name,
            permissions: user.permissions, // Include permissions for Agents
            tenantId: user.role === 'agent' ? user.parentId : user._id // Avoid DB lookups later!
        };

        // SECURITY FIX: Require JWT_SECRET from environment
        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = jwt.sign(
            payload,
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        auditLogger.log({
            actor: user,
            actionCategory: 'SECURITY',
            action: 'LOGIN_SUCCESS',
            req
        });

        // Frontend ko bhi batao ki role kya hai
        res.json({
            token,
            role: user.role,
            user: { 
                id: user._id, 
                name: user.name, 
                email: user.email, 
                role: user.role, 
                permissions: user.permissions, 
                is_active: user.is_active,
                approved_by_admin: user.approved_by_admin,
                status: user.status,
                activeModules: workspace?.activeModules || [],
                isOnboarded: user.isOnboarded
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 2.5 GOOGLE LOGIN (OAuth)
exports.googleLogin = async (req, res) => {
    try {
        const { credential, allowNewUser = true } = req.body;

        if (!credential) {
            return res.status(400).json({ message: 'Google credential is required' });
        }

        const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
        if (!GOOGLE_CLIENT_ID) {
            console.error('GOOGLE_CLIENT_ID missing from environment');
            return res.status(500).json({ message: 'Google login is not configured on the server' });
        }

        // Verify the Google ID token
        const client = new OAuth2Client(GOOGLE_CLIENT_ID);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        const { sub: googleId, email, name, picture } = payload;

        if (!email) {
            return res.status(400).json({ message: 'Unable to get email from Google account' });
        }

        // Find existing user by googleId or email
        let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });

        if (user) {
            // Update googleId if user exists by email but hasn't linked Google yet
            if (!user.googleId) {
                user.googleId = googleId;
                user.authProvider = user.password ? user.authProvider : 'google';
                await user.save();
            }
            // Check if existing user has essential details to be considered onboarded
            if (!user.isOnboarded && user.companyName) {
                user.isOnboarded = true;
                await user.save();
            }
        } else {
            // New users cannot register via Google Auth anymore
            return res.status(404).json({ 
                message: "You don't have an account with this Google email. Please contact the Super Admin to provision your account.",
                isNewUser: true 
            });
        }
        
        // Fetch workspace for login response
        const ownerId = user.role === 'agent' ? user.parentId : user._id;
        const workspace = await WorkspaceSettings.findOne({ userId: ownerId });

        // Create JWT token (same format as normal login)
        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const tokenPayload = {
            userId: user._id,
            role: user.role,
            name: user.name,
            permissions: user.permissions,
            tenantId: user.role === 'agent' ? user.parentId : user._id
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '1d' });

        res.json({
            token,
            role: user.role,
            user: { 
                id: user._id, 
                name: user.name, 
                email: user.email, 
                role: user.role, 
                permissions: user.permissions,
                subscriptionStatus: workspace?.subscriptionStatus || 'Trial',
                planExpiryDate: workspace?.planExpiryDate,
                activeModules: workspace?.activeModules || [],
                isOnboarded: user.isOnboarded
            }
        });

    } catch (err) {
        console.error('Google Login Error:', err);
        if (err.message?.includes('Token used too late') || err.message?.includes('Invalid token')) {
            return res.status(401).json({ message: 'Google token has expired. Please try again.' });
        }
        res.status(500).json({ message: 'Google authentication failed. Please try again.' });
    }
};

// 3. CREATE AGENT (Manager apne neeche employee banayega)
exports.createAgent = async (req, res) => {
    try {
        const { name, email, password, permissions } = req.body;
        const { BASIC_AGENT } = require('../constants/permissionPresets');

        // 1. Check permission
        const canManageTeam = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.manageTeam === true;
        if (!canManageTeam) {
            return res.status(403).json({ message: "Unauthorized to manage team" });
        }

        // 2. Check duplicate email
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ message: "User already exists" });

        // 2.5 CRITICAL FIX: Enforce Agent Limit from WorkspaceSettings
        const managerId = req.user.role === 'agent' ? req.user.parentId : req.user.userId;
        const workspace = await WorkspaceSettings.findOne({ userId: managerId }).select('agentLimit');
        const currentAgentCount = await User.countDocuments({ parentId: managerId, role: 'agent' });
        const limit = workspace?.agentLimit || 5;
        
        if (currentAgentCount >= limit) {
            return res.status(403).json({ 
                message: `Upgrade required. You have reached your current plan limit of ${limit} agents.` 
            });
        }

        // 3. Password Encrypt
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Use provided permissions or default to BASIC_AGENT preset
        const agentPermissions = permissions || BASIC_AGENT;

        // 5. Create Agent Linked to Manager
        user = await User.create({
            name,
            email,
            password: hashedPassword,
            role: 'agent',            // Role fix hai
            parentId: req.user.userId, // Manager ka ID yahan save hoga
            permissions: agentPermissions // Add permissions
        });

        res.json({
            success: true,
            message: "Agent Created Successfully!",
            agent: {
                id: user._id,
                name: user.name,
                email: user.email,
                permissions: user.permissions
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};
// 4. GET MY TEAM (Manager apne agents dekhega)
// 5. DELETE AGENT (Manager apne agent ko remove kar sakta hai)
exports.deleteAgent = async (req, res) => {
    try {
        const agentId = req.params.id;

        // Verify requester is a manager or has manageTeam permission
        const canManageTeam = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.manageTeam === true;
        if (!canManageTeam) {
            return res.status(403).json({ message: "Unauthorized to manage team" });
        }

        // Find the agent and ensure they belong to this manager
        const agent = await User.findOne({ _id: agentId, parentId: req.user.userId });

        if (!agent) {
            return res.status(404).json({ message: "Agent not found or does not belong to you" });
        }

        // Cascade delete agent's data
        await Promise.all([
            Lead.deleteMany({ userId: agentId }),
            WhatsAppConversation.deleteMany({ userId: agentId }),
            WhatsAppMessage.deleteMany({ userId: agentId }),
            WhatsAppTemplate.deleteMany({ userId: agentId }),
            WhatsAppBroadcast.deleteMany({ userId: agentId }),
            WhatsAppLog.deleteMany({ userId: agentId }),
            EmailLog.deleteMany({ userId: agentId }),
            EmailTemplate.deleteMany({ userId: agentId }),
            ChatbotFlow.deleteMany({ userId: agentId }),
            ChatbotSession.deleteMany({ userId: agentId }),
            Stage.deleteMany({ userId: agentId }),
            ActivityLog.deleteMany({ userId: agentId })
        ]);

        // Delete the agent
        await User.findByIdAndDelete(agentId);

        res.json({ success: true, message: "Agent and all associated data deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 5.5 UPDATE AGENT (Manager updates agent permissions/details)
exports.updateAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, permissions, password } = req.body;

        // Only managers or users with permission can update agents
        const canManageTeam = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.manageTeam === true;
        if (!canManageTeam) {
            return res.status(403).json({ message: "Unauthorized to manage team" });
        }

        // Find agent and ensure they belong to this manager
        const agent = await User.findOne({ _id: id, parentId: req.user.userId, role: 'agent' });

        if (!agent) {
            return res.status(404).json({ message: "Agent not found or does not belong to you" });
        }

        // Update fields
        const updateData = {};
        if (name) updateData.name = name;
        if (permissions) updateData.permissions = permissions;

        // Handle password update
        if (password) {
            if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(password)) {
                return res.status(400).json({ message: "Password must be at least 8 characters, and include uppercase, lowercase, number, and special character" });
            }
            const salt = await bcrypt.genSalt(10);
            updateData.password = await bcrypt.hash(password, salt);
        }

        const updatedAgent = await User.findByIdAndUpdate(id, updateData, { new: true })
            .select('-password');

        res.json({
            success: true,
            message: "Agent updated successfully",
            agent: updatedAgent
        });

    } catch (err) {
        console.error("Update Agent Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// 6. GET MY TEAM
exports.getMyTeam = async (req, res) => {
    try {
        // Sirf wo users dhundo jinka 'parentId' logged-in user (Manager) hai
        const agents = await User.find({ parentId: req.user.userId }).select('-password'); // Password mat bhejna
        res.json(agents);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 6. UPDATE PROFILE (User apna naam/password change kar sakta hai)
exports.updateProfile = async (req, res) => {
    try {
        const { name, password } = req.body;
        const userId = req.user.userId;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: "User not found" });

        if (name && name.trim()) {
            user.name = name.trim();
        }

        if (password && password.trim()) {
            if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/.test(password)) {
                return res.status(400).json({ message: "Password must be at least 8 characters, and include uppercase, lowercase, number, and special character" });
            }
            const salt = await bcrypt.genSalt(10);
            user.password = await bcrypt.hash(password, salt);
        }

        await user.save();

        res.json({ success: true, message: "Profile updated successfully", user: { id: user._id, name: user.name, email: user.email } });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 7. GET PUBLIC PLANS (For viewing subscription plans)
exports.getPlans = async (req, res) => {
    try {
        // Billing removed
        res.json({ success: true, plans: [] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

// 8. GET APP NAME (Public - no auth required)
exports.getAppName = async (req, res) => {
    try {
        const GlobalSetting = require('../models/GlobalSetting');
        const appNameSetting = await GlobalSetting.findOne({ key: 'app_name' });
        res.json({
            success: true,
            appName: appNameSetting?.value || 'CRM Pro'
        });
    } catch (err) {
        console.error(err);
        res.json({ success: true, appName: 'CRM Pro' }); // Fallback on error
    }
};