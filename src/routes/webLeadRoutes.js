const express = require('express');
const router = express.Router();
const webLeadController = require('../controllers/webLeadController');
const { authMiddleware, requireFeature } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
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
// SECURITY: these previously had authMiddleware ONLY. `accessSettings` was
// enforced in the UI (Settings.jsx hides the tab) but never on the API, so any
// authenticated agent could read the workspace's Web-to-Lead API key, rotate it
// (silently breaking every customer landing page), or point `defaultAgent` at
// themselves to self-assign all inbound web leads. The permission defaults to
// false for agents, matching tagRoutes/emailRoutes.
router.get('/config', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.webLead'), webLeadController.getConfig);
router.put('/config', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.webLead'), webLeadController.updateConfig);
router.post('/regenerate', authMiddleware, checkPermission('accessSettings'), requireFeature('settings.webLead'), webLeadController.regenerateKey);

module.exports = router;
