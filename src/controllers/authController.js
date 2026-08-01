const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const GlobalSetting = require('../models/GlobalSetting');
const { TRIAL_DURATION_MS, DEFAULT_AGENT_LIMIT, DEFAULT_ACTIVE_MODULES, SIGNUP_AI_CREDITS } = require('../constants/trial');
const { resolveValues } = require('../constants/featureRegistry');
const aiCreditService = require('../services/aiCreditService');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
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

// Absolute ceiling on a sliding rememberMe session. The token itself is
// re-issued on every /auth/me call, so without this a stolen token could be
// renewed indefinitely and would never expire.
const ABSOLUTE_SESSION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const buildAuthPayload = (user) => ({
    userId: user._id,
    role: user.role,
    name: user.name,
    permissions: user.permissions,
    tenantId: user.role === 'agent' ? user.parentId : user._id,
    // Session generation — authMiddleware compares this against the live
    // User.tokenVersion and rejects the request if they differ. This is what
    // makes a password reset actually log other sessions out.
    tv: user.tokenVersion || 0
});

const buildBaseUserResponse = (user) => ({
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    permissions: user.permissions,
    isOnboarded: user.isOnboarded
});

// Billable tenant whose paid/trial window has elapsed → account is read-only.
// agencies + superadmin are lifetime-free and never lapse.
const isAccessLapsed = (user, workspace) => {
    const billable = user.role === 'manager' || user.role === 'agent';
    if (!billable) return false;
    const expiry = workspace?.planExpiryDate;
    if (!expiry) return false;
    return Date.now() > new Date(expiry).getTime();
};

const buildLoginUserResponse = (user, workspace) => ({
    ...buildBaseUserResponse(user),
    is_active: user.is_active,
    approved_by_admin: user.approved_by_admin,
    status: user.status,
    activeModules: workspace?.activeModules || [],
    planFeatures: workspace?.planFeatures || {},
    featureFlags: workspace?.featureFlags || {},
    // Resolved entitlements map { featureKey: boolean } — the frontend's single
    // source of truth for what the plan unlocks. Locked features are NOT hidden;
    // the UI shows them and gates access with an upgrade wall (see FeatureGate).
    entitlements: workspace ? resolveValues(workspace) : {},
    subscriptionStatus: workspace?.subscriptionStatus || null,
    planExpiryDate: workspace?.planExpiryDate || null,
    accessLocked: isAccessLapsed(user, workspace),
    termsAccepted: !!user.termsAcceptedAt
});

const buildGoogleUserResponse = (user, workspace) => ({
    ...buildBaseUserResponse(user),
    subscriptionStatus: workspace?.subscriptionStatus || 'Trial',
    planExpiryDate: workspace?.planExpiryDate,
    activeModules: workspace?.activeModules || [],
    planFeatures: workspace?.planFeatures || {},
    featureFlags: workspace?.featureFlags || {},
    entitlements: workspace ? resolveValues(workspace) : {},
    termsAccepted: !!user.termsAcceptedAt
});

const getJwtSecret = () => process.env.JWT_SECRET;

/**
 * Sign an auth token.
 * @param {object} user
 * @param {boolean} rememberMe
 * @param {number} [inheritedAbsExp] - unix seconds. Pass the CURRENT token's
 *   absExp when re-issuing (sliding session) so the 90-day ceiling is carried
 *   forward rather than reset. Omit on a fresh login to start a new window.
 */
const signAuthToken = (user, rememberMe = false, inheritedAbsExp = null) => {
    const expiresIn = rememberMe ? '30d' : TOKEN_EXPIRY;
    // Carry the rememberMe choice forward in the JWT so /auth/me can re-issue
    // a fresh long-lived token on each visit (sliding session).
    const payload = {
        ...buildAuthPayload(user),
        remember: !!rememberMe,
        // Copied forward on renewal — never extended. A renewal that minted a
        // new absExp would defeat the cap entirely.
        absExp: inheritedAbsExp || Math.floor((Date.now() + ABSOLUTE_SESSION_MS) / 1000)
    };
    return jwt.sign(payload, getJwtSecret(), { expiresIn });
};

