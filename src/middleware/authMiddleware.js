const jwt = require('jsonwebtoken');
const NodeCache = require('node-cache');
const { resolveValues, getFeatureMeta } = require('../constants/featureRegistry');
const tenantCache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // 5-min TTL
// Separate short-lived cache for agent permissions. Keeps permissions fresh
// (revocation takes effect within 5 minutes) without adding a DB query to every
// request — the cache absorbs the cost after the first miss.
const agentPermCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

// Export utilities to clear caches immediately when settings change.
const clearTenantCache = (tenantId) => {
    if (tenantId) {
        tenantCache.del(`workspace_${tenantId}`);
        tenantCache.del(`integrations_${tenantId}`);
    }
};

const clearAgentPermCache = (agentId) => {
    if (agentId) agentPermCache.del(`perms_${agentId}`);
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET not found in environment variables!');
  console.error('Please set JWT_SECRET in your .env file');
  process.exit(1);
}

// MAIN AUTH MIDDLEWARE
const authMiddleware = async (req, res, next) => {
    // Tokens are accepted from the Authorization header ONLY.
    // Accepting ?token= in query params leaks JWTs into server logs, CDN logs,
    // browser history, and Referer headers — a well-known security anti-pattern.
    let token = req.header('Authorization');

    if (!token) {
        return res.status(401).json({ message: 'No authentication token provided' });
    }

    try {
        // Sanitize token (strip Bearer prefix)
        let cleanToken = token.replace(/^Bearer\s+/i, '').trim();

        const decoded = jwt.verify(cleanToken, JWT_SECRET);
        req.user = decoded;

        const User = require('../models/User'); // Lazy load models
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const IntegrationConfig = require('../models/IntegrationConfig');

        // RESOLVE TENANT
        if (req.user.tenantId) {
            req.tenantId = req.user.tenantId;
        } else {
            let ownerId = req.user.userId || req.user.id;
            if (req.user.role === 'agent') {
                const agentUser = await User.findById(ownerId).select('parentId').lean();
                if (agentUser && agentUser.parentId) ownerId = agentUser.parentId;
            }
            req.tenantId = ownerId;
        }

        // 🚀 FETCH WORKSPACE & INTEGRATIONS WITH IN-MEMORY CACHE
        if (req.tenantId) {
            let workspace    = tenantCache.get(`workspace_${req.tenantId}`);
            let integrations = tenantCache.get(`integrations_${req.tenantId}`);

            const misses = [];
            if (!workspace)    misses.push(WorkspaceSettings.findOne({ userId: req.tenantId }).lean().then(w => { workspace    = w || {}; tenantCache.set(`workspace_${req.tenantId}`, workspace); }));
            if (!integrations) misses.push(IntegrationConfig.findOne({ userId: req.tenantId }).lean().then(i => { integrations = i || {}; tenantCache.set(`integrations_${req.tenantId}`, integrations); }));

            if (misses.length > 0) await Promise.all(misses);

            req.workspace    = workspace;
            req.integrations = integrations;
        } else {
            req.workspace    = {};
            req.integrations = {};
        }

        // 🌳 ENTITLEMENTS — resolved ONCE per request from the feature registry
        // (module + planFeature + featureFlag), so requireFeature and any handler
        // read a single { key: boolean } object instead of re-deriving each time.
        req.entitlements = resolveValues(req.workspace);

        // --- 🔐 AGENT PERMISSION FRESHNESS ---
        // JWT permissions are baked in at login time. Without a fresh DB check,
        // a revoked permission stays active until the token expires (up to 30 days
        // with rememberMe). We cache the DB result for 5 minutes so revocation takes
        // effect within one cache window without adding a full DB query to every request.
        if (req.user.role === 'agent') {
            const agentId = req.user.userId || req.user.id;
            let freshPerms = agentPermCache.get(`perms_${agentId}`);
            if (freshPerms === undefined) {
                const agentDoc = await User.findById(agentId).select('permissions').lean();
                freshPerms = agentDoc?.permissions || {};
                agentPermCache.set(`perms_${agentId}`, freshPerms);
            }
            // Override JWT-embedded permissions with live DB state.
            req.user.permissions = freshPerms;
        }

        // --- 🚨 TRI-STATE ACCOUNT LIFECYCLE CHECK 🚨 ---
        if (req.workspace && Object.keys(req.workspace).length > 0) {
            const isSuspendedOrFrozen =
                req.workspace.accountStatus === 'Frozen' ||
                req.workspace.accountStatus === 'Suspended';

            if (isSuspendedOrFrozen) {
                const reason = req.workspace.accountStatus === 'Suspended'
                    ? 'Account suspended by platform administration.'
                    : 'Account temporarily frozen. Contact your agency administrator.';
                return res.status(403).json({ message: reason });
            }
        }

        // --- 💰 SUBSCRIPTION / TRIAL LAPSE → READ-ONLY LOCK ---
        // Business model: agencies have LIFETIME FREE access — distribution
        // partners, not paying customers. We only meter managers (direct + agency
        // sub-clients). superadmin + agency are therefore exempt.
        //
        // When a billable tenant's planExpiryDate passes (trial ended without
        // subscribing, OR a paid plan lapsed), we DO NOT hard-block / log them out.
        // Instead the account goes READ-ONLY: they can still log in and view every
        // module, but all write actions are blocked with `subscription_required`
        // until they pay. Billing/auth/support stay fully usable so they can
        // reactivate. There is no free tier — read-only IS the post-lapse state.
        // Non-destructive: access is restored instantly the moment payment lands.
        const billableRole = req.user.role === 'manager' || req.user.role === 'agent';
        if (billableRole && req.workspace?.planExpiryDate) {
            const expiry = new Date(req.workspace.planExpiryDate).getTime();
            const now    = Date.now();
            const lapsed = now > expiry;

            req.accessLocked  = lapsed;
            req.paymentStatus = {
                expiry: req.workspace.planExpiryDate,
                lapsed,
                daysUntilExpiry: Math.ceil((expiry - now) / (24 * 60 * 60 * 1000))
            };

            if (lapsed) {
                // Block mutating requests app-wide. Reads (GET/HEAD/OPTIONS) pass
                // through so the UI stays viewable but inert. Billing/auth/support
                // are exempt so the tenant can pay and reactivate.
                const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
                const url     = req.originalUrl || req.url || '';
                const exempt  = url.startsWith('/api/billing')
                    || url.startsWith('/api/auth')
                    || url.startsWith('/api/support');

                if (isWrite && !exempt) {
                    return res.status(403).json({
                        error: 'subscription_required',
                        message: 'Your plan has ended. Subscribe from the Billing page to reactivate your account.',
                        expiredAt: req.workspace.planExpiryDate
                    });
                }
            }
        }

        // Base Tenant Isolation
        req.dataScope = { userId: req.tenantId };

        // Agent Row-Level Security — uses fresh permissions resolved above
        if (req.user.role === 'agent') {
            const canViewAll = req.user.permissions?.viewAllLeads;
            if (!canViewAll) {
                // Agent can only interact with rows assigned to them
                req.dataScope.assignedTo = req.user.userId || req.user.id;
            }
        }

        next();
    } catch (err) {
        console.error("Auth Middleware Error:", err);
        res.status(401).json({ message: "Token is not valid" });
    }
};

