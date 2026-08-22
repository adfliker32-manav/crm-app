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

    // ─── Conflict scope ──────────────────────────────────────────────────────
    // 'service' → each service (Turf A, Dr. Sweta…) has its own independent
    //             calendar. A Turf A booking at 11 AM does NOT block Turf B at
    //             11 AM. The query is scoped by bookingPageId + serviceType.
    // 'page'    → (default) any active booking on this page blocks the slot
    //             for everyone, regardless of service.
    const conflictScope = page.conflictScope || 'page';
    const apptQuery = {
        userId: page.userId,
        appointmentDate: { $gte: dayStart, $lte: dayEnd },
        status: { $in: ['Pending', 'Confirmed'] }
    };

    if (conflictScope === 'service') {
        // Scope to this specific service (resource) within this booking page.
        // bookingPageId narrows to this business's page; serviceType narrows to
        // the exact resource the customer chose (e.g. "Turf A" or "Dr. Sweta").
        apptQuery.bookingPageId = page._id;
        apptQuery.serviceType   = serviceType;
    }

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

// ─── Shared confirmation sender ───────────────────────────────────────────────
// Sends the same WhatsApp (template or plain-text) + email + ICS confirmation
// that the public booking page sends. Used by both bookingPageController and
// the chatbot's book_appointment action so every booking path is consistent.
//
// @param {Object} page          - BookingPage document (plain object or Mongoose doc)
// @param {Object} appt          - Appointment document (Mongoose doc, needs .toObject())
// @param {Object} customerData  - { name, phone, email, serviceType, formattedDate, notes }
// @param {string} frontendUrl   - base URL for the reschedule link (no trailing slash)
async function sendBookingConfirmation(page, appt, customerData, frontendUrl) {
    if (!page.sendConfirmation) return;

    const {
        sendWhatsAppTextMessage, sendWhatsAppTemplateMessage
    } = require('./whatsappService');
    const { sendEmail }  = require('./emailService');
    const WhatsAppTemplate = require('../models/WhatsAppTemplate');
    const { escapeHtml, buildIcs } = require('../utils/appointmentUtils');
    const { resolveTemplate, buildTemplateContext } = require('../utils/templateResolver');

    const { name, phone, email, serviceType, formattedDate, notes, appointmentAt, appointmentTime } = customerData;
    const manageUrl = `${frontendUrl}/book/manage/${appt.manageToken}`;

    const bookingData = {
        name,
        date:         formattedDate,
        time:         appointmentTime || appt.appointmentTime,
        service:      serviceType,
        businessName: page.businessName || ''
    };

    // ── Resolve WhatsApp template components (same mapping as booking page) ──
    const resolveBookingVar = (n) => {
        switch (n) {
            case 1: return bookingData.name;
            case 2: return bookingData.date;
            case 3: return bookingData.time;
            case 4: return bookingData.service;
            case 5: return bookingData.businessName;
            default: return '';
        }
    };
    const buildComponents = (dbComponents) => {
        const out = [];
        for (const comp of (dbComponents || [])) {
            if ((comp.type === 'BODY' || (comp.type === 'HEADER' && comp.format === 'TEXT')) && comp.text) {
                const matches = comp.text.match(/\{\{(\d+)\}\}/g);
                if (matches?.length) {
                    const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                    out.push({ type: comp.type.toLowerCase(), parameters: nums.map(n => ({ type: 'text', text: resolveBookingVar(n) })) });
                }
            }
        }
        return out;
    };

    // ── ICS calendar invite ──────────────────────────────────────────────────
    const effectiveApptAt = appointmentAt instanceof Date ? appointmentAt : new Date(appt.appointmentDate);
    const icsContent = buildIcs({
        uid:             `appt-${appt._id}@adfliker`,
        start:           effectiveApptAt,
        durationMinutes: Number(page.slotDurationMinutes || 30),
        summary:         `${serviceType} — ${page.businessName || 'Appointment'}`,
        description:     `Booking with ${page.businessName || ''}. Manage: ${manageUrl}`,
        organizerName:   page.businessName || 'Appointment'
    });

    // ── Email HTML ───────────────────────────────────────────────────────────
    const eName    = escapeHtml(name);
    const eService = escapeHtml(serviceType);
    const eDate    = escapeHtml(formattedDate);
    const eTime    = escapeHtml(bookingData.time);
    const eNotes   = escapeHtml(notes || '');
    const eBiz     = escapeHtml(page.businessName || '');
    const eManage  = escapeHtml(manageUrl);
    const emailHtml = email?.trim() ? `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px;">
            <h2 style="color:#1e293b;margin-bottom:4px;">✅ Appointment Confirmed</h2>
            <p style="color:#64748b;margin-top:0;">Hi <strong>${eName}</strong>, your appointment has been booked!</p>
            <table style="width:100%;border-collapse:collapse;margin:20px 0;">
                <tr><td style="padding:10px 0;color:#64748b;font-size:14px;">Service</td><td style="padding:10px 0;font-weight:600;color:#1e293b;">${eService}</td></tr>
                <tr style="border-top:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:14px;">Date</td><td style="padding:10px 0;font-weight:600;color:#1e293b;">${eDate}</td></tr>
                <tr style="border-top:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:14px;">Time</td><td style="padding:10px 0;font-weight:600;color:#1e293b;">${eTime}</td></tr>
                ${notes ? `<tr style="border-top:1px solid #f1f5f9;"><td style="padding:10px 0;color:#64748b;font-size:14px;">Notes</td><td style="padding:10px 0;color:#1e293b;">${eNotes}</td></tr>` : ''}
            </table>
            <div style="text-align:center;margin:20px 0;">
                <a href="${eManage}" style="display:inline-block;padding:11px 22px;background:#3b82f6;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;">Reschedule or Cancel</a>
            </div>
            <p style="color:#94a3b8;font-size:12px;text-align:center;">A calendar invite (.ics) is attached — tap it to add this to your calendar.</p>
            <p style="color:#94a3b8;font-size:12px;margin-top:24px;">${eBiz}</p>
        </div>
    ` : null;

    const sends = [];

    // ── WhatsApp: template if configured, else plain-text fallback ───────────
    if (page.confirmationTemplateId) {
        try {
            const tpl = await WhatsAppTemplate.findOne({ _id: page.confirmationTemplateId })
                .select('name language components status').lean();
            if (tpl?.name && tpl.status === 'APPROVED') {
                sends.push(
                    sendWhatsAppTemplateMessage(
                        phone, tpl.name, tpl.language || 'en',
                        buildComponents(tpl.components || []),
                        page.userId,
                        { isAutomated: true, triggerType: 'booking_confirmation' }
                    )
                        .then(() => Appointment.findByIdAndUpdate(appt._id, { confirmationSent: true }))
                        .catch(e => console.warn('[BookingConfirmation] WhatsApp template failed:', e.message))
                );
            }
        } catch (e) {
            console.warn('[BookingConfirmation] Template lookup failed:', e.message);
        }
    }

    if (sends.length === 0) {
        // Plain-text fallback using the page's confirmationMessage template
        const tplContext = buildTemplateContext({
            lead: { name, email, phone, customData: { date: bookingData.date, time: bookingData.time, service: bookingData.service } },
            appointment: { ...appt.toObject(), manageLink: manageUrl }
        });
        let waMsg = resolveTemplate(page.confirmationMessage, tplContext);
        if (manageUrl && !waMsg.includes(manageUrl)) waMsg += `\n\nReschedule or cancel: ${manageUrl}`;
        sends.push(
            sendWhatsAppTextMessage(phone, waMsg, page.userId)
                .then(() => Appointment.findByIdAndUpdate(appt._id, { confirmationSent: true }))
                .catch(e => console.warn('[BookingConfirmation] WhatsApp text failed:', e.message))
        );
    }

    // ── Email with ICS ────────────────────────────────────────────────────────
    if (emailHtml) {
        sends.push(
            sendEmail({
                to:      email.trim(),
                subject: `✅ Appointment Confirmed — ${serviceType} on ${formattedDate}`,
                html:    emailHtml,
                userId:  page.userId,
                transactional: true,
                attachments: [{
                    filename:    'appointment.ics',
                    content:     icsContent,
                    contentType: 'text/calendar; charset=utf-8; method=PUBLISH'
                }]
            })
                .then(() => Appointment.findByIdAndUpdate(appt._id, { confirmationSent: true }))
                .catch(e => console.warn('[BookingConfirmation] Email failed:', e.message))
        );
    }

    await Promise.all(sends);
}

module.exports = { checkAvailability, sendBookingConfirmation };
