// ─────────────────────────────────────────────────────────────────────────────
// aiCreditService.js — the accounting core for AI credits.
// ─────────────────────────────────────────────────────────────────────────────
// Credits are a VIRTUAL CURRENCY, not a message count. Their real-money value is
// fixed by CREDIT_VALUE_INR (default: ₹100 = 10,000 credits → 1 credit = ₹0.01).
//
// What a call costs is driven by the AiModelRate table (admin-editable, no code
// deploy): each model has `creditsPer1kTokens`, so cost tracks real provider $:
//
//     credits = ceil((inputTokens + outputTokens) / 1000 × creditsPer1kTokens)
//
// Every movement — debit (AI usage) or credit (top-up/bonus) — is:
//   1. applied atomically to User.aiCreditsBalance, and
//   2. written as a signed row to AiCreditLedger (the statement).
// The wallet balance is the running total; the ledger is the audit trail behind
// it, so a customer can always see exactly where their credits went.
//
// One shared provider key (super-admin pays) backs all tenants; credits are how
// that cost is metered back. Voice and text AI both draw from the same wallet.
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const User = require('../models/User');
const AiModelRate = require('../models/AiModelRate');
const AiCreditLedger = require('../models/AiCreditLedger');

// Real-money value of one credit, in INR. ₹100 buys 10,000 credits.
const CREDIT_VALUE_INR = Number(process.env.CREDIT_VALUE_INR) || 0.01;

// Charged per 1,000 tokens for a model not present in the AiModelRate table.
// Deliberately conservative (higher than the cheap models) so an untabled model
// never bills too little.
const DEFAULT_RATE_PER_1K = Number(process.env.DEFAULT_CREDITS_PER_1K) || 20;

// When false, usage is still deducted and logged, but an empty balance never
// blocks a call (warn-only rollout). Flip to true for hard spend protection.
const ENFORCE_BALANCE = true;

// Seed rates used the first time the table is empty. Admins edit these live
// afterwards; this constant is only the starting point.
const DEFAULT_RATES = [
    { model: 'gpt-4o',                                provider: 'openai',    label: 'GPT-4o',              creditsPer1kTokens: 60 },
    { model: 'gpt-4o-mini',                           provider: 'openai',    label: 'GPT-4o Mini',         creditsPer1kTokens: 12 },
    { model: 'gemini-2.5-flash',                      provider: 'gemini',    label: 'Gemini 2.5 Flash',    creditsPer1kTokens: 10 },
    { model: 'gemini-2.5-flash-lite-preview-06-17',   provider: 'gemini',    label: 'Gemini 2.5 Flash Lite', creditsPer1kTokens: 6 },
    { model: 'gemini-2.0-flash',                      provider: 'gemini',    label: 'Gemini 2.0 Flash',    creditsPer1kTokens: 10 },
    { model: 'gemini-2.0-flash-lite',                 provider: 'gemini',    label: 'Gemini 2.0 Flash Lite', creditsPer1kTokens: 6 },
    { model: 'gemini-2.5-pro',                        provider: 'gemini',    label: 'Gemini 2.5 Pro',      creditsPer1kTokens: 25 },
    { model: 'claude-sonnet',                         provider: 'anthropic', label: 'Claude Sonnet',       creditsPer1kTokens: 30 },
];

// ── Rate table cache (5-minute TTL) ─────────────────────────────────────────
let _rateCache = null;
let _rateCacheAt = 0;
const RATE_TTL_MS = 5 * 60 * 1000;

async function _loadRates() {
    let rows = await AiModelRate.find({}).lean();
    // First run: seed the table so the platform is never rate-less.
    if (rows.length === 0) {
        try {
            await AiModelRate.insertMany(DEFAULT_RATES, { ordered: false });
        } catch (err) {
            // Ignore duplicate-key races from concurrent boots.
            if (err.code !== 11000) console.error('[AiCredits] Rate seed failed:', err.message);
        }
        rows = await AiModelRate.find({}).lean();
    }
    const map = new Map();
    for (const r of rows) map.set(r.model, r);
    return map;
}

async function getRateMap() {
    if (_rateCache && (Date.now() - _rateCacheAt) < RATE_TTL_MS) return _rateCache;
    _rateCache = await _loadRates();
    _rateCacheAt = Date.now();
    return _rateCache;
}

function bustRateCache() {
    _rateCache = null;
    _rateCacheAt = 0;
}

async function rateFor(model) {
    const map = await getRateMap();
    const row = model && map.get(model);
    return row ? row.creditsPer1kTokens : DEFAULT_RATE_PER_1K;
}