/**
 * Invalidate every JWT previously issued for a user by bumping their session
 * generation, then evicting the middleware cache so it takes effect immediately
 * rather than after the 60s TTL.
 *
 * Call this on password reset, password change, permission change, and
 * deactivation — anywhere "all their existing sessions must stop working".
 */
const revokeUserSessions = async (userId) => {
    if (!userId) return;
    try {
        await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
        const { clearTokenVersionCache, clearAgentPermCache } = require('../middleware/authMiddleware');
        clearTokenVersionCache(userId);
        clearAgentPermCache(userId);
    } catch (err) {
        // Never let revocation bookkeeping fail the caller's operation, but do
        // make it loud — a silent failure here means sessions stay alive.
        console.error(`⚠️  Failed to revoke sessions for user ${userId}:`, err.message);
    }
};

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

    // Note: Accounts are active by default. We only block login if a superadmin
    // has explicitly manually deactivated the account (is_active = false).
    if (!user.is_active) {
        res.status(403).json({
            message: 'Account has been deactivated. Please contact your administrator.',
            status: 'deactivated'
        });
        return true;
    }

    return false;
};

const findManagedAgent = (managerId, agentId) =>
    User.findOne({ _id: agentId, parentId: managerId, role: 'agent' });

/**
 * The workspace owner every team operation must be scoped to.
 *
 * `manageTeam` is a grantable AGENT permission, so the actor is not always the
 * owner. Using the actor's own id (the old behaviour) made an agent with
 * manageTeam create agents parented to *themselves*: those users resolved to a
 * tenant with no WorkspaceSettings (every requireModule gate 404s, and every
 * opt-out feature flag defaults to unlocked), and the seat-limit count ran
 * against the wrong parent so `agentLimit` was never enforced. `req.tenantId`
 * is the owner for managers and agents alike.
 */
const getTeamOwnerId = (req) => req.tenantId || getRequestUserId(req.user);

// An agent with manageTeam is themselves a row under this owner, so the generic
// "does this agent belong to me" lookup would happily match their OWN record —
// letting them grant themselves viewAllLeads, exportLeads and the rest. Team
// management never includes managing yourself.
const isSelf = (req, targetId) => String(getRequestUserId(req.user)) === String(targetId);

/**
 * Owners (manager / superadmin) may grant anything. A delegated agent may only
 * grant permissions they already hold themselves — otherwise `manageTeam` is a
 * self-escalation primitive by proxy: create a second agent with viewAllLeads +
 * exportLeads, log in as it, and you have escaped your own restrictions.
 * Returns the offending key, or null when the grant is allowed.
 */
const findOverreachingPermission = (req, requested) => {
    if (['superadmin', 'manager', 'agency'].includes(req.user.role)) return null;
    if (!requested || typeof requested !== 'object') return null;
    const held = req.user.permissions || {};
    return Object.keys(requested).find(k => requested[k] === true && held[k] !== true) || null;
};

