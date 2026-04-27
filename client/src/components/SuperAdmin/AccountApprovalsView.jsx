/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const statusColors = {
    pending:  { bg: 'bg-amber-100',  text: 'text-amber-700',  border: 'border-amber-300',  dot: 'bg-amber-500'  },
    approved: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300', dot: 'bg-emerald-500' },
    rejected: { bg: 'bg-red-100',    text: 'text-red-700',    border: 'border-red-300',    dot: 'bg-red-500'    },
};

const AccountCard = ({ account, onApprove, onReject, onDeactivate, showActions }) => {
    const [loading, setLoading] = useState(false);
    const sc = statusColors[account.status] || statusColors.pending;

    const handle = async (action) => {
        setLoading(true);
        try { await action(); } finally { setLoading(false); }
    };

    return (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    {/* Avatar */}
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                        {(account.companyName || account.name || '?')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <h3 className="font-semibold text-slate-800 truncate">
                            {account.companyName || account.name}
                        </h3>
                        <p className="text-sm text-slate-500 truncate">{account.email}</p>
                        {account.phone && (
                            <p className="text-xs text-slate-400">{account.phone}</p>
                        )}
                    </div>
                </div>

                {/* Status Badge */}
                <span className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${sc.bg} ${sc.text} ${sc.border}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                    {account.status?.charAt(0).toUpperCase() + account.status?.slice(1)}
                </span>
            </div>

            {/* Meta info */}
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">
                {account.agencyName && (
                    <span className="flex items-center gap-1">
                        <i className="fa-solid fa-network-wired text-purple-400" />
                        {account.agencyName}
                    </span>
                )}
                <span className="flex items-center gap-1">
                    <i className="fa-solid fa-user-tag text-slate-400" />
                    {account.role === 'agency' ? 'Agency' : 'Direct Client'}
                </span>
                {account.agentCount !== undefined && (
                    <span className="flex items-center gap-1">
                        <i className="fa-solid fa-users text-slate-400" />
                        {account.agentCount} agent{account.agentCount !== 1 ? 's' : ''}
                    </span>
                )}
                <span className="flex items-center gap-1 ml-auto">
                    <i className="fa-regular fa-clock text-slate-400" />
                    {new Date(account.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
            </div>

            {/* Action Buttons */}
            {showActions && (
                <div className="mt-4 flex gap-2 pt-3 border-t border-slate-100">
                    {onApprove && (
                        <button
                            onClick={() => handle(onApprove)}
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium transition disabled:opacity-50"
                        >
                            <i className="fa-solid fa-check" />
                            Approve
                        </button>
                    )}
                    {onReject && (
                        <button
                            onClick={() => handle(onReject)}
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition disabled:opacity-50"
                        >
                            <i className="fa-solid fa-times" />
                            Reject
                        </button>
                    )}
                    {onDeactivate && (
                        <button
                            onClick={() => handle(onDeactivate)}
                            disabled={loading}
                            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium transition disabled:opacity-50"
                        >
                            <i className="fa-solid fa-ban" />
                            Deactivate
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const AccountApprovalsView = () => {
    const [activeTab, setActiveTab] = useState('pending');
    const [accounts, setAccounts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [counts, setCounts] = useState({ pending: 0, active: 0, rejected: 0 });
    const [search, setSearch] = useState('');
    const [toast, setToast] = useState(null);

    const showToast = (message, type = 'success') => {
        setToast({ message, type });
        setTimeout(() => setToast(null), 3500);
    };

    const fetchCounts = useCallback(async () => {
        try {
            const [p, a, r] = await Promise.all([
                api.get(`/superadmin/accounts/pending`),
                api.get(`/superadmin/accounts/active`),
                api.get(`/superadmin/accounts/rejected`),
            ]);
            setCounts({ pending: p.data.total, active: a.data.total, rejected: r.data.total });
        } catch (err) { console.error('Failed to load account counts:', err.message); }
    }, []);

    const fetchAccounts = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`/superadmin/accounts/${activeTab}`);
            setAccounts(res.data.accounts || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => { fetchAccounts(); fetchCounts(); }, [activeTab]);

    const handleAction = async (id, action) => {
        try {
            const res = await api.put(`/superadmin/accounts/${id}/${action}`);
            showToast(res.data.message);
            fetchAccounts();
            fetchCounts();
        } catch (err) {
            showToast(err.response?.data?.message || 'Action failed', 'error');
        }
    };

    const filtered = accounts.filter(a =>
        !search ||
        (a.companyName || a.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (a.email || '').toLowerCase().includes(search.toLowerCase()) ||
        (a.agencyName || '').toLowerCase().includes(search.toLowerCase())
    );

    const tabs = [
        { id: 'pending',  label: 'Pending',  icon: 'fa-hourglass-half', color: 'text-amber-600',  count: counts.pending  },
        { id: 'active',   label: 'Active',   icon: 'fa-circle-check',   color: 'text-emerald-600', count: counts.active   },
        { id: 'rejected', label: 'Rejected', icon: 'fa-circle-xmark',   color: 'text-red-500',     count: counts.rejected },
    ];

    return (
        <div className="space-y-6">
            {/* Toast */}
            {toast && (
                <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-medium flex items-center gap-2 transition-all ${
                    toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'
                }`}>
                    <i className={`fa-solid ${toast.type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}`} />
                    {toast.message}
                </div>
            )}

            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-800">Account Approvals</h1>
                <p className="text-slate-500 mt-1">Approve, reject, or deactivate client accounts. You have full control.</p>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 gap-4">
                {tabs.map(tab => (
                    <div key={tab.id} className={`bg-white rounded-xl border p-4 cursor-pointer transition-all ${activeTab === tab.id ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}
                        onClick={() => setActiveTab(tab.id)}>
                        <div className={`text-2xl font-bold ${tab.color}`}>{tab.count}</div>
                        <div className="text-sm text-slate-600 mt-0.5 flex items-center gap-1.5">
                            <i className={`fa-solid ${tab.icon} ${tab.color} text-xs`} />
                            {tab.label} {tab.label === 'Pending' ? 'Requests' : 'Accounts'}
                        </div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="flex items-center justify-between">
                <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                activeTab === tab.id 
                                    ? 'bg-white text-slate-900 shadow-sm' 
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <i className={`fa-solid ${tab.icon} ${activeTab === tab.id ? tab.color : ''}`} />
                            {tab.label}
                            {tab.count > 0 && (
                                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
                {/* Search */}
                <div className="relative">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                    <input
                        type="text"
                        placeholder="Search accounts..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 w-56"
                    />
                </div>
            </div>

            {/* Accounts Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20 text-slate-400">
                    <i className={`fa-solid ${tabs.find(t => t.id === activeTab)?.icon} text-5xl mb-3 block opacity-30`} />
                    <p className="font-medium">No {activeTab} accounts</p>
                    {activeTab === 'pending' && <p className="text-sm mt-1">When agencies create client accounts, they'll appear here.</p>}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map(account => (
                        <AccountCard
                            key={account._id}
                            account={account}
                            showActions={true}
                            onApprove={activeTab === 'pending' || activeTab === 'rejected' ? () => handleAction(account._id, 'approve') : null}
                            onReject={activeTab === 'pending' ? () => handleAction(account._id, 'reject') : null}
                            onDeactivate={activeTab === 'active' ? () => handleAction(account._id, 'deactivate') : null}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

export default AccountApprovalsView;
