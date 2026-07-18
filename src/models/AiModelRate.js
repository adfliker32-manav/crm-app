const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// AiModelRate — the admin-editable pricing table for AI credits.
// ─────────────────────────────────────────────────────────────────────────────
// One row per model. `creditsPer1kTokens` is how many credits a model burns per
// 1,000 tokens (input + output combined). This is what makes credits real money:
// with the platform's conversion (see aiCreditService CREDIT_VALUE_INR), an admin
// can reprice any model, add a new one (Claude, Gemini Pro, …), or retire one
// WITHOUT a code deploy. Nothing about model cost is hardcoded anymore.
//
// Global (not per-tenant): the super-admin owns this table; every workspace is
// billed against the same rates.
// ─────────────────────────────────────────────────────────────────────────────

const aiModelRateSchema = new mongoose.Schema({
    // Provider model id exactly as sent to the API (e.g. 'gpt-4o', 'gemini-2.5-flash').
    model: { type: String, required: true, unique: true, index: true },
    provider: { type: String, enum: ['openai', 'gemini', 'anthropic', 'other'], default: 'other' },
    // Friendly name for dashboards ("GPT-4o", "Gemini Flash").
    label: { type: String, default: '' },
    // Credits charged per 1,000 tokens (input + output). The one number an admin edits.
    creditsPer1kTokens: { type: Number, required: true, min: 0 },
    // Inactive models are hidden from pickers but kept for historical ledger rows.
    active: { type: Boolean, default: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, {
    timestamps: true
});

module.exports = mongoose.model('AiModelRate', aiModelRateSchema);