const sendWelcomeEmail = async (user) => {
    try {
        const { sendEmail } = require('../services/emailService');
        const IntegrationConfig = require('../models/IntegrationConfig');
        const User = require('../models/User');

        const superAdmins = await User.find({ role: 'superadmin' }).select('_id').lean();
        const superAdminIds = superAdmins.map(sa => sa._id);
        
        const configuredSaConfig = await IntegrationConfig.findOne({
            userId: { $in: superAdminIds },
            'email.emailUser': { $ne: null, $exists: true }
        }).select('userId').lean();
        
        const superAdminId = configuredSaConfig ? configuredSaConfig.userId.toString() : superAdminIds[0]?.toString();
        
        const appName = process.env.APP_NAME || 'Adfliker';
        const rawFrontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173';
        const frontendUrl = rawFrontendUrl.replace(/\/+$/, '');

        const demoVideoLink = "https://www.youtube.com/watch?v=YOUR_VIDEO_ID_HERE"; // TODO: Update with actual YouTube link

        const htmlBody = `
            <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <div style="background-color: #0f172a; padding: 30px; text-align: center; border-bottom: 4px solid #10b981;">
                        <h1 style="color: white; margin: 0; font-size: 28px; font-weight: bold;">Welcome to ${appName}! 🚀</h1>
                    </div>
                    <div style="padding: 40px 32px;">
                        <h2 style="margin: 0 0 16px; font-size: 22px; font-weight: 700; color: #111827;">Hello ${user.name || 'there'},</h2>
                        <p style="color: #4b5563; margin: 0 0 20px; font-size: 16px; line-height: 1.6;">
                            We are absolutely thrilled to have you on board! You've just unlocked the true power of <strong>${appName}</strong>.
                            Get ready to streamline your operations, engage with your customers seamlessly, and grow your business like never before.
                        </p>
                        
                        <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0;">
                            <h3 style="margin: 0 0 8px; color: #065f46; font-size: 18px;">Getting Started is Easy</h3>
                            <p style="color: #064e3b; margin: 0 0 12px; font-size: 15px; line-height: 1.5;">
                                We've put together a quick demo and setup guide to help you configure everything perfectly.
                            </p>
                            <a href="${demoVideoLink}" target="_blank" style="display: inline-block; padding: 10px 20px; background-color: #10b981; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">Watch Demo & Setup Video</a>
                        </div>
                        
                        <p style="color: #4b5563; margin: 0 0 24px; font-size: 16px; line-height: 1.6;">
                            <strong>Need guidance or have questions?</strong><br>
                            For more info and dedicated support, connect with the ${appName} Support Team anytime. We are always here to help you succeed!
                        </p>
                        
                        <a href="${frontendUrl}" style="display: block; width: 100%; text-align: center; padding: 14px 0; background-color: #111827; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">Log In to Your Dashboard</a>
                        
                        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 32px 0 24px;">
                        <p style="color: #9ca3af; font-size: 13px; margin: 0; text-align: center;">© ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
                    </div>
                </div>
            </div>
        `;

        await sendEmail({
            to: user.email,
            subject: `Welcome to ${appName}! 🚀`,
            html: htmlBody,
            text: `Welcome to ${appName}!\n\nWe are thrilled to have you on board. Check out our setup video here: ${demoVideoLink}\n\nFor more info connect with ${appName} support.\n\nLog in here: ${frontendUrl}`,
            userId: superAdminId || null,
            transactional: true,
        });
    } catch (err) {
        console.error('Failed to send welcome email:', err.message);
    }
};

