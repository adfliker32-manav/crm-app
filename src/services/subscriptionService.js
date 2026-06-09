const crypto = require('crypto');
const User = require('../models/User');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Payment = require('../models/Payment');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const razorpayService = require('./razorpayService');
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
            leadLimit:  plan.planFeatures?.leadLimit  ?? 100,
            agentLimit: plan.planFeatures?.agentLimit ?? 3
        },
        subscriptionPlan: plan.name,
        agentLimit: plan.planFeatures?.agentLimit ?? 5
    };
    return WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        { $set: update },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
};

// ─── Start subscribe flow ──────────────────────────────────────────────────
// Returns { subscription, razorpaySubscriptionId, keyId }.
// Called from POST /api/billing/me/subscribe and /me/change-plan.
//
// Charging model:
//   Charge is IMMEDIATE on mandate approval — no deferral, no start_at.
//   The 14-day trial is a free window before the customer decides to subscribe.
//   Once they click Subscribe and approve the mandate, ₹X is debited the same
//   day. Next charge is 30 days (monthly) or 365 days (yearly) from today.
//
// Plan ID resolution:
//   Razorpay Plan IDs (plan_XXXXXXX) are stored in the Plan MongoDB document
//   (razorpayMonthlyPlanId / razorpayYearlyPlanId). NEVER hardcoded in code.
const initiateSubscription = async (clientId, planCode, cycle = 'monthly', amountOverride = null) => {
    const client = await User.findById(clientId);
    if (!client) throw new Error('Client not found');
    if (client.role !== 'manager') throw new Error('Only managers can subscribe via autodebit');
    if (client.parentId) throw new Error('Agency sub-clients are billed by their agency, not the platform');

    const plan = await Plan.findOne({ code: planCode.toLowerCase(), isActive: true });
    if (!plan) throw new Error(`Plan "${planCode}" not found or inactive`);
    if (plan.isCustom) throw new Error('Custom plans are not self-serve — SuperAdmin must provision them');

    // ── Resolve Razorpay Plan ID from DB (never hardcoded) ──────────────────
    const razorpayPlanId = cycle === 'yearly'
        ? plan.razorpayYearlyPlanId
        : plan.razorpayMonthlyPlanId;

    if (!razorpayPlanId) {
        const e = new Error(
            `Razorpay plan ID not configured for "${plan.name}" (${cycle}). ` +
            'SuperAdmin must set the razorpayMonthlyPlanId / razorpayYearlyPlanId on this plan.'
        );
        e.code = 'RAZORPAY_PLAN_NOT_CONFIGURED';
        throw e;
    }

    const baseAmount = cycle === 'yearly'
        ? (plan.yearlyPrice || plan.monthlyPrice * 12)
        : plan.monthlyPrice;
    const amount = amountOverride !== null ? amountOverride : baseAmount;
    if (amount == null || amount < 0) throw new Error('Plan amount is not set');

    // Reuse an existing pending sub if one is open for this client.
    let sub = await Subscription.findOne({ clientId });

    // Skip reuse when a coupon is applied (old session carries full-price mandate).
    if (!amountOverride && sub && sub.status === 'pending_auth'
        && sub.planCode === plan.code
        && sub.billingCycle === cycle
        && sub.razorpaySubscriptionId) {
        return {
            subscription: sub,
            razorpaySubscriptionId: sub.razorpaySubscriptionId,
            keyId: process.env.RAZORPAY_KEY_ID
        };
    }

    // Cancel any stale Razorpay sub from a previous attempt before starting fresh.
    if (sub && sub.razorpaySubscriptionId && ['pending_auth', 'active', 'grace'].includes(sub.status)) {
        await razorpayService.cancelSubscription(sub.razorpaySubscriptionId, false);
    }

    // Phone validation — Razorpay uses it for SMS notifications.
    const rawPhone = (client.phone || '').replace(/[^\d]/g, '');
    const phone = rawPhone.length > 10 ? rawPhone.slice(-10) : rawPhone;
    if (phone.length !== 10) {
        const e = new Error('A valid 10-digit mobile number is required before subscribing. Please add your phone number in Settings.');
        e.code = 'PHONE_REQUIRED';
        throw e;
    }

    const rzpResp = await razorpayService.createSubscription({
        razorpayPlanId,
        customerEmail: client.email,
        customerPhone: phone,
        customerName:  client.companyName || client.name || client.email
        // No trialDays / start_at — charge fires immediately on mandate approval.
        // The 14-day trial is a free window before subscribing; once the customer
        // approves the mandate, ₹X is debited the same day.
    });


    // rzpResp.id        = sub_XXXXXXX  (key for Razorpay Checkout on frontend)
    // rzpResp.short_url = hosted Razorpay link (fallback if popup blocked)
    const rzpSubId  = rzpResp.id        || null;
    const shortUrl  = rzpResp.short_url || null;

    if (!rzpSubId) {
        const e = new Error('Razorpay did not return a subscription id. Check API credentials.');
        e.code = 'RAZORPAY_NO_SUB_ID';
        throw e;
    }

    const upsert = {
        clientId,
        planCode: plan.code,
        razorpaySubscriptionId: rzpSubId,
        razorpayPlanId,
        authLink: shortUrl,
        status:   'pending_auth',
        amount,
        currency: 'INR',
        billingCycle: cycle,
        failedAttempts: 0,
        rawRazorpayPayload: rzpResp
    };

    sub = await Subscription.findOneAndUpdate(
        { clientId },
        { $set: upsert },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Pre-mark workspace so the UI shows "Awaiting mandate authorization".
    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                subscriptionStatus: 'pending_auth',
                billingType:   'autodebit_razorpay',
                subscriptionId: sub._id
            }
        },
        { upsert: true, setDefaultsOnInsert: true }
    );

    return {
        subscription: sub,
        razorpaySubscriptionId: rzpSubId,
        keyId: process.env.RAZORPAY_KEY_ID
    };
};

