/**
 * External CRM Integration API Routes
 * ─────────────────────────────────────────────────────────────────────────────
 * Base prefix: /api/v1  (registered in index.js)
 * Auth:        extApiAuthMiddleware — validates x-api-key, no JWT required
 * CORS:        open (*) — external CRMs can be anywhere
 *
 * All routes are rate-limited by the middleware (30 req/min per key, 500/day).
 */

const express = require('express');
const router  = express.Router();

const { extApiAuthMiddleware, extApiIpRateLimit } = require('../middleware/extApiAuthMiddleware');
const ctrl = require('../controllers/extApiController');

// Apply IP rate limit first (cheap), then API key auth
router.use(extApiIpRateLimit);
router.use(extApiAuthMiddleware);

// ── Utility ───────────────────────────────────────────────────────────────────
// GET /api/v1/ping  — test that key is valid and plan is correct
router.get('/ping', ctrl.ping);

// ── Leads ─────────────────────────────────────────────────────────────────────
// POST /api/v1/leads           → create lead (fires automations)
router.post('/leads', ctrl.createLead);

// GET  /api/v1/leads           → list leads (paginated)
//   ?status=New&source=HubSpot&tag=vip&search=ravi&dateFrom=2026-01-01&dateTo=2026-07-01&limit=25&page=1
router.get('/leads', ctrl.listLeads);

// GET  /api/v1/leads/:id       → get single lead
router.get('/leads/:id', ctrl.getLead);

// PUT  /api/v1/leads/:id       → update lead (fires STAGE_CHANGED automation if stage changes)
router.put('/leads/:id', ctrl.updateLead);

// POST /api/v1/leads/:id/note  → add a note to a lead
router.post('/leads/:id/note', ctrl.addNote);

// ── WhatsApp ──────────────────────────────────────────────────────────────────
// GET  /api/v1/whatsapp/templates        → list approved WhatsApp templates
router.get('/whatsapp/templates', ctrl.listWhatsAppTemplates);

// POST /api/v1/whatsapp/send             → send free-text message
router.post('/whatsapp/send', ctrl.sendWhatsApp);

// POST /api/v1/whatsapp/template         → send a template message
router.post('/whatsapp/template', ctrl.sendWhatsAppTemplate);

// ── Email ─────────────────────────────────────────────────────────────────────
// POST /api/v1/email/send               → send email to lead or direct address
router.post('/email/send', ctrl.sendEmail);

// ── Appointments ──────────────────────────────────────────────────────────────
// POST /api/v1/appointments             → create appointment
router.post('/appointments', ctrl.createAppointment);

// PUT  /api/v1/appointments/:id         → update appointment (status, date, time)
router.put('/appointments/:id', ctrl.updateAppointment);

// ── Stats / Analytics (read-only) ─────────────────────────────────────────────
// GET /api/v1/stats/leads               → lead stats summary
//   ?period=today|week|month|all
router.get('/stats/leads', ctrl.getLeadStats);

// GET /api/v1/stats/pipeline            → per-stage breakdown
router.get('/stats/pipeline', ctrl.getPipelineOverview);

module.exports = router;