// SUPER ADMIN ONLY MIDDLEWARE
const requireSuperAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Authentication required" });
    if (req.user.role !== 'superadmin') return res.status(403).json({ message: "Access Denied: Super Admins Only" });
    next();
};

// AGENCY ONLY MIDDLEWARE (Resellers)
const requireAgency = (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: "Authentication required" });
    if (!['superadmin', 'agency'].includes(req.user.role)) {
        return res.status(403).json({ message: "Access Denied: Agency/Reseller Administrative Access Required" });
    }
    next();
};

// ✅ APPROVAL-BASED ACCESS CONTROL (stub kept for backwards-compat with any
// routes that still import it — enforcement is done via planExpiryDate above).
const requireActiveSubscription = (req, res, next) => { next(); };

// 🎚️ FEATURE GATE (backend security boundary — the React gate is UX only)
// Blocks the request if the tenant's plan doesn't include the given feature.
// Accepts EITHER a registry node key (e.g. 'whatsapp.chatbot.ai') — resolved via
// the request's cached entitlements (module/feature/flag aware) — OR a legacy
// planFeatures key (e.g. 'aiChatbot') for backward compatibility. Array = OR.
// Superadmin and agency are always exempt (they're the platform operators).
const requireFeature = (featureKey) => (req, res, next) => {
    if (['superadmin', 'agency'].includes(req.user?.role)) return next();
    const keys = Array.isArray(featureKey) ? featureKey : [featureKey];
    const enabled = keys.some(k => {
        // Registry node key → resolved entitlements (opt-out flags respected).
        if (req.entitlements && k in req.entitlements) return req.entitlements[k] !== false;
        // Legacy planFeatures key.
        return !!req.workspace?.planFeatures?.[k];
    });
    if (!enabled) {
        // Prefer the registry key for a richer, upgrade-oriented 403 payload.
        const primary = keys.find(k => req.entitlements && k in req.entitlements) || keys[0];
        const meta = getFeatureMeta(primary);
        return res.status(403).json({
            error: 'feature_locked',
            feature: primary,
            featureName: meta.name,
            planHint: meta.planHint,
            message: `${meta.name} is not included in your current plan. Upgrade to unlock it.`
        });
    }
    next();
};

// 🛡️ STRICT ROLE-BASED ACCESS CONTROL (RBAC) WRAPPER
const requirePermission = (permissionKey) => {
    return (req, res, next) => {
        // Superadmins and agency owners bypass permission checks
        if (['superadmin', 'agency'].includes(req.user.role)) return next();

        // Managers and agents — permissions are always the fresh DB-sourced values
        // for agents (resolved above in authMiddleware) and JWT values for managers.
        const hasPermission = req.user.permissions?.[permissionKey];
        if (!hasPermission) {
            console.warn(`🛑 RBAC Blocked: User ${req.user.userId} attempted unauthorized access requiring '${permissionKey}'.`);
            return res.status(403).json({
                message: `Action Denied. You lack the necessary permission (${permissionKey}). Contact your administrator.`
            });
        }
        next();
    };
};

module.exports = {
    authMiddleware,
    requireSuperAdmin,
    requireAgency,
    requireActiveSubscription,
    requireFeature,
    requirePermission,
    clearTenantCache,
    clearAgentPermCache
};
