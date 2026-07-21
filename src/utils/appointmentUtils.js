// Shared appointment/booking helpers.
// Single source of truth for slot-time math so the public /slots endpoint and
// the /submit validation can never drift out of sync.

// Default booking timezone offset (minutes east of UTC). 330 = IST (Asia/Kolkata).
// India has no DST, so a fixed offset is correct here; configurable per booking
// page via BookingPage.timezoneOffsetMinutes for other regions.
const DEFAULT_TZ_OFFSET_MINUTES = 330;

// Convert "09:00 AM" / "12:00 PM" → minutes since midnight. Returns -1 if unparseable.
function timeToMinutes(str) {
    const m = String(str).match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!m) return -1;
    let h = parseInt(m[1], 10);
    const mins = parseInt(m[2], 10);
    const period = m[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + mins;
}

// Slot S conflicts with a booked appointment A (with buffer B minutes) when:
// - exact match, OR
// - S falls in the buffer window immediately after A  (0 < S-A < B)
function conflicts(slotMins, apptMins, bufferMinutes) {
    const diff = slotMins - apptMins;
    if (diff === 0) return true;
    if (bufferMinutes > 0 && diff > 0 && diff < bufferMinutes) return true;
    return false;
}

// Combine an appointment's calendar day + "10:00 AM" string into a real UTC instant.
// `dateVal` may be a "YYYY-MM-DD" string or a Date stored at midnight-UTC of the day;
// either way we read its calendar Y/M/D in UTC (that's how bookings are persisted).
// Returns a Date, or null if the inputs can't be parsed.
function deriveAppointmentAt(dateVal, timeStr, offsetMinutes = DEFAULT_TZ_OFFSET_MINUTES) {
    const mins = timeToMinutes(timeStr);
    if (mins < 0 || dateVal == null) return null;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();
    const h = Math.floor(mins / 60);
    const mm = mins % 60;
    const offset = Number.isFinite(offsetMinutes) ? offsetMinutes : DEFAULT_TZ_OFFSET_MINUTES;
    return new Date(Date.UTC(y, mo, day, h, mm) - offset * 60000);
}

// Escape user-supplied text before interpolating into HTML (confirmation emails).
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Random URL-safe token for the customer's self-service manage link.
function generateManageToken() {
    return require('crypto').randomBytes(24).toString('hex');
}

// Format a Date as an iCalendar UTC timestamp: 20260720T093000Z
function toIcsUtc(date) {
    return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Escape a value for an iCalendar text field (RFC 5545 §3.3.11).
function icsEscape(str) {
    return String(str ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');
}

// Build a minimal single-event .ics (VCALENDAR) the customer can add to any calendar.
// start/end are Date instants; durationMinutes used when end is omitted.
function buildIcs({ uid, start, end, summary, description, location, organizerName, durationMinutes = 30 }) {
    const dtStart = new Date(start);
    const dtEnd = end ? new Date(end) : new Date(dtStart.getTime() + durationMinutes * 60000);
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Adfliker CRM//Appointments//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${icsEscape(uid)}`,
        `DTSTAMP:${toIcsUtc(new Date())}`,
        `DTSTART:${toIcsUtc(dtStart)}`,
        `DTEND:${toIcsUtc(dtEnd)}`,
        `SUMMARY:${icsEscape(summary || 'Appointment')}`
    ];
    if (description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    if (location)    lines.push(`LOCATION:${icsEscape(location)}`);
    if (organizerName) lines.push(`ORGANIZER;CN=${icsEscape(organizerName)}:mailto:noreply@adfliker.com`);
    lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
}

module.exports = {
    DEFAULT_TZ_OFFSET_MINUTES,
    timeToMinutes,
    conflicts,
    deriveAppointmentAt,
    escapeHtml,
    generateManageToken,
    buildIcs
};
