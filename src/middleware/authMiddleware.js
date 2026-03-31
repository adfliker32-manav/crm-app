const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET not found in environment variables!');
  console.error('Please set JWT_SECRET in your .env file');
  process.exit(1);
}

// MAIN AUTH MIDDLEWARE
const authMiddleware = async (req, res, next) => {
    let token = req.header('Authorization') || req.query.token;
    if (!token) return res.status(401).json({ message: "No Token, Authorization Denied" });

    if (token.startsWith('Bearer ')) {
        token = token.substring(7);
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
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

        // FETCH WORKSPACE & INTEGRATIONS ONCE FOR ALL DOWNSTREAM ROUTES
        // We use Promise.all to fetch both simultaneously (non-blocking)
        if (req.tenantId) {
            const [workspace, integrations] = await Promise.all([
                WorkspaceSettings.findOne({ userId: req.tenantId }).lean(),
                IntegrationConfig.findOne({ userId: req.tenantId }).lean()
            ]);
            req.workspace = workspace || {};
            req.integrations = integrations || {};
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

// ==========================================
// ✅ SUBSCRIPTION CHECK — PERMANENTLY REMOVED
// System now uses approval-based access control.
// Super Admin manually approves/rejects accounts.
// ==========================================
const requireActiveSubscription = (req, res, next) => {
    next(); // Payment restrictions removed — approval-based system in place
};

// 🎚️ FEATURE GATE — PERMANENTLY REMOVED
const requireFeature = (featureKey) => (req, res, next) => {
    next(); // Feature gates removed — all features available to approved accounts
};

module.exports = { authMiddleware, requireSuperAdmin, requireAgency, requireActiveSubscription, requireFeature };
