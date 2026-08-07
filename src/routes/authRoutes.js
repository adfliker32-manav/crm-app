const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const mcpKeyController = require('../controllers/mcpKeyController');
const { authMiddleware } = require('../middleware/authMiddleware');
const requireModule = require('../middleware/moduleMiddleware');
const { validate, schemas } = require('../middleware/validateRequest');
const rateLimit = require('express-rate-limit');
const validateObjectId = require('../middleware/validateObjectId');

const User = require('../models/User');
const { sendEmail } = require('../services/emailService');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { message: 'Too many authentication attempts, please try again after 15 minutes' },
    handler: async (req, res, next, options) => {
        // Only send the email on the EXACT request that trips the limit to prevent email spam
        if (req.rateLimit && req.rateLimit.current === options.max + 1) {
            const email = req.body?.email;
            if (email) {
                try {
                    const user = await User.findOne({ email });
                    if (user) {
                        await sendEmail({
                            to: user.email,
                            subject: 'Security Alert: Multiple Failed Login Attempts',
                            html: `
                                <p>Hi ${user.name},</p>
                                <p>We detected multiple failed login attempts to your account from IP address <strong>${req.ip}</strong>.</p>
                                <p>To protect your security, we have temporarily blocked further login attempts for 15 minutes.</p>
                                <p>If you forgot your password, you can reset it on the login page.</p>
                                <p>If this wasn't you, please reset your password immediately.</p>
                            `
                        });
                        console.log(`[Security] Sent rate-limit alert email to ${user.email}`);
                    }
                } catch (error) {
                    console.error('[Security] Failed to send rate-limit alert email:', error);
                }
            }
        }
        res.status(options.statusCode).json(options.message);
    }
});

// 1. Login (Public)
router.post('/login', authLimiter, validate(schemas.login), authController.login);
router.post('/google', authLimiter, authController.googleLogin);

// 1.3 Forgot / Reset Password (Public)
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/reset-password',  authLimiter, authController.resetPassword);


// 1.5 Register (Public) — client self-onboarding, auto-approved 14-day trial.
// Shares authLimiter (10 attempts / 15 min / IP) to throttle signup spam.
router.post('/register', authLimiter, validate(schemas.register), authController.register);

// 1.5. Get fresh user + workspace data (refresh cached permissions)
router.get('/me', authMiddleware, authController.getMe);

// 2. Add New Agent (Manager Only) — plan-gated by the 'team' module
router.post('/add-agent', authMiddleware, requireModule('team'), validate(schemas.createAgent), authController.createAgent);

// 3. Team Management — plan-gated by the 'team' module
router.get('/my-team', authMiddleware, requireModule('team'), authController.getMyTeam);
router.delete('/remove-agent/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('team'), authController.deleteAgent);
router.put('/update-agent/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireModule('team'), authController.updateAgent);

// 4. Profile & Plans
router.put('/profile', authMiddleware, authController.updateProfile);
// Billing removed

// 5. Accept Terms & Conditions
router.post('/accept-terms', authMiddleware, authController.acceptTerms);

// 5b. Payment status (for banner UI — 5-day warning / 7-day grace)
router.get('/payment-status', authMiddleware, authController.getPaymentStatus);

// 6. Public
router.get('/app-name', authController.getAppName);

// 7. Claude AI / MCP key management (workspace owners only — enforced in controller)
router.get('/mcp-key',    authMiddleware, mcpKeyController.getMcpKey);
router.post('/mcp-key',   authMiddleware, mcpKeyController.generateMcpKey);
router.delete('/mcp-key', authMiddleware, mcpKeyController.revokeMcpKey);

module.exports = router;
