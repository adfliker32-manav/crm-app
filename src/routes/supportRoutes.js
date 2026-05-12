const express = require('express');
const router = express.Router();
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');
const validateObjectId = require('../middleware/validateObjectId');
const { uploadSupportMedia } = require('../middleware/supportUploadMiddleware');
const {
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

// ── Customer / shared routes (any authenticated user; access checks done in controller)
router.post('/tickets', authMiddleware, uploadSupportMedia, createTicket);
router.get('/tickets', authMiddleware, listMyTickets);

router.get('/tickets/:id/messages',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    getTicketMessages
);

router.post('/tickets/:id/messages',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    uploadSupportMedia,
    sendMessage
);

router.patch('/tickets/:id/close',
    validateObjectId({ params: ['id'] }),
    authMiddleware,
    closeTicket
);

module.exports = router;
