const BookingPage  = require('../models/BookingPage');
const Appointment  = require('../models/Appointment');
const BlockedSlot  = require('../models/BlockedSlot');

// Convert "09:00 AM" / "12:00 PM" → minutes since midnight
function timeToMinutes(str) {
    const m = String(str).match(/^(\d+):(\d+)\s*(AM|PM)$/i);
    if (!m) return -1;
    let h = parseInt(m[1]);
    const mins = parseInt(m[2]);
    const period = m[3].toUpperCase();
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    return h * 60 + mins;
}

// Slot S is blocked by booked appointment A (with buffer B in minutes):
// - exact match, OR
// - S falls in the buffer window immediately after A  (0 < S-A < B)
function conflicts(slotMins, apptMins, bufferMinutes) {
    const diff = slotMins - apptMins;
    if (diff === 0) return true;
    if (bufferMinutes > 0 && diff > 0 && diff < bufferMinutes) return true;
    return false;
}

// ─── Public: GET /book/:slug/slots?date=YYYY-MM-DD ──────────────────────────

const getAvailableSlots = async (req, res) => {
    try {
        const slug = String(req.params.slug || '').toLowerCase().trim();
        const { date }  = req.query;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
            return res.status(400).json({ message: 'date query param required (YYYY-MM-DD)' });

        const page = await BookingPage.findOne({ slug, isActive: true }).lean();
        if (!page) return res.status(404).json({ message: 'Booking page not found.' });

        const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
        if (!page.availableDays.includes(dayOfWeek))
            return res.json({ slots: [] });

        const bufferMinutes = page.bufferMinutes || 0;

        // Pending + Confirmed appointments on that day
        const appts = await Appointment.find({
            userId: page.userId,
            appointmentDate: { $gte: new Date(`${date}T00:00:00.000Z`), $lte: new Date(`${date}T23:59:59.999Z`) },
            status: { $in: ['Pending', 'Confirmed'] }
        }).select('appointmentTime').lean();

        const bookedMins = appts.map(a => timeToMinutes(a.appointmentTime)).filter(m => m >= 0);

        // Blocked slots for that day
        const blocked = await BlockedSlot.find({ userId: page.userId, date }).lean();
        if (blocked.some(b => !b.time)) return res.json({ slots: [] }); // whole day blocked

        const blockedTimes = new Set(blocked.filter(b => b.time).map(b => b.time));

        const available = (page.timeSlots || []).filter(slot => {
            if (blockedTimes.has(slot.time)) return false;
            const slotMins = timeToMinutes(slot.time);
            if (slotMins < 0) return false;
            return !bookedMins.some(bm => conflicts(slotMins, bm, bufferMinutes));
        });

        res.json({ slots: available });
    } catch (err) {
        console.error('getAvailableSlots error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── Admin: GET /appointments/calendar?month=YYYY-MM ────────────────────────

const getCalendarData = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { month } = req.query;

        if (!month || !/^\d{4}-\d{2}$/.test(month))
            return res.status(400).json({ message: 'month query param required (YYYY-MM)' });

        const [year, mo] = month.split('-').map(Number);
        const start = new Date(year, mo - 1, 1);
        const end   = new Date(year, mo, 0, 23, 59, 59, 999);

        const [appts, blocked] = await Promise.all([
            Appointment.find({ userId, appointmentDate: { $gte: start, $lte: end } })
                .select('customerName serviceType appointmentDate appointmentTime status')
                .lean(),
            BlockedSlot.find({ userId, date: { $gte: `${month}-01`, $lte: `${month}-31` } }).lean()
        ]);

        // Group appointments by "YYYY-MM-DD"
        const appointments = {};
        appts.forEach(a => {
            const key = new Date(a.appointmentDate).toISOString().slice(0, 10);
            if (!appointments[key]) appointments[key] = [];
            appointments[key].push(a);
        });

        res.json({ appointments, blockedSlots: blocked });
    } catch (err) {
        console.error('getCalendarData error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── Admin: GET /appointments/blocked-slots ──────────────────────────────────

const getBlockedSlots = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { date, month } = req.query;

        const query = { userId };
        if (date)  query.date = date;
        if (month) query.date = { $gte: `${month}-01`, $lte: `${month}-31` };

        const blocked = await BlockedSlot.find(query).sort({ date: 1, time: 1 }).lean();
        res.json(blocked);
    } catch (err) {
        console.error('getBlockedSlots error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── Admin: POST /appointments/blocked-slots ─────────────────────────────────

const blockSlot = async (req, res) => {
    try {
        const userId = req.tenantId;
        const { date, time, reason } = req.body;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
            return res.status(400).json({ message: 'date required (YYYY-MM-DD)' });

        // Prevent duplicates
        const existing = await BlockedSlot.findOne({ userId, date, time: time || null });
        if (existing) return res.json(existing);

        const blocked = new BlockedSlot({ userId, date, time: time || null, reason: reason || '' });
        await blocked.save();
        res.status(201).json(blocked);
    } catch (err) {
        console.error('blockSlot error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

// ─── Admin: DELETE /appointments/blocked-slots/:id ───────────────────────────

const unblockSlot = async (req, res) => {
    try {
        const userId = req.tenantId;
        const doc = await BlockedSlot.findOneAndDelete({ _id: req.params.id, userId });
        if (!doc) return res.status(404).json({ message: 'Blocked slot not found' });
        res.json({ success: true });
    } catch (err) {
        console.error('unblockSlot error:', err);
        res.status(500).json({ message: 'Server error' });
    }
};

module.exports = { getAvailableSlots, getCalendarData, getBlockedSlots, blockSlot, unblockSlot };
