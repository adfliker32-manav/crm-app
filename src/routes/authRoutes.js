const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authMiddleware } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Limit each IP to 10 requests per windowMs
    message: { message: 'Too many authentication attempts, please try again after 15 minutes' }
});

// 1. Register & Login (Public)
router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/google', authLimiter, authController.googleLogin); // Google OAuth Login

// 2. Add New Agent (Manager Only)
router.post('/add-agent', authMiddleware, authController.createAgent);

// 👇 YE MISSING THA: Team List fetch karne ke liye
router.get('/my-team', authMiddleware, authController.getMyTeam);

// 3. Remove Agent (Manager Only)
router.delete('/remove-agent/:id', authMiddleware, authController.deleteAgent);

// 4. Update Agent (Manager Only)
router.put('/update-agent/:id', authMiddleware, authController.updateAgent);

// 5. Update Profile (All Authenticated Users)
router.put('/profile', authMiddleware, authController.updateProfile);

// 5. Get Public Plans (For viewing subscription plans)
router.get('/plans', authMiddleware, authController.getPlans);

// 6. Get App Name (Public - no auth required)
router.get('/app-name', authController.getAppName);

module.exports = router;