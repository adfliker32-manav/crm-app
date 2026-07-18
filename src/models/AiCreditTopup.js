const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// AiCreditTopup — one row per self-serve AI-credit purchase (Razorpay Order).
// ─────────────────────────────────────────────────────────────────────────────
// Serves two jobs:
//   1. IDEMPOTENCY GUARD. The client success callback and the payment.captured
//      webhook race to fulfil the same payment. The unique index on
//      razorpayPaymentId lets exactly one of them win the insert; the loser sees
//      a duplicate-key and skips granting. Without this a customer could be
//      credited twice for one payment.
//   2. Purchase history / receipt trail, separate from the signed AiCreditLedger
//      row that the grant writes (the ledger is the wallet statement; this is the
//      "what did I buy from Razorpay" record, with the order/payment ids).
//
// status:
//   pending      — claimed, grant not yet confirmed (transient; concurrent path)
//   granted      — credits added, balanceAfter recorded
//   grant_failed — payment captured but the wallet grant errored → needs manual
//                  reconciliation (the grant failure is also logged loudly by
//                  aiCreditService). Rare: grant is atomic.
//
// source:
//   'razorpay' — paid self-serve purchase (amountInr > 0, real razorpay ids). REVENUE.
//   'manual'   — super-admin credit grant (free; amountInr = 0, adminId set). NOT
//                revenue — kept here so it shows in the same client + super-admin
//                top-up history, but every ₹-revenue rollup excludes it by source.
//                For manual rows the razorpay*Id fields hold synthetic non-colliding
//                values ("manual"/"manual_<oid>") so the unique paymentId index is
//                satisfied without touching the index definition.
// ─────────────────────────────────────────────────────────────────────────────

const aiCreditTopupSchema = new mongoose.Schema({
    userId:            { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    razorpayOrderId:   { type: String, required: true, index: true },
    // Unique — the idempotency key. A given Razorpay payment fulfils at most once.
    // (Manual grants store a synthetic unique value here — see `source` above.)
    razorpayPaymentId: { type: String, required: true, unique: true },
    amountInr:         { type: Number, required: true },
    credits:           { type: Number, required: true },
    balanceAfter:      { type: Number, default: null },
    status:            { type: String, enum: ['pending', 'granted', 'grant_failed'], default: 'pending' },
    source:            { type: String, enum: ['razorpay', 'manual'], default: 'razorpay' },
    // Manual-grant provenance (null for razorpay rows).
    adminId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note:              { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('AiCreditTopup', aiCreditTopupSchema);
