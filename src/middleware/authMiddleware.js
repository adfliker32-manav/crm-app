const jwt = require('jsonwebtoken');
const NodeCache = require('node-cache'); // 🚀 PERFORMANCE FIX: LRU cache
const tenantCache = new NodeCache({ stdTTL: 300, checkperiod: 120 }); // 5 minutes TTL

// Export utility to clear cache when users update their settings
const clearTenantCache = (tenantId) => {
    if (tenantId) {
        tenantCache.del(`workspace_${tenantId}`);
        tenantCache.del(`integrations_${tenantId}`);
    }
};

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET not found in environment variables!');
  console.error('Please set JWT_SECRET in your .env file');
  process.exit(1);
}

// MAIN AUTH MIDDLEWARE
const authMiddleware = async (req, res, next) => {
    let token = req.header('Authorization') || req.query.token;
    try {
        // Sanitize token (handle URL encoding or Bearer prefix in query/header)
        let cleanToken = token.replace(/^Bearer\s+/i, '').trim();
        
        // Additional URL decoding for safety if it came from query
        if (req.query.token) {
            cleanToken = decodeURIComponent(cleanToken);
            // Handle if there's still a Bearer prefix inside the decoded string
            cleanToken = cleanToken.replace(/^Bearer\s+/i, '').trim();
        }

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
        // Eliminates 2 database queries per API request
        if (req.tenantId) {
            let workspace = tenantCache.get(`workspace_${req.tenantId}`);
            let integrations = tenantCache.get(`integrations_${req.tenantId}`);

            const misses = [];
            if (!workspace) misses.push(WorkspaceSettings.findOne({ userId: req.tenantId }).lean().then(w => { workspace = w || {}; tenantCache.set(`workspace_${req.tenantId}`, workspace); }));
            if (!integrations) misses.push(IntegrationConfig.findOne({ userId: req.tenantId }).lean().then(i => { integrations = i || {}; tenantCache.set(`integrations_${req.tenantId}`, integrations); }));
            
            if (misses.length > 0) await Promise.all(misses);

            req.workspace = workspace;
            req.integrations = integrations;
        } else {
            req.workspace = {};
            req.integrations = {};
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

        // Base Tenant Isolation
        req.dataScope = { userId: req.tenantId };

        // Agent Row-Level Security
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

// ✅ APPROVAL-BASED ACCESS CONTROL
// Subscription Payment restrictions permanently removed.
const requireActiveSubscription = (req, res, next) => {
    next(); 
};

// 🎚️ FEATURE GATE
// All features available to approved accounts.
const requireFeature = (featureKey) => (req, res, next) => {
    next(); 
};

// 🛡️ STRICT ROLE-BASED ACCESS CONTROL (RBAC) WRAPPER
// Ensures users without the requisite permission flag cannot hit the backend endpoint.
const requirePermission = (permissionKey) => {
    return (req, res, next) => {
        // Superadmins and agency owners bypass permission checks
        if (['superadmin', 'agency'].includes(req.user.role)) {
            return next();
        }

        // Managers and agents must have the specific boolean flag in their token/DB
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
    clearTenantCache 
};
