const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

const timeSlotSchema = new mongoose.Schema({
    time: { type: String, required: true },
    label: { type: String, default: '' }
}, { _id: false });

const customQuestionSchema = new mongoose.Schema({
    id:       { type: String, required: true },
    question: { type: String, required: true, trim: true },
    type:     { type: String, enum: ['text', 'textarea', 'select', 'phone', 'email'], default: 'text' },
    options:  [{ type: String, trim: true }],
    required: { type: Boolean, default: false },
    order:    { type: Number, default: 0 }
}, { _id: false });

const bookingPageSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    // Public-facing slug: used in the URL /book/:slug
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    // Page content
    title: { type: String, default: 'Book an Appointment', trim: true },
    subtitle: { type: String, default: 'Choose a service and pick a convenient time.', trim: true },
    // Services offered (e.g. "Site Visit", "Online Meeting", "Consultation")
    services: [{ type: String, trim: true }],
    // Available days (0=Sun, 1=Mon, ..., 6=Sat)
    availableDays: { type: [Number], default: [1, 2, 3, 4, 5] },
    // Available time slots
    timeSlots: { type: [timeSlotSchema], default: [
        { time: '09:00 AM' },
        { time: '10:00 AM' },
        { time: '11:00 AM' },
        { time: '12:00 PM' },
        { time: '02:00 PM' },
        { time: '03:00 PM' },
        { time: '04:00 PM' },
        { time: '05:00 PM' }
    ]},
    // Branding
    primaryColor: { type: String, default: '#3b82f6' },
    logoUrl: { type: String, default: '' },
    businessName: { type: String, default: '', trim: true },
    // When a public booking is submitted: create/link a lead and optionally set its stage
    leadStageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stage', default: null, index: true },
    // WhatsApp confirmation (template-based). If set, confirmations are sent using this template.
    confirmationTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: 'WhatsAppTemplate', default: null, index: true },
    // Auto WhatsApp confirmation message template
    confirmationMessage: {
        type: String,
        default: 'Hi {{name}}! ✅ Your appointment has been confirmed.\n\n📅 Date: {{date}}\n⏰ Time: {{time}}\n🏷️ Service: {{service}}\n\nWe look forward to seeing you!'
    },
    // Whether to send WhatsApp confirmation on booking
    sendConfirmation: { type: Boolean, default: true },
    // Whether the booking page is publicly accessible
    isActive: { type: Boolean, default: true },
    // Advance booking limit in days (0 = unlimited)
    maxAdvanceDays: { type: Number, default: 30 },
    // Gap in minutes to leave between back-to-back bookings
    bufferMinutes: { type: Number, default: 0 },
    // Custom questions shown on the booking form; answers saved with appointment + lead
    customQuestions: { type: [customQuestionSchema], default: [] },
    // Message shown on the success screen after booking
    thankYouMessage: { type: String, default: '', trim: true },
    // Optional description shown on the public booking page
    description: { type: String, default: '', trim: true },
    // User-editable URL prefix (slug = slugPrefix-userId_last8 or book-userId_last8)
    slugPrefix: { type: String, default: '', trim: true }
}, { timestamps: true });

bookingPageSchema.plugin(saasPlugin);

module.exports = mongoose.model('BookingPage', bookingPageSchema);
