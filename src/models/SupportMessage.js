const mongoose = require('mongoose');

const supportAttachmentSchema = new mongoose.Schema({
    kind: { type: String, enum: ['image', 'video'], required: true },
    url: { type: String, required: true },
    filename: { type: String, default: '' },
    size: { type: Number, default: 0 }
}, { _id: false });

const supportMessageSchema = new mongoose.Schema({
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'SupportTicket', required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ['customer', 'superadmin'], required: true },
    senderName: { type: String, default: '' },
    text: { type: String, default: '', maxlength: 4000 },
    attachments: [supportAttachmentSchema],
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }
});

supportMessageSchema.index({ ticketId: 1, createdAt: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
