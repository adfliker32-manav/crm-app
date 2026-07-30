/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import EmailTemplates from '../components/Email/EmailTemplates';
import EmailInbox from '../components/Email/EmailInbox';
import EmailSettings from '../components/Email/EmailSettings';
import EmailAnalytics from '../components/Email/EmailAnalytics';
import EmailLogs from '../components/Email/EmailLogs';
import EmailCampaigns from '../components/Email/EmailCampaigns';
import { hasEmailPermission } from '../components/Email/emailPermissions';

const ALL_TABS = [
    { id: 'inbox',     label: 'Inbox',      icon: 'fa-inbox' },
    { id: 'templates', label: 'Templates',   icon: 'fa-layer-group' },
    { id: 'campaigns', label: 'Campaigns',   icon: 'fa-bullhorn' },
    // Delivery log: the /email-logs/logs endpoint was fully implemented but had
    // no UI, so a failed send showed only as a count with no way to see which
    // message failed, to whom, or why.
    { id: 'logs',      label: 'Delivery',    icon: 'fa-list-check' },
    { id: 'analytics', label: 'Analytics',   icon: 'fa-chart-pie' },
    // Config reads and writes need accessSettings on the server, so the tab is
    // hidden without it rather than rendering a form that cannot save.
    { id: 'settings',  label: 'Config',      icon: 'fa-sliders', requires: 'accessSettings' },
];

const MiniStat = ({ value, label, color }) => (
    <div className="text-center">
        <p className={`text-2xl font-bold leading-none ${color}`}>{value}</p>
        <p className="text-xs text-slate-400 font-medium mt-1">{label}</p>
    </div>
);

const EmailManagement = () => {
    const { user } = useAuth();
    // Must mirror the server gate exactly (checkPermission: manager/superadmin
    // bypass, everyone else needs the explicit permission). Previously this also
    // accepted `manageTeam`, so an agent with manageTeam but without viewEmails
    // was shown the whole Email Center while every API call behind it returned
    // 403 — a page of controls that could not do anything.
    const canViewEmails = hasEmailPermission(user, 'viewEmails');

    // Only render tabs whose backing endpoints this user may actually call.
    const TABS = ALL_TABS.filter(t => !t.requires || hasEmailPermission(user, t.requires));

    const [activeTab, setActiveTab] = useState('inbox');
    const [stats, setStats] = useState({
        today: { sent: 0, failed: 0, automated: { sent: 0 } },
        thisMonth: { sent: 0 }
    });
    const [lastFetched, setLastFetched] = useState(null);
    const [statsError, setStatsError] = useState(false);

    // Inbox is a full-height email client — the stats bar (also on the Analytics
    // tab) only steals its vertical space, so show the summary on Templates only.
    const showStats = activeTab === 'templates';

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

    // Only fetch when the summary is actually rendered. This ran on every mount
    // regardless of tab, so opening the Email Center on the default Inbox tab
    // fired a 4-query analytics aggregation whose result was never displayed —
    // and opening the Analytics tab then ran the whole thing a second time.
    useEffect(() => {
        if (showStats) fetchAnalytics();
    }, [showStats, fetchAnalytics]);

    if (!canViewEmails) return <Navigate to="/dashboard" replace />;

    return (
        <div className="h-full flex flex-col bg-slate-50/50 font-sans animate-fade-in-up overflow-hidden">
            {/* ═══ Page Header ═══ */}
            <div className="px-8 pt-6 pb-0 flex-shrink-0">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200 flex-shrink-0">
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
                    <div className="flex items-center gap-0 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-4 divide-x divide-slate-100">
                        <div className="flex-1 px-6 py-3">
                            <MiniStat value={stats.today?.sent ?? 0} label="Sent today" color="text-blue-600" />
                        </div>
                        <div className="flex-1 px-6 py-3">
                            <MiniStat value={stats.today?.failed ?? 0} label="Failed today" color={stats.today?.failed > 0 ? 'text-rose-500' : 'text-slate-400'} />
                        </div>
                        <div className="flex-1 px-6 py-3">
                            <MiniStat value={stats.today?.automated?.sent ?? 0} label="Auto-triggered" color="text-blue-600" />
                        </div>
                        <div className="flex-1 px-6 py-3">
                            <MiniStat value={stats.thisMonth?.sent ?? 0} label="This month" color="text-blue-600" />
                        </div>
                        <div className="px-6 py-3 flex flex-col items-center justify-center min-w-[130px]">
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
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                        >
                            <i className={`fa-solid ${tab.icon} text-[13px]`}></i>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ═══ Content ═══ */}
            <div className="flex-1 min-h-0 mx-8 mb-6 bg-white border border-slate-200 border-t-0 rounded-b-2xl shadow-sm overflow-hidden">
                <div className={`h-full ${activeTab === 'inbox' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
                    {activeTab === 'inbox'     && <EmailInbox />}
                    {activeTab === 'templates' && <EmailTemplates />}
                    {activeTab === 'campaigns' && <EmailCampaigns />}
                    {activeTab === 'logs'      && <EmailLogs />}
                    {activeTab === 'analytics' && <EmailAnalytics />}
                    {activeTab === 'settings'  && <EmailSettings />}
                </div>
            </div>
        </div>
    );
};

export default EmailManagement;
