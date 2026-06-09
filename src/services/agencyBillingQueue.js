// src/services/agencyBillingQueue.js
//
// Agenda-based billing follow-up engine for Agency Clients.
// Pattern follows whatsappQueueService.js — a single shared agenda instance
// is injected from index.js via defineAgencyBillingJobs(agenda).
//
// Job flow:
//   SEND_AGENCY_BILL         → Day 0  (immediate) — initial invoice notification
//   AGENCY_BILL_FOLLOWUP_5D  → Day 5              — first reminder
//   AGENCY_BILL_FOLLOWUP_7D  → Day 7              — second reminder
//   AGENCY_BILL_FOLLOWUP_10D → Day 10             — final notice
//
// Each job checks payment.status in real time before acting. If it has been
// marked received/partial the job exits silently — no duplicate sends.

const AgencyPayment   = require('../models/AgencyPayment');
const AgencyClient    = require('../models/AgencyClient');
const User            = require('../models/User');
const BillingReminderConfig = require('../models/BillingReminderConfig');
const { sendEmail }   = require('./emailService');
const { sendWhatsAppTemplateMessage } = require('./whatsappService');

let sharedAgenda = null;

// ─── Super Admin Lookup ────────────────────────────────────────────────────────
// Finds the platform Super Admin user. Results are cached in module scope since
// the Super Admin's _id never changes at runtime.
let _cachedSuperAdminId = null;
const getSuperAdminId = async () => {
    if (_cachedSuperAdminId) return _cachedSuperAdminId;
    const admin = await User.findOne({ role: 'superadmin' }).select('_id').lean();
    if (admin) _cachedSuperAdminId = admin._id.toString();
    return _cachedSuperAdminId;
};

