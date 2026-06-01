const crypto = require('crypto');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const cashfreeService = require('./cashfreeService');
const billingEmailService = require('./billingEmailService');
const auditLogger = require('./auditLogger');

// Domain logic shared by the billing controller, webhook handler, and cron
// sweeps. All Plan ↔ WorkspaceSettings copying happens here so the "what
// modules does this tenant have" question always has a single answer.

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const YEAR_MS  = 365 * 24 * 60 * 60 * 1000;

const cycleToMs = (cycle) => (cycle === 'yearly' ? YEAR_MS : MONTH_MS);

const addCycle = (date, cycle) => new Date(new Date(date).getTime() + cycleToMs(cycle));

// Same stacking pattern as financeController.recordPayment — extend from the
// later of (current expiry, paymentDate) so successful renewals never shorten
// the existing paid window.
const stackExpiry = (currentExpiry, paymentDate, cycle) => {
    const now = new Date(paymentDate || Date.now());
    const baseline = currentExpiry && new Date(currentExpiry) > now
        ? new Date(currentExpiry)
        : now;
    return addCycle(baseline, cycle);
};

// Copy a Plan onto a WorkspaceSettings doc. Single chokepoint for module
// permissions: every "customer is now on tier X" path goes through here.
const applyPlanToWorkspace = async (clientId, plan) => {
    const update = {
        currentPlanCode: plan.code,
        activeModules: plan.activeModules || ['leads', 'team', 'reports'],
        planFeatures: {
            ...(plan.planFeatures || {}),
            // Surface limits at top-level too for legacy code paths that read
            // workspace.planFeatures.leadLimit directly (kept in sync).
            leadLimit: plan.planFeatures?.leadLimit ?? 100,
            agentLimit: plan.planFeatures?.agentLimit ?? 3
        },
        subscriptionPlan: plan.name,
        // Hard agentLimit mirror (separate top-level field on WorkspaceSettings)
        agentLimit: plan.planFeatures?.agentLimit ?? 5
    };
    return WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

// ─── Start subscribe flow ──────────────────────────────────────────────────
// Returns { subscription, authLink }. Called from POST /api/billing/me/subscribe.
// Idempotent for the same (clientId, planCode) — if a pending_auth sub already
// exists with the same plan, returns its authLink so the customer can resume.
// amountOverride: optional — pass a discounted price when a coupon is applied.
const initiateSubscription = async (clientId, planCode, cycle = 'monthly', amountOverride = null) => {
    const client = await User.findById(clientId);
    if (!client) throw new Error('Client not found');
    if (client.role !== 'manager') throw new Error('Only managers can subscribe via autodebit');
    if (client.parentId) throw new Error('Agency sub-clients are billed by their agency, not the platform');

    const plan = await Plan.findOne({ code: planCode.toLowerCase(), isActive: true });
    if (!plan) throw new Error(`Plan "${planCode}" not found or inactive`);
    if (plan.isCustom) throw new Error('Custom plans are not self-serve — SuperAdmin must provision them');

    const baseAmount = cycle === 'yearly' ? (plan.yearlyPrice || plan.monthlyPrice * 12) : plan.monthlyPrice;
    const amount = amountOverride !== null ? amountOverride : baseAmount;
    if (!amount || amount <= 0) throw new Error('Plan amount is not set');

    // Reuse an existing pending sub if one is open for this client.
    let sub = await Subscription.findOne({ clientId });

    if (sub && sub.status === 'pending_auth' && sub.planCode === plan.code && sub.billingCycle === cycle && sub.cashfreeSessionId) {
        return { subscription: sub, sessionId: sub.cashfreeSessionId };
    }

    // Cancel any stale Cashfree sub from a previous attempt before starting fresh.
    if (sub && sub.cashfreeSubscriptionId && ['pending_auth', 'active', 'grace'].includes(sub.status)) {
        try { await cashfreeService.cancelSubscription(sub.cashfreeSubscriptionId); } catch (e) { /* best effort */ }
    }

    const ourSubId = `adf_${clientId.toString().slice(-8)}_${crypto.randomBytes(4).toString('hex')}`;

    // Cashfree mandates require a real, dialable phone. Reject up-front with a
    // clear message rather than sending a placeholder that Cashfree silently
    // rejects (or worse, anchors the mandate to a bogus number).
    const rawPhone = (client.phone || '').replace(/[^\d]/g, '');
    const phone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone; // strip country code if present
    if (phone.length !== 10) {
        const e = new Error('A valid 10-digit mobile number is required before subscribing. Please add your phone number in Settings.');
        e.code = 'PHONE_REQUIRED';
        throw e;
    }

    const cfResp = await cashfreeService.createSubscription({
        subscriptionId: ourSubId,
        customerName: client.companyName || client.name || client.email,
        customerEmail: client.email,
        customerPhone: phone,
        planName: `${plan.name} (${cycle})`,
        amount,
        cycle,
        returnUrl: process.env.CASHFREE_RETURN_URL || `${process.env.FRONTEND_URL}/billing?cf_return=1`,
        notifyUrl: `${process.env.SERVER_URL || process.env.FRONTEND_URL}/api/billing/cashfree/webhook`
    });

    // The 2025-01-01 Subscriptions API returns a subscription_session_id (consumed
    // by the Cashfree JS SDK's subscriptionsCheckout on the frontend) — NOT a
    // redirect link. cf_subscription_id is Cashfree's own id (kept for webhook
    // matching). Verified against the live sandbox response.
    const sessionId = cfResp.subscription_session_id || cfResp.data?.subscription_session_id || null;
    const cfSubscriptionId = cfResp.cf_subscription_id || cfResp.data?.cf_subscription_id || null;

    if (!sessionId) {
        const e = new Error('Cashfree did not return a subscription_session_id. Check API credentials/version.');
        e.code = 'CASHFREE_NO_SESSION';
        throw e;
    }

    const upsert = {
        clientId,
        planCode: plan.code,
        cashfreeSubscriptionId: ourSubId,
        cfSubscriptionId,
        cashfreeSessionId: sessionId,
        cashfreeCustomerId: cfResp.customer_details?.customer_email || client.email,
        status: 'pending_auth',
        amount,
        currency: 'INR',
        billingCycle: cycle,
        failedAttempts: 0,
        rawCashfreePayload: cfResp
    };

    sub = await Subscription.findOneAndUpdate(
        { clientId },
        { $set: upsert },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Pre-mark workspace state so the UI shows "Awaiting mandate authorization"
    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                subscriptionStatus: 'pending_auth',
                billingType: 'autodebit_cashfree',
                subscriptionId: sub._id
            }
        },
        { upsert: true, setDefaultsOnInsert: true }
    );

    return { subscription: sub, sessionId };
};

