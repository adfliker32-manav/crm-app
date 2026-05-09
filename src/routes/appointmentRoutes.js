const express = require('express');
const router  = express.Router();
const apptCtrl = require('../controllers/appointmentController');
const bpCtrl   = require('../controllers/bookingPageController');
const slotCtrl = require('../controllers/slotController');
const validateObjectId = require('../middleware/validateObjectId');

// ─── Specific named routes (must come BEFORE /:id) ──────────────────────────
router.get('/stats',               apptCtrl.getAppointmentStats);
router.get('/calendar',            slotCtrl.getCalendarData);
router.get('/booking-page/config', bpCtrl.getMyBookingPage);
router.put('/booking-page/config', bpCtrl.updateMyBookingPage);

// Blocked slots CRUD
router.get('/blocked-slots',    slotCtrl.getBlockedSlots);
router.post('/blocked-slots',   slotCtrl.blockSlot);
router.delete('/blocked-slots/:id', validateObjectId({ params: ['id'] }), slotCtrl.unblockSlot);

// ─── Appointment CRUD ────────────────────────────────────────────────────────
router.get('/',                                             apptCtrl.getAppointments);
router.get('/:id', validateObjectId({ params: ['id'] }),    apptCtrl.getAppointment);
router.post('/',                                            apptCtrl.createAppointment);
router.put('/:id', validateObjectId({ params: ['id'] }),    apptCtrl.updateAppointment);
router.delete('/:id', validateObjectId({ params: ['id'] }), apptCtrl.deleteAppointment);

module.exports = router;
