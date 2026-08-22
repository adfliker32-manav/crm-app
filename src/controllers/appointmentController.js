const Appointment = require('../models/Appointment');
const BookingPage = require('../models/BookingPage');
const Lead = require('../models/Lead');
const { sendBookingConfirmation } = require('../services/bookingAvailabilityService');

// ─── 1. Get all appointments (admin) ────────────────────────────────────────

const getAppointments = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { status, date, search } = req.query;

        const query = { userId };

        if (status && status !== 'all') query.status = status;

        if (date === 'today') {
            const start = new Date(); start.setHours(0, 0, 0, 0);
            const end   = new Date(); end.setHours(23, 59, 59, 999);
            query.appointmentDate = { $gte: start, $lte: end };
        } else if (date === 'upcoming') {
            query.appointmentDate = { $gte: new Date() };
        } else if (date === 'past') {
            query.appointmentDate = { $lt: new Date() };
        }

        if (search) {
            const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const rx = new RegExp(escaped, 'i');
            query.$or = [
                { customerName: rx },
                { customerPhone: rx },
                { serviceType: rx }
            ];
        }

        const appointments = await Appointment.find(query)
            .sort({ appointmentDate: 1, appointmentTime: 1 })
            .populate('leadId', 'name phone email status')
            .lean();

        res.json(appointments);
    } catch (err) {
        console.error('getAppointments error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── 2. Get single appointment ───────────────────────────────────────────────

const getAppointment = async (req, res) => {
    try {
        const userId = req.tenantId;
        const appt = await Appointment.findOne({ _id: req.params.id, userId })
            .populate('leadId', 'name phone email status')
            .lean();
        if (!appt) return res.status(404).json({ message: 'Appointment not found' });
        res.json(appt);
    } catch (err) {
        console.error('getAppointment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── 3. Create appointment manually (admin) ──────────────────────────────────

const createAppointment = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { customerName, customerPhone, customerEmail, serviceType, appointmentDate, appointmentTime, notes, leadId } = req.body;

        if (!customerName || !customerPhone || !serviceType || !appointmentDate || !appointmentTime) {
            return res.status(400).json({ message: 'Name, phone, service, date and time are required.' });
        }

        // ─── Resolve BookingPage for bookingPageId + conflict scope ─────────
        // Even for manual bookings we link the appointment to the tenant's
        // booking page. This ensures conflictScope: 'service' works correctly:
        // a manually-created "Dr. Sweta" appointment won't block "Dr. Mira".
        const bookingPage = await BookingPage.findOne({ userId }).select('_id conflictScope').lean();
        const conflictScope = bookingPage?.conflictScope || 'page';

        // ─── Double-booking guard ────────────────────────────────────────────
        const dayStart = new Date(appointmentDate); dayStart.setUTCHours(0, 0, 0, 0);
        const dayEnd   = new Date(appointmentDate); dayEnd.setUTCHours(23, 59, 59, 999);

        const conflictQ = {
            userId,
            appointmentDate: { $gte: dayStart, $lte: dayEnd },
            appointmentTime,
            status: { $in: ['Pending', 'Confirmed'] }
        };
        // In service-scope mode, only count conflicts for the same resource.
        if (conflictScope === 'service' && bookingPage) {
            conflictQ.bookingPageId = bookingPage._id;
            conflictQ.serviceType   = serviceType;
        }

        const conflict = await Appointment.findOne(conflictQ).select('_id customerName').lean();
        if (conflict) {
            return res.status(409).json({
                message: `This time slot (${appointmentTime}) is already booked. Please choose a different time.`
            });
        }
        // ────────────────────────────────────────────────────────────────────

        const appt = new Appointment({
            userId,
            bookingPageId: bookingPage?._id || null,
            customerName,
            customerPhone,
            customerEmail: customerEmail || '',
            serviceType,
            appointmentDate: new Date(appointmentDate),
            appointmentTime,
            notes: notes || '',
            leadId: leadId || null,
            source: 'manual',
            status: 'Pending'
        });
        await appt.save();

        // ── Send WhatsApp + email + ICS confirmation (same as public page) ───
        // Admin-created appointments notify the customer exactly the same way as
        // a public web booking — WhatsApp template if configured, plain-text
        // fallback, and an email with an .ics calendar invite.
        if (bookingPage) {
            const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
            const formattedDate = new Date(appointmentDate).toLocaleDateString('en-US', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
            });
            sendBookingConfirmation(
                bookingPage,
                appt,
                {
                    name:          customerName,
                    phone:         customerPhone,
                    email:         customerEmail || '',
                    serviceType,
                    formattedDate,
                    appointmentTime,
                    notes:         notes || ''
                },
                frontendUrl
            ).catch(e => console.error('[Appointment] sendBookingConfirmation error:', e.message));
        }

        if (leadId) {
            const lead = await Lead.findOne({ _id: leadId, userId });
            if (lead) {
                lead.history.push({
                    type: 'Appointment',
                    subType: 'Booked',
                    content: `Appointment booked: ${serviceType} on ${new Date(appointmentDate).toLocaleDateString()} at ${appointmentTime}`,
                    date: new Date()
                });
                await lead.save();

                // Fire Workflow Engine trigger
                try {
                    const WorkflowEngine = require('../workflow-engine/WorkflowEngine');
                    WorkflowEngine.fireTrigger('APPOINTMENT_BOOKED', { lead, appointment: appt }).catch(err =>
                        console.error('[Appointment] WorkflowEngine APPOINTMENT_BOOKED error:', err.message)
                    );
                } catch (wfErr) {
                    console.error('[Appointment] WorkflowEngine import error:', wfErr.message);
                }
            }
        }

        res.status(201).json(appt);
    } catch (err) {
        console.error('createAppointment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── 4. Update appointment status ────────────────────────────────────────────

const updateAppointment = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { status, notes, cancelledReason, appointmentDate, appointmentTime } = req.body;

        // Fetch-modify-save (not findOneAndUpdate) so the model's pre-save hook
        // recomputes appointmentAt whenever the date/time changes.
        const appt = await Appointment.findOne({ _id: req.params.id, userId });
        if (!appt) return res.status(404).json({ message: 'Appointment not found' });

        const prevStatus = appt.status;
        if (status)              appt.status = status;
        if (notes !== undefined) appt.notes = notes;
        if (cancelledReason)     appt.cancelledReason = cancelledReason;

        let rescheduled = false;
        if (appointmentDate) { appt.appointmentDate = new Date(appointmentDate); rescheduled = true; }
        if (appointmentTime) { appt.appointmentTime = appointmentTime;          rescheduled = true; }

        // On reschedule, let reminders fire again for the new time.
        if (rescheduled) {
            appt.reminder24hSent = false;
            appt.reminder1hSent  = false;

            // ── Double-booking guard on reschedule ────────────────────────────
            // Prevent an admin from moving an appointment onto a slot that is
            // already occupied by another Pending/Confirmed booking.
            // We exclude this appointment itself (_id $ne) so it never conflicts
            // with its own previous record during a same-slot status-only update.
            const dayStart = new Date(appt.appointmentDate); dayStart.setUTCHours(0, 0, 0, 0);
            const dayEnd   = new Date(appt.appointmentDate); dayEnd.setUTCHours(23, 59, 59, 999);

            const conflict = await Appointment.findOne({
                userId,
                _id:             { $ne: appt._id },
                appointmentDate: { $gte: dayStart, $lte: dayEnd },
                appointmentTime: appt.appointmentTime,
                status:          { $in: ['Pending', 'Confirmed'] }
            }).select('_id customerName').lean();

            if (conflict) {
                return res.status(409).json({
                    message: `That time slot (${appt.appointmentTime}) is already booked by another appointment. Please choose a different time.`
                });
            }
            // ────────────────────────────────────────────────────────────────
        }

        await appt.save();

        // Log status changes and reschedules to the linked lead's timeline so the
        // history isn't silently lost.
        if (appt.leadId && ((status && status !== prevStatus) || rescheduled)) {
            const parts = [];
            if (status && status !== prevStatus) parts.push(`status ${prevStatus} ➔ ${status}`);
            if (rescheduled) parts.push(`rescheduled to ${new Date(appt.appointmentDate).toLocaleDateString()} at ${appt.appointmentTime}`);
            Lead.findByIdAndUpdate(appt.leadId, {
                $push: { history: { $each: [{
                    type: 'Appointment',
                    subType: 'Updated',
                    content: `Appointment ${parts.join('; ')}${cancelledReason ? ` (${cancelledReason})` : ''}`,
                    date: new Date()
                }], $slice: -100 } }
            }).catch(err => console.error('[Appointment] lead history update error:', err.message));
        }

        await appt.populate('leadId', 'name phone email status');
        res.json(appt);
    } catch (err) {
        console.error('updateAppointment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── 5. Delete appointment ───────────────────────────────────────────────────

const deleteAppointment = async (req, res) => {
    try {
        const userId = req.tenantId;
        const appt = await Appointment.findOneAndDelete({ _id: req.params.id, userId });
        if (!appt) return res.status(404).json({ message: 'Appointment not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('deleteAppointment error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── 6. Get stats (for dashboard widget) ────────────────────────────────────

const getAppointmentStats = async (req, res) => {
    try {
        const userId = req.tenantId;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

        const [total, todayCount, pending, confirmed] = await Promise.all([
            Appointment.countDocuments({ userId }),
            Appointment.countDocuments({ userId, appointmentDate: { $gte: today, $lt: tomorrow } }),
            Appointment.countDocuments({ userId, status: 'Pending' }),
            Appointment.countDocuments({ userId, status: 'Confirmed' })
        ]);

        res.json({ total, today: todayCount, pending, confirmed });
    } catch (err) {
        console.error('getAppointmentStats error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = {
    getAppointments,
    getAppointment,
    createAppointment,
    updateAppointment,
    deleteAppointment,
    getAppointmentStats
};