// ─── Charge succeeded ──────────────────────────────────────────────────────
// Called on subscription.charged webhook. Creates a Payment ledger row and
// extends planExpiryDate using the stacking rule.
//
// IDEMPOTENT: Razorpay delivers webhooks at-least-once. The ledger insert
// is the single dedup gate — if a Payment row for this razorpayPaymentId
// already exists (unique index), we treat the event as already processed.
const applyChargeSuccess = async (clientId, payload) => {
    const sub = await Subscription.findOne({ clientId });
    if (!sub) throw new Error(`No Subscription doc for clientId=${clientId}`);

    const plan = await Plan.findOne({ code: sub.planCode });
    if (!plan) throw new Error(`Plan "${sub.planCode}" not found`);

    // Razorpay webhook shape for subscription.charged:
    //   payload.payload.payment.entity  → payment details
    //   payload.payload.subscription.entity.id → sub id
    const paymentEntity = payload?.payload?.payment?.entity || {};
    const rzpAmount     = paymentEntity.amount ? paymentEntity.amount / 100 : sub.amount; // paise → rupees
    const method        = paymentEntity.method || 'upi'; // 'upi' | 'card' | 'emandate' | 'nach'
    const rzpPaymentId  = paymentEntity.id || null; // pay_XXXXXXX

    // Dedup key: prefer Razorpay's pay_XXXXXXX; fallback to sub+time composite.
    const chargeTime = paymentEntity.created_at
        ? new Date(paymentEntity.created_at * 1000).toISOString()
        : '';
    const dedupKey = rzpPaymentId || `${sub.razorpaySubscriptionId}:${chargeTime}`;

    const wsNow = await WorkspaceSettings.findOne({ userId: clientId });
    const now = new Date();
    const activationStart = (wsNow?.planExpiryDate && new Date(wsNow.planExpiryDate) > now)
        ? new Date(wsNow.planExpiryDate)
        : now;
    const newExpiry = addCycle(activationStart, sub.billingCycle);
    const client = await User.findById(clientId).select('email name companyName phone').lean();

    // Attempt the ledger insert FIRST — let the unique index arbitrate.
    try {
        await Payment.create({
            clientId,
            clientName:  client?.companyName || client?.name || '',
            clientEmail: client?.email || '',
            clientRole:  'manager',
            amount:      Number(rzpAmount),
            currency:    'INR',
            paymentDate: now,
            durationMonths: sub.billingCycle === 'yearly' ? 12 : 1,
            activationStart,
            activationEnd:  newExpiry,
            paymentMethod: `razorpay_${
                String(method).toLowerCase().includes('card')      ? 'card'      :
                String(method).toLowerCase().includes('emandate')  ? 'emandate'  :
                String(method).toLowerCase().includes('nach')      ? 'nach'      :
                'upi'
            }`,
            gateway: 'razorpay',
            razorpaySubscriptionId: sub.razorpaySubscriptionId,
            razorpayPaymentId:      dedupKey,
            reference: rzpPaymentId || dedupKey,
            notes: 'Autodebit (Razorpay subscription charge)'
        });
    } catch (err) {
        // E11000 = duplicate key → charge already processed → idempotent no-op.
        if (err && err.code === 11000) {
            console.log(`↩️  [Autodebit] Duplicate charge webhook ignored (dedupKey=${dedupKey})`);
            return { subscription: sub, newExpiry: wsNow?.planExpiryDate, deduped: true };
        }
        throw err;
    }

    // First time we've seen this charge — flip subscription + workspace to active.
    sub.status = 'active';
    sub.failedAttempts = 0;
    sub.lastChargeAt = now;
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd = newExpiry;
    sub.nextChargeAt = newExpiry;
    sub.mandateMethod = method;
    sub.authLink = null; // mandate is live
    sub.rawRazorpayPayload = payload;
    await sub.save();

    await applyPlanToWorkspace(clientId, plan);
    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                planExpiryDate:    newExpiry,
                subscriptionStatus: 'active',
                lastPaymentDate:   now,
                autoDebitEnabled:  true,
                subscriptionId:    sub._id
            }
        }
    );

    auditLogger.log({
        actor: null,
        actorName: 'System (Razorpay)',
        actionCategory: 'BILLING',
        action: 'RAZORPAY_CHARGE_SUCCESS',
        targetType: 'User',
        targetId: clientId,
        targetName: client?.companyName || client?.email,
        details: { amount: rzpAmount, planCode: sub.planCode, newExpiry }
    });

    // Receipt email — fire-and-forget.
    billingEmailService.sendPaymentSuccess(client, {
        planName: plan.name,
        amount:   rzpAmount,
        cycle:    sub.billingCycle,
        newExpiry
    }).catch(err => console.error('[BillingEmail] success email failed:', err.message));

    // WhatsApp Receipt — fire-and-forget template message (if configured).
    if (client?.phone) {
        (async () => {
            try {
                const BillingReminderConfig = require('../models/BillingReminderConfig');
                const config       = await BillingReminderConfig.findOne().lean();
                const templateName = config?.receiptTemplateName;
                const langCode     = config?.receiptLanguageCode || 'en';
                if (templateName) {
                    const { sendWhatsAppTemplateMessage } = require('./whatsappService');
                    const admin = await User.findOne({ role: 'superadmin' }).select('_id').lean();
                    if (admin?._id) {
                        await sendWhatsAppTemplateMessage(
                            client.phone, templateName, langCode, [], admin._id,
                            { isAutomated: true, triggerType: 'payment_receipt' }
                        );
                    }
                }
            } catch (err) {
                console.error('❌ [BillingWA] WhatsApp receipt failed:', err.message);
            }
        })().catch(err => console.error('❌ [BillingWA] Background error:', err.message));
    }

    return { subscription: sub, newExpiry };
};

