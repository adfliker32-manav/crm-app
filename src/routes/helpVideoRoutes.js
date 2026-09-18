const express = require('express');
const router = express.Router();
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { validate, schemas } = require('../middleware/validateRequest');
const {
    getHelpVideos,
    getHelpCatalog,
    adminListHelpVideos,
    adminPreviewHelpVideoUrl,
    adminCreateHelpVideo,
    adminUpdateHelpVideo,
    adminToggleHelpVideo,
    adminDeleteHelpVideo
} = require('../controllers/helpVideoController');

// ── Super Admin: Video Management ───────────────────────────────────────────
// Registered BEFORE the customer read route. Nothing here collides today, but
// the '/admin' literal must never be reachable as a value of a later path
// param — the same ordering rule supportRoutes.js documents.
router.get('/admin/catalog', authMiddleware, requireSuperAdmin, getHelpCatalog);
router.get('/admin', authMiddleware, requireSuperAdmin, adminListHelpVideos);

router.post('/admin/preview',
    authMiddleware,
    requireSuperAdmin,
    validate(schemas.previewHelpVideoUrl),
    adminPreviewHelpVideoUrl
);

router.post('/admin',
    authMiddleware,
    requireSuperAdmin,
    validate(schemas.createHelpVideo),
    adminCreateHelpVideo
);

router.put('/admin/:id',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    requireSuperAdmin,
    validate(schemas.updateHelpVideo),
    adminUpdateHelpVideo
);

router.patch('/admin/:id/toggle',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    requireSuperAdmin,
    validate(schemas.toggleHelpVideo),
    adminToggleHelpVideo
);

router.delete('/admin/:id',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    requireSuperAdmin,
    adminDeleteHelpVideo
);

// ── Customer-facing ─────────────────────────────────────────────────────────
// The single call the Help drawer makes:
//   GET /api/help-videos?module=whatsapp&submodule=broadcasts
//
// Authenticated but deliberately NOT plan-gated: help content explains the
// product to whoever is looking at it, including someone on a tier that has the
// module locked behind an upgrade wall. It exposes no tenant data.
router.get('/', authMiddleware, getHelpVideos);

module.exports = router;
