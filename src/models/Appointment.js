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
    }]
}, { timestamps: true });

appointmentSchema.index({ userId: 1, appointmentDate: 1, status: 1 });
appointmentSchema.index({ userId: 1, customerPhone: 1 });

appointmentSchema.plugin(saasPlugin);

module.exports = mongoose.model('Appointment', appointmentSchema);