// ─── Mandate authorized (subscription.activated) ───────────────────────────
// Fires the instant the customer completes Razorpay Checkout — BEFORE the first
// charge settles. We grant provisional access immediately so a re-subscribing
// customer isn't gated waiting for the first debit. The first
// subscription.charged webhook then overwrites this with the real paid period.
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

    const ws = await WorkspaceSettings.findOne({ userId: clientId }).select('planExpiryDate').lean();
    const provisional = new Date(Date.now() + ACTIVATION_GRACE_MS);
    const existing = ws?.planExpiryDate ? new Date(ws.planExpiryDate) : null;
    const expiry = existing && existing > provisional ? existing : provisional;

    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                subscriptionStatus: 'active',
                autoDebitEnabled:   true,
                planExpiryDate:     expiry,
                subscriptionId:     sub._id
            }
        }
    );
    return sub;
};

// ─── Charge failed / subscription halted ─────────────────────────────────────
// Called on subscription.halted (Razorpay gave up after all retries) or
// subscription.pending (single attempt failed, retries still pending).
//
// ── RECOVERY FLOW ──
// When Razorpay halts a subscription the customer's card/UPI is no longer
// valid. We must proactively contact them with a way to update their payment
// method — otherwise they'll lose access silently and churn.
//
// Recovery actions (all fire-and-forget):
//   1. Email  → billingEmailService.sendPaymentFailed()  (with "Update payment" CTA)
//   2. WhatsApp → payment_failed template (if configured in BillingReminderConfig)
//   3. In-app → subscriptionStatus='grace' causes the Billing page banner to render
const applyChargeFailure = async (clientId, payload, isHalted = false) => {
    const sub = await Subscription.findOne({ clientId });
    if (!sub) return null;

    sub.failedAttempts = (sub.failedAttempts || 0) + 1;
    sub.rawRazorpayPayload = payload;

    // subscription.halted = Razorpay has exhausted all retries → enter grace.
    // subscription.pending = single attempt failed, retries still in progress.
    const enteredGrace = isHalted || sub.failedAttempts >= 3;
    if (enteredGrace) {
        sub.status = 'grace';
        await WorkspaceSettings.findOneAndUpdate(
            { userId: clientId },
            { $set: { subscriptionStatus: 'grace' } }
        );
    }
    await sub.save();

    // ── Notify customer only on first failure and when entering grace ────────
    // Avoids spamming on every Razorpay retry webhook while still giving
    // immediate heads-up and a final warning with the payment update CTA.
    if (sub.failedAttempts === 1 || enteredGrace) {
        const client = await User.findById(clientId).select('email name companyName phone').lean();
        const plan   = await Plan.findOne({ code: sub.planCode }).select('name').lean();

        // 1. Email with "Update payment method" CTA
        billingEmailService.sendPaymentFailed(client, {
            planName: plan?.name,
            amount: sub.amount,
            inGrace: enteredGrace
        }).catch(err => console.error('[BillingEmail] failure email failed:', err.message));

        // 2. WhatsApp notification (fire-and-forget)
        if (client?.phone) {
            (async () => {
                try {
                    const BillingReminderConfig = require('../models/BillingReminderConfig');
                    const config       = await BillingReminderConfig.findOne().lean();
                    const templateName = config?.paymentFailedTemplateName;
                    const langCode     = config?.paymentFailedLanguageCode || 'en';
                    if (templateName) {
                        const { sendWhatsAppTemplateMessage } = require('./whatsappService');
                        const admin = await User.findOne({ role: 'superadmin' }).select('_id').lean();
                        if (admin?._id) {
                            await sendWhatsAppTemplateMessage(
                                client.phone, templateName, langCode, [], admin._id,
                                { isAutomated: true, triggerType: 'payment_failed' }
                            );
                            console.log(`💬 [BillingWA] Payment-failed WA sent to ${client.phone}`);
                        }
                    }
                } catch (err) {
                    console.error('❌ [BillingWA] Payment-failed WhatsApp failed:', err.message);
                }
            })().catch(err => console.error('❌ [BillingWA] Background error:', err.message));
        }

        auditLogger.log({
            actor: null,
            actorName: 'System (Razorpay)',
            actionCategory: 'BILLING',
            action: enteredGrace ? 'RAZORPAY_SUBSCRIPTION_HALTED' : 'RAZORPAY_CHARGE_FAILED',
            targetType: 'User',
            targetId: clientId,
            targetName: client?.companyName || client?.email,
            details: { failedAttempts: sub.failedAttempts, enteredGrace }
        });
    }

    return sub;
};