// 1.5. GET ME — returns fresh user + workspace data (used to refresh cached permissions)
exports.getMe = async (req, res) => {
    try {
        // Never pass a possibly-undefined id to findById: Mongoose casts it away and
        // the query degenerates to `{}`, returning an arbitrary user's record.
        const userId = getRequestUserId(req.user);
        if (!userId) return res.status(401).json({ message: 'Invalid session token' });

        const user = await User.findById(userId).select('-password');
        if (!user) return res.status(404).json({ message: 'User not found' });

        const workspace = await getWorkspaceForUser(user);
        const response = { user: buildLoginUserResponse(user, workspace) };

        // Sliding session: if the original login was a rememberMe login, refresh
        // the token to a new 30-day window so active users never get logged out.
        // The original absExp is carried forward (not reset), so the session
        // still dies 90 days after the FIRST login no matter how active the user
        // is — otherwise a stolen token could be renewed forever.
        if (req.user.remember === true) {
            response.token = signAuthToken(user, true, req.user.absExp || null);
        }

        res.json(response);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 1.6 REGISTER — public client self-onboarding.
// Creates a `manager` tenant, auto-approves it, and spins up a 14-day trial
// workspace (mirrors superAdminController.createCompany, the proven template).
// No token is returned: the client is sent to the login page to sign in (UX
// decision). Fields are validated upstream by validate(schemas.register).
exports.register = async (req, res) => {
    try {
        const { name, companyName, email, password, phone, website, onboardingNotes } = req.body;

        const normalizedEmail = normalizeEmail(email);
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({ message: 'An account with this email already exists. Please log in instead.' });
        }

        const newUser = await User.create({
            name,
            companyName,
            email: normalizedEmail,
            password, // hashed by User model pre('save') hook
            phone,
            website: website || null,
            onboardingNotes: onboardingNotes || null,
            role: 'manager',
            isOnboarded: true,
            accountStatus: 'Active',
            // Self-serve trial accounts are auto-approved so they can log in and
            // start evaluating immediately — no manual SuperAdmin approval step.
            is_active: true,
            approved_by_admin: true,
            status: 'approved'
        });

        // Trial workspace + integrations, created in parallel. The 14-day window
        // and full module set come from the shared trial constants.
        //
        // If provisioning fails we must roll back the just-created user — otherwise
        // the email is permanently taken by a broken, workspace-less account that
        // can't load any modules on login.
        try {
            await Promise.all([
                WorkspaceSettings.create({
                    userId: newUser._id,
                    agentLimit: DEFAULT_AGENT_LIMIT,
                    activeModules: DEFAULT_ACTIVE_MODULES,
                    subscriptionPlan: 'Free Trial',
                    subscriptionStatus: 'trial',
                    billingType: 'trial',
                    planExpiryDate: new Date(Date.now() + TRIAL_DURATION_MS)
                }),
                IntegrationConfig.create({ userId: newUser._id })
            ]);
        } catch (provisionErr) {
            await Promise.all([
                User.deleteOne({ _id: newUser._id }),
                WorkspaceSettings.deleteOne({ userId: newUser._id }),
                IntegrationConfig.deleteOne({ userId: newUser._id })
            ]).catch(() => { /* best-effort cleanup */ });
            throw provisionErr;
        }

        // Signup AI credits — granted once, best-effort. A failure here must never
        // break registration (the account is already provisioned); it just means
        // the user starts at 0 and can be topped up. Written to the ledger.
        try {
            await aiCreditService.grant(newUser._id, SIGNUP_AI_CREDITS, {
                feature: 'signup_bonus',
                note: 'Welcome credits — new account'
            });
        } catch (creditErr) {
            console.error('Signup credit grant failed (non-fatal):', creditErr.message);
        }

        auditLogger.log({
            actor: newUser,
            actionCategory: 'SECURITY',
            action: 'CLIENT_REGISTERED',
            details: { email: normalizedEmail, companyName, signupCredits: SIGNUP_AI_CREDITS },
            req
        });

        // Send welcome email asynchronously
        sendWelcomeEmail(newUser);

        res.status(201).json({
            success: true,
            message: 'Registration successful. Your 14-day free trial has started — please log in to continue.'
        });
    } catch (err) {
        console.error('Register error:', err);
        // Only an email-key collision means "account already exists" (e.g. a race
        // between the findOne check and create). Any OTHER duplicate-key error is a
        // genuine server fault — don't mislabel it as a taken email.
        if (err.code === 11000 && err.keyPattern && err.keyPattern.email) {
            return res.status(409).json({ message: 'An account with this email already exists. Please log in instead.' });
        }
        res.status(500).json({ message: 'Registration failed. Please try again.' });
    }
};

// 2. LOGIN (Purana User)
exports.login = async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;

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

        const token = signAuthToken(user, !!rememberMe);

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

// 2.3 FORGOT PASSWORD — sends a reset link to the user's email
exports.forgotPassword = async (req, res) => {
    // Always return same message to prevent user enumeration
    const GENERIC_OK = { message: 'If that email exists, a password reset link has been sent.' };

    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Email is required.' });

        const normalizedEmail = normalizeEmail(email);
        const user = await User.findOne({ email: normalizedEmail });

        // No user — respond generically (no leak)
        if (!user) return res.json(GENERIC_OK);

        // Generate 32-byte random token; store only the SHA-256 hash in DB
        const rawToken = require('crypto').randomBytes(32).toString('hex');
        const hashedToken = require('crypto').createHash('sha256').update(rawToken).digest('hex');

        user.passwordResetToken = hashedToken;
        user.passwordResetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
        await user.save({ validateBeforeSave: false });

        // Build reset URL using frontend origin (strip trailing slashes to prevent // in the URL)
        const rawFrontendUrl = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:5173';
        const frontendUrl = rawFrontendUrl.replace(/\/+$/, '');
        const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

        // Use Super Admin's configured SMTP credentials (Option B)
        const { getUserEmailCredentials } = require('../utils/emailUtils');
        const { sendEmail } = require('../services/emailService');

        const superAdmins = await User.find({ role: 'superadmin' }).select('_id').lean();
        const superAdminIds = superAdmins.map(sa => sa._id);
        
        // Find the specific Super Admin who actually configured their email
        const IntegrationConfig = require('../models/IntegrationConfig');
        const configuredSaConfig = await IntegrationConfig.findOne({
            userId: { $in: superAdminIds },
            'email.emailUser': { $ne: null, $exists: true }
        }).select('userId').lean();
        
        const superAdminId = configuredSaConfig ? configuredSaConfig.userId.toString() : superAdminIds[0]?.toString();

        const appName = process.env.APP_NAME || 'Adfliker';

        const htmlBody = `
            <div style="background-color: #f9fafb; padding: 40px 20px; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
                <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                    <div style="background-color: #0f172a; padding: 24px; text-align: center; border-bottom: 4px solid #10b981;">
                        <img src="${frontendUrl}/logo.png" alt="${appName} Logo" style="height: 36px; object-fit: contain;" />
                    </div>
                    <div style="padding: 40px 32px;">
                        <h2 style="margin: 0 0 12px; font-size: 24px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">Reset your password</h2>
                        <p style="color: #4b5563; margin: 0 0 32px; font-size: 16px; line-height: 1.5;">We received a request to reset the password for your <strong>${appName}</strong> account (<strong>${normalizedEmail}</strong>).</p>
                        
                        <a href="${resetUrl}" style="display: block; width: 100%; text-align: center; padding: 14px 0; background-color: #10b981; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);">Reset Password</a>
                        
                        <p style="color: #6b7280; font-size: 14px; line-height: 1.5; margin: 32px 0 0;">This link expires in <strong>1 hour</strong>. If you didn't request a reset, you can safely ignore this email — your password won't change.</p>
                        
                        <hr style="border: none; border-top: 1px solid #f3f4f6; margin: 32px 0 24px;">
                        <p style="color: #9ca3af; font-size: 13px; margin: 0; text-align: center;">© ${new Date().getFullYear()} ${appName}. All rights reserved.</p>
                    </div>
                </div>
            </div>
        `;

        try {
            await sendEmail({
                to: normalizedEmail,
                subject: `Reset your ${appName} password`,
                html: htmlBody,
                text: `Reset your password here: ${resetUrl}\n\nThis link expires in 1 hour.`,
                userId: superAdminId || null,
                transactional: true, // bypass unsubscribe suppression list
            });
        } catch (emailErr) {
            console.error('Password reset email failed:', emailErr.message);
            // Clear the token so user isn't locked with a useless token
            user.passwordResetToken = null;
            user.passwordResetExpiry = null;
            await user.save({ validateBeforeSave: false });
            return res.status(500).json({ message: 'Failed to send reset email. Please try again or contact support.' });
        }

        return res.json(GENERIC_OK);
    } catch (err) {
        console.error('forgotPassword error:', err);
        res.status(500).json({ message: 'Server error. Please try again.' });
    }
};

