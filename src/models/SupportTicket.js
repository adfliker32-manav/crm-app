const mongoose = require('mongoose');

// In-built Help Center ticket.
// NOTE: intentionally does NOT use saasPlugin — super admin must read across all tenants.
// TTL safety net: any ticket older than 30 days auto-purges so the buffer never grows.
const supportTicketSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByName: { type: String, default: '' },
    createdByEmail: { type: String, default: '' },
    createdByRole: { type: String, default: '' },
    subject: { type: String, required: true, trim: true, maxlength: 200 },
    tag: { type: String, default: 'general' },
    status: { type: String, enum: ['open', 'admin_replied', 'user_replied'], default: 'open', index: true },
    unreadByAdmin: { type: Number, default: 1 },
    unreadByUser: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 30 }
});

supportTicketSchema.index({ status: 1, lastMessageAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
