// src/routes/invoicePublicRoute.js
//
// Public (no auth) route that serves the invoice HTML page.
// Secured via HMAC token — only someone with the link can view the invoice.
//
// GET /api/invoice/:invoiceNumber?token=<hmac-token>
//
// The token is generated using:
//   HMAC-SHA256( invoiceNumber + paymentId, JWT_SECRET )
//
// This means:
//   - Only the server can create valid tokens (secret is required)
//   - Tokens are deterministic — same invoice always gets the same token
//   - No expiry — the invoice link stays valid forever (clients bookmark them)
//   - No auth needed — client doesn't need an account to view their invoice

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const AgencyPayment = require('../models/AgencyPayment');
const { buildInvoiceHtml } = require('../utils/invoiceHtmlBuilder');

// ─── Token helpers ─────────────────────────────────────────────────────────────

const getSecret = () => process.env.JWT_SECRET || process.env.SECRET_KEY || 'fallback-billing-secret';

/**
 * Generate a deterministic HMAC token for an invoice.
 * Used when building the "View Invoice" link for emails.
 */
const generateInvoiceToken = (invoiceNumber, paymentId) => {
    const payload = `${invoiceNumber}:${paymentId}`;
    return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
};

/**
 * Verify an HMAC token against an invoice.
 */
const verifyInvoiceToken = (invoiceNumber, paymentId, token) => {
    const expected = generateInvoiceToken(invoiceNumber, paymentId);
    // Timing-safe comparison to prevent timing attacks
    try {
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
    } catch {
        return false;
    }
};

/**
 * Build the full public URL for an invoice.
 * Used by email builders and the controller.
 */
const buildInvoiceUrl = (invoiceNumber, paymentId) => {
    const backendUrl = process.env.BACKEND_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
    const token = generateInvoiceToken(invoiceNumber, paymentId);
    return `${backendUrl}/api/invoice/${encodeURIComponent(invoiceNumber)}?token=${token}`;
};

// ─── Route: GET /api/invoice/:invoiceNumber ────────────────────────────────────

router.get('/:invoiceNumber', async (req, res) => {
    try {
        const { invoiceNumber } = req.params;
        const { token } = req.query;

        if (!token) {
            return res.status(401).send(errorPage('Access Denied', 'A valid token is required to view this invoice.'));
        }

        // Look up the payment by invoice number
        const payment = await AgencyPayment.findOne({ invoiceNumber }).lean();
        if (!payment) {
            return res.status(404).send(errorPage('Invoice Not Found', `Invoice ${invoiceNumber} does not exist.`));
        }

        // Verify the HMAC token
        if (!verifyInvoiceToken(invoiceNumber, payment._id.toString(), token)) {
            return res.status(403).send(errorPage('Invalid Token', 'This invoice link is invalid or has been tampered with.'));
        }

        // Load global branding as fallback
        const GlobalSetting = require('../models/GlobalSetting');
        const keys = ['company_name', 'company_address', 'company_gst', 'company_logo'];
        const settings = await GlobalSetting.find({ key: { $in: keys } }).lean();
        const brandingMap = {};
        settings.forEach(s => { brandingMap[s.key] = s.value || ''; });
        const branding = {
            agencyName:    brandingMap.company_name    || '',
            agencyAddress: brandingMap.company_address || '',
            agencyGst:     brandingMap.company_gst     || '',
            agencyLogo:    brandingMap.company_logo    || ''
        };

        // Build and serve the invoice HTML
        const html = buildInvoiceHtml(payment, branding, { autoPrint: false });

        // Cache for 1 hour — invoice data doesn't change frequently
        res.set('Cache-Control', 'private, max-age=3600');
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    } catch (err) {
        console.error('[InvoicePublic] Error serving invoice:', err.message);
        res.status(500).send(errorPage('Server Error', 'Something went wrong while loading this invoice. Please try again later.'));
    }
});

// ─── Styled error page ─────────────────────────────────────────────────────────

const errorPage = (title, message) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 16px; padding: 48px; text-align: center; max-width: 420px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h1 { color: #1e293b; font-size: 22px; font-weight: 800; margin-bottom: 8px; }
    p { color: #64748b; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

module.exports = { router, generateInvoiceToken, verifyInvoiceToken, buildInvoiceUrl };
