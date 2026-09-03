/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import CreatePartnerModal from './CreatePartnerModal';
import PartnerDetailView from './PartnerDetailView';

const PartnerAppsView = () => {
    const { showSuccess, showError } = useNotification();
    const [partners, setPartners] = useState([]);
    const [stats, setStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [selectedPartner, setSelectedPartner] = useState(null);

    useEffect(() => { fetchPartners(); }, []);

    const fetchPartners = async () => {
        setLoading(true);
        try {
            const res = await api.get('/superadmin/partner-apps');
            setPartners(res.data.data || []);
            setStats(res.data.stats || {});
        } catch (err) {
            showError('Failed to load partner apps');
        } finally {
            setLoading(false);
        }
    };

    const filtered = useMemo(() => {
        const q = searchTerm.toLowerCase();
        return partners.filter(p =>
            p.appName?.toLowerCase().includes(q) ||
            p.contactPerson?.toLowerCase().includes(q) ||
            p.contactEmail?.toLowerCase().includes(q)
        );
    }, [partners, searchTerm]);

    // ── DETAIL VIEW ─────────────────────────────────────────────────────────
    if (selectedPartner) {
        return (
            <PartnerDetailView
                partnerId={selectedPartner}
                onBack={() => { setSelectedPartner(null); fetchPartners(); }}
            />
        );
    }

    // ── LOADING ─────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-cyan-500 border-t-transparent" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                        <span className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                            <i className="fa-solid fa-puzzle-piece text-white" />
                        </span>
                        Partner Apps
                    </h1>
                    <p className="text-slate-500 mt-1">Manage third-party CRM integrations</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-5 py-2.5 rounded-xl font-semibold shadow-lg hover:shadow-xl transition flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus" />
                    Create Partner
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: 'Total Partners', value: stats.totalPartners || 0, icon: 'fa-puzzle-piece', color: 'from-cyan-500 to-cyan-600', iconBg: 'bg-cyan-100 text-cyan-600' },
                    { label: 'Active Partners', value: stats.activePartners || 0, icon: 'fa-check-circle', color: 'from-emerald-500 to-emerald-600', iconBg: 'bg-emerald-100 text-emerald-600' },
                    { label: 'Total Accounts', value: stats.totalAccounts || 0, icon: 'fa-users', color: 'from-violet-500 to-violet-600', iconBg: 'bg-violet-100 text-violet-600' },
                    { label: 'Monthly Revenue', value: `₹${(stats.monthlyRevenue || 0).toLocaleString('en-IN')}`, icon: 'fa-indian-rupee-sign', color: 'from-amber-500 to-amber-600', iconBg: 'bg-amber-100 text-amber-600' },
                ].map((stat, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-lg transition-shadow">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
                                <p className="text-2xl font-bold text-slate-900 mt-1">{stat.value}</p>
                            </div>
                            <div className={`w-12 h-12 rounded-xl ${stat.iconBg} flex items-center justify-center`}>
                                <i className={`fa-solid ${stat.icon} text-lg`} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Search */}
            <div className="relative">
                <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    type="text"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search partners..."
                    className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                />
            </div>

            {/* Partners Table */}
            {filtered.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                    <i className="fa-solid fa-puzzle-piece text-4xl text-slate-300 mb-3" />
                    <p className="text-slate-500 font-medium">
                        {searchTerm ? 'No partners match your search' : 'No partner apps yet'}
                    </p>
                    {!searchTerm && (
                        <button
                            onClick={() => setShowCreateModal(true)}
                            className="mt-3 text-cyan-600 hover:text-cyan-700 font-semibold text-sm"
                        >
                            Create your first partner →
                        </button>
                    )}
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200">
                                <th className="text-left px-5 py-3.5 font-semibold text-slate-600">App Name</th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-600">Accounts</th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-600">Price/Acct</th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-600">Monthly Revenue</th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-600">API Today</th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-600">Status</th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-600"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(p => (
                                <tr
                                    key={p.id}
                                    className="border-b border-slate-100 hover:bg-cyan-50/30 cursor-pointer transition"
                                    onClick={() => setSelectedPartner(p.id)}
                                >
                                    <td className="px-5 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-9 h-9 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center">
                                                <i className="fa-solid fa-puzzle-piece text-white text-sm" />
                                            </div>
                                            <div>
                                                <p className="font-semibold text-slate-900">{p.appName}</p>
                                                <p className="text-xs text-slate-400">{p.contactEmail || 'No contact email'}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="text-center px-5 py-4">
                                        <span className="font-bold text-slate-900">{p.totalAccounts}</span>
                                    </td>
                                    <td className="text-center px-5 py-4">
                                        <span className="text-slate-700">₹{p.pricePerAccount || 0}</span>
                                    </td>
                                    <td className="text-center px-5 py-4">
                                        <span className="font-bold text-emerald-600">₹{(p.monthlyRevenue || 0).toLocaleString('en-IN')}</span>
                                    </td>
                                    <td className="text-center px-5 py-4">
                                        <span className="text-slate-500">{p.apiCallsToday || 0}</span>
                                    </td>
                                    <td className="text-center px-5 py-4">
                                        {p.isActive ? (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-semibold">
                                                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                                                Active
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-100 text-red-700 rounded-full text-xs font-semibold">
                                                <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                                                Inactive
                                            </span>
                                        )}
                                    </td>
                                    <td className="text-center px-5 py-4">
                                        <i className="fa-solid fa-chevron-right text-slate-400" />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <CreatePartnerModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={() => { setShowCreateModal(false); fetchPartners(); }}
                />
            )}
        </div>
    );
};

export default PartnerAppsView;
