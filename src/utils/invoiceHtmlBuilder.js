// src/utils/invoiceHtmlBuilder.js
//
// Server-side invoice HTML generator.
// Mirrors the client-side printInvoice template exactly.
// Used by:
//   1. Public invoice route (GET /api/invoice/:invoiceNumber)
//   2. Billing emails (as a "View Invoice" link)
//
// The HTML is a self-contained, print-ready A4 invoice.
// Client can open it in the browser and Print → Save as PDF.

const MONTHS_FULL = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const SERVICE_LABELS_MAP = {
    'seo':          'SEO Services',
    'ads':          'Ads Management',
    'social-media': 'Social Media Management',
    'web-dev':      'Web Development',
    'content':      'Content Creation',
    'branding':     'Branding & Design',
    'other':        'Monthly Retainer'
};

const fmtCur = (n) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

/**
 * Build a complete HTML invoice page for a given payment.
 *
 * @param {Object} payment  - AgencyPayment document (lean or toObject)
 * @param {Object} branding - { agencyName, agencyAddress, agencyGst, agencyLogo }
 * @param {Object} opts     - { autoPrint: boolean } — if true, triggers window.print() on load
 * @returns {string} Full HTML document string
 */
const buildInvoiceHtml = (payment, branding = {}, opts = {}) => {
    const serviceLabel = SERVICE_LABELS_MAP[payment.clientServiceType] || 'Monthly Retainer — Services';
    const period = `${MONTHS_FULL[(payment.billingMonth || 1) - 1]} ${payment.billingYear}`;

    const invoiceDate = payment.invoiceDate
        ? new Date(payment.invoiceDate)
        : new Date(payment.billingYear, (payment.billingMonth || 1) - 1, 1);

    const statusColor = payment.status === 'received' ? '#10b981'
        : payment.status === 'partial' ? '#3b82f6' : '#f59e0b';
    const statusLabel = payment.status === 'received' ? 'PAID ✓ VERIFIED'
        : payment.status === 'partial' ? 'PARTIAL PAID' : 'OUTSTANDING';
    const isVerified = payment.status === 'received';

    const agencyName    = payment.agencyNameSnapshot    || branding.agencyName    || 'AGENCY';
    const agencyAddress = payment.agencyAddressSnapshot || branding.agencyAddress || '';
    const agencyGst     = payment.agencyGstSnapshot     || branding.agencyGst     || '';
    const agencyLogo    = payment.agencyLogoSnapshot    || branding.agencyLogo    || '';

    // Escape HTML in user data to prevent XSS
    const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    const printScript = opts.autoPrint
        ? `<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>`
        : '';

    // "Save as PDF" button (hidden when printing)
    const saveButton = !opts.autoPrint ? `
    <div class="no-print" style="text-align:center;padding:20px 0 40px;">
      <button onclick="window.print()" style="background:#4f46e5;color:#fff;border:none;padding:14px 40px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(79,70,229,0.3);letter-spacing:0.3px;">
        🖨️ Print / Save as PDF
      </button>
    </div>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Invoice ${esc(payment.invoiceNumber || '')}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; background: #f1f5f9; }
    .page { padding: 48px 56px; max-width: 800px; margin: 32px auto; background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
    .logo-area img { max-height: 64px; max-width: 200px; object-fit: contain; }
    .logo-area .brand { font-size: 24px; font-weight: 900; color: #4f46e5; letter-spacing: -0.5px; }
    .invoice-badge { text-align: right; }
    .invoice-badge h1 { font-size: 36px; font-weight: 900; color: #4f46e5; letter-spacing: -1px; }
    .invoice-badge .inv-num { font-size: 13px; color: #64748b; margin-top: 4px; }
    .status-badge { display: inline-block; padding: 4px 14px; border-radius: 999px; font-size: 12px; font-weight: 800; letter-spacing: 1px; margin-top: 8px; color: white; background: ${statusColor}; }
    .divider { border: none; border-top: 2px solid #e2e8f0; margin: 32px 0; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 40px; }
    .party-box h3 { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .party-box h2 { font-size: 18px; font-weight: 800; color: #1e293b; margin-bottom: 4px; }
    .party-box p { font-size: 13px; color: #475569; line-height: 1.6; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; background: #f8fafc; border-radius: 12px; padding: 20px 24px; margin-bottom: 36px; }
    .meta-item label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; }
    .meta-item span { font-size: 14px; font-weight: 700; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    thead th { background: #4f46e5; color: white; padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    thead th:last-child { text-align: right; }
    tbody td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    tbody td:last-child { text-align: right; font-weight: 700; }
    .total-section { display: flex; justify-content: flex-end; }
    .total-box { width: 280px; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #475569; }
    .total-row.grand { border-top: 2px solid #e2e8f0; padding-top: 12px; margin-top: 4px; font-size: 18px; font-weight: 900; color: #1e293b; }
    .footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .footer p { font-size: 12px; color: #94a3b8; }
    @media print {
      @page { margin: 0; size: A4; }
      body { background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .page { margin: 0; border-radius: 0; box-shadow: none; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
${saveButton}
<div class="page">
  ${isVerified ? `
  <div style="position:fixed;top:35%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);opacity:0.07;pointer-events:none;z-index:1000;">
    <div style="border:8px solid #10b981;color:#10b981;font-size:56px;font-weight:900;padding:16px 32px;letter-spacing:0.12em;white-space:nowrap;border-radius:8px;">PAYMENT VERIFIED</div>
  </div>` : ''}
  <div class="header">
    <div class="logo-area">
      ${agencyLogo ? `<img src="${esc(agencyLogo)}" alt="Logo" />` : `<div class="brand">${esc(agencyName)}</div>`}
    </div>
    <div class="invoice-badge">
      <h1>INVOICE</h1>
      <div class="inv-num">${esc(payment.invoiceNumber || 'INV-000')}</div>
      <div class="status-badge">${statusLabel}</div>
    </div>
  </div>

  <hr class="divider" />

  <div class="parties">
    <div class="party-box">
      <h3>From</h3>
      <h2>${esc(agencyName)}</h2>
      ${agencyAddress ? `<p style="white-space:pre-line; margin-top: 4px;">${esc(agencyAddress).replace(/\n/g, '<br/>')}</p>` : ''}
      ${agencyGst ? `<p style="margin-top: 4px;">GST: <strong>${esc(agencyGst)}</strong></p>` : ''}
    </div>
    <div class="party-box">
      <h3>Billed To</h3>
      <h2>${esc(payment.clientName || '—')}</h2>
      ${payment.clientCompany ? `<p>${esc(payment.clientCompany)}</p>` : ''}
      ${payment.billingAddressSnapshot ? `<p style="white-space:pre-line; margin-top: 4px;">${esc(payment.billingAddressSnapshot).replace(/\n/g, '<br/>')}</p>` : '<p style="color:#94a3b8;font-style:italic; margin-top: 4px;">No billing address on file</p>'}
      ${payment.gstNumberSnapshot ? `<p style="margin-top: 4px;">GST: <strong>${esc(payment.gstNumberSnapshot)}</strong></p>` : ''}
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><label>Invoice #</label><span>${esc(payment.invoiceNumber || '—')}</span></div>
    <div class="meta-item"><label>Invoice Date</label><span>${fmtD(invoiceDate)}</span></div>
    <div class="meta-item"><label>Due Date</label><span>${fmtD(payment.dueDate)}</span></div>
    <div class="meta-item"><label>Payment Status</label><span style="color:${statusColor};font-weight:700">${statusLabel}</span></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Period</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>${esc(serviceLabel)}</strong></td>
        <td>${esc(period)}</td>
        <td>${fmtCur(payment.amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="total-section">
    <div class="total-box">
      <div class="total-row"><span>Subtotal</span><span>${fmtCur(payment.amount)}</span></div>
      ${payment.status === 'partial' ? `<div class="total-row" style="color:#10b981"><span>Received</span><span>− ${fmtCur(payment.receivedAmount)}</span></div>` : ''}
      <div class="total-row grand">
        <span>${payment.status === 'partial' ? 'Balance Due' : 'Total'}</span>
        <span>${payment.status === 'partial' ? fmtCur(payment.amount - (payment.receivedAmount || 0)) : fmtCur(payment.amount)}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>Generated on ${fmtD(payment.invoiceGeneratedDate || payment.createdAt || new Date())}</p>
  </div>
</div>
${printScript}
</body></html>`;
};

module.exports = { buildInvoiceHtml };
