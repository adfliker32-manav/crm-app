const express = require('express');
const router = express.Router();
const voiceCallController = require('../controllers/voiceCallController');
const { authMiddleware } = require('../middleware/authMiddleware');
const checkPermission = require('../middleware/checkPermission');
const requireModule = require('../middleware/moduleMiddleware');
const validateObjectId = require('../middleware/validateObjectId');

router.use(authMiddleware);

// Call history for ONE lead. Deliberately NOT module-gated: this is fetched by
// LeadDetailsModal, which is not itself behind a <FeatureGate>, and the axios
// interceptor reacts to a `module_locked` 403 by patching entitlements and
// reloading the page — so gating it would reload the app every time a tenant
// without the voice module opened a lead. The query is tenant-scoped and a
// tenant without voice has no call logs, so it simply returns [].
router.get(
    '/lead/:leadId',
    validateObjectId({ params: ['leadId'] }),
    voiceCallController.getLeadVoiceCalls
);

// ── Voice integration config ────────────────────────────────────────────────
// These read and write the tenant's PROVIDER CREDENTIALS — the Vapi/Retell API
// key, the outbound number and the webhook secret — so they carry the same
// `accessSettings` gate as every other integration-credential route (email
// config, sheet sync, Meta). `accessSettings` defaults to FALSE for agents;
// without it, any agent could rotate the webhook secret (and then forge call
// outcomes into their tenant's workflows) or point outbound calls at another
// provider account. The UI only ever showed AI Voice to managers, but the API
// was reachable with any valid JWT.
//
// requireModule('voice') is safe to mount here because the only caller is the
// VoiceHub page, which is already behind <FeatureGate feature="voice">.
const voiceSettings = [requireModule('voice'), checkPermission('accessSettings')];

router.get('/config', ...voiceSettings, voiceCallController.getVoiceConfig);
router.put('/config', ...voiceSettings, voiceCallController.saveVoiceConfig);

module.exports = router;
