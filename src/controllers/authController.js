const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const GlobalSetting = require('../models/GlobalSetting');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const auditLogger = require('../services/auditLogger');
const { BASIC_AGENT } = require('../constants/permissionPresets');
const { deleteOwnedRecords } = require('../services/accountCleanupService');
const {
    STRONG_PASSWORD_MESSAGE,
    normalizeEmail,
    getRequestUserId,
    hasManageTeamAccess,
    hasStrongPassword
} = require('../utils/controllerHelpers');

const TOKEN_EXPIRY = '1d';
const PASSWORD_SALT_ROUNDS = 10;

const getWorkspaceForUser = (user) => {
    const ownerId = user.role === 'agent' ? user.parentId : user._id;
    return WorkspaceSettings.findOne({ userId: ownerId });
};

const buildAuthPayload = (user) => ({
    userId: user._id,
    role: user.role,
    name: user.name,
    permissions: user.permissions,
    tenantId: user.role === 'agent' ? user.parentId : user._id
});

const buildBaseUserResponse = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    isOnboarded: user.isOnboarded
});

const buildLoginUserResponse = (user, workspace) => ({
    ...buildBaseUserResponse(user),
    is_active: user.is_active,
    approved_by_admin: user.approved_by_admin,
    status: user.status,
    activeModules: workspace?.activeModules || []
});

const buildGoogleUserResponse = (user, workspace) => ({
    ...buildBaseUserResponse(user),
    subscriptionStatus: workspace?.subscriptionStatus || 'Trial',
    planExpiryDate: workspace?.planExpiryDate,
    activeModules: workspace?.activeModules || []
});

const getJwtSecret = () => process.env.JWT_SECRET;

const signAuthToken = (user) =>
    jwt.sign(buildAuthPayload(user), getJwtSecret(), { expiresIn: TOKEN_EXPIRY });

// password hashing is now handled by User model hooks

const logFailedLogin = (reason, emailAttempted, req) => {
    auditLogger.log({
        actionCategory: 'SECURITY',
        action: 'LOGIN_FAILED',
        details: { reason, emailAttempted },
        req
    });
};

const blockUnapprovedLogin = (user, res) => {
    if (user.role === 'superadmin') {
        return false;
    }

    if (!user.approved_by_admin) {
        res.status(403).json({
            message: 'Account not approved yet. Please wait for admin approval.',
            status: 'pending_approval'
        });
        return true;
    }

    if (!user.is_active) {
        res.status(403).json({
            message: 'Account has been deactivated. Please contact your administrator.',
            status: 'deactivated'
        });
        return true;
    }

    if (user.status === 'rejected') {
        res.status(403).json({
            message: 'Account application was rejected. Please contact support.',
            status: 'rejected'
        });
        return true;
    }

    return false;
};

const findManagedAgent = (managerId, agentId) =>
    User.findOne({ _id: agentId, parentId: managerId, role: 'agent' });

