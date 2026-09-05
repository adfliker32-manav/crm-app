/* eslint-disable no-unused-vars */
import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { formatMoney } from '../../utils/currency';

const PartnerBillingTab = ({ partner, onRefresh }) => {
    const { showSuccess, showError } = useNotification();
    const [generating, setGenerating] = useState(false);
    const [monthInput, setMonthInput] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    const bills = [...(partner.billingHistory || [])].sort((a, b) => b.month.localeCompare(a.month));

    const handleGenerateBill = async () => {
        if (!monthInput) return showError('Select a month');
        setGenerating(true);
        try {
            const res = await api.post(`/superadmin/partner-apps/${partner._id}/generate-bill`, { month: monthInput });
            showSuccess(res.data.message || 'Bill generated!');
            onRefresh();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to generate bill');
        } finally {
            setGenerating(false);
        }
    };

    const handleMarkPaid = async (billId) => {
        try {
            await api.put(`/superadmin/partner-apps/${partner._id}/billing/${billId}/mark-paid`);
            showSuccess('Bill marked as paid');
            onRefresh();
        } catch { showError('Failed to mark bill as paid'); }
    };

    const totalRevenue = bills.filter(b => b.status === 'paid').reduce((sum, b) => sum + b.amount, 0);
    const pendingAmount = bills.filter(b => b.status === 'due').reduce((sum, b) => sum + b.amount, 0);
    // The partner's CURRENT currency, for live figures. Historical rows carry
    // their own frozen `currency` and are formatted with that instead.
    const cur = partner.currency || 'INR';

    const handleMarkDue = async (billId) => {
        try {
            await api.put(`/superadmin/partner-apps/${partner._id}/billing/${billId}/mark-due`);
            showSuccess('Bill reopened as due');
            onRefresh();
        } catch { showError('Failed to reopen bill'); }
    };

    return (
        <div className="space-y-6">
            {/* Summary */}
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm text-slate-500">
                        Pricing: <span className="font-bold text-slate-900">{formatMoney(partner.pricePerAccount || 0, cur)}</span> per active account / month
                    </p>
                </div>
                <div className="flex items-center gap-4 text-sm">
                    <span className="text-slate-500">Total Paid: <span className="font-bold text-emerald-600">{formatMoney(totalRevenue, cur)}</span></span>
                    {pendingAmount > 0 && (
                        <span className="text-slate-500">Pending: <span className="font-bold text-amber-600">{formatMoney(pendingAmount, cur)}</span></span>
                    )}
                </div>
            </div>

            {/* Generate Bill */}
            <div className="bg-slate-50 rounded-xl p-4 flex items-center gap-4">
                <i className="fa-solid fa-file-invoice text-cyan-500 text-lg" />
                <div className="flex-1">
                    <p className="font-semibold text-sm text-slate-700">Generate Monthly Bill</p>
                    <p className="text-xs text-slate-400">Snapshot active accounts × rate for the selected month</p>
                </div>
                <input
                    type="month"
                    value={monthInput}
                    onChange={e => setMonthInput(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <button
                    onClick={handleGenerateBill}
                    disabled={generating}
                    className="px-5 py-2 bg-cyan-600 text-white rounded-lg font-semibold text-sm hover:bg-cyan-700 transition disabled:opacity-50"
                >
                    {generating ? <i className="fa-solid fa-spinner fa-spin" /> : 'Generate Bill'}
                </button>
            </div>

            {/* Billing History Table */}
            {bills.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                    <i className="fa-solid fa-file-invoice-dollar text-3xl mb-2" />
                    <p>No bills generated yet</p>
                </div>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Month</th>
                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Invoice</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">Active Accounts</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">Rate</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">Amount</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">Status</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {bills.map(bill => (
                            <tr key={bill._id} className="border-b border-slate-100">
                                <td className="py-3 px-3 font-medium text-slate-900">
                                    {new Date(bill.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                                </td>
                                <td className="py-3 px-3 text-xs font-mono text-slate-500">{bill.invoiceNumber || '—'}</td>
                                <td className="py-3 px-3 text-center text-slate-700">{bill.activeAccounts}</td>
                                {/* Historical rows format with the currency frozen at
                                    generation, so switching the partner's currency
                                    later cannot silently restate old invoices. */}
                                <td className="py-3 px-3 text-center text-slate-700">{formatMoney(bill.rate, bill.currency || cur)}</td>
                                <td className="py-3 px-3 text-center font-bold text-slate-900">{formatMoney(bill.amount, bill.currency || cur)}</td>
                                <td className="py-3 px-3 text-center">
                                    {bill.status === 'paid' ? (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                                            <i className="fa-solid fa-check text-[10px]" /> Paid
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-semibold">
                                            <i className="fa-solid fa-clock text-[10px]" /> Due
                                        </span>
                                    )}
                                </td>
                                <td className="py-3 px-3 text-center">
                                    {bill.status === 'due' && (
                                        <button
                                            onClick={() => handleMarkPaid(bill._id)}
                                            className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold hover:bg-emerald-700 transition"
                                        >
                                            Mark Paid
                                        </button>
                                    )}
                                    {bill.status === 'paid' && (
                                        <div className="flex flex-col items-center gap-1">
                                            <span className="text-xs text-slate-400">
                                                {bill.paidAt && new Date(bill.paidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                {bill.paidByName && ` · ${bill.paidByName}`}
                                            </span>
                                            {/* Marking paid used to be a one-way door — a
                                                mis-click could only be undone in the DB. */}
                                            <button
                                                onClick={() => handleMarkDue(bill._id)}
                                                className="text-[11px] text-slate-400 hover:text-amber-600 underline"
                                            >
                                                Reopen
                                            </button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default PartnerBillingTab;
