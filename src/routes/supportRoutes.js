const express = require('express');
const router = express.Router();
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { uploadSupportMedia } = require('../middleware/supportUploadMiddleware');
const { createRateLimiter } = require('../middleware/emailRateLimiter');
const {
    authorizeTicketAccess,
    createTicket,
    listMyTickets,
    getTicketMessages,
    sendMessage,
    closeTicket,
    adminListTickets,
    adminUnreadCount,
    adminGetCannedReply
} = require('../controllers/supportController');

// ── Super Admin routes (must be registered BEFORE :id route to avoid 'admin' being parsed as ObjectId)
router.get('/admin/tickets', authMiddleware, requireSuperAdmin, adminListTickets);
router.get('/admin/unread', authMiddleware, requireSuperAdmin, adminUnreadCount);
router.get('/admin/canned', authMiddleware, requireSuperAdmin, adminGetCannedReply);

// Ticket creation triggers an LLM auto-reply billed to the PLATFORM's own global
// API key, not the tenant's credits (see supportController.createTicket). Without
// a cap, any authenticated tenant could loop this endpoint and run up our bill.
// Per-tenant so extra agent accounts don't multiply the allowance.
const createTicketLimiter = createRateLimiter(
    5,
    10 * 60 * 1000,
    'You have opened several tickets recently. Please reply on an existing ticket, or try again in a few minutes.'
);

// ── Customer / shared routes (any authenticated user; access checks done in controller)
router.post('/tickets', authMiddleware, createTicketLimiter, uploadSupportMedia, createTicket);
router.get('/tickets', authMiddleware, listMyTickets);

router.get('/tickets/:id/messages',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    authorizeTicketAccess,
    getTicketMessages
);

// ⚠️ ORDER IS SECURITY-CRITICAL: authorizeTicketAccess MUST precede
// uploadSupportMedia. multer writes accepted files into uploads/support/<:id>/
// as a side effect of parsing the request, so authorising after it runs lets any
// authenticated user plant files in another tenant's ticket folder before the
// 403 is returned.
router.post('/tickets/:id/messages',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    authorizeTicketAccess,
    uploadSupportMedia,
    sendMessage
);

router.patch('/tickets/:id/close',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    authorizeTicketAccess,
    closeTicket
);

module.exports = router;
