// Customer-facing self-service management of a single appointment via an opaque
// manageToken (no auth). Powers the /book/manage/:token page: view, reschedule,
// cancel. All availability rules are reused from bookingAvailabilityService so a
// reschedule obeys the same constraints as a fresh booking.

const Appointment = require('../models/Appointment');
const BookingPage = require('../models/BookingPage');
const Lead = require('../models/Lead');
const { checkAvailability } = require('../services/bookingAvailabilityService');
const { emitToUser } = require('../services/socketService');

const MODIFIABLE = ['Pending', 'Confirmed'];

const toISODate = (d) => new Date(d).toISOString().slice(0, 10);

// Load the appointment + the public slice of its booking page needed to render the
// manage / reschedule UI.
const loadContext = async (token) => {
    const appt = await Appointment.findOne({ manageToken: String(token || '') });
    if (!appt) return { appt: null, page: null };
    const page = await BookingPage.findOne({ userId: appt.userId }).lean();
    return { appt, page };
};

const pushLeadHistory = (leadId, content) => {
    if (!leadId) return;
    Lead.findByIdAndUpdate(leadId, {
        $push: { history: { $each: [{
            type: 'Appointment', subType: 'Updated', content, date: new Date()
        }], $slice: -100 } }
    }).catch(err => console.error('[BookingManage] lead history error:', err.message));
};

// ─── GET /api/book/manage/:token ─────────────────────────────────────────────
const getManageAppointment = async (req, res) => {
    try {
        const { appt, page } = await loadContext(req.params.token);
        if (!appt) return res.status(404).json({ message: 'Appointment not found.' });

        res.json({
            appointment: {
                serviceType:     appt.serviceType,
                appointmentDate: toISODate(appt.appointmentDate),
                appointmentTime: appt.appointmentTime,
                customerName:    appt.customerName,
                status:          appt.status,
                notes:           appt.notes || ''
            },
            canModify: MODIFIABLE.includes(appt.status),
            page: page ? {
                businessName:     page.businessName || '',
                primaryColor:     page.primaryColor || '#3b82f6',
                slug:             page.slug,
                services:         page.services || [],
                availableDays:    page.availableDays || [1, 2, 3, 4, 5],
                maxAdvanceDays:   page.maxAdvanceDays || 30,
                minNoticeMinutes: page.minNoticeMinutes || 0
            } : null
        });
    } catch (err) {
        console.error('getManageAppointment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── POST /api/book/manage/:token/cancel ─────────────────────────────────────
const cancelAppointmentByToken = async (req, res) => {
    try {
        const { appt } = await loadContext(req.params.token);
        if (!appt) return res.status(404).json({ message: 'Appointment not found.' });
        if (!MODIFIABLE.includes(appt.status))
            return res.status(409).json({ message: `This appointment is already ${appt.status.toLowerCase()} and can't be changed.` });

        appt.status = 'Cancelled';
        appt.cancelledReason = 'Cancelled by customer';
        await appt.save();

        pushLeadHistory(appt.leadId, `Appointment cancelled by customer: ${appt.serviceType} on ${new Date(appt.appointmentDate).toLocaleDateString()} at ${appt.appointmentTime}`);
        try { emitToUser(appt.userId.toString(), 'appointment:updated', { _id: appt._id, status: 'Cancelled' }); } catch (_) {}

        res.json({ success: true, message: 'Your appointment has been cancelled.' });
    } catch (err) {
        console.error('cancelAppointmentByToken error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── POST /api/book/manage/:token/reschedule ─────────────────────────────────
const rescheduleAppointmentByToken = async (req, res) => {
    try {
        const { appointmentDate, appointmentTime } = req.body;
        if (!appointmentDate || !appointmentTime)
            return res.status(400).json({ message: 'New date and time are required.' });

        const { appt, page } = await loadContext(req.params.token);
        if (!appt) return res.status(404).json({ message: 'Appointment not found.' });
        if (!page)  return res.status(404).json({ message: 'Booking page not found.' });
        if (!MODIFIABLE.includes(appt.status))
            return res.status(409).json({ message: `This appointment is already ${appt.status.toLowerCase()} and can't be changed.` });

        // Same rules as a new booking, but keep the original service and ignore this
        // appointment when checking for conflicts.
        const availability = await checkAvailability(page, {
            appointmentDate, appointmentTime, excludeApptId: appt._id
        });
        if (!availability.ok) return res.status(availability.code).json({ message: availability.message });

        const oldDate = appt.appointmentDate;
        const oldTime = appt.appointmentTime;
        const oldWhen = `${new Date(oldDate).toLocaleDateString()} at ${oldTime}`;

        appt.appointmentDate = new Date(appointmentDate);
        appt.appointmentTime = appointmentTime;
        appt.$locals.tzOffsetMinutes = availability.tzOffset;
        // Let the reminders fire again for the new time.
        appt.reminder24hSent = false;
        appt.reminder1hSent  = false;
        await appt.save();

        // Concurrency guard: lose to any earlier active booking now sharing this slot,
        // and roll back to the original slot rather than dropping the appointment.
        const earlier = await Appointment.findOne({
            userId: appt.userId,
            appointmentDate: appt.appointmentDate,
            appointmentTime,
            status: { $in: MODIFIABLE },
            _id: { $lt: appt._id }
        }).select('_id').lean();
        if (earlier) {
            appt.appointmentDate = oldDate;
            appt.appointmentTime = oldTime;
            await appt.save();
            return res.status(409).json({ message: 'Sorry, that time slot was just booked. Please choose another.' });
        }

        pushLeadHistory(appt.leadId, `Appointment rescheduled by customer: ${appt.serviceType} from ${oldWhen} to ${new Date(appt.appointmentDate).toLocaleDateString()} at ${appt.appointmentTime}`);
        try { emitToUser(appt.userId.toString(), 'appointment:updated', { _id: appt._id, appointmentDate: appt.appointmentDate, appointmentTime }); } catch (_) {}

        res.json({ success: true, message: 'Your appointment has been rescheduled.' });
    } catch (err) {
        console.error('rescheduleAppointmentByToken error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getManageAppointment, cancelAppointmentByToken, rescheduleAppointmentByToken };
