const { sendEmail } = require('./emailService');

// Transactional billing emails sent from the PLATFORM (not a tenant's mailbox).
// We call emailService.sendEmail WITHOUT a userId, so it uses the platform Gmail
// (EMAIL_USER / EMAIL_PASSWORD in .env). All sends are best-effort and must NEVER
// throw into the webhook/charge flow — callers fire-and-forget with .catch.

const BRAND = process.env.EMAIL_FROM_NAME || 'Adfliker';
const APP_URL = process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://app.adfliker.com';
const LOGO_URL = `${APP_URL.replace(/\/+$/, '')}/logo.png`;
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// Shared shell — mirrors the branded template already used for the welcome and
// password-reset emails (authController.js): navy header with the Adfliker
// logo, white Inter-font card with rounded corners + shadow, copyright footer.
// `accentColor` tints the header's bottom border to signal the email's status
// (green = good news, red = action needed, amber = warning, blue = FYI) while
// keeping the header itself on-brand navy across every billing email.
const shell = (heading, accentColor, bodyHtml) => `
<div style="background-color:#f9fafb;padding:40px 20px;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="background-color:#0f172a;padding:24px;text-align:center;border-bottom:4px solid ${accentColor};">
      <img src="${LOGO_URL}" alt="${BRAND} Logo" style="height:32px;object-fit:contain;display:block;margin:0 auto 12px;" />
      <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;">${heading}</p>
    </div>
    <div style="padding:40px 32px;color:#374151;font-size:15px;line-height:1.6;">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #f3f4f6;margin:32px 0 20px;" />
      <p style="color:#9ca3af;font-size:12px;margin:0;text-align:center;">© ${new Date().getFullYear()} ${BRAND}. All rights reserved.</p>
    </div>
  </div>
</div>`;

const cta = (label, href, color = '#10b981') =>
    `<div style="margin:24px 0 4px;"><a href="${href}" style="display:block;width:100%;box-sizing:border-box;text-align:center;padding:14px 0;background-color:${color};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;box-shadow:0 1px 2px rgba(0,0,0,0.05);">${label}</a></div>`;

// ── Payment SUCCESS — receipt + confirmation ────────────────────────────────
const sendPaymentSuccess = async (client, { planName, amount, cycle, newExpiry } = {}) => {
    if (!client?.email) return;
    const name = client.companyName || client.name || 'there';
    const html = shell('Payment received ✅', '#10b981', `
        <p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">We've successfully received your payment. Your <b>${planName || 'subscription'}</b> is active.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="text-align:right;font-weight:bold;">${fmtINR(amount)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Plan</td><td style="text-align:right;">${planName || '—'} ${cycle ? `(${cycle})` : ''}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Active until</td><td style="text-align:right;font-weight:bold;">${fmtDate(newExpiry)}</td></tr>
        </table>
        <p style="margin:0;">Your account will auto-renew on the date above. You can view invoices or manage your plan anytime.</p>
        ${cta('View billing', `${APP_URL}/billing`)}
        <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">Thank you for being with ${BRAND}.</p>
    `);
    return sendEmail({
        to: client.email,
        subject: `Payment received — ${planName || 'subscription'} active until ${fmtDate(newExpiry)}`,
        html,
        transactional: true
    });
};