// ─── Charge succeeded ──────────────────────────────────────────────────────
// Called on SUBSCRIPTION_PAYMENT_SUCCESS webhook. Creates a Payment ledger row
// (so existing FinanceView shows the charge) and extends planExpiryDate using
// the stacking rule.
//
// IDEMPOTENT: Cashfree delivers webhooks at-least-once and retries on any
// non-2xx, so the same PAYMENT_SUCCESS can arrive multiple times. We make the
// ledger insert the single dedup gate — if a Payment row for this charge
// already exists (unique index on cashfreePaymentId), we treat the event as
// already processed and return WITHOUT extending the plan again. This is the
// fix for the double-extension bug where replays kept pushing planExpiryDate
// forward a full cycle each time.
const applyChargeSuccess = async (clientId, payload) => {
    const sub = await Subscription.findOne({ clientId });
    if (!sub) throw new Error(`No Subscription doc for clientId=${clientId}`);

    const plan = await Plan.findOne({ code: sub.planCode });
    if (!plan) throw new Error(`Plan "${sub.planCode}" not found`);

    // Cashfree nests the charge details differently across API versions — probe
    // the documented containers (payment / data.payment / data.subscription_payment).
    const pay = payload?.payment
        || payload?.data?.payment
        || payload?.data?.subscription_payment
        || payload?.subscription_payment
        || {};
    const cfAmount = pay.payment_amount || pay.amount || sub.amount;
    const mandateMethod = pay.payment_method || pay.method || sub.mandateMethod || 'upi';

    // Stable dedup key. Prefer Cashfree's cf_payment_id; if a payload ever lacks
    // it, derive a deterministic key from (subscription_id + charge cycle / time)
    // so replays of that same event are still caught and not double-counted.
    const cfPaymentId = pay.cf_payment_id || pay.payment_id || payload?.cf_payment_id || null;
    const chargeTime = pay.payment_time || pay.charge_time || payload?.event_time || '';
    const dedupKey = cfPaymentId || `${sub.cashfreeSubscriptionId}:${chargeTime || sub.nextChargeAt?.toISOString() || ''}`;

    const ws = await WorkspaceSettings.findOne({ userId: clientId });
    const now = new Date();
    // Always stack from the existing planExpiryDate when it is in the future.
    // This correctly handles both renewals AND the first charge after a manual
    // payment extension — previously "first charge" always started from now,
    // potentially shortening access that was already extended offline.
    const activationStart = (ws?.planExpiryDate && new Date(ws.planExpiryDate) > now)
        ? new Date(ws.planExpiryDate)
        : now;
    const newExpiry = addCycle(activationStart, sub.billingCycle);
    const client = await User.findById(clientId).select('email name companyName').lean();

    // Attempt the ledger insert FIRST and let the unique index arbitrate. A
    // duplicate-key error means this exact charge was already applied — bail out
    // so we never extend the plan or copy modules twice for one payment.
    try {
        await Payment.create({
            clientId,
            clientName: client?.companyName || client?.name || '',
            clientEmail: client?.email || '',
            clientRole: 'manager',
            amount: Number(cfAmount),
            currency: 'INR',
            paymentDate: now,
            durationMonths: sub.billingCycle === 'yearly' ? 12 : 1,
            activationStart,
            activationEnd: newExpiry,
            paymentMethod: `cashfree_${String(mandateMethod).toLowerCase().includes('card') ? 'card'
                : String(mandateMethod).toLowerCase().includes('nach') ? 'enach'
                : 'upi'}`,
            gateway: 'cashfree',
            cashfreeSubscriptionId: sub.cashfreeSubscriptionId,
            cashfreePaymentId: dedupKey,
            reference: cfPaymentId || dedupKey,
            notes: 'Autodebit (Cashfree subscription charge)'
        });
    } catch (err) {
        // E11000 = duplicate key → charge already processed → idempotent no-op.
        if (err && err.code === 11000) {
            console.log(`↩️  [Autodebit] Duplicate charge webhook ignored (dedupKey=${dedupKey})`);
            return { subscription: sub, newExpiry: ws?.planExpiryDate, deduped: true };
        }
        throw err;
    }

    // First time we've seen this charge — flip subscription + workspace to active
    // and copy plan modules over (single chokepoint: applyPlanToWorkspace).
    sub.status = 'active';
    sub.failedAttempts = 0;
    sub.lastChargeAt = new Date();
    sub.currentPeriodStart = new Date();
    sub.currentPeriodEnd = newExpiry;
    sub.nextChargeAt = newExpiry;
    sub.mandateMethod = mandateMethod;
    sub.authLink = null; // mandate is live; no need to re-show auth link
    sub.rawCashfreePayload = payload;
    await sub.save();

    await applyPlanToWorkspace(clientId, plan);
    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                planExpiryDate: newExpiry,
                subscriptionStatus: 'active',
                lastPaymentDate: new Date(),
                autoDebitEnabled: true,
                subscriptionId: sub._id
            }
        }
    );

    // actor:null → logged as a System event. (Passing a fake {id:'system'} would
    // fail the ObjectId cast on AuditLog.actorId and silently drop the entry.)
    auditLogger.log({
        actor: null,
        actorName: 'System (Cashfree)',
        actionCategory: 'BILLING',
        action: 'CASHFREE_CHARGE_SUCCESS',
        targetType: 'User',
        targetId: clientId,
        targetName: client?.companyName || client?.email,
        details: { amount: cfAmount, planCode: sub.planCode, newExpiry }
    });

    // Receipt email — fire-and-forget so a slow/failed SMTP never blocks the webhook.
    billingEmailService.sendPaymentSuccess(client, {
        planName: plan.name,
        amount: cfAmount,
        cycle: sub.billingCycle,
        newExpiry
    }).catch(err => console.error('[BillingEmail] success email failed:', err.message));

    return { subscription: sub, newExpiry };
};