// ── Cost math ────────────────────────────────────────────────────────────────
// Token usage → integer credits via the model's per-1K rate. Any real call costs
// at least 1 credit; a call that reported no usage costs 0.
async function computeCredits({ model, inputTokens = 0, outputTokens = 0 } = {}) {
    const total = Math.max(0, Number(inputTokens) || 0) + Math.max(0, Number(outputTokens) || 0);
    if (total === 0) return 0;
    const rate = await rateFor(model);
    return Math.max(1, Math.ceil((total / 1000) * rate));
}

function creditsToInr(credits) {
    return Number(((Number(credits) || 0) * CREDIT_VALUE_INR).toFixed(2));
}

// ── Gate ─────────────────────────────────────────────────────────────────────
async function hasCredits(tenantId) {
    if (!ENFORCE_BALANCE) return true;
    const user = await User.findById(tenantId).select('aiCreditsBalance').lean();
    return !!user && (user.aiCreditsBalance || 0) > 0;
}

// ── Debit ──────────────────────────────────────────────────────────────────
// Post-call debit. Deducts unconditionally (no $gte guard) so a low-balance
// tenant can't get free calls forever via a failing guarded debit — the balance
// may dip negative by at most one call, and hasCredits() then blocks the next.
// Writes a signed (negative) ledger row. Balance change + ledger row are committed
// together via _commitMovement (atomic on a replica set). Returns
// { charged, credits, balanceAfter, ledgerLogged }.
async function charge(tenantId, { model, provider, inputTokens, outputTokens, feature, note, meta } = {}) {
    const credits = await computeCredits({ model, inputTokens, outputTokens });
    if (credits <= 0) return { charged: false, credits: 0, balanceAfter: null, ledgerLogged: false };

    const res = await _commitMovement(
        tenantId,
        { aiCreditsBalance: -credits, aiCreditsUsedThisMonth: credits },
        (balanceAfter) => ({
            tenantId, type: 'debit', feature: feature || 'ai',
            model: model || null, provider: provider || null,
            inputTokens: inputTokens || 0, outputTokens: outputTokens || 0,
            credits: -credits, balanceAfter, note, meta
        })
    );

    if (!res.applied) {
        // Tenant missing, or the atomic transaction rolled back (nothing was written —
        // no divergence). Report as un-charged so no phantom deduction is claimed.
        console.warn(`[AiCredits] Debit not applied for tenant ${tenantId} (feature=${feature || '?'}, credits=${credits}).`);
        return { charged: false, credits, balanceAfter: null, ledgerLogged: false };
    }
    if (res.balanceAfter < 0) {
        console.warn(`[AiCredits] Tenant ${tenantId} balance negative (${res.balanceAfter}) after ${credits}-credit ${feature || 'AI'} charge. Next call blocked.`);
    }
    return { charged: true, credits, balanceAfter: res.balanceAfter, ledgerLogged: res.ledgerLogged };
}

// ── Credit (grant) ───────────────────────────────────────────────────────────
// Adds credits (top-up, bonus, refund) and writes a signed (positive) ledger row,
// atomically with the balance change.
async function grant(tenantId, amount, { feature = 'topup', note, meta, adminId } = {}) {
    const credits = Math.round(Number(amount) || 0);
    if (credits <= 0) return { granted: false, credits: 0, balanceAfter: null, ledgerLogged: false };

    const res = await _commitMovement(
        tenantId,
        { aiCreditsBalance: credits },
        (balanceAfter) => ({
            tenantId, type: 'credit', feature,
            credits, balanceAfter, note,
            meta: { ...(meta || {}), ...(adminId ? { adminId } : {}) }
        })
    );

    if (!res.applied) return { granted: false, credits, balanceAfter: null, ledgerLogged: false };
    return { granted: true, credits, balanceAfter: res.balanceAfter, ledgerLogged: res.ledgerLogged };
}

// ── Atomic movement (balance + ledger together) ──────────────────────────────
// Remembers whether the deployment supports transactions so we probe only once.
let _txnSupported = null;

function _isTxnUnsupported(err) {
    const msg = (err && (err.message || err.errmsg || '')) + '';
    return !!err && (
        err.code === 20 ||
        err.codeName === 'IllegalOperation' ||
        /Transaction numbers are only allowed on a replica set member or mongos/i.test(msg) ||
        /Transactions are not supported/i.test(msg) ||
        /does not support (?:transactions|sessions)/i.test(msg)
    );
}

