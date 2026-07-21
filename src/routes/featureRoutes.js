const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/authMiddleware');
const { flattenRegistry, getFeatureMeta } = require('../constants/featureRegistry');
const UpgradeEvent = require('../models/UpgradeEvent');

// GET /api/features
// Returns the resolved display metadata for every feature key (name, icon,
// category, tagline, planHint, benefits). The frontend UpgradeWall renders
// entirely from this — no hardcoded feature copy in React. Static per deploy,
// so the client caches it after the first call.
router.get('/', authMiddleware, (req, res) => {
    const flat = flattenRegistry();
    const features = {};
    Object.keys(flat).forEach((key) => { features[key] = getFeatureMeta(key); });
    res.json({ features });
});

// POST /api/features/upgrade-event
// Records a monetization signal (prompt viewed / upgrade clicked / locked access).
// Fire-and-forget from the client; never blocks the UX.
const VALID_TYPES = ['upgrade_prompt_viewed', 'upgrade_button_clicked', 'locked_feature_access'];
router.post('/upgrade-event', authMiddleware, async (req, res) => {
    try {
        const { type, featureKey, featureName, source } = req.body || {};
        if (!VALID_TYPES.includes(type)) {
            return res.status(400).json({ message: 'Invalid event type' });
        }
        await UpgradeEvent.create({
            userId:   req.user.userId,
            tenantId: req.tenantId || req.user.userId,
            type,
            featureKey:  featureKey || null,
            featureName: featureName || null,
            plan: req.workspace?.currentPlanCode || req.workspace?.subscriptionPlan || null,
            role: req.user.role || null,
            source: source || null,
        });
        res.json({ success: true });
    } catch (err) {
        console.error('upgrade-event log error:', err.message);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
