const { sendEmail } = require('./emailService');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────────────────────
// Webhook Health Monitor
// ─────────────────────────────────────────────────────────────────────────────
// Tracks consecutive Razorpay webhook processing failures and alerts the
// superadmin team when billing webhooks stop working reliably.
//
// Why this matters:
//   Razorpay retries failed webhooks up to ~5 times over ~48 hours.
//   If our handler keeps returning 5xx, Razorpay eventually gives up and the
//   event is silently lost — subscription.charged payments don't get recorded,
//   subscription.halted doesn't trigger recovery, etc.
//
// Strategy:
//   - Every webhook handler success → recordSuccess() resets the counter.
//   - Every webhook handler error   → recordFailure() increments counter.
//   - On ANY failure: alert the superadmin by email.
//   - Alert cooldown: 5 minutes (prevents flood if Razorpay batch-retries).
//   - In-memory counter resets on server restart (fine — we want live-session
//     failure visibility, not historical accumulation).
//
// Usage in billingController.webhook catch block:
//   catch (err) {
//       await webhookMonitor.recordFailure(eventType, err, payload);
//       res.json({ received: true, error: err.message });
//   }
// ─────────────────────────────────────────────────────────────────────────────

const ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between alerts
const APP_URL = process.env.FRONTEND_URL || 'https://app.adfliker.com';
const BRAND   = process.env.EMAIL_FROM_NAME || 'Adfliker';

// In-memory state
let consecutiveFailures = 0;
let lastAlertAt         = null;

const canAlert = () =>
    !lastAlertAt || (Date.now() - lastAlertAt) > ALERT_COOLDOWN_MS;

// ── recordSuccess ────────────────────────────────────────────────────────────
// Call this at the end of a successful webhook dispatch so the counter resets.
const recordSuccess = () => {
    if (consecutiveFailures > 0) {
        console.log(`✅ [WebhookMonitor] Webhook recovered after ${consecutiveFailures} consecutive failure(s).`);
    }
    consecutiveFailures = 0;
};

// ── recordFailure ────────────────────────────────────────────────────────────
// Call this in the webhook catch block. Increments counter and alerts if the
// cooldown has elapsed. Always resolves — never throws into the webhook flow.
const recordFailure = async (eventType, error, rawPayload) => {
    consecutiveFailures++;
    const failureCount = consecutiveFailures;

    console.error(`🚨 [WebhookMonitor] Webhook failure #${failureCount} — event="${eventType}" error="${error?.message}"`);

    if (!canAlert()) {
        console.warn(`[WebhookMonitor] Alert suppressed (cooldown active — last alert ${Math.round((Date.now() - lastAlertAt) / 1000)}s ago)`);
        return;
    }

    lastAlertAt = Date.now();

    // Fire alerts concurrently — both are best-effort.
    await Promise.allSettled([
        sendEmailAlert(eventType, error, rawPayload, failureCount),
        sendWhatsAppAlert(eventType, error, failureCount)
    ]);
};

// ── getStatus ────────────────────────────────────────────────────────────────
// Returns current monitor state for the SuperAdmin health dashboard.
const getStatus = () => ({
    consecutiveFailures,
    lastAlertAt,
    healthy: consecutiveFailures === 0
});

