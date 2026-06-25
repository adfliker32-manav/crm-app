const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// LeadProcessingLock Schema
//
// Used as a MongoDB-level advisory lock to prevent duplicate webhook
// processing if Meta sends multiple webhooks in rapid succession (e.g. 50ms apart).
// Auto-expires after 5 minutes (300 seconds) via a TTL index.
// ─────────────────────────────────────────────────────────────────────────────
const LeadProcessingLockSchema = new mongoose.Schema({
    leadgenId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    createdAt: {
        type: Date,
        default: Date.now,
        expires: 60 // Auto-expire after 60 seconds — max real processing time is ~30s (5 retry attempts)
    }
});

module.exports = mongoose.model('LeadProcessingLock', LeadProcessingLockSchema);