// ─── Mandate authorized (ACTIVATED) ────────────────────────────────────────
// Fires the instant the customer authorizes the mandate — BEFORE the first
// charge settles. We grant access immediately so a resubscribing (read-only)
// customer isn't stuck waiting for the first debit: apply the plan's modules,
// flip to active, and set a SHORT provisional expiry (a couple of days). The
// first SUBSCRIPTION_PAYMENT_SUCCESS then overwrites this with the real paid
// period (see isFirstCharge in applyChargeSuccess) and records the ledger row.
// If the first charge never lands, the provisional window lapses → read-only.
const ACTIVATION_GRACE_MS = 2 * 24 * 60 * 60 * 1000;
const applyActivation = async (clientId) => {
    const sub = await Subscription.findOne({ clientId });
    if (!sub) return null;
    const plan = await Plan.findOne({ code: sub.planCode });

    sub.status = 'active';
    sub.authLink = null;
    sub.currentPeriodStart = sub.currentPeriodStart || new Date();
    await sub.save();

    if (plan) await applyPlanToWorkspace(clientId, plan);

    // Provisional access window — but keep a longer existing expiry (e.g. the
    // remaining free trial) if it is further out than the provisional grant.
    const ws = await WorkspaceSettings.findOne({ userId: clientId }).select('planExpiryDate').lean();
    const provisional = new Date(Date.now() + ACTIVATION_GRACE_MS);
    const existing = ws?.planExpiryDate ? new Date(ws.planExpiryDate) : null;
    const expiry = existing && existing > provisional ? existing : provisional;

    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                subscriptionStatus: 'active',
                autoDebitEnabled: true,
                planExpiryDate: expiry,
                subscriptionId: sub._id
            }
        }
    );
    return sub;
};

