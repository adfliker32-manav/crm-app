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

    // The negative margins cancel the app layout's page padding so the Email
    // Center runs edge-to-edge like the other messaging module. The page used to
    // add its own px-8 on top of that padding and nest the inbox inside a card,
    // which left the inbox visibly inset and misaligned with every other screen.
    // flex-1 (not h-full / h-screen) fills <main> exactly, payment banner or not.
    return (
        <div className="-mx-4 md:-mx-6 -my-4 md:-my-6 flex-1 min-h-0 flex flex-col bg-slate-50 font-sans overflow-hidden">
            {/* ═══ Page Header ═══ */}
            <div className="bg-white border-b border-slate-200 px-6 flex-shrink-0">
                <div className="flex items-center justify-between gap-4 pt-4 pb-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm shadow-blue-600/20 flex-shrink-0">
                            <i className="fa-solid fa-envelope text-white"></i>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-xl font-bold text-slate-900 leading-tight">Email Center</h1>
                            <p className="text-sm text-slate-500 truncate">Conversations, templates, campaigns and delivery in one place</p>
                        </div>
                    </div>
                    {showStats && statsError && (
                        <span className="flex items-center gap-2 px-3 py-1.5 bg-rose-50 text-rose-600 rounded-full text-xs font-semibold border border-rose-100 flex-shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block"></span>
                            Analytics error
                        </span>
                    )}
                </div>

                {/* ═══ Tab Navigation ═══ */}
                <nav className="flex items-center gap-1 -mb-px overflow-x-auto">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors
                                ${activeTab === tab.id
                                    ? 'border-blue-600 text-blue-600'
                                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'}`}
                        >
                            <i className={`fa-solid ${tab.icon} text-[13px]`}></i>
                            {tab.label}
                        </button>
                    ))}
                </nav>
            </div>

            {/* ═══ Content ═══ */}
            {activeTab === 'inbox' ? (
                <div className="flex-1 min-h-0 overflow-hidden">
                    <EmailInbox />
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto">
                    {/* Stats summary — Templates only; the inbox needs the height. */}
                    {showStats && (
                        <div className="px-6 pt-6">
                            <div className="flex flex-wrap items-stretch bg-white rounded-xl border border-slate-200 shadow-sm divide-x divide-slate-100">
                                <div className="flex-1 min-w-[120px] px-6 py-4">
                                    <MiniStat value={stats.today?.sent ?? 0} label="Sent today" color="text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-[120px] px-6 py-4">
                                    <MiniStat value={stats.today?.failed ?? 0} label="Failed today" color={stats.today?.failed > 0 ? 'text-rose-500' : 'text-slate-400'} />
                                </div>
                                <div className="flex-1 min-w-[120px] px-6 py-4">
                                    <MiniStat value={stats.today?.automated?.sent ?? 0} label="Auto-triggered" color="text-blue-600" />
                                </div>
                                <div className="flex-1 min-w-[120px] px-6 py-4">
                                    <MiniStat value={stats.thisMonth?.sent ?? 0} label="This month" color="text-blue-600" />
                                </div>
                                <div className="px-6 py-4 flex flex-col items-center justify-center min-w-[130px]">
                                    <p className="text-xs text-slate-400 font-medium">Last update</p>
                                    <p className="text-sm text-slate-600 font-semibold mt-1">
                                        {lastFetched
                                            ? lastFetched.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                            : '—'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'templates' && <EmailTemplates />}
                    {activeTab === 'campaigns' && <EmailCampaigns />}
                    {activeTab === 'logs'      && <EmailLogs />}
                    {activeTab === 'analytics' && <EmailAnalytics />}
                    {activeTab === 'settings'  && <EmailSettings />}
                </div>
            )}
        </div>
    );
};

export default EmailManagement;
