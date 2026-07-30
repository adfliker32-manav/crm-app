const mongoose = require('mongoose');
const saasPlugin = require('./plugins/saasPlugin');

// FIX W7: drafts were routed and reachable but every handler returned 501.
const emailDraftSchema = new mongoose.Schema({
    // Owning tenant — drafts are visible to the whole workspace.
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // The individual who wrote it, for attribution in a shared workspace.
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    to: { type: String, default: '' },
    cc: { type: String, default: '' },
    bcc: { type: String, default: '' },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        default: null
    }
}, { timestamps: true });

emailDraftSchema.index({ userId: 1, updatedAt: -1 });

// Abandoned drafts would otherwise accumulate forever.
emailDraftSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

emailDraftSchema.plugin(saasPlugin);

module.exports = mongoose.model('EmailDraft', emailDraftSchema);