// 2.4 RESET PASSWORD — validates token and sets a new password
exports.resetPassword = async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) {
            return res.status(400).json({ message: 'Token and new password are required.' });
        }

        if (!require('../utils/controllerHelpers').hasStrongPassword(password)) {
            return res.status(400).json({ message: require('../utils/controllerHelpers').STRONG_PASSWORD_MESSAGE });
        }

        // Hash the incoming raw token and look it up
        const hashedToken = require('crypto').createHash('sha256').update(token).digest('hex');

        const user = await User.findOne({
            passwordResetToken: hashedToken,
            passwordResetExpiry: { $gt: new Date() }, // not expired
        });

        if (!user) {
            return res.status(400).json({ message: 'Reset link is invalid or has expired. Please request a new one.' });
        }

        // Set new password (bcrypt hashing handled by pre-save hook)
        user.password = password;
        user.passwordResetToken = null;
        user.passwordResetExpiry = null;

        // 🔐 Kill every session issued before this reset. Without this a password
        // reset is cosmetic: an attacker holding a stolen token keeps full access,
        // which removes the standard incident-response action entirely.
        user.tokenVersion = (user.tokenVersion || 0) + 1;
        await user.save();

        const { clearTokenVersionCache, clearAgentPermCache } = require('../middleware/authMiddleware');
        clearTokenVersionCache(user._id);
        clearAgentPermCache(user._id);

        return res.json({
            message: 'Password updated successfully. You have been signed out on all other devices — please log in again.'
        });
    } catch (err) {
        console.error('resetPassword error:', err);
        res.status(500).json({ message: 'Server error. Please try again.' });
    }
};