// ─── Email alert ──────────────────────────────────────────────────────────────
const sendEmailAlert = async (eventType, error, rawPayload, failureCount) => {
    try {
        // Fetch the superadmin email
        // Fetch the superadmin who actually configured email
        const IntegrationConfig = require('../models/IntegrationConfig');
        const superAdmins = await User.find({ role: 'superadmin' }).select('_id email companyName name').lean();
        const superAdminIds = superAdmins.map(sa => sa._id);
        
        const configuredSaConfig = await IntegrationConfig.findOne({
            userId: { $in: superAdminIds },
            'email.emailUser': { $ne: null, $exists: true }
        }).select('userId').lean();
        
        const admin = configuredSaConfig 
            ? superAdmins.find(sa => sa._id.toString() === configuredSaConfig.userId.toString())
            : superAdmins[0];

        if (!admin?.email) {
            console.warn('[WebhookMonitor] No superadmin email found — skipping email alert');
            return;
        }

        const safePayload = (() => {
            try {
                return JSON.stringify(rawPayload || {}, null, 2).slice(0, 800);
            } catch {
                return '(unserializable)';
            }
        })();

        const html = `
<div style="max-width:560px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
  <div style="background:#dc2626;color:#fff;padding:24px;border-radius:14px 14px 0 0;">
    <h1 style="margin:0;font-size:20px;">🚨 Billing Webhook Failure — Action Required</h1>
  </div>
  <div style="border:1px solid #fecaca;border-top:none;border-radius:0 0 14px 14px;padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
    <p>A Razorpay billing webhook failed to process on <strong>${BRAND}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <tr><td style="padding:6px 0;color:#64748b;width:140px;">Event</td><td style="font-weight:bold;font-family:monospace;">${eventType || 'unknown'}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Error</td><td style="color:#dc2626;font-family:monospace;">${error?.message || 'Unknown error'}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Consecutive failures</td><td style="font-weight:bold;color:${failureCount >= 3 ? '#dc2626' : '#d97706'};">${failureCount}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;">Time (UTC)</td><td>${new Date().toISOString()}</td></tr>
    </table>
    <p style="background:#fef2f2;border-left:4px solid #dc2626;padding:10px 12px;border-radius:6px;font-size:13px;">
      <strong>What this means:</strong> Razorpay will retry the webhook, but if failures continue,
      billing events (charges, cancellations, halts) may be silently lost.
    </p>
    <p><strong>Payload (truncated):</strong></p>
    <pre style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-size:11px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;">${safePayload}</pre>
    <p>
      <a href="${APP_URL}/dashboard" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:bold;padding:11px 22px;border-radius:10px;margin-top:8px;">
        Open Dashboard
      </a>
    </p>
    <p style="color:#94a3b8;font-size:12px;margin-top:18px;">
      Check server logs for the full stack trace. This alert will not repeat for 5 minutes.
    </p>
  </div>
</div>`;

        await sendEmail({
            to: admin.email,
            subject: `🚨 [${BRAND}] Billing webhook failure — ${eventType || 'unknown event'} (${failureCount} consecutive)`,
            html,
            transactional: true,
            userId: admin._id.toString()
        });

        console.log(`📧 [WebhookMonitor] Alert email sent to ${admin.email}`);
    } catch (alertErr) {
        console.error('[WebhookMonitor] Failed to send alert email:', alertErr.message);
    }
};

// ─── WhatsApp alert ───────────────────────────────────────────────────────────
const sendWhatsAppAlert = async (eventType, error, failureCount) => {
    try {
        const BillingReminderConfig = require('../models/BillingReminderConfig');
        const config = await BillingReminderConfig.findOne().lean();
        const templateName = config?.webhookAlertTemplateName;
        const langCode     = config?.webhookAlertLanguageCode || 'en';
        // Only send WA if an ops-alert template is configured.
        // This is intentionally optional — email is the primary alert channel.
        if (!templateName) return;

        // Fetch the superadmin who configured WhatsApp
        const superAdmins = await User.find({ role: 'superadmin' }).select('_id phone').lean();
        const superAdminIds = superAdmins.map(sa => sa._id);
        
        const IntegrationConfig = require('../models/IntegrationConfig');
        const configuredSaConfig = await IntegrationConfig.findOne({
            userId: { $in: superAdminIds },
            'whatsapp.wabaId': { $ne: null, $exists: true }
        }).select('userId').lean();
        
        const admin = configuredSaConfig 
            ? superAdmins.find(sa => sa._id.toString() === configuredSaConfig.userId.toString())
            : superAdmins[0];

        if (!admin?.phone || !admin?._id) return;

        const { sendWhatsAppTemplateMessage } = require('./whatsappService');
        await sendWhatsAppTemplateMessage(
            admin.phone,
            templateName,
            langCode,
            [eventType || 'unknown', String(failureCount), error?.message?.slice(0, 60) || '?'],
            admin._id,
            { isAutomated: true, triggerType: 'webhook_failure_alert' }
        );
        console.log(`💬 [WebhookMonitor] WA alert sent to superadmin (${admin.phone})`);
    } catch (alertErr) {
        console.error('[WebhookMonitor] Failed to send WA alert:', alertErr.message);
    }
};

module.exports = { recordSuccess, recordFailure, getStatus };
