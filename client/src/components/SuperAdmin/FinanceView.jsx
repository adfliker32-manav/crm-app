import React, { useState, useEffect, useCallback } from 'react';
import { Line, Bar } from 'react-chartjs-2';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
    BarElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import RecordPaymentModal from './RecordPaymentModal';
import RecordExpenseModal from './RecordExpenseModal';
import AutodebitView from './AutodebitView';
import AgencyFinanceView from './AgencyFinanceView';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler);

const fmtINR = (n) => `₹${(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

// ────────────────────────────────────────────── OVERVIEW TAB ──────────────────────────────────────────────
const OverviewTab = ({ summary, chart, renewalsDueSoon, topClients, trialsExpiringSoon, trialDays, onRecordPayment, autodebitStats }) => {
    const s = summary || {};

    const chartData = chart ? {
        labels: chart.labels,
        datasets: [
            { label: 'Revenue', data: chart.revenue, backgroundColor: 'rgba(16, 185, 129, 0.8)',  borderColor: '#10B981', borderWidth: 2, borderRadius: 6 },
            { label: 'Expense', data: chart.expense, backgroundColor: 'rgba(244, 63, 94, 0.6)',   borderColor: '#F43F5E', borderWidth: 2, borderRadius: 6 }
        ]
    } : null;

    const profitData = chart ? {
        labels: chart.labels,
        datasets: [{
            label: 'Net Profit',
            data: chart.profit,
            borderColor: '#6366F1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            tension: 0.4, fill: true, pointRadius: 0, pointHoverRadius: 5
        }]
    } : null;

    const chartOpts = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top' } },
        scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 } } },
            y: { ticks: { font: { size: 10 }, callback: v => `₹${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}` } }
        }
    };

    // Build the "This Month" label dynamically so users see e.g. "May 2026 Revenue"
    const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    return (
        <div className="space-y-6">
            {/* ── HERO ROW 1: THIS MONTH (the operating cockpit) ── */}
            <div>
                <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">{monthLabel} · This Month</h2>
                    <span className="text-[10px] text-slate-400 font-medium">From day 1 of the month to today</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <MetricCard
                        label={`${monthLabel} Revenue`}
                        value={fmtINR(s.thisMonthRevenue)}
                        sub={s.lastMonthDelta !== undefined ? (
                            <span className={s.lastMonthDelta >= 0 ? 'text-emerald-200' : 'text-red-200'}>
                                <i className={`fa-solid ${s.lastMonthDelta >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'} mr-1`} />
                                {Math.abs(s.lastMonthDelta)}% vs last month
                            </span>
                        ) : 'No prior month'}
                        icon="fa-arrow-trend-up"
                        gradient="from-emerald-500 to-emerald-600" />
                    <MetricCard
                        label={`${monthLabel} Expenses`}
                        value={fmtINR(s.thisMonthExpense)}
                        sub={s.thisMonthRevenue > 0 ?
                            `${Math.round((s.thisMonthExpense / s.thisMonthRevenue) * 100)}% of monthly revenue`
                            : 'No revenue this month'}
                        icon="fa-receipt"
                        gradient="from-rose-500 to-rose-600" />
                    <MetricCard
                        label={`${monthLabel} Net Profit`}
                        value={fmtINR(s.thisMonthProfit)}
                        sub={s.thisMonthProfit >= 0 ? 'Profitable this month' : 'Operating at a loss'}
                        icon="fa-sack-dollar"
                        gradient="from-indigo-500 to-purple-600" />
                </div>
            </div>

            {/* ── HERO ROW 2: LIFETIME + GROWTH (the long-view metrics) ── */}
            <div>
                <div className="flex items-baseline justify-between mb-3">
                    <h2 className="text-sm font-black uppercase tracking-widest text-slate-500">Lifetime &amp; Trends</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <MetricCard label="Lifetime Revenue" value={fmtINR(s.lifetimeRevenue)}
                        sub={`${s.lifetimePaymentsCount || 0} payment${s.lifetimePaymentsCount === 1 ? '' : 's'} recorded`}
                        icon="fa-coins" gradient="from-emerald-600 to-teal-700" />
                    <MetricCard label="Lifetime Net Profit" value={fmtINR(s.netProfit)}
                        sub={`Lifetime Expenses: ${fmtINR(s.lifetimeExpense)}`}
                        icon="fa-piggy-bank" gradient="from-indigo-600 to-purple-700" />
                    <MetricCard label="Avg Monthly Revenue" value={fmtINR(s.avgMonthlyRevenue)}
                        sub="6-month rolling avg" icon="fa-chart-line"
                        gradient="from-blue-500 to-blue-600" />
                    <MetricCard label="Paying Clients" value={(s.payingClients || 0).toLocaleString()}
                        sub={`ARPU: ${fmtINR(s.arpu)} / month`}
                        icon="fa-users" gradient="from-purple-500 to-fuchsia-600" />
                </div>
            </div>

            {/* Secondary metric strip — quick-reference small stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <SmallStat label="Last Month Rev"  value={fmtINR(s.lastMonthRevenue)} count="completed cycle" color="text-emerald-600" icon="fa-calendar-day" />
                <SmallStat label="Total Trials"    value={(s.trialsActive || 0).toLocaleString()} count={`${trialDays || 14}-day free trial`} color="text-amber-600" icon="fa-gift" />
                <SmallStat label="Avg Per Payment" value={fmtINR(s.lifetimePaymentsCount > 0 ? Math.round(s.lifetimeRevenue / s.lifetimePaymentsCount) : 0)} count="across all payments" color="text-slate-700" icon="fa-divide" />
                <SmallStat label="Profit Margin"   value={s.lifetimeRevenue > 0 ? `${Math.round((s.netProfit / s.lifetimeRevenue) * 100)}%` : '—'} count="net / revenue lifetime" color="text-indigo-600" icon="fa-percent" />
                <SmallStat label="Autodebit MRR"   value={fmtINR(autodebitStats?.mrr || 0)} count={`${autodebitStats?.activeMandates || 0} mandates · ${autodebitStats?.inGrace || 0} failing`} color="text-blue-600" icon="fa-bolt" />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-6">
                    <h3 className="text-base font-black text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-column text-emerald-600" />Revenue vs Expenses
                    </h3>
                    <div className="h-64">{chartData && <Bar data={chartData} options={chartOpts} />}</div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 p-6">
                    <h3 className="text-base font-black text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-arrow-trend-up text-indigo-600" />Net Profit Trend
                    </h3>
                    <div className="h-64">{profitData && <Line data={profitData} options={chartOpts} />}</div>
                </div>
            </div>

            {/* Trials expiring — only render if there are any to chase */}
            {trialsExpiringSoon && trialsExpiringSoon.length > 0 && (
                <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-amber-100 bg-amber-50/50 flex justify-between items-center">
                        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-gift text-amber-600" />Free Trials Ending in Next 7 Days
                        </h3>
                        <span className="text-xs font-bold bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full">{trialsExpiringSoon.length}</span>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                        {trialsExpiringSoon.map(t => {
                            const days = Math.max(0, Math.ceil((new Date(t.trialExpiresAt) - Date.now()) / (24*60*60*1000)));
                            return (
                                <div key={t._id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50">
                                    <div className="min-w-0">
                                        <div className="font-bold text-sm text-slate-800 truncate">{t.clientName || 'Unknown'}</div>
                                        <div className="text-[11px] text-slate-500 truncate">{t.clientEmail}</div>
                                    </div>
                                    <div className="flex items-center gap-3 ml-2">
                                        <div className="text-right">
                                            <div className={`text-[11px] font-black ${days <= 2 ? 'text-red-600' : 'text-amber-600'}`}>
                                                {days === 0 ? 'Expires today' : `${days}d left`}
                                            </div>
                                            <div className="text-[10px] text-slate-400">{fmtDate(t.trialExpiresAt)}</div>
                                        </div>
                                        <button
                                            onClick={() => onRecordPayment({ _id: t._id, companyName: t.clientName, email: t.clientEmail })}
                                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg">
                                            Convert
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Renewals + Top Clients */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-hourglass-half text-amber-600" />Renewals Due (next 30 days)
                        </h3>
                        <span className="text-xs font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">{renewalsDueSoon?.length || 0}</span>
                    </div>
                    <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                        {(!renewalsDueSoon || renewalsDueSoon.length === 0) ? (
                            <div className="p-6 text-center text-sm text-slate-400">
                                <i className="fa-regular fa-calendar-check text-2xl mb-2 block" />
                                No renewals due in the next 30 days.
                            </div>
                        ) : renewalsDueSoon.map(r => {
                            const days = Math.ceil((new Date(r.latestExpiry) - Date.now()) / (24*60*60*1000));
                            const urgent = days <= 7;
                            return (
                                <div key={r._id} className="px-6 py-3 flex items-center justify-between hover:bg-slate-50">
                                    <div className="min-w-0">
                                        <div className="font-bold text-sm text-slate-800 truncate">{r.clientName || 'Unknown'}</div>
                                        <div className="text-[11px] text-slate-500 truncate">{r.clientEmail}</div>
                                    </div>
                                    <div className="text-right ml-2 flex items-center gap-2">
                                        <div>
                                            <div className={`text-[11px] font-black ${urgent ? 'text-red-600' : 'text-amber-600'}`}>
                                                {days <= 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d left`}
                                            </div>
                                            <div className="text-[10px] text-slate-400">{fmtDate(r.latestExpiry)}</div>
                                        </div>
                                        <button onClick={() => onRecordPayment({ _id: r._id, companyName: r.clientName, email: r.clientEmail })}
                                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg">
                                            Renew
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-100">
                        <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-trophy text-amber-500" />Top Paying Clients
                        </h3>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {(!topClients || topClients.length === 0) ? (
                            <div className="p-6 text-center text-sm text-slate-400">No payments yet.</div>
                        ) : topClients.map((c, idx) => (
                            <div key={c._id} className="px-6 py-3 flex items-center gap-3 hover:bg-slate-50">
                                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0
                                    ${idx === 0 ? 'bg-amber-500 text-white' : idx === 1 ? 'bg-slate-400 text-white' : idx === 2 ? 'bg-amber-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                    {idx + 1}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm text-slate-800 truncate">{c.clientName || 'Unknown'}</div>
                                    <div className="text-[11px] text-slate-500 truncate">{c.payments} payment{c.payments === 1 ? '' : 's'} · {c.clientEmail}</div>
                                </div>
                                <div className="font-black text-emerald-600 text-sm">{fmtINR(c.total)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ────────────────────────────────────────────── PAYMENTS TAB ──────────────────────────────────────────────
const PaymentsTab = ({ payments, loading, onDelete, onRecord }) => (
    <div className="space-y-4">
        <div className="flex justify-between items-center">
            <p className="text-sm text-slate-500">{payments.length} payment{payments.length === 1 ? '' : 's'} recorded</p>
            <button onClick={onRecord}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-600/20">
                <i className="fa-solid fa-plus text-xs" />Record Payment
            </button>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    <tr>
                        <th className="px-4 py-3">Client</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Duration</th>
                        <th className="px-4 py-3">Active Period</th>
                        <th className="px-4 py-3">Method</th>
                        <th className="px-4 py-3">Recorded</th>
                        <th className="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan="7" className="p-10 text-center text-slate-400"><i className="fa-solid fa-spinner fa-spin text-2xl" /></td></tr>
                    ) : payments.length === 0 ? (
                        <tr><td colSpan="7" className="p-10 text-center text-slate-400">
                            <i className="fa-regular fa-folder-open text-2xl mb-2 block" />No payments recorded yet.
                        </td></tr>
                    ) : payments.map(p => {
                        const expired = new Date(p.activationEnd) < new Date();
                        return (
                            <tr key={p._id} className="hover:bg-slate-50">
                                <td className="px-4 py-3">
                                    <div className="font-bold text-sm text-slate-800">{p.clientName}</div>
                                    <div className="text-[11px] text-slate-500">{p.clientEmail}</div>
                                </td>
                                <td className="px-4 py-3 font-black text-emerald-600">{fmtINR(p.amount)}</td>
                                <td className="px-4 py-3 text-sm">{p.durationMonths} mo</td>
                                <td className="px-4 py-3 text-[11px]">
                                    <div className="text-slate-700">{fmtDate(p.activationStart)} → {fmtDate(p.activationEnd)}</div>
                                    {expired && <div className="text-rose-600 font-bold">expired</div>}
                                </td>
                                <td className="px-4 py-3 text-xs">
                                    <div className="flex flex-col gap-1 items-start">
                                        <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-full font-bold">
                                            {p.paymentMethod}
                                        </span>
                                        {p.gateway === 'cashfree' ? (
                                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold text-[9px] uppercase">
                                                <i className="fa-solid fa-bolt mr-1" />Autodebit
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 bg-slate-50 text-slate-500 rounded-full font-bold text-[9px] uppercase border border-slate-200">
                                                Manual
                                            </span>
                                        )}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-[11px] text-slate-500">{fmtDate(p.paymentDate)}</td>
                                <td className="px-4 py-3 text-right">
                                    <button onClick={() => onDelete(p)}
                                        className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200">
                                        <i className="fa-solid fa-trash text-[10px]" />
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    </div>
);

// ────────────────────────────────────────────── EXPENSES TAB ──────────────────────────────────────────────
const EXPENSE_CAT_COLORS = {
    infrastructure: 'bg-blue-100 text-blue-700',
    salary:         'bg-purple-100 text-purple-700',
    marketing:      'bg-orange-100 text-orange-700',
    tools:          'bg-emerald-100 text-emerald-700',
    legal:          'bg-slate-200 text-slate-700',
    taxes:          'bg-rose-100 text-rose-700',
    office:         'bg-amber-100 text-amber-700',
    other:          'bg-slate-100 text-slate-600'
};

const ExpensesTab = ({ expenses, loading, onDelete, onRecord }) => (
    <div className="space-y-4">
        <div className="flex justify-between items-center">
            <p className="text-sm text-slate-500">{expenses.length} expense{expenses.length === 1 ? '' : 's'} recorded</p>
            <button onClick={onRecord}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-lg shadow-rose-600/20">
                <i className="fa-solid fa-plus text-xs" />Record Expense
            </button>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <table className="w-full text-left">
                <thead className="bg-slate-50 text-[10px] font-black text-slate-500 uppercase tracking-wider">
                    <tr>
                        <th className="px-4 py-3">Description</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Vendor</th>
                        <th className="px-4 py-3">Amount</th>
                        <th className="px-4 py-3">Date</th>
                        <th className="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan="6" className="p-10 text-center text-slate-400"><i className="fa-solid fa-spinner fa-spin text-2xl" /></td></tr>
                    ) : expenses.length === 0 ? (
                        <tr><td colSpan="6" className="p-10 text-center text-slate-400">
                            <i className="fa-regular fa-folder-open text-2xl mb-2 block" />No expenses recorded yet.
                        </td></tr>
                    ) : expenses.map(e => (
                        <tr key={e._id} className="hover:bg-slate-50">
                            <td className="px-4 py-3">
                                <div className="font-bold text-sm text-slate-800">{e.description}</div>
                                {e.notes && <div className="text-[11px] text-slate-500 truncate max-w-[200px]">{e.notes}</div>}
                            </td>
                            <td className="px-4 py-3">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${EXPENSE_CAT_COLORS[e.category] || EXPENSE_CAT_COLORS.other}`}>
                                    {e.category}
                                </span>
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600">{e.vendor || '—'}</td>
                            <td className="px-4 py-3 font-black text-rose-600">{fmtINR(e.amount)}</td>
                            <td className="px-4 py-3 text-[11px] text-slate-500">{fmtDate(e.date)}</td>
                            <td className="px-4 py-3 text-right">
                                <button onClick={() => onDelete(e)}
                                    className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-red-600 hover:border-red-200">
                                    <i className="fa-solid fa-trash text-[10px]" />
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

// ────────────────────────────────────────────── PARENT VIEW ──────────────────────────────────────────────
const FinanceView = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [tab, setTab] = useState('overview');
    const [loading, setLoading] = useState(true);

    const [summary, setSummary] = useState({});
    const [chart, setChart] = useState(null);
    const [renewalsDueSoon, setRenewalsDueSoon] = useState([]);
    const [topClients, setTopClients] = useState([]);
    const [trialsExpiringSoon, setTrialsExpiringSoon] = useState([]);
    const [trialDays, setTrialDays] = useState(14);
    const [autodebitStats, setAutodebitStats] = useState({ mrr: 0, activeMandates: 0, inGrace: 0 });

    const [payments, setPayments] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [tabLoading, setTabLoading] = useState(false);

    const [payModalOpen, setPayModalOpen] = useState(false);
    const [expModalOpen, setExpModalOpen] = useState(false);
    const [preselectedClient, setPreselectedClient] = useState(null);

    const fetchOverview = useCallback(async () => {
        setLoading(true);
        try {
            const [summaryRes, subsRes] = await Promise.all([
                api.get('/superadmin/finance/summary'),
                // Autodebit stats are a side-fetch — failure shouldn't block the main overview
                api.get('/billing/superadmin/subscriptions').catch(() => ({ data: { subscriptions: [] } }))
            ]);
            if (summaryRes.data?.success) {
                setSummary(summaryRes.data.summary || {});
                setChart(summaryRes.data.chart || null);
                setRenewalsDueSoon(summaryRes.data.renewalsDueSoon || []);
                setTopClients(summaryRes.data.topClients || []);
                setTrialsExpiringSoon(summaryRes.data.trialsExpiringSoon || []);
                if (summaryRes.data.trialDays) setTrialDays(summaryRes.data.trialDays);
            }
            const subs = subsRes.data?.subscriptions || [];
            const active = subs.filter(s => s.status === 'active');
            const mrr = active.reduce((sum, s) =>
                sum + (s.billingCycle === 'yearly' ? (s.amount / 12) : s.amount), 0);
            setAutodebitStats({
                mrr: Math.round(mrr),
                activeMandates: active.length,
                inGrace: subs.filter(s => s.status === 'grace').length
            });
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchPayments = useCallback(async () => {
        setTabLoading(true);
        try {
            const res = await api.get('/superadmin/finance/payments?limit=200');
            setPayments(res.data?.payments || []);
        } catch (e) { console.error(e); }
        finally { setTabLoading(false); }
    }, []);

    const fetchExpenses = useCallback(async () => {
        setTabLoading(true);
        try {
            const res = await api.get('/superadmin/finance/expenses?limit=200');
            setExpenses(res.data?.expenses || []);
        } catch (e) { console.error(e); }
        finally { setTabLoading(false); }
    }, []);

    useEffect(() => { fetchOverview(); }, [fetchOverview]);
    useEffect(() => {
        if (tab === 'payments') fetchPayments();
        if (tab === 'expenses') fetchExpenses();
    }, [tab, fetchPayments, fetchExpenses]);

    const handleDeletePayment = async (p) => {
        const ok = await showDanger(
            `Delete the ₹${p.amount.toLocaleString('en-IN')} payment from ${p.clientName}? This also rolls back the plan extension it granted — the client's access is reduced accordingly, and becomes read-only if no paid time remains.`,
            'Delete payment & roll back plan?'
        );
        if (!ok) return;
        try {
            const res = await api.delete(`/superadmin/finance/payments/${p._id}`);
            showSuccess(res.data?.message || 'Payment record removed.');
            fetchPayments();
            fetchOverview();
        } catch (e) {
            showError(e.response?.data?.message || 'Failed to delete payment.');
        }
    };

    const handleDeleteExpense = async (e) => {
        const ok = await showDanger(`Delete expense "${e.description}" (₹${e.amount.toLocaleString('en-IN')})?`, 'Delete expense?');
        if (!ok) return;
        try {
            await api.delete(`/superadmin/finance/expenses/${e._id}`);
            showSuccess('Expense removed.');
            fetchExpenses();
            fetchOverview();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to delete expense.');
        }
    };

    const handlePaymentRecorded = (data) => {
        showSuccess(data?.message || 'Payment recorded.');
        fetchOverview();
        if (tab === 'payments') fetchPayments();
        setPreselectedClient(null);
    };

    const handleExpenseRecorded = () => {
        showSuccess('Expense recorded.');
        fetchOverview();
        if (tab === 'expenses') fetchExpenses();
    };

    const tabs = [
        { id: 'overview',  label: 'Overview',  icon: 'fa-chart-pie',          color: 'text-indigo-600' },
        { id: 'payments',  label: 'Payments',  icon: 'fa-indian-rupee-sign',  color: 'text-emerald-600' },
        { id: 'autodebit', label: 'Autodebit', icon: 'fa-credit-card',        color: 'text-blue-600' },
        { id: 'expenses',  label: 'Expenses',  icon: 'fa-receipt',            color: 'text-rose-600' },
        { id: 'agency',    label: 'My Agency', icon: 'fa-briefcase',          color: 'text-violet-600' }
    ];

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-3">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">Finance Manager</h1>
                    <p className="text-slate-500 mt-1">Track payments, expenses, and platform-wide profitability.</p>
                </div>
                {tab !== 'agency' && (
                    <div className="flex items-center gap-2">
                        <button onClick={() => { setPreselectedClient(null); setPayModalOpen(true); }}
                            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl flex items-center gap-2 shadow-md">
                            <i className="fa-solid fa-plus text-xs" />Record Payment
                        </button>
                        <button onClick={() => setExpModalOpen(true)}
                            className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-bold rounded-xl flex items-center gap-2 shadow-sm">
                            <i className="fa-solid fa-receipt text-xs" />Add Expense
                        </button>
                        <button onClick={fetchOverview}
                            className="w-10 h-10 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl flex items-center justify-center text-slate-500 shadow-sm">
                            <i className={`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`} />
                        </button>
                    </div>
                )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
                {tabs.map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition
                            ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                        <i className={`fa-solid ${t.icon} ${tab === t.id ? t.color : ''}`} />
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Body */}
            {tab === 'agency' ? (
                <AgencyFinanceView />
            ) : loading && tab === 'overview' ? (
                <div className="flex items-center justify-center h-72">
                    <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400" />
                </div>
            ) : tab === 'overview' ? (
                <OverviewTab
                    summary={summary} chart={chart}
                    renewalsDueSoon={renewalsDueSoon} topClients={topClients}
                    trialsExpiringSoon={trialsExpiringSoon} trialDays={trialDays}
                    autodebitStats={autodebitStats}
                    onRecordPayment={(c) => { setPreselectedClient(c); setPayModalOpen(true); }}
                />
            ) : tab === 'payments' ? (
                <PaymentsTab payments={payments} loading={tabLoading}
                    onDelete={handleDeletePayment}
                    onRecord={() => { setPreselectedClient(null); setPayModalOpen(true); }} />
            ) : tab === 'autodebit' ? (
                <AutodebitView />
            ) : (
                <ExpensesTab expenses={expenses} loading={tabLoading}
                    onDelete={handleDeleteExpense}
                    onRecord={() => setExpModalOpen(true)} />
            )}

            {/* Modals */}
            <RecordPaymentModal
                isOpen={payModalOpen}
                onClose={() => { setPayModalOpen(false); setPreselectedClient(null); }}
                onSuccess={handlePaymentRecorded}
                preselectedClient={preselectedClient}
            />
            <RecordExpenseModal
                isOpen={expModalOpen}
                onClose={() => setExpModalOpen(false)}
                onSuccess={handleExpenseRecorded}
            />
        </div>
    );
};

// ────────── small components ──────────
const MetricCard = ({ label, value, sub, icon, gradient }) => (
    <div className={`bg-gradient-to-br ${gradient} rounded-2xl shadow-lg p-5 text-white hover:scale-[1.02] transition-transform`}>
        <div className="flex justify-between items-start mb-2">
            <p className="text-white/80 text-xs font-bold uppercase tracking-wider">{label}</p>
            <div className="bg-white/20 w-9 h-9 rounded-lg flex items-center justify-center">
                <i className={`fa-solid ${icon} text-sm`} />
            </div>
        </div>
        <h3 className="text-3xl font-black mb-1">{value}</h3>
        {sub && <p className="text-white/80 text-xs font-medium">{sub}</p>}
    </div>
);

const SmallStat = ({ label, value, count, color, icon }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center ${color}`}>
            <i className={`fa-solid ${icon} text-sm`} />
        </div>
        <div className="min-w-0">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider truncate">{label}</div>
            <div className={`text-base font-black ${color} truncate`}>{value}</div>
            <div className="text-[10px] text-slate-400 truncate">{count}</div>
        </div>
    </div>
);

export default FinanceView;
