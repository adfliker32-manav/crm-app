const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// AiCreditLedger — an append-only statement of every credit movement, per tenant.
// ─────────────────────────────────────────────────────────────────────────────
// Like a bank / Stripe statement: one row per event, signed. Debits (AI usage)
// are negative, credits (top-ups, bonuses) are positive. `balanceAfter` is the
// wallet balance immediately after the row was applied, so a customer can read
// the ledger top-to-bottom and see exactly where every credit went — which is
// the whole point: "where did my credits go?" answered without a support ticket.
//
// Rows are never mutated or deleted. The wallet balance (User.aiCreditsBalance)
// is the running total; this collection is the audit trail behind it.
// ─────────────────────────────────────────────────────────────────────────────

const aiCreditLedgerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // 'debit' = AI consumed credits; 'credit' = credits added (top-up/bonus/refund).
    type: { type: String, enum: ['debit', 'credit'], required: true },
    // What spent/added the credits: ai_fallback, ai_rescue, ai_node, button_mapping,
    // ai_classifier, ai_support, test_simulator, voice, topup, bonus, refund, ...
    feature: { type: String, required: true, index: true },
    // Model + provider for debits (null for grants).
    model: { type: String, default: null },
    provider: { type: String, default: null },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    // Signed credit delta: negative for debits, positive for credits.
    credits: { type: Number, required: true },
    // Wallet balance immediately after this entry was applied.
    balanceAfter: { type: Number, required: true },
    // Free-form context (ticket id, conversation id, admin note, call id, …).
    note: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }
}, {
    timestamps: true
});

// Fast "recent activity for this tenant" and monthly-usage rollups.
aiCreditLedgerSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('AiCreditLedger', aiCreditLedgerSchema);
