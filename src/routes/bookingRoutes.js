// Public booking routes — no auth required
const express = require('express');
const router  = express.Router();
const { getPublicBookingPage, submitBooking } = require('../controllers/bookingPageController');
const { getAvailableSlots } = require('../controllers/slotController');

router.get('/:slug',              getPublicBookingPage);
router.get('/:slug/slots',        getAvailableSlots);
router.post('/:slug/submit',      submitBooking);

module.exports = router;
