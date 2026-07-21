// Public booking routes — no auth required
const express = require('express');
const router  = express.Router();
const { getPublicBookingPage, submitBooking } = require('../controllers/bookingPageController');
const { getAvailableSlots } = require('../controllers/slotController');
const {
    getManageAppointment, cancelAppointmentByToken, rescheduleAppointmentByToken
} = require('../controllers/bookingManageController');
const { createRateLimiter } = require('../middleware/emailRateLimiter');

// Public + unauthenticated: each submit creates a lead and can fire WhatsApp/email
// sends, so throttle per IP to blunt spam/abuse. Keyed on req.ip (no req.user here).
const bookingSubmitLimiter = createRateLimiter(
    8, 60 * 1000,
    'Too many booking attempts. Please wait a minute and try again.'
);
const manageLimiter = createRateLimiter(
    20, 60 * 1000,
    'Too many requests. Please wait a minute and try again.'
);

// Self-service manage (reschedule / cancel) by opaque token. Registered before the
// generic /:slug routes; the two-segment paths don't collide, but keep them first.
router.get('/manage/:token',                       manageLimiter, getManageAppointment);
router.post('/manage/:token/cancel',               manageLimiter, cancelAppointmentByToken);
router.post('/manage/:token/reschedule',           manageLimiter, rescheduleAppointmentByToken);

router.get('/:slug',                             getPublicBookingPage);
router.get('/:slug/slots',                       getAvailableSlots);
router.post('/:slug/submit', bookingSubmitLimiter, submitBooking);

module.exports = router;