// 2.5 GOOGLE LOGIN (OAuth)

exports.googleLogin = async (req, res) => {
    try {
        const { credential, rememberMe, allowNewUser } = req.body;

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

        // An unverified Google address proves nothing about who controls that mailbox.
        // Below we link this identity onto any pre-existing account with a matching
        // email, so accepting an unverified address would be an account-takeover path.
        if (googlePayload.email_verified !== true) {
            return res.status(403).json({
                message: 'Your Google account email is not verified. Verify it with Google, then try again.'
            });
        }

        const normalizedEmail = normalizeEmail(email);
        let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });

        if (!user) {
            // Only auto-create if the caller explicitly allows new user creation
            // (i.e., the request came from the Registration/Onboarding page).
            // Login-page Google sign-ins pass allowNewUser=false → reject gracefully.
            if (!allowNewUser) {
                return res.status(404).json({
                    message: 'No account found with this email. Please register first.',
                    needsRegistration: true
                });
            }

            // Auto-create a new manager account from Google profile
            const googleName = googlePayload.name || normalizedEmail.split('@')[0];
            const newUser = await User.create({
                name: googleName,
                email: normalizedEmail,
                googleId,
                authProvider: 'google',
                role: 'manager',
                isOnboarded: true,
                is_active: true,
                approved_by_admin: true,
                status: 'approved'
            });

            // Provision trial workspace + integrations
            try {
                await Promise.all([
                    WorkspaceSettings.create({
                        userId: newUser._id,
                        agentLimit: DEFAULT_AGENT_LIMIT,
                        activeModules: DEFAULT_ACTIVE_MODULES,
                        subscriptionPlan: 'Free Trial',
                        subscriptionStatus: 'trial',
                        billingType: 'trial',
                        planExpiryDate: new Date(Date.now() + TRIAL_DURATION_MS)
                    }),
                    IntegrationConfig.create({ userId: newUser._id })
                ]);
            } catch (provisionErr) {
                await Promise.all([
                    User.deleteOne({ _id: newUser._id }),
                    WorkspaceSettings.deleteOne({ userId: newUser._id }),
                    IntegrationConfig.deleteOne({ userId: newUser._id })
                ]).catch(() => { });
                throw provisionErr;
            }

            auditLogger.log({
                actor: newUser,
                actionCategory: 'SECURITY',
                action: 'CLIENT_REGISTERED',
                details: { email: normalizedEmail, provider: 'google' },
                req
            });

            // Send welcome email asynchronously
            sendWelcomeEmail(newUser);

            user = newUser;
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

        // 🔐 Same lifecycle gate the password login runs. Without this, "Sign in with
        // Google" was a complete bypass: a pending, rejected or deactivated account
        // got a fully valid session. authMiddleware only re-checks `is_active` — it
        // never looks at `approved_by_admin` or `status === 'rejected'`.
        if (blockUnapprovedLogin(user, res)) {
            return;
        }

        const workspace = await getWorkspaceForUser(user);
        if (!getJwtSecret()) {
            return res.status(500).json({ error: 'Server configuration error' });
        }

        const token = signAuthToken(user, !!rememberMe);

        auditLogger.log({
            actor: user,
            actionCategory: 'SECURITY',
            action: 'LOGIN_SUCCESS',
            details: { provider: 'google' },
            req
        });

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

        const managerId = getTeamOwnerId(req);
        const workspace = await WorkspaceSettings.findOne({ userId: managerId }).select('agentLimit');
        // A limit of 0 means UNLIMITED (higher tiers may set it). Use ?? so a
        // genuine 0 is preserved (not coerced to the default 5 by ||), then skip
        // the cap entirely when the resolved limit is 0.
        const limit = workspace?.agentLimit ?? 5;

        // Count existing agents under this manager
        const currentAgentCount = await User.countDocuments({ parentId: managerId, role: 'agent' });

        if (limit > 0 && currentAgentCount >= limit) {
            return res.status(403).json({
                message: `Upgrade required. You have reached your current plan limit of ${limit} agents.`
            });
        }

        const agentPermissions = permissions || BASIC_AGENT;

        const overreach = findOverreachingPermission(req, agentPermissions);
        if (overreach) {
            return res.status(403).json({
                message: `You cannot grant '${overreach}' because you do not hold it yourself.`
            });
        }

        user = await User.create({
            name,
            email: normalizedEmail,
            password: password,
            role: 'agent',
            parentId: managerId,
            permissions: agentPermissions,
            // Auto-approve agents — manager creating them IS the approval.
            approved_by_admin: true,
            is_active: true,
            status: 'approved'
        });

        // The count-then-create check above is not atomic, so two concurrent requests
        // can both pass it and overshoot the plan's seat limit. Re-count after the
        // write and roll back the loser — cheap, and it makes the cap actually hold.
        if (limit > 0) {
            const confirmedCount = await User.countDocuments({ parentId: managerId, role: 'agent' });
            if (confirmedCount > limit) {
                await User.deleteOne({ _id: user._id });
                return res.status(403).json({
                    message: `Upgrade required. You have reached your current plan limit of ${limit} agents.`
                });
            }
        }

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

        if (!mongoose.Types.ObjectId.isValid(agentId)) {
            return res.status(400).json({ message: 'Invalid agent ID format' });
        }

        if (!hasManageTeamAccess(req.user)) {
            return res.status(403).json({ message: 'Unauthorized to manage team' });
        }

        if (isSelf(req, agentId)) {
            return res.status(403).json({ message: 'You cannot delete your own account.' });
        }

        const managerId = getTeamOwnerId(req);
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

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: 'Invalid agent ID format' });
        }

        if (!hasManageTeamAccess(req.user)) {
            return res.status(403).json({ message: 'Unauthorized to manage team' });
        }

        // Blocks the self-escalation path: an agent holding manageTeam is a row under
        // this same owner, so without this they could grant themselves any permission.
        if (isSelf(req, id)) {
            return res.status(403).json({ message: 'You cannot edit your own permissions. Ask your administrator.' });
        }

        const managerId = getTeamOwnerId(req);
        const agent = await findManagedAgent(managerId, id);

        if (!agent) {
            return res.status(404).json({ message: 'Agent not found or does not belong to you' });
        }

        const updateData = {};

        if (name) {
            updateData.name = name;
        }

        if (permissions) {
            const overreach = findOverreachingPermission(req, permissions);
            if (overreach) {
                return res.status(403).json({
                    message: `You cannot grant '${overreach}' because you do not hold it yourself.`
                });
            }
            updateData.permissions = permissions;
        }

        if (password) {
            if (!hasStrongPassword(password)) {
                return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
            }

            updateData.password = password;
        }

        // 🔐 A manager resetting an agent's password must terminate that agent's
        // existing sessions — otherwise the old session survives the reset and
        // the password change achieves nothing against a compromised device.
        // A permissions-only edit does NOT bump the version: authMiddleware
        // already re-reads agent permissions from the DB on every request, so
        // clearing the cache is sufficient and avoids a needless forced re-login.
        if (updateData.password) {
            updateData.$inc = { tokenVersion: 1 };
        }

        const updatedAgent = await User.findByIdAndUpdate(id, updateData, { returnDocument: 'after' }).select('-password');

        // Evict the agent's caches immediately so the next request reflects the
        // change instead of serving stale values for the rest of the TTL.
        try {
            const { clearAgentPermCache, clearTokenVersionCache } = require('../middleware/authMiddleware');
            if (updateData.permissions) clearAgentPermCache(id);
            if (updateData.password) clearTokenVersionCache(id);
        } catch { /* cache module optional */ }

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
        const managerId = getTeamOwnerId(req);
        const agents = await User.find({ parentId: managerId, role: 'agent' }).select('-password');

        if (req.query.includeManager === 'true') {
            const manager = await User.findById(managerId).select('-password');
            if (manager) {
                agents.unshift(manager);
            }
        }

        res.json(agents);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};

