// Server-side availability validation shared by the public booking submit and the
// self-service reschedule flow, so the two can never diverge.

const Appointment = require('../models/Appointment');
const BlockedSlot = require('../models/BlockedSlot');
const {
    timeToMinutes, conflicts, deriveAppointmentAt, DEFAULT_TZ_OFFSET_MINUTES
} = require('../utils/appointmentUtils');

// Validate a requested slot against a booking page's rules and existing bookings.
// Returns { ok: true, appointmentAt, tzOffset } or { ok: false, code, message }.
//   - serviceType omitted → skip the "is this an offered service" check (reschedule
//     keeps the original service).
//   - excludeApptId → ignore this appointment when checking conflicts (reschedule
//     must not conflict with itself).
async function checkAvailability(page, { appointmentDate, appointmentTime, serviceType, excludeApptId } = {}) {
    const tzOffset = Number.isFinite(page.timezoneOffsetMinutes)
        ? page.timezoneOffsetMinutes : DEFAULT_TZ_OFFSET_MINUTES;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(appointmentDate)))
        return { ok: false, code: 400, message: 'Invalid appointment date.' };

    if (serviceType !== undefined && !(page.services || []).includes(serviceType))
        return { ok: false, code: 400, message: 'Selected service is not available.' };

    if (!(page.timeSlots || []).some(s => s.time === appointmentTime))
        return { ok: false, code: 400, message: 'Selected time slot is not available.' };

    const dayOfWeek = new Date(`${appointmentDate}T00:00:00`).getDay();
    if (Array.isArray(page.availableDays) && !page.availableDays.includes(dayOfWeek))
        return { ok: false, code: 400, message: 'Bookings are not available on the selected day.' };

    const appointmentAt = deriveAppointmentAt(appointmentDate, appointmentTime, tzOffset);
    if (!appointmentAt)
        return { ok: false, code: 400, message: 'Invalid appointment time.' };

    const minNotice = Number(page.minNoticeMinutes || 0);
    if (appointmentAt.getTime() < Date.now() + minNotice * 60000) {
        return {
            ok: false, code: 400,
            message: minNotice > 0
                ? 'That slot is too soon to book. Please pick a later time.'
                : 'That time slot is in the past. Please pick a future time.'
        };
    }

    const maxAdvanceDays = Number(page.maxAdvanceDays || 0);
    if (maxAdvanceDays > 0 && appointmentAt.getTime() > Date.now() + (maxAdvanceDays + 1) * 86400000)
        return { ok: false, code: 400, message: 'That date is too far in advance.' };

    const dayStart = new Date(`${appointmentDate}T00:00:00.000Z`);
    const dayEnd   = new Date(`${appointmentDate}T23:59:59.999Z`);
    const apptQuery = {
        userId: page.userId,
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $in: ['Pending', 'Confirmed'] }
    };
    if (excludeApptId) apptQuery._id = { $ne: excludeApptId };

    const [dayAppts, blocked] = await Promise.all([
        Appointment.find(apptQuery).select('appointmentTime').lean(),
        BlockedSlot.find({ userId: page.userId, date: appointmentDate }).lean()
    ]);

    if (blocked.some(b => !b.time))
        return { ok: false, code: 409, message: 'This date is unavailable for booking.' };
    if (blocked.some(b => b.time === appointmentTime))
        return { ok: false, code: 409, message: 'This time slot is unavailable.' };

    const bufferMinutes = page.bufferMinutes || 0;
    const slotMins = timeToMinutes(appointmentTime);
    const slotTaken = dayAppts
        .map(a => timeToMinutes(a.appointmentTime))
        .filter(m => m >= 0)
        .some(bm => conflicts(slotMins, bm, bufferMinutes));
    if (slotTaken)
        return { ok: false, code: 409, message: 'Sorry, that time slot was just booked. Please choose another.' };

    return { ok: true, appointmentAt, tzOffset };
}

module.exports = { checkAvailability };
