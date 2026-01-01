// src/routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');

// 1. Jab Facebook check karega (Verification) - GET Request
router.get('/', webhookController.verifyWebhook);

// 2. Jab Facebook data bhejega (Lead) - POST Request
router.post('/', webhookController.handleWebhook);

module.exports = router;