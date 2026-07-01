import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import AgenciesView from './AgenciesView';
import PartnerPayoutsView from './PartnerPayoutsView';

const StatCard = ({ label, value, sub, icon, gradient, iconBg }) => (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm relative overflow-hidden group">
        <div className={`absolute -right-4 -top-4 p-4 opacity-[0.03] transform group-hover:scale-110 transition duration-500`}>
            <i className={`${icon} text-8xl text-slate-900`} />
        </div>
        <div className="flex items-center gap-3 mb-3 relative z-10">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
                <i className={`${icon} text-lg`} />
            </div>
            <p className="text-sm font-bold tracking-wider uppercase text-slate-500">{label}</p>
        </div>
        <h3 className={`text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r relative z-10 ${gradient}`}>{value}</h3>
        {sub && <p className="text-sm font-semibold mt-2 text-slate-400 relative z-10">{sub}</p>}
    </div>
);

const AgencyManagementModule = () => {
    const [tab, setTab] = useState('overview');
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);

    const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

    useEffect(() => {
        api.get('/superadmin/partner/analytics')
            .then(res => setAnalytics(res.data.analytics))
            .catch(err => console.error("Failed to load analytics:", err))
            .finally(() => setLoading(false));
    }, []);

    const tabs = [
        { id: 'overview', label: 'Analytics & Overview', icon: 'fa-chart-pie' },
        { id: 'agencies', label: 'Agency Network', icon: 'fa-network-wired' },
        { id: 'payouts', label: 'Partner Payouts & Tiers', icon: 'fa-money-bill-transfer' }
    ];

    return (
        <div className="space-y-6 animate-fade-in-up pb-20">
            {/* Header */}
            <div>
                <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Agency Management</h1>
                <p className="text-slate-500 font-medium text-lg mt-1">Manage your reseller network, payouts, and financial liabilities.</p>
            </div>

            {/* Navigation Tabs */}
            <div className="flex gap-2 bg-slate-100 p-1.5 rounded-2xl w-fit">
                {tabs.map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                            tab === t.id 
                                ? 'bg-white text-indigo-700 shadow-sm' 
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                        }`}
                    >
                        <i className={`fa-solid ${t.icon}`} /> {t.label}
                    </button>
                ))}
            </div>

            {/* Tab Contents */}
            {tab === 'overview' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <StatCard 
                            label="Total Unpaid Liability" 
                            value={analytics ? fmt(analytics.unclaimedLiability) : '...'} 
                            sub="Total commission sitting in agency accounts"
                            icon="fa-vault" 
                            gradient="from-indigo-600 to-violet-600"
                            iconBg="bg-indigo-100 text-indigo-600"
                        />
                        <StatCard 
                            label="Pending Payouts" 
                            value={analytics ? fmt(analytics.pendingLiability) : '...'} 
                            sub={analytics ? `${analytics.pendingRequests} request(s) awaiting payment` : '...'}
                            icon="fa-clock-rotate-left" 
                            gradient="from-amber-500 to-orange-500"
                            iconBg="bg-amber-100 text-amber-600"
                        />
                        <StatCard 
                            label="Paid This Month" 
                            value={analytics ? fmt(analytics.paidThisMonth) : '...'} 
                            sub="Total transferred this calendar month"
                            icon="fa-calendar-check" 
                            gradient="from-emerald-500 to-teal-500"
                            iconBg="bg-emerald-100 text-emerald-600"
                        />
                        <StatCard 
                            label="Lifetime Payouts" 
                            value={analytics ? fmt(analytics.lifetimePaid) : '...'} 
                            sub="Total transferred since inception"
                            icon="fa-trophy" 
                            gradient="from-pink-500 to-rose-500"
                            iconBg="bg-pink-100 text-pink-600"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm col-span-3">
                            <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2">
                                <i className="fa-solid fa-users text-blue-500" /> Agency Network Growth
                            </h3>
                            <div className="grid grid-cols-4 gap-6">
                                <div className="p-4 bg-slate-50 rounded-xl">
                                    <p className="text-sm font-semibold text-slate-500 mb-1">Total Agencies</p>
                                    <p className="text-3xl font-black text-slate-800">{analytics?.agencyGrowth?.total || 0}</p>
                                </div>
                                <div className="p-4 bg-emerald-50 rounded-xl">
                                    <p className="text-sm font-semibold text-emerald-600 mb-1">Active</p>
                                    <p className="text-3xl font-black text-emerald-700">{analytics?.agencyGrowth?.active || 0}</p>
                                </div>
                                <div className="p-4 bg-red-50 rounded-xl">
                                    <p className="text-sm font-semibold text-red-500 mb-1">Frozen / Restricted</p>
                                    <p className="text-3xl font-black text-red-600">{analytics?.agencyGrowth?.frozen || 0}</p>
                                </div>
                                <div className="p-4 bg-blue-50 rounded-xl">
                                    <p className="text-sm font-semibold text-blue-500 mb-1">New This Month</p>
                                    <p className="text-3xl font-black text-blue-600">+{analytics?.agencyGrowth?.newThisMonth || 0}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {tab === 'agencies' && (
                <div className="animate-in fade-in duration-300">
                    <AgenciesView />
                </div>
            )}

            {tab === 'payouts' && (
                <div className="animate-in fade-in duration-300">
                    <PartnerPayoutsView />
                </div>
            )}
        </div>
    );
};

export default AgencyManagementModule;
