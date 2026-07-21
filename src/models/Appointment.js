const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const appointmentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
    // Customer info (captured from booking form — may not have a lead yet)
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, required: true, trim: true },
    customerEmail: { type: String, default: '', trim: true },
    // Booking details
    serviceType: { type: String, required: true, trim: true },
    appointmentDate: { type: Date, required: true },
    appointmentTime: { type: String, required: true }, // "10:00 AM"
    // Real UTC instant of the appointment (date + parsed time in the booking-page
    // timezone). Reminders and any time-based logic MUST use this, not
    // appointmentDate — which is stored at midnight-UTC and carries no time-of-day.
    appointmentAt: { type: Date, default: null, index: true },
    notes: { type: String, default: '', trim: true },
    // Status lifecycle
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'Cancelled', 'Completed', 'No-Show'],
        default: 'Pending'
    },
    // Track if WhatsApp confirmation was sent
    confirmationSent: { type: Boolean, default: false },
    // Source: chatbot or direct link
    source: { type: String, enum: ['chatbot', 'direct_link', 'manual'], default: 'direct_link' },
    // Cancellation reason
    cancelledReason: { type: String, default: '' },
    // Answers to custom questions from the booking page
    customAnswers: [{
        questionId: { type: String },
        question:   { type: String },
        answer:     { type: String },
        _id: false
    }],

    // Reminder tracking — prevents duplicate sends on each cron tick
    reminder24hSent: { type: Boolean, default: false },
    reminder1hSent:  { type: Boolean, default: false },

    // Opaque token for the customer's self-service manage link (reschedule/cancel).
    // Unguessable; the only credential needed to view/change this one appointment.
    manageToken: { type: String, default: null, index: { unique: true, sparse: true } }
}, { timestamps: true });

appointmentSchema.index({ userId: 1, appointmentDate: 1, status: 1 });
appointmentSchema.index({ userId: 1, customerPhone: 1 });
// Reminder cron scans upcoming appointments by their true instant.
appointmentSchema.index({ status: 1, appointmentAt: 1 });

// Safety net: guarantee appointmentAt is always populated on save, even for code
// paths that don't set it explicitly. Controllers that know the booking-page
// timezone pass it via `doc.$locals.tzOffsetMinutes`; otherwise the default
// (IST) offset is used.
appointmentSchema.pre('save', function (next) {
    const { deriveAppointmentAt } = require('../utils/appointmentUtils');
    if (
        (this.isModified('appointmentDate') || this.isModified('appointmentTime') || !this.appointmentAt) &&
        this.appointmentDate && this.appointmentTime
    ) {
        const offset = this.$locals && Number.isFinite(this.$locals.tzOffsetMinutes)
            ? this.$locals.tzOffsetMinutes
            : undefined;
        const at = deriveAppointmentAt(this.appointmentDate, this.appointmentTime, offset);
        if (at) this.appointmentAt = at;
    }
    next();
});

appointmentSchema.plugin(saasPlugin);

module.exports = mongoose.model('Appointment', appointmentSchema);
