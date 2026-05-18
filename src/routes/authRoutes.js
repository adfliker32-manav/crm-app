const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const mcpKeyController = require('../controllers/mcpKeyController');
const { authMiddleware } = require('../middleware/authMiddleware');
const { validate, schemas } = require('../middleware/validateRequest');
const rateLimit = require('express-rate-limit');
const validateObjectId = require('../middleware/validateObjectId');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Too many authentication attempts, please try again after 15 minutes' }
});

// 1. Login (Public)
router.post('/login', authLimiter, validate(schemas.login), authController.login);
router.post('/google', authLimiter, authController.googleLogin);

// 1.5. Get fresh user + workspace data (refresh cached permissions)
router.get('/me', authMiddleware, authController.getMe);

// 2. Add New Agent (Manager Only)
router.post('/add-agent', authMiddleware, validate(schemas.createAgent), authController.createAgent);

// 3. Team Management
router.get('/my-team', authMiddleware, authController.getMyTeam);
router.delete('/remove-agent/:id', validateObjectId({ params: ['id'] }), authMiddleware, authController.deleteAgent);
router.put('/update-agent/:id', validateObjectId({ params: ['id'] }), authMiddleware, authController.updateAgent);

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
