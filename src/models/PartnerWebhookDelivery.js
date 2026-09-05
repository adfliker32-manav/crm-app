const mongoose = require('mongoose');

// ============================================================
// PARTNER WEBHOOK DELIVERY OUTBOX
// ============================================================
// Durable delivery record for every partner webhook event (PA-H4).
//
// WHY: forwarding used to be a single fire-and-forget axios.post with a 5s
// timeout and a console.warn on failure. A three-second blip on the partner's
// side lost those messages permanently, with no way for either party to find
// out. Every event is now written here BEFORE the first attempt; the drain cron
// (partnerWebhookOutboxService, every minute) retries pending rows with
// exponential backoff, so an event can only end up 'delivered' or visibly
// 'failed' — and either way it is inspectable in the SuperAdmin Webhook tab.
//
// Same shape as CapiEventOutbox deliberately: Mongo is the queue, so retries
// survive server restarts without requiring Redis to be up.
//
// PRIVACY: `payload` holds exactly what was signed and sent to the partner —
// the same message metadata they would have received inline. It inherits the
// 30-day TTL below rather than living forever.
// ============================================================

const partnerWebhookDeliverySchema = new mongoose.Schema({
    partnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PartnerApp',
        required: true,
        index: true
    },
    // The provisioned account the event belongs to. Kept denormalised so the
    // drain cron never has to re-resolve tenant → partner.
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    event: { type: String, required: true },   // 'message.received', 'account.frozen', …

    // Frozen at enqueue. Retries resend the ORIGINAL payload — including its
    // original `timestamp` — so a partner's anti-replay window measures the
    // real event time, not the retry time.
    payload: { type: mongoose.Schema.Types.Mixed, required: true },

    // Resolved at enqueue so a webhook URL change mid-flight cannot silently
    // redirect already-queued events to a new destination.
    targetUrl: { type: String, required: true },

    // Deterministic id echoed in the X-Partner-Delivery-Id header. A partner
    // that receives the same id twice (ambiguous timeout, then a retry) can
    // dedupe on it instead of double-processing a message.
    deliveryId: { type: String, required: true, unique: true, index: true },

    status: {
        type: String,
        enum: ['pending', 'delivered', 'failed'],
        default: 'pending',
        index: true
    },
    attempts:     { type: Number, default: 0 },
    nextRetryAt:  { type: Date, default: Date.now },
    lastError:    { type: String, default: null },
    lastStatusCode: { type: Number, default: null },
    deliveredAt:  { type: Date, default: null }
}, { timestamps: true });

// Drain-cron scan path.
partnerWebhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });
// Delivery-log tab: newest-first per partner, filterable by status.
partnerWebhookDeliverySchema.index({ partnerId: 1, createdAt: -1 });
partnerWebhookDeliverySchema.index({ partnerId: 1, status: 1, createdAt: -1 });

// Auto-purge after 30 days — long enough to debug a partner integration,
// short enough that a high-volume tenant cannot grow this unbounded.
partnerWebhookDeliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

module.exports = mongoose.model('PartnerWebhookDelivery', partnerWebhookDeliverySchema);
