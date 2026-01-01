const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController'); // Controller ko bulaya
const auth = require('../middleware/authMiddleware'); // Security guard

// Route: Send Welcome Email
router.post('/send-welcome', auth, emailController.sendWelcomeEmail);

module.exports = router;