// Applies an { $inc } balance change AND writes the ledger row as ONE unit.
//   buildRow(balanceAfter) -> ledger row fields (balanceAfter known only after the
//   balance update, so the row is built inside the committed unit).
// Returns { applied, ledgerLogged, balanceAfter }:
//   - applied=false  → nothing was written (tenant missing, or transaction rolled
//                      back). No balance/ledger divergence is possible.
//   - applied=true, ledgerLogged=false → only reachable on the non-transactional
//                      fallback (standalone mongod): balance moved, ledger failed;
//                      _writeLedger already reported it loudly.
async function _commitMovement(tenantId, incFields, buildRow) {
    // ── Preferred path: one atomic transaction (replica set / Atlas) ──
    if (_txnSupported !== false) {
        const session = await mongoose.startSession();
        let balanceAfter = null;
        let userMissing = false;
        try {
            await session.withTransaction(async () => {
                const updated = await User.findByIdAndUpdate(
                    tenantId, { $inc: incFields }, { new: true, session }
                );
                if (!updated) { userMissing = true; throw new Error('__USER_MISSING__'); }
                balanceAfter = updated.aiCreditsBalance;
                // Array form is how create() accepts a session.
                await AiCreditLedger.create([_ledgerDoc(buildRow(balanceAfter))], { session });
            });
            _txnSupported = true;
            return { applied: true, ledgerLogged: true, balanceAfter };
        } catch (err) {
            if (userMissing) return { applied: false, ledgerLogged: false, balanceAfter: null };
            if (_isTxnUnsupported(err)) {
                // Standalone mongod (typically dev): fall through to the non-txn path.
                _txnSupported = false;
            } else {
                // Real transaction failure → full rollback → nothing written. No
                // divergence; report it and tell the caller nothing was applied.
                _reportLedgerFailure(_ledgerDoc(buildRow(null)), err, { rolledBack: true });
                return { applied: false, ledgerLogged: false, balanceAfter: null };
            }
        } finally {
            session.endSession();
        }
    }

    // ── Fallback path: non-transactional (no replica set) ──
    // Two separate writes: balance first, then a best-effort ledger row. A crash
    // between them can still diverge — hence the loud reporting in _writeLedger —
    // but this only runs where transactions are unavailable (dev standalone).
    const updated = await User.findByIdAndUpdate(tenantId, { $inc: incFields }, { new: true });
    if (!updated) return { applied: false, ledgerLogged: false, balanceAfter: null };
    const ledgerLogged = await _writeLedger(buildRow(updated.aiCreditsBalance));
    return { applied: true, ledgerLogged, balanceAfter: updated.aiCreditsBalance };
}

// Build the persisted ledger document from a row descriptor.
function _ledgerDoc(row) {
    return {
        userId: row.tenantId,
        type: row.type,
        feature: row.feature,
        model: row.model || null,
        provider: row.provider || null,
        inputTokens: row.inputTokens || 0,
        outputTokens: row.outputTokens || 0,
        credits: row.credits,
        balanceAfter: row.balanceAfter,
        note: row.note || '',
        meta: row.meta || {}
    };
}

// Writes one ledger row. A ledger failure must never break the AI reply, but it
// must NEVER be silent either: when it fails, the wallet balance has ALREADY
// moved (balanceAfter reflects it) while the movement went un-journaled, so the
// balance and the ledger have diverged for that tenant. We retry once for a
// transient blip, then emit a full, structured, alertable record so the gap is
// observable and reconcilable. Returns true on success, false on final failure.
// Only used on the non-transactional fallback path; the transactional path writes
// the ledger inside the committed unit.
async function _writeLedger(row) {
    const doc = _ledgerDoc(row);
    try {
        await AiCreditLedger.create(doc);
        return true;
    } catch (err) {
        // A create that throws did not insert, so a single retry cannot double-write.
        try {
            await AiCreditLedger.create(doc);
            return true;
        } catch (err2) {
            _reportLedgerFailure(doc, err2);
            return false;
        }
    }
}

// Make a ledger-write failure loud. The primary signal is a distinctively-tagged
// structured stderr line (survives even a full Mongo outage, so host log alerting
// can catch it); the AuditLog write is a best-effort secondary trail for when
// Mongo is healthy but the insert failed for a document-specific reason. Neither
// path may throw. `opts.rolledBack` distinguishes an atomic rollback (nothing was
// written, no divergence) from a fallback-path failure (balance moved, needs
// reconciliation).
function _reportLedgerFailure(doc, err, opts = {}) {
    const headline = opts.rolledBack
        ? 'transaction rolled back — movement NOT applied (no divergence)'
        : 'balance moved but not journaled — reconcile required';
    try {
        console.error('[AiCredits][LEDGER_WRITE_FAILED] ' + headline + ' ' + JSON.stringify({
            tenant: String(doc.userId),
            actor: doc.meta?.adminId ? String(doc.meta.adminId) : 'system',
            rolledBack: !!opts.rolledBack,
            type: doc.type,
            feature: doc.feature,
            model: doc.model,
            credits: doc.credits,          // signed amount
            balanceAfter: doc.balanceAfter,
            timestamp: new Date().toISOString(),
            error: err && err.message
        }));
        if (err && err.stack) console.error(err.stack);
    } catch (_) { /* logging must never throw */ }

    try {
        require('./auditLogger').log({
            actionCategory: 'BILLING',
            action: 'AI_LEDGER_WRITE_FAILED',
            targetType: 'User',
            targetId: String(doc.userId),
            details: {
                type: doc.type, feature: doc.feature, model: doc.model,
                credits: doc.credits, balanceAfter: doc.balanceAfter,
                error: err && err.message
            }
        });
    } catch (_) { /* secondary trail is best-effort */ }
}

