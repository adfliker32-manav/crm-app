/* eslint-disable no-unused-vars */
import React, { useState, useMemo } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const PartnerAccountsTab = ({ partner, onRefresh }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [menuOpen, setMenuOpen] = useState(null);

    const accounts = partner.accounts || [];

    const filtered = useMemo(() => {
        let list = accounts;
        if (filter === 'active') list = list.filter(a => a.status === 'Active');
        if (filter === 'frozen') list = list.filter(a => a.status === 'Frozen');
        if (search) {
            const q = search.toLowerCase();
            list = list.filter(a =>
                a.name?.toLowerCase().includes(q) ||
                a.email?.toLowerCase().includes(q) ||
                a.companyName?.toLowerCase().includes(q)
            );
        }
        return list;
    }, [accounts, search, filter]);

    const handleFreeze = async (accountId) => {
        try {
            await api.put(`/superadmin/partner-apps/${partner._id}/accounts/${accountId}/freeze`);
            showSuccess('Account frozen');
            onRefresh();
        } catch { showError('Failed to freeze account'); }
        setMenuOpen(null);
    };

    const handleUnfreeze = async (accountId) => {
        try {
            await api.put(`/superadmin/partner-apps/${partner._id}/accounts/${accountId}/unfreeze`);
            showSuccess('Account unfrozen');
            onRefresh();
        } catch { showError('Failed to unfreeze account'); }
        setMenuOpen(null);
    };

    const handleDelete = async (accountId) => {
        setMenuOpen(null);
        const confirmed = await showDanger(
            'This will permanently delete the account and all associated data. This cannot be undone.',
            'Delete Account?'
        );
        if (!confirmed) return;
        try {
            await api.delete(`/superadmin/partner-apps/${partner._id}/accounts/${accountId}`);
            showSuccess('Account deleted');
            onRefresh();
        } catch { showError('Failed to delete account'); }
    };

    return (
        <div className="space-y-4">
            {/* Top bar */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search accounts..."
                        className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                </div>
                <select
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                >
                    <option value="all">All ({accounts.length})</option>
                    <option value="active">Active ({accounts.filter(a => a.status === 'Active').length})</option>
                    <option value="frozen">Frozen ({accounts.filter(a => a.status === 'Frozen').length})</option>
                </select>
            </div>

            {/* Table */}
            {filtered.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                    <i className="fa-solid fa-users text-3xl mb-2" />
                    <p>{search || filter !== 'all' ? 'No accounts match' : 'No accounts provisioned yet'}</p>
                </div>
            ) : (
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-slate-200">
                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Name</th>
                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Email</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">WhatsApp</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">Status</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600">Created</th>
                            <th className="text-center py-3 px-3 font-semibold text-slate-600"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map(acc => (
                            <tr key={acc.accountId} className="border-b border-slate-100 hover:bg-slate-50 transition">
                                <td className="py-3 px-3">
                                    <p className="font-medium text-slate-900">{acc.name}</p>
                                    <p className="text-xs text-slate-400">{acc.companyName}</p>
                                </td>
                                <td className="py-3 px-3 text-slate-600">{acc.email}</td>
                                <td className="py-3 px-3 text-center">
                                    {acc.whatsapp?.connected ? (
                                        <span className="inline-flex items-center gap-1 text-green-600 text-xs font-semibold">
                                            <i className="fa-brands fa-whatsapp" /> Connected
                                        </span>
                                    ) : (
                                        <span className="text-xs text-slate-400">Not connected</span>
                                    )}
                                </td>
                                <td className="py-3 px-3 text-center">
                                    {acc.status === 'Active' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">Active</span>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">Frozen</span>
                                    )}
                                </td>
                                <td className="py-3 px-3 text-center text-xs text-slate-400">
                                    {new Date(acc.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                </td>
                                <td className="py-3 px-3 text-center relative">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === acc.accountId ? null : acc.accountId); }}
                                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
                                    >
                                        <i className="fa-solid fa-ellipsis-vertical" />
                                    </button>
                                    {menuOpen === acc.accountId && (
                                        <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-20 w-44 py-1">
                                            {acc.status === 'Active' ? (
                                                <button onClick={() => handleFreeze(acc.accountId)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2 text-blue-600">
                                                    <i className="fa-solid fa-snowflake text-xs" /> Freeze Account
                                                </button>
                                            ) : (
                                                <button onClick={() => handleUnfreeze(acc.accountId)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-2 text-emerald-600">
                                                    <i className="fa-solid fa-fire text-xs" /> Unfreeze Account
                                                </button>
                                            )}
                                            <button onClick={() => handleDelete(acc.accountId)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 text-red-600">
                                                <i className="fa-solid fa-trash text-xs" /> Delete Account
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

export default PartnerAccountsTab;
