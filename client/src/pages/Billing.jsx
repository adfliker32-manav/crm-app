import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { useConfirm } from '../context/ConfirmContext';
import { WORKSPACE_MODULES, moduleLabel } from '../constants/modules';
import { openSubscriptionCheckout } from '../services/razorpay';

const fmt = (n) => (n ?? 0).toLocaleString('en-IN');
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const daysLeft = (expiry) => {
    if (!expiry) return null;
    return Math.ceil((new Date(expiry) - Date.now()) / 86400000);
};

const STATUS_CONFIG = {
    active:       { label: 'Active',           bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    pending_auth: { label: 'Pending mandate',  bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500'    },
    grace:        { label: 'Payment overdue',  bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500'   },
    expired:      { label: 'Expired',          bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400'   },
    trial:        { label: 'Trial',            bg: 'bg-purple-100',  text: 'text-purple-700',  dot: 'bg-purple-500'  },
    pending:      { label: 'Pending',          bg: 'bg-slate-100',   text: 'text-slate-600',   dot: 'bg-slate-400'   },
};

const StatusBadge = ({ status }) => {
    const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
    return (
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${cfg.bg} ${cfg.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
        </span>
    );
};

const Billing = () => {
    const [data, setData]           = useState(null);
    const [loading, setLoading]     = useState(true);
    const [confirming, setConfirming] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const [couponCode, setCouponCode] = useState('');
    const [couponBusy, setCouponBusy] = useState(false);

    // Billing details and invoice states
    const [billingAddress, setBillingAddress] = useState('');
    const [gstNumber, setGstNumber]           = useState('');
    const [saveBusy, setSaveBusy]             = useState(false);
    const [downloadingId, setDownloadingId]   = useState(null);

    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // Razorpay uses a popup — no redirect params on return.
    // justReturned is no longer needed; polling starts inside the Razorpay handler.
    const { showSuccess, showError, showInfo } = useNotification();
    const { showDanger } = useConfirm();
    const cancelledRef = useRef(false);
    const [checkoutBusy, setCheckoutBusy] = useState(false);
    // Used by the "Update payment method" button when subscription is in grace state.
    // Always fetches a fresh Razorpay short_url — never relies on the stale stored authLink.
    const [paymentLinkBusy, setPaymentLinkBusy] = useState(false);

    const load = async (silent = false) => {
        if (!silent) setLoading(true);
        try {
            const res = await api.get('/billing/me/subscription');
            setData(res.data || {});
            setBillingAddress(res.data?.workspace?.billingAddress || '');
            setGstNumber(res.data?.workspace?.gstNumber || '');
            return res.data || {};
        } catch (err) {
            if (!silent) showError(err.response?.data?.message || 'Failed to load billing info');
            return null;
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const handleSaveBillingDetails = async () => {
        setSaveBusy(true);
        try {
            await api.put('/billing/me/billing-details', { billingAddress, gstNumber });
            showSuccess('Billing details updated successfully.');
            load(true);
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save billing details');
        } finally {
            setSaveBusy(false);
        }
    };

    const handleDownloadInvoice = async (invId) => {
        setDownloadingId(invId);
        try {
            const res = await api.get(`/billing/me/invoice/${invId}`);
            const { payment, company, client, planName } = res.data;

            const fmtCur = (n) => `₹${(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
            const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
            
            const period = `${fmtDate(payment.activationStart)} to ${fmtDate(payment.activationEnd)}`;
            
            const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${payment.invoiceNumber || ''}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1e293b; background: #fff; }
    .page { padding: 48px 56px; max-width: 800px; margin: auto; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 48px; }
    .logo-area .brand { font-size: 24px; font-weight: 900; color: #4f46e5; letter-spacing: -0.5px; }
    .invoice-badge { text-align: right; }
    .invoice-badge h1 { font-size: 36px; font-weight: 900; color: #10b981; letter-spacing: -1px; }
    .invoice-badge .inv-num { font-size: 13px; color: #64748b; margin-top: 4px; }
    .status-badge { display: inline-block; padding: 4px 14px; border-radius: 999px; font-size: 12px; font-weight: 800; letter-spacing: 1px; margin-top: 8px; color: white; background: #10b981; }
    .divider { border: none; border-top: 2px solid #e2e8f0; margin: 32px 0; }
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 40px; }
    .party-box h3 { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .party-box h2 { font-size: 18px; font-weight: 800; color: #1e293b; margin-bottom: 4px; }
    .party-box p { font-size: 13px; color: #475569; line-height: 1.6; }
    .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; background: #f8fafc; border-radius: 12px; padding: 20px 24px; margin-bottom: 36px; }
    .meta-item label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 1px; display: block; margin-bottom: 4px; }
    .meta-item span { font-size: 14px; font-weight: 700; color: #1e293b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
    thead th { background: #10b981; color: white; padding: 12px 16px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
    thead th:last-child { text-align: right; }
    tbody td { padding: 14px 16px; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    tbody td:last-child { text-align: right; font-weight: 700; }
    .total-section { display: flex; justify-content: flex-end; }
    .total-box { width: 280px; }
    .total-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; color: #475569; }
    .total-row.grand { border-top: 2px solid #e2e8f0; padding-top: 12px; margin-top: 4px; font-size: 18px; font-weight: 900; color: #1e293b; }
    .footer { margin-top: 64px; padding-top: 24px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
    .footer p { font-size: 12px; color: #94a3b8; }
    @media print { @page { margin: 0; size: A4; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
<div class="page">
  <div style="position:fixed;top:35%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);opacity:0.07;pointer-events:none;z-index:1000;">
    <div style="border:8px solid #10b981;color:#10b981;font-size:56px;font-weight:900;padding:16px 32px;letter-spacing:0.12em;white-space:nowrap;border-radius:8px;">PAYMENT VERIFIED</div>
  </div>
  <div class="header">
    <div class="logo-area">
      <div class="brand">${company.name}</div>
    </div>
    <div class="invoice-badge">
      <h1>INVOICE</h1>
      <div class="inv-num">${payment.invoiceNumber || 'INV-000'}</div>
      <div class="status-badge">PAID ✓ VERIFIED</div>
    </div>
  </div>

  <hr class="divider" />

  <div class="parties">
    <div class="party-box">
      <h3>Billed By</h3>
      <h2>${company.name}</h2>
      <p style="white-space:pre-line">${company.address}</p>
      ${company.gst ? `<p>GST: <strong>${company.gst}</strong></p>` : ''}
      <p>Email: ${company.email}</p>
    </div>
    <div class="party-box" style="text-align:right">
      <h3>Billed To</h3>
      <h2>${payment.clientName || client.companyName || client.name || '—'}</h2>
      ${client.email ? `<p>${client.email}</p>` : ''}
      ${payment.billingAddressSnapshot ? `<p style="white-space:pre-line">${payment.billingAddressSnapshot.replace(/\n/g, '<br/>')}</p>` : '<p style="color:#94a3b8;font-style:italic">No billing address on file</p>'}
      ${payment.gstNumberSnapshot ? `<p>GST: <strong>${payment.gstNumberSnapshot}</strong></p>` : ''}
    </div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><label>Invoice #</label><span>${payment.invoiceNumber || '—'}</span></div>
    <div class="meta-item"><label>Invoice Date</label><span>${fmtD(payment.paymentDate)}</span></div>
    <div class="meta-item"><label>Payment Status</label><span style="color:#10b981;font-weight:700">PAID ✓</span></div>
    <div class="meta-item"><label>Payment Date</label><span>${fmtD(payment.paymentDate)}</span></div>
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
        <td><strong>${planName} Subscription</strong></td>
        <td>${period}</td>
        <td>${fmtCur(payment.amount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="total-section">
    <div class="total-box">
      <div class="total-row"><span>Subtotal</span><span>${fmtCur(payment.amount)}</span></div>
      <div class="total-row grand">
        <span>Total Paid</span>
        <span>${fmtCur(payment.amount)}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Thank you for your subscription!</p>
    <p>Generated on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
  </div>
</div>
<script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }<\/script>
</body></html>`;

            const win = window.open('', '_blank', 'width=900,height=700');
            if (win) {
                win.document.write(html);
                win.document.close();
            }
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to download invoice');
        } finally {
            setDownloadingId(null);
        }
    };

    // Razorpay Checkout uses a popup — no page redirect needed.
    // The subscription.activated webhook fires once the customer completes the popup;
    // we poll after that to reflect status immediately in the UI.
    useEffect(() => {
        cancelledRef.current = false;
        load();
        return () => { cancelledRef.current = true; };
    }, []);

    const handleCancel = async () => {
        const ok = await showDanger(
            'Cancel autodebit? Your access continues until the current period ends.',
            'Cancel subscription'
        );
        if (!ok) return;
        setActionBusy(true);
        try {
            await api.post('/billing/me/cancel');
            showSuccess('Subscription cancelled.');
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Cancel failed');
        } finally {
            setActionBusy(false);
        }
    };

    // Opens the Razorpay Checkout popup. On success polls for webhook confirmation.
    const resumeAuth = async () => {
        const rzpSubId = data?.subscription?.razorpaySubscriptionId;
        const keyId    = data?.razorpayKeyId;
        const sub      = data?.subscription;

        if (!rzpSubId || !keyId) { navigate('/plans'); return; }

        setCheckoutBusy(true);
        try {
            await openSubscriptionCheckout({
                razorpaySubscriptionId: rzpSubId,
                keyId,
                planName:      data?.plan?.name || sub?.planCode,
                customerName:  '', // will be pre-filled by Razorpay from customer_notify
                onSuccess: async () => {
                    setConfirming(true);
                    const isActive = (d) => d?.workspace?.subscriptionStatus === 'active';
                    for (let i = 0; i < 20 && !cancelledRef.current; i++) {
                        await new Promise(r => setTimeout(r, 3000));
                        const d = await load(true);
                        if (isActive(d)) {
                            setConfirming(false);
                            showSuccess('Payment authorized — your plan is now active! 🎉');
                            return;
                        }
                    }
                    setConfirming(false);
                    showInfo('Mandate received. We\'ll activate your plan once the payment settles (usually instant).');
                },
                onDismiss: () => showInfo('Checkout closed. Click “Authorize now” to retry anytime.')
            });
        } catch (err) {
            if (!err.message?.includes('closed by user')) {
                showError(err.message || 'Could not open authorization. Try from Plans.');
            }
        } finally {
            setCheckoutBusy(false);
        }
    };

    // ── handleUpdatePayment ────────────────────────────────────────────────
    // Fetches a FRESH Razorpay short_url from the server on every click.
    // This prevents the "30 days later, link doesn't work" scenario:
    //   - The stored authLink is set at subscription creation time.
    //   - A plan change, server restart, or Razorpay internal update could
    //     make it stale. The server always re-fetches from Razorpay API.
    //   - short_url is permanent for the lifetime of the subscription.
    const handleUpdatePayment = async () => {
        setPaymentLinkBusy(true);
        try {
            const res = await api.get('/billing/me/payment-link');
            const link = res.data?.paymentLink;
            if (!link) throw new Error('No payment link received');
            // Open in new tab — Razorpay hosted payment page
            window.open(link, '_blank', 'noopener,noreferrer');
        } catch (err) {
            showError(err.response?.data?.message || 'Could not load payment link. Please try again.');
        } finally {
            setPaymentLinkBusy(false);
        }
    };

    const handleApplyCoupon = async () => {
        if (!couponCode.trim()) return;
        setCouponBusy(true);
        try {
            // Pass current planCode so plan-restricted coupons are checked server-side
            const res = await api.post('/billing/me/apply-coupon', {
                code: couponCode.trim(),
                planCode: ws?.currentPlanCode || undefined
            });
            showSuccess(`Coupon applied! Plan extended by ${res.data.extensionDays} days.`);
            setCouponCode('');
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Invalid coupon');
        } finally {
            setCouponBusy(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin" />
                    <span className="text-sm text-slate-500">Loading billing…</span>
                </div>
            </div>
        );
    }

    const sub  = data?.subscription;
    const ws   = data?.workspace;
    const plan = data?.plan;
    const invoices     = data?.invoices || [];
    const leadsUsed    = data?.leadsUsed ?? 0;
    const leadLimit    = ws?.planFeatures?.leadLimit ?? 0;
    const rzpReady  = data?.razorpayConfigured;
    const status       = ws?.subscriptionStatus || 'pending';
    const isActive     = status === 'active';
    const isPendingAuth = status === 'pending_auth';
    const isGrace      = status === 'grace';
    const isExpired    = status === 'expired';
    const days         = daysLeft(ws?.planExpiryDate);
    const usagePct     = leadLimit > 0 ? Math.min(100, Math.round((leadsUsed / leadLimit) * 100)) : 0;

    return (
        <div className="max-w-4xl mx-auto py-8 px-4 space-y-6">

            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Billing</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Manage your subscription and invoices.</p>
                </div>
                <button onClick={() => navigate('/plans')}
                    className="text-sm font-medium text-slate-700 border border-slate-300 px-3.5 py-1.5 rounded-lg hover:bg-slate-50 transition">
                    View plans
                </button>
            </div>

            {/* Confirming banner */}
            {confirming && (
                <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 text-blue-800 p-4 rounded-xl text-sm">
                    <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span><strong>Confirming payment…</strong> This usually takes a few seconds.</span>
                </div>
            )}

            {/* Razorpay not configured */}
            {!rzpReady && (
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl text-sm">
                    <i className="fa-solid fa-triangle-exclamation flex-shrink-0" />
                    Self-serve subscription is temporarily unavailable. Contact support to activate your plan.
                </div>
            )}

            {/* Status alerts */}
            {isPendingAuth && (
                <div className="flex items-center justify-between bg-blue-50 border border-blue-200 p-4 rounded-xl gap-4">
                    <div>
                        <p className="font-semibold text-blue-900 text-sm">Mandate authorization pending</p>
                        <p className="text-xs text-blue-700 mt-0.5">Complete the one-time payment authorization via Razorpay to activate autodebit.</p>
                    </div>
                    <button
                        onClick={resumeAuth}
                        disabled={checkoutBusy}
                        className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-40 flex items-center gap-2"
                    >
                        {checkoutBusy && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                        Authorize now
                    </button>
                </div>
            )}
            {isGrace && (
                <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
                    <p className="font-semibold text-amber-900 text-sm">Payment failed — action required</p>
                    <p className="text-xs text-amber-700 mt-1">
                        Your card or UPI has expired or is low on funds. Razorpay will retry automatically,
                        but to prevent losing access please update your payment method.
                    </p>
                    {/* Always fetch a fresh link from Razorpay — never use the stale stored authLink */}
                    <button
                        onClick={handleUpdatePayment}
                        disabled={paymentLinkBusy}
                        className="inline-flex items-center gap-1.5 mt-3 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 rounded-lg transition"
                    >
                        {paymentLinkBusy
                            ? <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : <i className="fa-solid fa-credit-card" />}
                        Update payment method
                    </button>
                    <p className="text-xs text-amber-600 mt-2">Access is paused. Once payment succeeds your plan will resume automatically.</p>
                </div>
            )}
            {isExpired && (
                <div className="flex items-center justify-between bg-slate-50 border border-slate-200 p-4 rounded-xl gap-4">
                    <div>
                        <p className="font-semibold text-slate-900 text-sm">Plan expired — account is read-only</p>
                        <p className="text-xs text-slate-600 mt-0.5">Subscribe to a plan to restore full access.</p>
                    </div>
                    <button onClick={() => navigate('/plans')}
                        className="flex-shrink-0 bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
                        Subscribe
                    </button>
                </div>
            )}

            {/* Plan overview card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6">
                <div className="flex items-start justify-between flex-wrap gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <StatusBadge status={status} />
                            {days !== null && days > 0 && days <= 14 && (
                                <span className="text-xs text-amber-600 font-medium">{days}d left</span>
                            )}
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mt-2">
                            {plan?.name || ws?.currentPlanCode || 'No active plan'}
                        </h2>
                        {plan?.description && (
                            <p className="text-sm text-slate-500 mt-1">{plan.description}</p>
                        )}
                        {sub?.amount > 0 && (
                            <p className="text-lg font-semibold text-slate-700 mt-2">
                                ₹{fmt(sub.amount)}
                                <span className="text-sm font-normal text-slate-500"> / {sub.billingCycle}</span>
                                {sub.couponCode && (
                                    <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 font-semibold px-2 py-0.5 rounded-full">
                                        {sub.couponCode} applied
                                    </span>
                                )}
                            </p>
                        )}
                    </div>
                    <div className="text-right space-y-1">
                        <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Access until</p>
                        <p className="text-xl font-bold text-slate-900">{fmtDate(ws?.planExpiryDate)}</p>
                        {sub?.nextChargeAt && isActive && (
                            <p className="text-xs text-slate-500">Next charge {fmtDate(sub.nextChargeAt)}</p>
                        )}
                    </div>
                </div>

                {/* Usage bar */}
                {leadLimit > 0 && (
                    <div className="mt-5 pt-5 border-t border-slate-100">
                        <div className="flex justify-between text-xs font-medium text-slate-600 mb-1.5">
                            <span>Leads used</span>
                            <span>{fmt(leadsUsed)} / {fmt(leadLimit)}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5">
                            <div
                                className={`h-1.5 rounded-full transition-all ${usagePct >= 90 ? 'bg-rose-500' : usagePct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${usagePct}%` }}
                            />
                        </div>
                    </div>
                )}
                {leadLimit === 0 && leadsUsed > 0 && (
                    <div className="mt-5 pt-5 border-t border-slate-100 text-xs text-slate-500 flex items-center gap-1.5">
                        <i className="fa-solid fa-infinity text-emerald-500" />
                        Unlimited leads — {fmt(leadsUsed)} in your workspace
                    </div>
                )}
            </div>

            {/* Modules */}
            {(() => {
                const mods = (ws?.activeModules || []).filter(id => WORKSPACE_MODULES.some(m => m.id === id));
                if (!mods.length) return null;
                return (
                    <div className="bg-white border border-slate-200 rounded-2xl p-5">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Modules included</p>
                        <div className="flex flex-wrap gap-2">
                            {mods.map(id => (
                                <span key={id} className="inline-flex items-center gap-1.5 text-xs font-medium bg-slate-100 text-slate-700 px-3 py-1 rounded-full">
                                    <i className="fa-solid fa-check text-emerald-500 text-[10px]" />
                                    {moduleLabel(id)}
                                </span>
                            ))}
                        </div>
                    </div>
                );
            })()}

            {/* Coupon code (trial extension) */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <p className="text-sm font-semibold text-slate-900 mb-1">Have a coupon code?</p>
                <p className="text-xs text-slate-500 mb-3">Enter a trial extension coupon to add more days to your plan.</p>
                <div className="flex gap-2 max-w-sm">
                    <input
                        value={couponCode}
                        onChange={e => setCouponCode(e.target.value.toUpperCase())}
                        onKeyDown={e => e.key === 'Enter' && handleApplyCoupon()}
                        placeholder="COUPON CODE"
                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                    <button
                        onClick={handleApplyCoupon}
                        disabled={couponBusy || !couponCode.trim()}
                        className="bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 transition">
                        {couponBusy ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Apply'}
                    </button>
                </div>
            </div>

            {/* Billing details */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <p className="text-sm font-semibold text-slate-900 mb-1">Billing details</p>
                <p className="text-xs text-slate-500 mb-4">Set your GST number and billing address to appear on your subscription invoices.</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">GST Number</label>
                        <input
                            type="text"
                            value={gstNumber}
                            onChange={e => setGstNumber(e.target.value.toUpperCase())}
                            placeholder="e.g. 07AAAAA0000A1Z5"
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 font-mono"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Billing Address</label>
                        <textarea
                            value={billingAddress}
                            onChange={e => setBillingAddress(e.target.value)}
                            placeholder="Your company's registered address"
                            rows={3}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                        />
                    </div>
                </div>
                
                <div className="mt-4 flex justify-end">
                    <button
                        onClick={handleSaveBillingDetails}
                        disabled={saveBusy}
                        className="bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 transition">
                        {saveBusy ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" /> : 'Save billing details'}
                    </button>
                </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
                <button onClick={() => navigate('/plans')}
                    className="bg-slate-900 hover:bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition flex items-center gap-2">
                    <i className="fa-solid fa-arrow-up-right-dots text-xs" />
                    Upgrade / change plan
                </button>
                {isActive && ws?.autoDebitEnabled && (
                    <button disabled={actionBusy} onClick={handleCancel}
                        className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 text-sm font-semibold px-4 py-2.5 rounded-lg disabled:opacity-40 transition">
                        Cancel autodebit
                    </button>
                )}
            </div>

            {/* Invoice history */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100">
                    <p className="text-sm font-semibold text-slate-900">Payment history</p>
                </div>
                {invoices.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                        <i className="fa-regular fa-file-lines text-3xl text-slate-300 mb-2 block" />
                        <p className="text-sm text-slate-400">No invoices yet. They appear here after your first charge.</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs uppercase text-slate-400 font-semibold tracking-wide border-b border-slate-100">
                                <th className="px-5 py-3">Date</th>
                                <th className="px-5 py-3">Amount</th>
                                <th className="px-5 py-3 hidden sm:table-cell">Period</th>
                                <th className="px-5 py-3 hidden md:table-cell">Method</th>
                                <th className="px-5 py-3 hidden lg:table-cell">Ref</th>
                                <th className="px-5 py-3 text-right">Invoice</th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv._id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                                    <td className="px-5 py-3 text-slate-700">{fmtDate(inv.paymentDate)}</td>
                                    <td className="px-5 py-3 font-semibold text-slate-900">₹{fmt(inv.amount)}</td>
                                    <td className="px-5 py-3 text-slate-500 text-xs hidden sm:table-cell">
                                        {fmtDate(inv.activationStart)} → {fmtDate(inv.activationEnd)}
                                    </td>
                                    <td className="px-5 py-3 text-slate-500 hidden md:table-cell capitalize">
                                        {inv.paymentMethod?.replace(/^razorpay_/, '') || '—'}
                                    </td>
                                    <td className="px-5 py-3 text-slate-400 font-mono text-xs hidden lg:table-cell">
                                        {inv.reference?.slice(0, 18) || '—'}
                                    </td>
                                    <td className="px-5 py-3 text-right">
                                        <button
                                            onClick={() => handleDownloadInvoice(inv._id)}
                                            disabled={downloadingId === inv._id}
                                            className="text-slate-500 hover:text-blue-600 transition disabled:opacity-40 p-1.5 hover:bg-slate-100 rounded-lg"
                                            title="Download Invoice"
                                        >
                                            {downloadingId === inv._id ? (
                                                <i className="fa-solid fa-spinner fa-spin text-sm" />
                                            ) : (
                                                <i className="fa-solid fa-file-pdf text-base" />
                                            )}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <p className="text-xs text-slate-400 text-center">
                Secure payments by Razorpay. All amounts in INR.
            </p>
        </div>
    );
};

export default Billing;
