const mongoose = require('mongoose');

// ============================================================
// META CAPI EVENT OUTBOX
// ============================================================
// Durable delivery record for every Meta Conversions API event.
// WHY: CAPI sends used to be a single fire-and-forget HTTP POST — any Meta
// 429/5xx, network failure, or server restart during send silently lost the
// conversion forever. Every event is now written here BEFORE the first send
// attempt; the drain cron (capiOutboxService, every 5 min) retries pending
// rows with backoff, so an event can only end up 'sent' or visibly 'failed'.
//
// The (userId, eventId) unique index doubles as application-level dedup that
// outlives Meta's 48-hour event_id window: once a logical event is 'sent',
// re-fires of the same (lead, stage) within the 7-day TTL are suppressed.
//
// PRIVACY: rows hold only IDs, stage names and Meta error strings — never
// lead PII. user_data is rebuilt from the Lead document at send time.
// ============================================================

const capiEventOutboxSchema = new mongoose.Schema({
    // Tenant whose pixel/token this event is sent with. Already resolved
    // through the agent → parent-owner fallback, so the drain cron can look
    // the IntegrationConfig up directly by this id.
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    leadId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Lead',
        required: true
    },
    // Resolved at enqueue time from the tenant's stage mapping, so a later
    // mapping change can never mutate the event_id of an in-flight event.
    eventName: { type: String, required: true },
    // Deterministic `${leadId}_${eventName}` — retries always reuse it.
    eventId:   { type: String, required: true },
    newStatus: { type: String, required: true },
    oldStatus: { type: String, default: null },
    // Unix seconds, frozen at enqueue — retries report the TRUE conversion
    // time instead of drifting forward with each attempt.
    eventTime: { type: Number, required: true },

    status: {
        type: String,
        enum: ['pending', 'sent', 'failed'],
        default: 'pending',
        index: true
    },
    attempts:    { type: Number, default: 0 },
    nextRetryAt: { type: Date, default: Date.now },
    // Meta error message only — never payload contents.
    lastError:   { type: String, default: null }
}, { timestamps: true });

// One row per logical conversion event per tenant.
capiEventOutboxSchema.index({ userId: 1, eventId: 1 }, { unique: true });
// Drain-cron scan path.
capiEventOutboxSchema.index({ status: 1, nextRetryAt: 1 });
// Auto-purge after 7 days — matches Meta's max event_time backdating window,
// so a lead legitimately re-entering a stage months later sends again.
capiEventOutboxSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60 });

module.exports = mongoose.model('CapiEventOutbox', capiEventOutboxSchema);