// ── Payment FAILED — action needed ──────────────────────────────────────────
const sendPaymentFailed = async (client, { planName, amount, inGrace } = {}) => {
    if (!client?.email) return;
    const name = client.companyName || client.name || 'there';
    const html = shell('Payment failed ⚠️', '#e11d48', `
        <p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">We couldn't collect your subscription payment${amount ? ` of <b>${fmtINR(amount)}</b>` : ''}${planName ? ` for <b>${planName}</b>` : ''}.</p>
        <p style="margin:0 0 16px;">This usually happens due to insufficient balance, a bank limit, or an expired card/mandate.</p>
        ${inGrace
            ? `<div style="background:#fef2f2;border-left:4px solid #e11d48;padding:10px 12px;border-radius:6px;margin:0 0 8px;">
                 <b>Your account is now in a grace period.</b> Please complete payment soon to avoid your account going read-only.</div>`
            : `<p style="margin:0;">We'll retry automatically, but you can also pay now to avoid any interruption.</p>`}
        ${cta('Fix payment now', `${APP_URL}/billing`, '#e11d48')}
        <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">Need help? Just reply to this email.</p>
    `);
    return sendEmail({
        to: client.email,
        subject: `Action needed — your ${BRAND} payment failed`,
        html,
        transactional: true
    });
};

// ── Renewal REMINDER — sent T-7 / T-3 / T-1 before the next auto-charge ─────
const sendRenewalReminder = async (client, { planName, amount, daysUntil, chargeDate } = {}) => {
    if (!client?.email) return;
    const name = client.companyName || client.name || 'there';
    const whenLabel = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
    const html = shell('Upcoming renewal 🔔', '#2563eb', `
        <p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0 0 16px;">This is a friendly reminder that your <b>${planName || 'subscription'}</b> will auto-renew ${whenLabel}${chargeDate ? ` (${fmtDate(chargeDate)})` : ''}.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="text-align:right;font-weight:bold;">${fmtINR(amount)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Renews</td><td style="text-align:right;">${whenLabel}</td></tr>
        </table>
        <p style="margin:0;">No action is needed — just make sure your payment method has sufficient balance. To change or cancel your plan, visit billing.</p>
        ${cta('Manage billing', `${APP_URL}/billing`, '#2563eb')}
    `);
    return sendEmail({
        to: client.email,
        subject: `Your ${BRAND} ${planName || 'subscription'} renews ${whenLabel}`,
        html,
        transactional: true
    });
};

// ── Trial ENDING SOON — sent T-5 / T-2 before trial expiry ─────────────────
const sendTrialEndingSoon = async (client, { daysLeft, trialEndDate } = {}) => {
    if (!client?.email) return;
    const name = client.companyName || client.name || 'there';
    const whenLabel = daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`;
    const html = shell('Your trial is ending soon ⏳', '#d97706', `
        <p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0;">Your ${BRAND} trial ends <b>${whenLabel}</b>${trialEndDate ? ` (${fmtDate(trialEndDate)})` : ''}. Subscribe now to keep your leads, automations and integrations running without interruption.</p>
        ${cta('Subscribe now', `${APP_URL}/billing`, '#d97706')}
        <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">Questions? Just reply to this email.</p>
    `);
    return sendEmail({
        to: client.email,
        subject: `Your ${BRAND} trial ends ${whenLabel} — subscribe to keep access`,
        html,
        transactional: true
    });
};

// ── Trial EXPIRED — sent on the day it lapses, then every 7 days after ─────
const sendTrialExpired = async (client, { daysSinceExpiry } = {}) => {
    if (!client?.email) return;
    const name = client.companyName || client.name || 'there';
    const whenLabel = daysSinceExpiry <= 0 ? 'today' : `${daysSinceExpiry} day${daysSinceExpiry === 1 ? '' : 's'} ago`;
    const html = shell('Your trial has expired', '#e11d48', `
        <p style="margin:0 0 16px;">Hi ${name},</p>
        <p style="margin:0;">Your ${BRAND} trial expired <b>${whenLabel}</b>. Your account is now read-only — subscribe to restore full access to your leads, automations and integrations.</p>
        ${cta('Subscribe now', `${APP_URL}/billing`, '#e11d48')}
        <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">Need help choosing a plan? Just reply to this email.</p>
    `);
    return sendEmail({
        to: client.email,
        subject: `Your ${BRAND} trial has expired — subscribe to reactivate`,
        html,
        transactional: true
    });
};

module.exports = { sendPaymentSuccess, sendPaymentFailed, sendRenewalReminder, sendTrialEndingSoon, sendTrialExpired };
