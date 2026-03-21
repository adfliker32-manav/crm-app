const jwt = require('jsonwebtoken');

// SECURITY FIX: Require JWT_SECRET from environment, no weak fallback
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET not found in environment variables!');
  console.error('Please set JWT_SECRET in your .env file');
  process.exit(1);
}

// MAIN AUTH MIDDLEWARE
const authMiddleware = async (req, res, next) => {
    let token = req.header('Authorization');

    if (!token) {
        return res.status(401).json({ message: "No Token, Authorization Denied" });
    }

    if (token.startsWith('Bearer ')) {
        token = token.substring(7);
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;

        // ENTERPRISE ABAC & TENANT RESOLUTION
        if (req.user.tenantId) {
            req.tenantId = req.user.tenantId;
        } else {
            // FALLBACK FOR OLD TOKENS
            let ownerId = req.user.userId || req.user.id;
            if (req.user.role === 'agent') {
                const User = require('../models/User'); // Lazy load
                const agentUser = await User.findById(ownerId).select('parentId').lean();
                if (agentUser && agentUser.parentId) ownerId = agentUser.parentId;
            }
            req.tenantId = ownerId;
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
    if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
    }
    if (req.user.role !== 'superadmin') {
        return res.status(403).json({ message: "Access Denied: Super Admins Only" });
    }
    next();
};

module.exports = { authMiddleware, requireSuperAdmin };