// ─── Cancellation ──────────────────────────────────────────────────────────
// Called on subscription.cancelled webhook OR by /me/cancel route.
// We do NOT downgrade modules immediately — the customer keeps access until
// currentPeriodEnd; the daily sweep flips them expired when planExpiryDate passes.
const applyCancellation = async (clientId, payload = null, reason = '') => {
    const sub = await Subscription.findOne({ clientId });
    if (!sub) return null;

    sub.status = 'cancelled';
    sub.cancelledAt = new Date();
    if (reason) sub.cancelReason = reason;
    if (payload) sub.rawRazorpayPayload = payload;
    await sub.save();

    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        { $set: { autoDebitEnabled: false } }
    );
    return sub;
};

// ─── Enforce downgrade (mark expired) ──────────────────────────────────────
// Triggered by cron when planExpiryDate + grace has elapsed for a cancelled /
// grace subscription. READ-ONLY MODEL: we do NOT strip activeModules here —
// the account is already read-only via the planExpiryDate lapse check in
// authMiddleware. Stripping modules would hide them, contradicting
// "show all but disabled".
const enforceDowngrade = async (clientId) => {
    const client = await User.findById(clientId).select('email companyName name').lean();
    await WorkspaceSettings.findOneAndUpdate(
        { userId: clientId },
        {
            $set: {
                subscriptionStatus: 'expired',
                autoDebitEnabled:   false
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

// ─── Change plan ────────────────────────────────────────────────────────────
// Cancels the current Razorpay sub immediately, creates a new one at the new
// tier. The new mandate must be re-authorized by the customer via Checkout.
const changePlan = async (clientId, newPlanCode, cycle = 'monthly', amountOverride = null) => {
    const sub = await Subscription.findOne({ clientId });
    if (sub?.razorpaySubscriptionId && sub.status !== 'cancelled') {
        await razorpayService.cancelSubscription(sub.razorpaySubscriptionId, false);
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