// ─── Email Builder ─────────────────────────────────────────────────────────────
const buildBillingEmail = (payment, client, dayType) => {
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthName   = MONTH_NAMES[(payment.billingMonth || 1) - 1];
    const year        = payment.billingYear;
    const amount      = `₹${Number(payment.amount || 0).toLocaleString('en-IN')}`;
    const invoice     = payment.invoiceNumber || `INV-${year}-${String(payment.billingMonth).padStart(2,'0')}`;
    const dueDate     = payment.dueDate
        ? new Date(payment.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : `${monthName} ${year}`;

    const subjectMap = {
        day0:  `Invoice ${invoice} — ${monthName} ${year} | Amount Due: ${amount}`,
        day5:  `Reminder: Invoice ${invoice} | ${amount} Still Due`,
        day7:  `2nd Reminder: Invoice ${invoice} | ${amount} Awaiting Payment`,
        day10: `Final Reminder: Invoice ${invoice} | ${amount} — Please Respond`
    };

    const bodyIntroMap = {
        day0:  `Please find your invoice for <strong>${monthName} ${year}</strong> below.`,
        day5:  `This is a friendly reminder that your invoice for <strong>${monthName} ${year}</strong> is still pending.`,
        day7:  `This is a second reminder — your invoice for <strong>${monthName} ${year}</strong> is still awaiting payment.`,
        day10: `This is your final notice. Your invoice for <strong>${monthName} ${year}</strong> remains unpaid.`
    };

    const subject = subjectMap[dayType] || subjectMap.day0;
    const intro   = bodyIntroMap[dayType] || bodyIntroMap.day0;

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1e3a5f,#0f62fe);padding:32px 40px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">
      ${dayType === 'day0' ? '📄 New Invoice' : dayType === 'day10' ? '🔔 Final Reminder' : '⏰ Payment Reminder'}
    </h1>
  </div>
  <div style="padding:32px 40px;background:#fff;">
    <p style="color:#374151;font-size:15px;">Dear <strong>${client.name}</strong>,</p>
    <p style="color:#374151;font-size:14px;">${intro}</p>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:20px;margin:20px 0;">
      <table style="width:100%;font-size:14px;color:#1e3a5f;">
        <tr><td style="padding:5px 0;color:#6b7280;">Invoice No.</td><td style="text-align:right;font-weight:700;">${invoice}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280;">Period</td><td style="text-align:right;">${monthName} ${year}</td></tr>
        <tr><td style="padding:5px 0;color:#6b7280;">Due Date</td><td style="text-align:right;">${dueDate}</td></tr>
        ${payment.billingAddressSnapshot ? `<tr><td style="padding:5px 0;color:#6b7280;">Bill To</td><td style="text-align:right;">${payment.billingAddressSnapshot}</td></tr>` : ''}
        ${payment.gstNumberSnapshot ? `<tr><td style="padding:5px 0;color:#6b7280;">GST No.</td><td style="text-align:right;">${payment.gstNumberSnapshot}</td></tr>` : ''}
      </table>
      <div style="border-top:2px solid #0f62fe;margin-top:12px;padding-top:12px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:16px;color:#1e3a5f;font-weight:700;">Total Due</span>
        <span style="font-size:24px;color:#0f62fe;font-weight:800;">${amount}</span>
      </div>
    </div>
    <p style="color:#374151;font-size:13px;">Please process this payment and confirm. Contact us if you have any questions.</p>
  </div>
  <div style="background:#f9fafb;padding:20px 40px;text-align:center;font-size:12px;color:#9ca3af;">
    This is an automated billing notification.
  </div>
</div>`;

    const text = `Invoice ${invoice} | ${monthName} ${year} | Amount: ${amount} | Due: ${dueDate}`;

    return { subject, html, text };
};

// ─── WhatsApp message builder ──────────────────────────────────────────────────
const buildWhatsAppMessage = (payment, client, dayType) => {
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthName   = MONTH_NAMES[(payment.billingMonth || 1) - 1];
    const year        = payment.billingYear;
    const amount      = `₹${Number(payment.amount || 0).toLocaleString('en-IN')}`;
    const invoice     = payment.invoiceNumber || `INV-${year}-${String(payment.billingMonth).padStart(2,'0')}`;

    const msgMap = {
        day0:  `Hi ${client.name}! 👋\n\nYour invoice for *${monthName} ${year}* is ready.\n📄 Invoice: *${invoice}*\n💰 Amount: *${amount}*\n\nPlease process the payment at your earliest convenience. Contact us for any queries!`,
        day5:  `Hi ${client.name} 👋\n\nThis is a friendly reminder that your invoice *${invoice}* for *${monthName} ${year}* (Amount: *${amount}*) is still pending.\n\nKindly arrange payment soon. Let us know if you need any help!`,
        day7:  `Hi ${client.name},\n\n📌 Second Reminder — Invoice *${invoice}* for *${monthName} ${year}* (Amount: *${amount}*) is still unpaid.\n\nPlease process this at the earliest. Reach out to us if you have any concerns!`,
        day10: `Hi ${client.name},\n\n⚠️ Final Reminder — Invoice *${invoice}* for *${monthName} ${year}* (Amount: *${amount}*) remains unpaid.\n\nPlease clear this immediately to avoid service interruption. Contact us right away if there is an issue.`
    };

    return msgMap[dayType] || msgMap.day0;
};

// ─── Core job handler ──────────────────────────────────────────────────────────
const processFollowUp = async (job, dayType) => {
    const { paymentId } = job.attrs.data;

    // Re-fetch to get latest status — bail if already paid
    const payment = await AgencyPayment.findById(paymentId).lean();
    if (!payment) {
        console.warn(`⚠️ [BillingQueue] Payment ${paymentId} not found — skipping ${dayType} follow-up.`);
        return;
    }
    if (['received', 'partial'].includes(payment.status)) {
        console.log(`✅ [BillingQueue] Payment ${paymentId} already ${payment.status} — skipping ${dayType} follow-up.`);
        return;
    }

    const client = await AgencyClient.findById(payment.agencyClientId).lean();
    if (!client) {
        console.warn(`⚠️ [BillingQueue] Client not found for payment ${paymentId} — skipping.`);
        return;
    }

    const superAdminId = await getSuperAdminId();
    if (!superAdminId) {
        console.warn('⚠️ [BillingQueue] Super Admin not found — cannot send billing notifications.');
        return;
    }

    // ── Load saved template config (one DB read, cached cheaply by Mongoose) ──
    const config = await BillingReminderConfig.findOne().lean();

    // Map dayType → template name + language from saved config
    const templateKey = {
        day0:  { name: config?.day0TemplateName,  lang: config?.day0LanguageCode  || 'en' },
        day5:  { name: config?.day5TemplateName,  lang: config?.day5LanguageCode  || 'en' },
        day7:  { name: config?.day7TemplateName,  lang: config?.day7LanguageCode  || 'en' },
        day10: { name: config?.day10TemplateName, lang: config?.day10LanguageCode || 'en' }
    }[dayType] || { name: '', lang: 'en' };

    // ── Send Email (if enabled in config) ────────────────────────────────────
    if (config?.sendEmail !== false && client.email) {
        try {
            const { subject, html, text } = buildBillingEmail(payment, client, dayType);
            await sendEmail({
                to:            client.email,
                subject,
                html,
                text,
                userId:        superAdminId,
                transactional: true
            });
            console.log(`📧 [BillingQueue] ${dayType} email sent to ${client.email} for invoice ${payment.invoiceNumber}`);
        } catch (emailErr) {
            console.error(`❌ [BillingQueue] Failed to send ${dayType} email to ${client.email}:`, emailErr.message);
        }
    }

    // ── Send WhatsApp ────────────────────────────────────────────────────────
    if (client.phone) {
        if (templateKey.name) {
            // ✅ Use Meta-approved template selected by Super Admin
            try {
                await sendWhatsAppTemplateMessage(
                    client.phone,
                    templateKey.name,
                    templateKey.lang,
                    [], // No components needed — template content is set in Meta
                    superAdminId,
                    { isAutomated: true, triggerType: 'billing_reminder' }
                );
                console.log(`💬 [BillingQueue] ${dayType} WA template '${templateKey.name}' sent to ${client.phone}`);
            } catch (waErr) {
                console.error(`❌ [BillingQueue] Failed to send ${dayType} WA template to ${client.phone}:`, waErr.message);
            }
        } else {
            // ⚠️ No template configured — SKIP WhatsApp entirely.
            // WhatsApp only allows plain-text (free-form) messages within a 24-hour
            // customer-service window. Billing reminders fire days later, so plain text
            // would be rejected by Meta. Configure a template in Billing Templates setup.
            console.warn(
                `⚠️ [BillingQueue] ${dayType}: No WhatsApp template configured for this step.` +
                ` WhatsApp skipped (plain-text rejected outside 24h window).` +
                ` Go to Super Admin → Billing Templates to assign an approved template.`
            );
        }
    }
};

// ─── defineAgencyBillingJobs — called from index.js ───────────────────────────
const defineAgencyBillingJobs = (agenda) => {
    sharedAgenda = agenda;

    // Day 0 — Initial invoice notification
    agenda.define('SEND_AGENCY_BILL', { concurrency: 5 }, async (job) => {
        try {
            await processFollowUp(job, 'day0');
        } catch (err) {
            console.error('❌ [BillingQueue] SEND_AGENCY_BILL job failed:', err.message);
            throw err;
        }
    });

    // Day 5 — First reminder
    agenda.define('AGENCY_BILL_FOLLOWUP_5D', { concurrency: 5 }, async (job) => {
        try {
            await processFollowUp(job, 'day5');
        } catch (err) {
            console.error('❌ [BillingQueue] AGENCY_BILL_FOLLOWUP_5D job failed:', err.message);
            throw err;
        }
    });

    // Day 7 — Second reminder
    agenda.define('AGENCY_BILL_FOLLOWUP_7D', { concurrency: 5 }, async (job) => {
        try {
            await processFollowUp(job, 'day7');
        } catch (err) {
            console.error('❌ [BillingQueue] AGENCY_BILL_FOLLOWUP_7D job failed:', err.message);
            throw err;
        }
    });

    // Day 10 — Final notice
    agenda.define('AGENCY_BILL_FOLLOWUP_10D', { concurrency: 5 }, async (job) => {
        try {
            await processFollowUp(job, 'day10');
        } catch (err) {
            console.error('❌ [BillingQueue] AGENCY_BILL_FOLLOWUP_10D job failed:', err.message);
            throw err;
        }
    });

    console.log('✅ [BillingQueue] Agency billing jobs registered (Day 0, Day 5, Day 7, Day 10)');
};

// ─── scheduleAgencyBillFollowups — called from agencyFinanceController ─────────
/**
 * Schedule Day 0, Day 5, Day 7, Day 10 follow-up jobs for a newly created pending payment.
 * Returns an array of Agenda job ID strings to store on payment.followUpJobs.
 */
const scheduleAgencyBillFollowups = async (payment) => {
    if (!sharedAgenda) {
        console.error('❌ [BillingQueue] scheduleAgencyBillFollowups called before agenda was initialized.');
        return [];
    }

    const paymentId = payment._id.toString();
    const now       = new Date();
    const day5      = new Date(now.getTime() +  5 * 24 * 60 * 60 * 1000);
    const day7      = new Date(now.getTime() +  7 * 24 * 60 * 60 * 1000);
    const day10     = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000);

    const [j0, j5, j7, j10] = await Promise.all([
        sharedAgenda.schedule(now,   'SEND_AGENCY_BILL',          { paymentId }),
        sharedAgenda.schedule(day5,  'AGENCY_BILL_FOLLOWUP_5D',   { paymentId }),
        sharedAgenda.schedule(day7,  'AGENCY_BILL_FOLLOWUP_7D',   { paymentId }),
        sharedAgenda.schedule(day10, 'AGENCY_BILL_FOLLOWUP_10D',  { paymentId })
    ]);

    const ids = [
        j0.attrs._id.toString(),
        j5.attrs._id.toString(),
        j7.attrs._id.toString(),
        j10.attrs._id.toString()
    ];

    console.log(`🗓️ [BillingQueue] Scheduled Day 0/5/7/10 follow-ups for payment ${paymentId}:`, ids);
    return ids;
};

// ─── cancelAgencyBillFollowups — called from agencyFinanceController ───────────
/**
 * Cancel all pending Agenda jobs saved in payment.followUpJobs.
 * Called when a payment is marked received or partial.
 */
const cancelAgencyBillFollowups = async (payment) => {
    if (!sharedAgenda) return;
    if (!payment.followUpJobs || payment.followUpJobs.length === 0) return;

    const mongoose = require('mongoose');
    const objectIds = payment.followUpJobs
        .filter(id => id && mongoose.Types.ObjectId.isValid(id))
        .map(id => new mongoose.Types.ObjectId(id));

    if (objectIds.length === 0) return;

    try {
        const removed = await sharedAgenda.cancel({ _id: { $in: objectIds } });
        console.log(`🗑️ [BillingQueue] Cancelled ${removed} follow-up jobs for payment ${payment._id}`);
    } catch (err) {
        console.error('⚠️ [BillingQueue] Failed to cancel follow-up jobs:', err.message);
    }
};

// ─── Payment Receipt Builder ───────────────────────────────────────────────────
// Called when a payment is marked received/confirmed.
// Sends a professional "Payment Confirmed ✅" receipt email + WhatsApp notification.
const buildReceiptEmail = (payment, client) => {
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthName   = MONTH_NAMES[(payment.billingMonth || 1) - 1];
    const year        = payment.billingYear;
    const amount      = `₹${Number(payment.amount || 0).toLocaleString('en-IN')}`;
    const invoice     = payment.invoiceNumber || `INV-${year}-${String(payment.billingMonth).padStart(2,'0')}`;
    const paidOn      = payment.receivedDate
        ? new Date(payment.receivedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

    const subject = `✅ Payment Confirmed — ${invoice} | ${monthName} ${year}`;

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f9fafb;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#064e3b,#10b981);padding:32px 40px;text-align:center;">
    <div style="width:64px;height:64px;background:rgba(255,255,255,0.2);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px;">
      <span style="font-size:32px;">✅</span>
    </div>
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700;">Payment Received!</h1>
    <p style="color:#d1fae5;margin:6px 0 0;font-size:14px;">Your payment has been confirmed and verified.</p>
  </div>
  <div style="padding:32px 40px;background:#fff;">
    <p style="color:#374151;font-size:15px;">Dear <strong>${client.name}</strong>,</p>
    <p style="color:#374151;font-size:14px;">
      Thank you! We have successfully received and verified your payment for
      <strong>${monthName} ${year}</strong>. Please find your receipt details below.
    </p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:24px;margin:20px 0;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
        <span style="font-size:20px;">🧾</span>
        <span style="font-size:16px;font-weight:700;color:#065f46;">Payment Receipt</span>
      </div>
      <table style="width:100%;font-size:14px;color:#1e3a5f;border-collapse:collapse;">
        <tr style="border-bottom:1px solid #d1fae5;">
          <td style="padding:8px 0;color:#6b7280;">Receipt / Invoice No.</td>
          <td style="text-align:right;font-weight:700;">${invoice}</td>
        </tr>
        <tr style="border-bottom:1px solid #d1fae5;">
          <td style="padding:8px 0;color:#6b7280;">Billing Period</td>
          <td style="text-align:right;">${monthName} ${year}</td>
        </tr>
        <tr style="border-bottom:1px solid #d1fae5;">
          <td style="padding:8px 0;color:#6b7280;">Payment Date</td>
          <td style="text-align:right;">${paidOn}</td>
        </tr>
        ${payment.billingAddressSnapshot ? `
        <tr style="border-bottom:1px solid #d1fae5;">
          <td style="padding:8px 0;color:#6b7280;">Billed To</td>
          <td style="text-align:right;">${payment.billingAddressSnapshot.replace(/\n/g, ', ')}</td>
        </tr>` : ''}
        ${payment.gstNumberSnapshot ? `
        <tr style="border-bottom:1px solid #d1fae5;">
          <td style="padding:8px 0;color:#6b7280;">GST No.</td>
          <td style="text-align:right;">${payment.gstNumberSnapshot}</td>
        </tr>` : ''}
        <tr>
          <td style="padding:12px 0 0;font-size:15px;font-weight:700;color:#065f46;">Amount Paid</td>
          <td style="text-align:right;font-size:22px;font-weight:800;color:#10b981;">${amount}</td>
        </tr>
      </table>
      <div style="background:#10b981;color:#fff;text-align:center;padding:10px 0;border-radius:8px;margin-top:16px;font-weight:700;font-size:14px;letter-spacing:0.05em;">
        ✅ PAYMENT VERIFIED & CONFIRMED
      </div>
    </div>

    <p style="color:#374151;font-size:13px;">
      Please keep this receipt for your records. If you have any questions, feel free to reach out.
    </p>
  </div>
  <div style="background:#f9fafb;padding:20px 40px;text-align:center;font-size:12px;color:#9ca3af;">
    This is an automated payment confirmation. Thank you for your business!
  </div>
</div>`;

    const text = `Payment Confirmed ✅ | Invoice: ${invoice} | Period: ${monthName} ${year} | Amount: ${amount} | Paid on: ${paidOn}`;

    return { subject, html, text };
};

// ─── sendPaymentReceipt — called from agencyFinanceController when payment confirmed ──
const sendPaymentReceipt = async (payment, client) => {
    const superAdminId = await getSuperAdminId();
    if (!superAdminId) {
        console.warn('⚠️ [Receipt] Super Admin not found — cannot send receipt.');
        return;
    }

    // ── Email Receipt ────────────────────────────────────────────────────────────
    if (client.email) {
        try {
            const { subject, html, text } = buildReceiptEmail(payment, client);
            await sendEmail({
                to:            client.email,
                subject,
                html,
                text,
                userId:        superAdminId,
                transactional: true
            });
            console.log(`📧 [Receipt] Confirmation email sent to ${client.email} for invoice ${payment.invoiceNumber}`);
        } catch (err) {
            console.error(`❌ [Receipt] Email failed:`, err.message);
        }
    }

    // ── WhatsApp Receipt (template if configured) ────────────────────────────────
    if (client.phone) {
        try {
            const config = await BillingReminderConfig.findOne().lean();
            const templateName = config?.receiptTemplateName;
            const langCode     = config?.receiptLanguageCode || 'en';

            if (templateName) {
                await sendWhatsAppTemplateMessage(
                    client.phone, templateName, langCode, [],
                    superAdminId,
                    { isAutomated: true, triggerType: 'payment_receipt' }
                );
                console.log(`💬 [Receipt] WA receipt template '${templateName}' sent to ${client.phone}`);
            } else {
                // No template configured — skip WA silently (cannot send free-form outside 24h window)
                console.log(`ℹ️ [Receipt] No WA receipt template configured — WA skipped. Email sent.`);
            }
        } catch (err) {
            console.error(`❌ [Receipt] WhatsApp failed:`, err.message);
        }
    }
};

module.exports = {
    defineAgencyBillingJobs,
    scheduleAgencyBillFollowups,
    cancelAgencyBillFollowups,
    buildBillingEmail,      // exported for manual send-bill endpoint
    sendPaymentReceipt      // exported for payment confirmation receipt
};
