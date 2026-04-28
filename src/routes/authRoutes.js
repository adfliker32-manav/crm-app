const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
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

// 2. Add New Agent (Manager Only)
router.post('/add-agent', authMiddleware, validate(schemas.createAgent), authController.createAgent);

// 3. Team Management
router.get('/my-team', authMiddleware, authController.getMyTeam);
router.delete('/remove-agent/:id', validateObjectId({ params: ['id'] }), authMiddleware, authController.deleteAgent);
router.put('/update-agent/:id', validateObjectId({ params: ['id'] }), authMiddleware, authController.updateAgent);

// 4. Profile & Plans
router.put('/profile', authMiddleware, authController.updateProfile);
// Billing removed

// 5. Public
router.get('/app-name', authController.getAppName);

module.exports = router;
