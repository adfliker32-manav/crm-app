/**
 * External API Key Routes
 * JWT-authenticated — only workspace owners can manage their key.
 *
 * GET    /api/ext-api/key           → get masked key status
 * POST   /api/ext-api/key/generate  → generate (or regenerate) key
 * DELETE /api/ext-api/key           → revoke key
 */

const express = require('express');
const router  = express.Router();
const { getExtApiKey, generateExtApiKey, revokeExtApiKey } = require('../controllers/extApiKeyController');

router.get('/key',              getExtApiKey);
router.post('/key/generate',    generateExtApiKey);
router.delete('/key',           revokeExtApiKey);

module.exports = router;
