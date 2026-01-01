const jwt = require('jsonwebtoken');

// Wahi secret key jo authController me thi
const JWT_SECRET = 'meri-secret-key-123'; 

module.exports = function(req, res, next) {
    // 1. Header se token nikalo
    const token = req.header('Authorization');

    // 2. Agar token nahi hai to block karo
    if (!token) {
        return res.status(401).json({ message: "No Token, Authorization Denied" });
    }

    // 3. Token verify karo
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // User ki ID request me jod do
        next(); // Sab sahi hai, aage jane do (Controller ke paas)
    } catch (err) {
        res.status(401).json({ message: "Token is not valid" });
    }
};