// 2. LOGIN (Purana User)
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ message: 'Email and password are required' });
        }

        const normalizedEmail = normalizeEmail(email);
        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            logFailedLogin('User not found', email, req);
            return res.status(400).json({ message: 'Invalid Email or Password' });
        }

        if (user.authProvider === 'google' && !user.password) {
            return res.status(400).json({
                message: "This account uses Google Sign-In. Please use the 'Sign in with Google' button."
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            logFailedLogin('Invalid password', email, req);
            return res.status(400).json({ message: 'Invalid Email or Password' });
        }

        if (blockUnapprovedLogin(user, res)) {
            return;
        }

        const workspace = await getWorkspaceForUser(user);
        if (!getJwtSecret()) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = signAuthToken(user);

        auditLogger.log({
            actor: user,
            actionCategory: 'SECURITY',
            action: 'LOGIN_SUCCESS',
            req
        });

        res.json({
            token,
            role: user.role,
            user: buildLoginUserResponse(user, workspace)
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 2.5 GOOGLE LOGIN (OAuth)
exports.googleLogin = async (req, res) => {
    try {
        const { credential } = req.body;

        if (!credential) {
            return res.status(400).json({ message: 'Google credential is required' });
        }

        const googleClientId = process.env.GOOGLE_CLIENT_ID;
        if (!googleClientId) {
            console.error('GOOGLE_CLIENT_ID missing from environment');
            return res.status(500).json({ message: 'Google login is not configured on the server' });
        }

        const client = new OAuth2Client(googleClientId);
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: googleClientId
        });
        const googlePayload = ticket.getPayload();
        const { sub: googleId, email } = googlePayload;

        if (!email) {
            return res.status(400).json({ message: 'Unable to get email from Google account' });
        }

        const normalizedEmail = normalizeEmail(email);
        let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });

        if (!user) {
            return res.status(404).json({
                message: "You don't have an account with this Google email. Please contact the Super Admin to provision your account.",
                isNewUser: true
            });
        }

        let shouldSaveUser = false;

        if (!user.googleId) {
            user.googleId = googleId;
            user.authProvider = user.password ? user.authProvider : 'google';
            shouldSaveUser = true;
        }

        if (!user.isOnboarded && user.companyName) {
            user.isOnboarded = true;
            shouldSaveUser = true;
        }

        if (shouldSaveUser) {
            await user.save();
        }

        const workspace = await getWorkspaceForUser(user);
        if (!getJwtSecret()) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = signAuthToken(user);

        res.json({
            token,
            role: user.role,
            user: buildGoogleUserResponse(user, workspace)
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

        if (!hasManageTeamAccess(req.user)) {
            return res.status(403).json({ message: 'Unauthorized to manage team' });
        }

        const normalizedEmail = normalizeEmail(email);
        let user = await User.findOne({ email: normalizedEmail });

        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }

        const managerId = getRequestUserId(req.user);
        const workspace = await WorkspaceSettings.findOne({ userId: managerId }).select('agentLimit');
        const currentAgentCount = await User.countDocuments({ parentId: managerId, role: 'agent' });
        const limit = workspace?.agentLimit || 5;

        if (currentAgentCount >= limit) {
            return res.status(403).json({
                message: `Upgrade required. You have reached your current plan limit of ${limit} agents.`
            });
        }

        const agentPermissions = permissions || BASIC_AGENT;

        user = await User.create({
            name,
            email: normalizedEmail,
            password: password,
            role: 'agent',
            parentId: managerId,
            permissions: agentPermissions
        });

        res.json({
            success: true,
            message: 'Agent Created Successfully!',
            agent: {
                id: user._id,
                name: user.name,
                email: user.email,
                permissions: user.permissions
            }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 4. GET MY TEAM (Manager apne agents dekhega)
// 5. DELETE AGENT (Manager apne agent ko remove kar sakta hai)
exports.deleteAgent = async (req, res) => {
    try {
        const agentId = req.params.id;

        if (!hasManageTeamAccess(req.user)) {
            return res.status(403).json({ message: 'Unauthorized to manage team' });
        }

        const managerId = getRequestUserId(req.user);
        const agent = await findManagedAgent(managerId, agentId);

        if (!agent) {
            return res.status(404).json({ message: 'Agent not found or does not belong to you' });
        }

        await deleteOwnedRecords(agentId);
        await User.findByIdAndDelete(agentId);

        // ⚠️ Proactively kick the deleted agent's active sessions via Socket.IO
        // Without this, the agent sees random API errors until they manually refresh.
        try {
            const { emitToUser } = require('../services/socketService');
            emitToUser(agentId, 'account:deleted', {
                message: 'Your account has been removed by your administrator. You will be logged out.'
            });
        } catch (_) { /* Socket not initialized — agent will get 401 on next API call */ }

        res.json({ success: true, message: 'Agent and all associated data deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 5.5 UPDATE AGENT (Manager updates agent permissions/details)
exports.updateAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, permissions, password } = req.body;

        if (!hasManageTeamAccess(req.user)) {
            return res.status(403).json({ message: 'Unauthorized to manage team' });
        }

        const managerId = getRequestUserId(req.user);
        const agent = await findManagedAgent(managerId, id);

        if (!agent) {
            return res.status(404).json({ message: 'Agent not found or does not belong to you' });
        }

        const updateData = {};

        if (name) {
            updateData.name = name;
        }

        if (permissions) {
            updateData.permissions = permissions;
        }

        if (password) {
            if (!hasStrongPassword(password)) {
                return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
            }

            updateData.password = password;
        }

        const updatedAgent = await User.findByIdAndUpdate(id, updateData, { new: true }).select('-password');

        res.json({
            success: true,
            message: 'Agent updated successfully',
            agent: updatedAgent
        });
    } catch (err) {
        console.error('Update Agent Error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 6. GET MY TEAM
exports.getMyTeam = async (req, res) => {
    try {
        const managerId = getRequestUserId(req.user);
        const agents = await User.find({ parentId: managerId, role: 'agent' }).select('-password');
        res.json(agents);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 6. UPDATE PROFILE (User apna naam/password change kar sakta hai)
exports.updateProfile = async (req, res) => {
    try {
        const { name, password } = req.body;
        const userId = getRequestUserId(req.user);

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (name && name.trim()) {
            user.name = name.trim();
        }

        if (password && password.trim()) {
            if (!hasStrongPassword(password)) {
                return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
            }

            user.password = password;
        }

        await user.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            user: { id: user._id, name: user.name, email: user.email }
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 7. GET PUBLIC PLANS (For viewing subscription plans)
exports.getPlans = async (req, res) => {
    try {
        res.json({ success: true, plans: [] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 8. GET APP NAME (Public - no auth required)
exports.getAppName = async (req, res) => {
    try {
        const appNameSetting = await GlobalSetting.findOne({ key: 'app_name' });

        res.json({
            success: true,
            appName: appNameSetting?.value || 'Adfliker'
        });
    } catch (err) {
        console.error(err);
        res.json({ success: true, appName: 'Adfliker' });
    }
};
