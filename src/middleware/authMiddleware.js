const jwt = require('jsonwebtoken');

// SECURITY FIX: Require JWT_SECRET from environment, no weak fallback
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ CRITICAL: JWT_SECRET not found in environment variables!');
  console.error('Please set JWT_SECRET in your .env file');
  process.exit(1);
}

// MAIN AUTH MIDDLEWARE
const authMiddleware = (req, res, next) => {
    let token = req.header('Authorization');

    if (!token) {
        return res.status(401).json({ message: "No Token, Authorization Denied" });
    }

    // Handle "Bearer token" format or direct token
    if (token.startsWith('Bearer ')) {
        token = token.substring(7);
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
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