// ─── Charge failed ─────────────────────────────────────────────────────────
// Called on SUBSCRIPTION_PAYMENT_FAILED webhook. We bump the attempt counter.
// If Cashfree has flagged the subscription as ON_HOLD (its terminal failure
// state — happens after retries are exhausted), we move the tenant into the
// 'grace' state so the UI shows a payment-overdue banner.
const applyChargeFailure = async (clientId, payload) => {
    const sub = await Subscription.findOne({ clientId });
    if (!sub) return null;

    sub.failedAttempts = (sub.failedAttempts || 0) + 1;
    sub.rawCashfreePayload = payload;

    const cfStatus = (payload?.subscription?.subscription_status
        || payload?.data?.subscription?.subscription_status
        || payload?.data?.subscription_details?.subscription_status
        || payload?.subscription_status
        || '').toUpperCase();

    const enteredGrace = cfStatus === 'ON_HOLD' || cfStatus === 'BANK_APPROVAL_PENDING' || sub.failedAttempts >= 3;
    if (enteredGrace) {
        sub.status = 'grace';
        await WorkspaceSettings.findOneAndUpdate(
            { userId: clientId },
            { $set: { subscriptionStatus: 'grace' } }
        );
    }

    await sub.save();

    // Notify the customer their charge failed (fire-and-forget). To avoid spamming
    // an email on every Cashfree retry webhook, we only send on the FIRST failure
    // (immediate heads-up) and when the subscription enters grace (final warning).
    if (sub.failedAttempts === 1 || enteredGrace) {
        const client = await User.findById(clientId).select('email name companyName').lean();
        const plan = await Plan.findOne({ code: sub.planCode }).select('name').lean();
        billingEmailService.sendPaymentFailed(client, {
            planName: plan?.name,
            amount: sub.amount,
            inGrace: enteredGrace
        }).catch(err => console.error('[BillingEmail] failure email failed:', err.message));
    }

    return sub;
};