// ── Reads ──────────────────────────────────────────────────────────────────
async function getWallet(tenantId) {
    const user = await User.findById(tenantId).select('aiCreditsBalance aiCreditsUsedThisMonth').lean();
    const balance = user?.aiCreditsBalance || 0;
    const usedThisMonth = user?.aiCreditsUsedThisMonth || 0;
    return {
        balance,
        usedThisMonth,
        creditValueInr: CREDIT_VALUE_INR,
        balanceInr: creditsToInr(balance),
        usedThisMonthInr: creditsToInr(usedThisMonth)
    };
}

async function getLedger(tenantId, { limit = 50, skip = 0 } = {}) {
    const rows = await AiCreditLedger.find({ userId: tenantId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Math.min(200, limit))
        .lean();
    return rows.map(r => ({ ...r, inr: creditsToInr(Math.abs(r.credits)) }));
}

// Month-to-date usage rollup + a simple linear forecast for the full month.
async function getUsageSummary(tenantId) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const match = { userId: new mongoose.Types.ObjectId(String(tenantId)), type: 'debit', createdAt: { $gte: monthStart } };

    const debits = await AiCreditLedger.aggregate([
        { $match: match },
        { $group: {
            _id: null,
            credits: { $sum: { $abs: '$credits' } },
            inputTokens: { $sum: '$inputTokens' },
            outputTokens: { $sum: '$outputTokens' },
            calls: { $sum: 1 }
        } }
    ]);
    const byFeature = await AiCreditLedger.aggregate([
        { $match: match },
        { $group: { _id: '$feature', credits: { $sum: { $abs: '$credits' } }, calls: { $sum: 1 } } },
        { $sort: { credits: -1 } }
    ]);
    const byModel = await AiCreditLedger.aggregate([
        { $match: match },
        { $group: { _id: '$model', credits: { $sum: { $abs: '$credits' } }, calls: { $sum: 1 } } },
        { $sort: { credits: -1 } }
    ]);

    const used = debits[0]?.credits || 0;
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    // Linear run-rate projection for the remainder of the month.
    const projectedCredits = dayOfMonth > 0 ? Math.round((used / dayOfMonth) * daysInMonth) : used;

    return {
        month: monthStart.toISOString().slice(0, 7),
        creditsUsed: used,
        inputTokens: debits[0]?.inputTokens || 0,
        outputTokens: debits[0]?.outputTokens || 0,
        calls: debits[0]?.calls || 0,
        moneyUsedInr: creditsToInr(used),
        forecast: {
            projectedCredits,
            projectedInr: creditsToInr(projectedCredits)
        },
        topFeatures: byFeature.map(f => ({ feature: f._id, credits: f.credits, calls: f.calls, inr: creditsToInr(f.credits) })),
        topModels: byModel.map(m => ({ model: m._id || 'unknown', credits: m.credits, calls: m.calls, inr: creditsToInr(m.credits) }))
    };
}

// ── Rate admin ───────────────────────────────────────────────────────────────
async function listRates() {
    await getRateMap(); // ensures seed on first call
    return AiModelRate.find({}).sort({ provider: 1, creditsPer1kTokens: 1 }).lean();
}

// Upsert one model's rate (admin edit). Busts the cache so it takes effect at once.
async function upsertRate({ model, provider, label, creditsPer1kTokens, active, adminId }) {
    if (!model) throw new Error('model is required');
    const update = { updatedBy: adminId || null };
    if (provider !== undefined) update.provider = provider;
    if (label !== undefined) update.label = label;
    if (creditsPer1kTokens !== undefined) update.creditsPer1kTokens = Math.max(0, Number(creditsPer1kTokens) || 0);
    if (active !== undefined) update.active = !!active;

    const row = await AiModelRate.findOneAndUpdate(
        { model },
        { $set: update, $setOnInsert: { model } },
        { new: true, upsert: true }
    );
    bustRateCache();
    return row;
}

module.exports = {
    CREDIT_VALUE_INR,
    DEFAULT_RATE_PER_1K,
    ENFORCE_BALANCE,
    DEFAULT_RATES,
    computeCredits,
    creditsToInr,
    hasCredits,
    charge,
    grant,
    getWallet,
    getLedger,
    getUsageSummary,
    listRates,
    upsertRate,
    bustRateCache,
};
