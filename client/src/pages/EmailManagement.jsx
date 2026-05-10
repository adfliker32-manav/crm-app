/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import EmailTemplates from '../components/Email/EmailTemplates';
import EmailInbox from '../components/Email/EmailInbox';
import EmailSettings from '../components/Email/EmailSettings';
import EmailAnalytics from '../components/Email/EmailAnalytics';

const TABS = [
    { id: 'inbox',     label: 'Inbox',      icon: 'fa-inbox' },
    { id: 'templates', label: 'Templates',   icon: 'fa-layer-group' },
    { id: 'analytics', label: 'Analytics',   icon: 'fa-chart-pie' },
    { id: 'settings',  label: 'Config',      icon: 'fa-sliders' },
];

const MiniStat = ({ value, label, color }) => (
    <div className="text-center">
        <p className={`text-2xl font-bold leading-none ${color}`}>{value}</p>
        <p className="text-xs text-slate-400 font-medium mt-1">{label}</p>
    </div>
);

const EmailManagement = () => {
    const { user } = useAuth();
    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const canViewEmails = canManageTeam || user?.permissions?.viewEmails === true;

    const [activeTab, setActiveTab] = useState('inbox');
    const [stats, setStats] = useState({
        today: { sent: 0, failed: 0, automated: { sent: 0 } },
        thisMonth: { sent: 0 }
    });
    const [lastFetched, setLastFetched] = useState(null);
    const [statsError, setStatsError] = useState(false);

    const fetchAnalytics = useCallback(async () => {
        try {
            const res = await api.get('/email-logs/analytics');
            setStats(res.data);
            setLastFetched(new Date());
            setStatsError(false);
        } catch (error) {
            console.error("Error fetching email analytics:", error);
            setStatsError(true);
        }
    }, []);

    useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

    if (!canViewEmails) return <Navigate to="/dashboard" replace />;

    const showStats = ['inbox', 'templates'].includes(activeTab);

    return (
        <div className="min-h-screen bg-slate-50/50 font-sans animate-fade-in-up">
            {/* ═══ Page Header ═══ */}
            <div className="px-8 pt-8 pb-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200 flex-shrink-0">
                            <i className="fa-solid fa-envelope text-white text-lg"></i>
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Email Center</h1>
                            <p className="text-slate-400 text-sm mt-0.5">Templates · Inbox · Analytics · Configuration</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {statsError ? (
                            <span className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-600 rounded-full text-xs font-semibold border border-rose-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block"></span>
                                Analytics error
                            </span>
                        ) : (
                            <span className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-full text-xs font-semibold border border-emerald-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                                System Operational
                            </span>
                        )}
                    </div>
                </div>

                {/* ═══ Stats Bar (only on inbox/templates tabs) ═══ */}
                {showStats && (
                    <div className="flex items-center gap-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6 divide-x divide-slate-100">
                        <div className="flex-1 px-6 py-4">
                            <MiniStat value={stats.today?.sent ?? 0} label="Sent today" color="text-indigo-600" />
                        </div>
                        <div className="flex-1 px-6 py-4">
                            <MiniStat value={stats.today?.failed ?? 0} label="Failed today" color={stats.today?.failed > 0 ? 'text-rose-500' : 'text-slate-400'} />
                        </div>
                        <div className="flex-1 px-6 py-4">
                            <MiniStat value={stats.today?.automated?.sent ?? 0} label="Auto-triggered" color="text-violet-600" />
                        </div>
                        <div className="flex-1 px-6 py-4">
                            <MiniStat value={stats.thisMonth?.sent ?? 0} label="This month" color="text-blue-600" />
                        </div>
                        <div className="px-6 py-4 flex flex-col items-center justify-center min-w-[130px]">
                            <p className="text-[10px] text-slate-300 font-semibold uppercase tracking-wider">Last update</p>
                            <p className="text-xs text-slate-400 font-semibold mt-1">
                                {lastFetched
                                    ? lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                    : '—'}
                            </p>
                        </div>
                    </div>
                )}

                {/* ═══ Tab Navigation ═══ */}
                <div className="flex items-center gap-0 border-b border-slate-200">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-all -mb-px
                                ${activeTab === tab.id
                                    ? 'border-indigo-500 text-indigo-600'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                        >
                            <i className={`fa-solid ${tab.icon} text-[13px]`}></i>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ═══ Content ═══ */}
            <div
                className="mx-8 mb-8 bg-white border border-slate-200 border-t-0 rounded-b-2xl shadow-sm overflow-hidden"
                style={{ height: 'calc(100vh - ' + (showStats ? '310px' : '200px') + ')' }}
            >
                <div className="h-full overflow-y-auto">
                    {activeTab === 'inbox'     && <EmailInbox />}
                    {activeTab === 'templates' && <EmailTemplates />}
                    {activeTab === 'analytics' && <EmailAnalytics />}
                    {activeTab === 'settings'  && <EmailSettings />}
                </div>
            </div>
        </div>
    );
};

export default EmailManagement;
