const express = require('express');
const router = express.Router();
const webLeadController = require('../controllers/webLeadController');
const { authMiddleware } = require('../middleware/authMiddleware');
const rateLimit = require('express-rate-limit');

// ── Public capture endpoint — accessed from any landing page ─────────────────
// Rate limit at the Express level as a first wall (per IP, light).
// The controller applies a tighter per-API-key limit on top of this.
const captureRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60, // 60 total requests/min from any single IP across all tenants
    message: { success: false, message: 'Too many requests. Please wait.' }
});

// Handle CORS preflight for cross-origin landing pages
router.options('/capture', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.status(204).end();
});

// PUBLIC — no auth middleware
router.post('/capture', captureRateLimit, webLeadController.captureLead);

// ── Authenticated config routes (used by CRM settings UI) ───────────────────
router.get('/config', authMiddleware, webLeadController.getConfig);
router.put('/config', authMiddleware, webLeadController.updateConfig);
router.post('/regenerate', authMiddleware, webLeadController.regenerateKey);

module.exports = router;