// ─── Cancellation ──────────────────────────────────────────────────────────
// Called on SUBSCRIPTION_CANCELLED webhook OR by /me/cancel route.
// We do NOT downgrade modules immediately — the customer keeps the access
// they already paid for through currentPeriodEnd; the daily sweep flips them
// to expired when planExpiryDate + grace passes.
const applyCancellation = async (clientId, payload = null, reason = '') => {
    const sub = await Subscription.findOne({ clientId });
    if (!sub) return null;

    sub.status = 'cancelled';
    sub.cancelledAt = new Date();
    if (reason) sub.cancelReason = reason;
    if (payload) sub.rawCashfreePayload = payload;
    await sub.save();

    // Turn off the autodebit flag so the UI reflects the cancellation immediately.
    // Keep planExpiryDate + subscriptionStatus alone — the customer keeps the
    // access they already paid for until the period ends (the sweep flips them to
    // expired/read-only once planExpiryDate passes).
    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        { $set: { autoDebitEnabled: false } }
    );

    return sub;
};

// ─── Enforce downgrade (mark expired) ──────────────────────────────────────
// Triggered by cron when planExpiryDate + grace has elapsed for a cancelled/
// grace subscription. This is the "if payment not cut → downgrade" path.
//
// READ-ONLY MODEL: we do NOT strip activeModules here. The account is already
// read-only via the planExpiryDate lapse check in authMiddleware (writes blocked,
// reads allowed), so the user keeps SEEING every module — just inert — until they
// pay. Stripping modules would hide them, contradicting "show all but disabled".
// We only flip the subscription to expired + turn off autodebit for reporting.
const enforceDowngrade = async (clientId) => {
    const client = await User.findById(clientId).select('email companyName name').lean();
    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                subscriptionStatus: 'expired',
                autoDebitEnabled: false
            }
        }
    );

    auditLogger.log({
        actor: null,
        actorName: 'System (Autodebit sweep)',
        actionCategory: 'BILLING',
        action: 'AUTODEBIT_DOWNGRADE_ENFORCED',
        targetType: 'User',
        targetId: clientId,
        targetName: client?.companyName || client?.email,
        details: { reason: 'Grace window elapsed after failed autodebit / cancellation' }
    });
};

// ─── Change plan (upgrade / downgrade) ─────────────────────────────────────
// Cancels the current Cashfree sub, creates a new one at the new tier price,
// returns a fresh authLink. The new mandate must be re-authorized by the
// customer. Modules update on first successful charge (applyChargeSuccess).
const changePlan = async (clientId, newPlanCode, cycle = 'monthly', amountOverride = null) => {
    const sub = await Subscription.findOne({ clientId });
    if (sub?.cashfreeSubscriptionId && sub.status !== 'cancelled') {
        try { await cashfreeService.cancelSubscription(sub.cashfreeSubscriptionId); } catch (e) { /* best-effort */ }
    }
    return initiateSubscription(clientId, newPlanCode, cycle, amountOverride);
};

module.exports = {
    initiateSubscription,
    applyActivation,
    applyChargeSuccess,
    applyChargeFailure,
    applyCancellation,
    enforceDowngrade,
    changePlan,
    applyPlanToWorkspace,
    stackExpiry
};
