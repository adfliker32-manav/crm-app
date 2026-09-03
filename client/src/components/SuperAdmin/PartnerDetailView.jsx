/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import PartnerAccountsTab from './PartnerAccountsTab';
import PartnerBillingTab from './PartnerBillingTab';
import PartnerSettingsTab from './PartnerSettingsTab';
import PartnerApiKeyTab from './PartnerApiKeyTab';

const TABS = [
    { key: 'accounts', label: 'Accounts', icon: 'fa-users' },
    { key: 'billing', label: 'Billing', icon: 'fa-file-invoice-dollar' },
    { key: 'settings', label: 'Settings', icon: 'fa-cog' },
    { key: 'api-key', label: 'API Key', icon: 'fa-key' },
];

const PartnerDetailView = ({ partnerId, onBack }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [partner, setPartner] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('accounts');

    useEffect(() => { fetchPartner(); }, [partnerId]);

    const fetchPartner = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/superadmin/partner-apps/${partnerId}`);
            setPartner(res.data.data);
        } catch (err) {
            showError('Failed to load partner details');
        } finally {
            setLoading(false);
        }
    };

    if (loading || !partner) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-cyan-500 border-t-transparent" />
            </div>
        );
    }

    const activeCount = partner.activeAccountCount || 0;
    const totalCount = partner.accounts?.length || 0;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition"
                    >
                        <i className="fa-solid fa-arrow-left text-lg" />
                    </button>
                    <div className="w-12 h-12 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                        <i className="fa-solid fa-puzzle-piece text-white text-xl" />
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold text-slate-900">{partner.appName}</h1>
                            {partner.isActive ? (
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
                        </div>
                        <p className="text-sm text-slate-500">
                            Created {new Date(partner.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            {partner.contactEmail && ` · ${partner.contactEmail}`}
                        </p>
                    </div>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: 'Revenue', value: `₹${(partner.monthlyRevenue || 0).toLocaleString('en-IN')}/mo`, sub: `₹${partner.pricePerAccount || 0} × ${activeCount}`, icon: 'fa-indian-rupee-sign', bg: 'bg-amber-100 text-amber-600' },
                    { label: 'Accounts', value: `${activeCount} Active`, sub: `${totalCount} Total`, icon: 'fa-users', bg: 'bg-violet-100 text-violet-600' },
                    { label: 'Messages', value: (partner.messagesThisMonth || 0).toLocaleString(), sub: 'This Month', icon: 'fa-comment-dots', bg: 'bg-green-100 text-green-600' },
                    { label: 'API Calls', value: (partner.apiUsage?.find(u => u.date === new Date().toISOString().slice(0, 10))?.count || 0).toLocaleString(), sub: 'Today', icon: 'fa-code', bg: 'bg-blue-100 text-blue-600' },
                ].map((s, i) => (
                    <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500 font-medium">{s.label}</p>
                                <p className="text-xl font-bold text-slate-900 mt-1">{s.value}</p>
                                <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>
                            </div>
                            <div className={`w-11 h-11 rounded-xl ${s.bg} flex items-center justify-center`}>
                                <i className={`fa-solid ${s.icon} text-lg`} />
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Tabs */}
            <div className="border-b border-slate-200">
                <div className="flex gap-1">
                    {TABS.map(tab => (
                        <button
                            key={tab.key}
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-5 py-3 text-sm font-medium rounded-t-lg transition flex items-center gap-2 ${
                                activeTab === tab.key
                                    ? 'bg-white border border-b-0 border-slate-200 text-cyan-600 -mb-px'
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            <i className={`fa-solid ${tab.icon} text-xs`} />
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
                {activeTab === 'accounts' && (
                    <PartnerAccountsTab partner={partner} onRefresh={fetchPartner} />
                )}
                {activeTab === 'billing' && (
                    <PartnerBillingTab partner={partner} onRefresh={fetchPartner} />
                )}
                {activeTab === 'settings' && (
                    <PartnerSettingsTab partner={partner} onRefresh={fetchPartner} />
                )}
                {activeTab === 'api-key' && (
                    <PartnerApiKeyTab partner={partner} onRefresh={fetchPartner} />
                )}
            </div>
        </div>
    );
};

export default PartnerDetailView;
