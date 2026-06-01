const { sendEmail } = require('./emailService');

// Transactional billing emails sent from the PLATFORM (not a tenant's mailbox).
// We call emailService.sendEmail WITHOUT a userId, so it uses the platform Gmail
// (EMAIL_USER / EMAIL_PASSWORD in .env). All sends are best-effort and must NEVER
// throw into the webhook/charge flow — callers fire-and-forget with .catch.

const BRAND = process.env.EMAIL_FROM_NAME || 'Adfliker';
const APP_URL = process.env.FRONTEND_URL || 'https://app.adfliker.com';
const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

const shell = (heading, color, bodyHtml) => `
<div style="max-width:520px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;">
  <div style="background:${color};color:#fff;padding:24px;border-radius:14px 14px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">${heading}</h1>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 14px 14px;padding:24px;color:#1e293b;font-size:14px;line-height:1.6;">
    ${bodyHtml}
  </div>
</div>`;

const cta = (label, href) =>
    `<a href="${href}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;font-weight:bold;padding:11px 22px;border-radius:10px;margin-top:8px;">${label}</a>`;

// ── Payment SUCCESS — receipt + confirmation ────────────────────────────────
const sendPaymentSuccess = async (client, { planName, amount, cycle, newExpiry } = {}) => {
    if (!client?.email) return;
    const name = client.companyName || client.name || 'there';
    const html = shell('Payment received ✅', '#059669', `
        <p>Hi ${name},</p>
        <p>We've successfully received your payment. Your <b>${planName || 'subscription'}</b> is active.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="text-align:right;font-weight:bold;">${fmtINR(amount)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Plan</td><td style="text-align:right;">${planName || '—'} ${cycle ? `(${cycle})` : ''}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Active until</td><td style="text-align:right;font-weight:bold;">${fmtDate(newExpiry)}</td></tr>
        </table>
        <p>Your account will auto-renew on the date above. You can view invoices or manage your plan anytime.</p>
        <p>${cta('View billing', `${APP_URL}/billing`)}</p>
        <p style="color:#94a3b8;font-size:12px;margin-top:18px;">Thank you for being with ${BRAND}.</p>
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
        <p>Hi ${name},</p>
        <p>We couldn't collect your subscription payment${amount ? ` of <b>${fmtINR(amount)}</b>` : ''}${planName ? ` for <b>${planName}</b>` : ''}.</p>
        <p>This usually happens due to insufficient balance, a bank limit, or an expired card/mandate.</p>
        ${inGrace
            ? `<p style="background:#fef2f2;border-left:4px solid #e11d48;padding:10px 12px;border-radius:6px;">
                 <b>Your account is now in a grace period.</b> Please complete payment soon to avoid your account going read-only.</p>`
            : `<p>We'll retry automatically, but you can also pay now to avoid any interruption.</p>`}
        <p>${cta('Fix payment now', `${APP_URL}/billing`)}</p>
        <p style="color:#94a3b8;font-size:12px;margin-top:18px;">Need help? Just reply to this email.</p>
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
        <p>Hi ${name},</p>
        <p>This is a friendly reminder that your <b>${planName || 'subscription'}</b> will auto-renew ${whenLabel}${chargeDate ? ` (${fmtDate(chargeDate)})` : ''}.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
            <tr><td style="padding:6px 0;color:#64748b;">Amount</td><td style="text-align:right;font-weight:bold;">${fmtINR(amount)}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b;">Renews</td><td style="text-align:right;">${whenLabel}</td></tr>
        </table>
        <p>No action is needed — just make sure your payment method has sufficient balance. To change or cancel your plan, visit billing.</p>
        <p>${cta('Manage billing', `${APP_URL}/billing`)}</p>
    `);
    return sendEmail({
        to: client.email,
        subject: `Your ${BRAND} ${planName || 'subscription'} renews ${whenLabel}`,
        html,
        transactional: true
    });
};

module.exports = { sendPaymentSuccess, sendPaymentFailed, sendRenewalReminder };