// 6. UPDATE PROFILE (User apna naam/password change kar sakta hai)
exports.updateProfile = async (req, res) => {
    try {
        const { name, password, currentPassword } = req.body;
        const userId = getRequestUserId(req.user);

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        if (name && name.trim()) {
            user.name = name.trim();
        }

        let passwordChanged = false;
        if (password && password.trim()) {
            // Re-authenticate before changing the password. Without this, anyone
            // holding a valid token — a stolen session, a borrowed unlocked laptop,
            // an XSS-exfiltrated JWT — could set a new password without knowing the
            // old one and take the account over permanently. Proof of the current
            // password is what makes the session revocation below meaningful.
            if (!currentPassword || typeof currentPassword !== 'string') {
                return res.status(400).json({ message: 'Enter your current password to set a new one.' });
            }
            const currentMatches = await bcrypt.compare(currentPassword, user.password);
            if (!currentMatches) {
                return res.status(401).json({ message: 'Your current password is incorrect.' });
            }

            if (!hasStrongPassword(password)) {
                return res.status(400).json({ message: STRONG_PASSWORD_MESSAGE });
            }

            user.password = password;
            // 🔐 A password change must invalidate sessions on other devices —
            // that is the whole point of changing it after a suspected compromise.
            user.tokenVersion = (user.tokenVersion || 0) + 1;
            passwordChanged = true;
        }

        await user.save();

        const response = {
            success: true,
            message: 'Profile updated successfully',
            user: { id: user._id, name: user.name, email: user.email }
        };

        if (passwordChanged) {
            const { clearTokenVersionCache, clearAgentPermCache } = require('../middleware/authMiddleware');
            clearTokenVersionCache(user._id);
            clearAgentPermCache(user._id);

            // The caller just invalidated their OWN token too. Hand back a fresh
            // one carrying the new tv so the user isn't logged out of the tab
            // they're actively using while every other device is signed out.
            response.token = signAuthToken(user, req.user.remember === true, req.user.absExp || null);
            response.message = 'Profile updated. You have been signed out on all other devices.';
        }

        res.json(response);
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

// 9b. PAYMENT STATUS (Protected)
// Returns the current tenant's payment-expiry posture. Used by the frontend
// to decide whether to show "X days left" / "in grace" banners.
// Past-grace tenants never reach here — they get blocked by the 402 in authMiddleware.
exports.getPaymentStatus = async (req, res) => {
    try {
        // Agencies + superadmin have lifetime-free access — never show banners.
        // (Defends against stale planExpiryDate left over from earlier code paths
        // that may not have been wiped by the startup migration yet.)
        if (req.user.role === 'superadmin' || req.user.role === 'agency') {
            return res.json({ success: true, hasExpiry: false, lifetimeFree: true });
        }

        const expiry = req.workspace?.planExpiryDate;
        if (!expiry) {
            return res.json({ success: true, hasExpiry: false });
        }
        const expiryTime = new Date(expiry).getTime();
        const now = Date.now();
        const day = 24 * 60 * 60 * 1000;
        const lapsed = now > expiryTime; // past expiry → account is read-only

        res.json({
            success: true,
            hasExpiry: true,
            expiry,
            daysUntilExpiry: Math.ceil((expiryTime - now) / day),
            // `lapsed` (a.k.a. accessLocked) drives the read-only banner; the
            // warning window drives the "expires soon" amber banner.
            lapsed,
            accessLocked: lapsed,
            subscriptionStatus: req.workspace?.subscriptionStatus || null,
            warningWindow: now > (expiryTime - 5 * day) && now <= expiryTime,
            currency: 'INR'
        });
    } catch (err) {
        console.error('getPaymentStatus error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// 10. ACCEPT TERMS & CONDITIONS (Protected)
exports.acceptTerms = async (req, res) => {
    try {
        // See getMe: an undefined id here would write to an arbitrary user document.
        const userId = getRequestUserId(req.user);
        if (!userId) return res.status(401).json({ message: 'Invalid session token' });

        await User.findByIdAndUpdate(userId, { $set: { termsAcceptedAt: new Date() } });
        res.json({ success: true, termsAccepted: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server error' });
    }
};
