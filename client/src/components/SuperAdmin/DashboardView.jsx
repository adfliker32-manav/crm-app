import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
    Title, Tooltip, Legend, Filler
} from 'chart.js';
import api from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const DashboardView = ({ setActiveView }) => {
    const { showDanger } = useConfirm();
    const [stats, setStats] = useState({});
    const [recentSignups, setRecentSignups] = useState([]);
    const [growthData, setGrowthData] = useState(null);
    const [cloudUsage, setCloudUsage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [cleaningOrphans, setCleaningOrphans] = useState(false);
    const [orphanResult, setOrphanResult] = useState(null);

    useEffect(() => { fetchDashboardData(); }, []);

    const fetchDashboardData = async () => {
        try {
            setLoading(true);
            const [statsRes, signupsRes, growthRes, cloudRes] = await Promise.all([
                api.get('/superadmin/stats'),
                api.get('/superadmin/recent-signups'),
                api.get('/superadmin/growth-data'),
                api.get('/superadmin/cloud-usage')
            ]);
            setStats(statsRes.data || {});
            setRecentSignups(signupsRes.data || []);
            setGrowthData(growthRes.data);
            setCloudUsage(cloudRes.data?.usage || null);
        } catch (error) {
            console.error('Error fetching dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    const chartData = growthData ? {
        labels: growthData.labels || [],
        datasets: [
            { label: 'New Companies', data: growthData.companies || [], borderColor: '#8B5CF6', backgroundColor: 'rgba(139, 92, 246, 0.1)', tension: 0.4, fill: true, pointRadius: 0 },
            { label: 'New Leads',     data: growthData.leads || [],     borderColor: '#10B981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.4, fill: true, pointRadius: 0 }
        ]
    } : null;

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'top' }, title: { display: true, text: 'Growth — Last 30 Days', font: { size: 14, weight: 'bold' } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400"></i>
            </div>
        );
    }

    const supportCount = stats.openSupportTickets || 0;
    const frozenTotal  = (stats.frozenAccounts || 0) + (stats.suspendedAccounts || 0);
    const orphanCount  = stats.orphanedAccounts || 0;

    const handleCleanupOrphans = async () => {
        const confirmed = await showDanger(
            `Permanently delete ${orphanCount} orphan account${orphanCount === 1 ? '' : 's'} and all their data (leads, agents, settings)? This cannot be undone.`,
            'Clean up orphan accounts?'
        );
        if (!confirmed) return;
        setCleaningOrphans(true);
        try {
            const res = await api.post('/superadmin/cleanup/orphans');
            setOrphanResult(res.data);
            await fetchDashboardData();
        } catch (e) {
            setOrphanResult({ error: e.response?.data?.message || 'Cleanup failed.' });
        } finally {
            setCleaningOrphans(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Super Admin Dashboard</h1>
                    <p className="text-slate-500 mt-1">Real-time platform metrics and activity</p>
                </div>
                <button
                    onClick={fetchDashboardData}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition shadow-md flex items-center gap-2"
                >
                    <i className="fa-solid fa-rotate"></i>
                    Refresh
                </button>
            </div>

            {/* Result toast for orphan cleanup */}
            {orphanResult && (
                <div className={`rounded-xl p-3 flex items-start gap-2 text-sm border ${orphanResult.error ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-700'}`}>
                    <i className={`fa-solid ${orphanResult.error ? 'fa-circle-exclamation' : 'fa-broom'} mt-0.5`} />
                    <div className="flex-1">
                        <div className="font-bold">{orphanResult.error || orphanResult.message}</div>
                        {orphanResult.names?.length > 0 && (
                            <div className="text-xs mt-1 opacity-80">Removed: {orphanResult.names.join(', ')}</div>
                        )}
                    </div>
                    <button onClick={() => setOrphanResult(null)} className="opacity-60 hover:opacity-100">
                        <i className="fa-solid fa-times" />
                    </button>
                </div>
            )}

            {/* 🔴 Action-required banner — only shown if anything needs attention */}
            {(supportCount > 0 || frozenTotal > 0 || orphanCount > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {supportCount > 0 && (
                        <button onClick={() => setActiveView?.('support')}
                            className="bg-orange-50 border-l-4 border-orange-500 rounded-r-xl p-4 flex items-center gap-3 text-left hover:bg-orange-100 transition">
                            <div className="w-10 h-10 rounded-full bg-orange-500 text-white flex items-center justify-center">
                                <i className="fa-solid fa-life-ring" />
                            </div>
                            <div className="flex-1">
                                <div className="text-xs font-bold uppercase text-orange-700 tracking-wider">Support inbox</div>
                                <div className="text-lg font-black text-orange-900">{supportCount} open ticket{supportCount === 1 ? '' : 's'}</div>
                            </div>
                            <i className="fa-solid fa-arrow-right text-orange-500" />
                        </button>
                    )}
                    {frozenTotal > 0 && (
                        <div className="bg-red-50 border-l-4 border-red-500 rounded-r-xl p-4 flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center">
                                <i className="fa-solid fa-snowflake" />
                            </div>
                            <div className="flex-1">
                                <div className="text-xs font-bold uppercase text-red-700 tracking-wider">Restricted accounts</div>
                                <div className="text-lg font-black text-red-900">
                                    {stats.suspendedAccounts || 0} suspended · {stats.frozenAccounts || 0} frozen
                                </div>
                            </div>
                        </div>
                    )}
                    {orphanCount > 0 && (
                        <button
                            onClick={handleCleanupOrphans}
                            disabled={cleaningOrphans}
                            className="bg-slate-100 border-l-4 border-slate-500 rounded-r-xl p-4 flex items-center gap-3 text-left hover:bg-slate-200 transition disabled:opacity-60"
                        >
                            <div className="w-10 h-10 rounded-full bg-slate-700 text-white flex items-center justify-center">
                                <i className={`fa-solid ${cleaningOrphans ? 'fa-spinner fa-spin' : 'fa-ghost'}`} />
                            </div>
                            <div className="flex-1">
                                <div className="text-xs font-bold uppercase text-slate-600 tracking-wider">Orphan accounts</div>
                                <div className="text-lg font-black text-slate-900">
                                    {orphanCount} ghost{orphanCount === 1 ? '' : 's'} from deleted agencies
                                </div>
                                <div className="text-[11px] font-semibold text-slate-500 mt-0.5">
                                    {cleaningOrphans ? 'Cleaning up...' : 'Click to clean up'}
                                </div>
                            </div>
                            <i className="fa-solid fa-broom text-slate-500" />
                        </button>
                    )}
                </div>
            )}

            {/* Headline Stats — primary 4 */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Total Companies"
                    value={stats.totalCompanies || 0}
                    sub={`${stats.totalAgencies || 0} agencies · ${stats.totalDirectClients || 0} direct · ${stats.totalSubClients || 0} agency clients`}
                    icon="fa-building"
                    gradient="bg-gradient-to-br from-purple-500 to-purple-600"
                />
                <StatCard
                    title="Total Leads"
                    value={stats.totalLeads || 0}
                    sub={stats.leadsThisWeek > 0 ? `+${stats.leadsThisWeek.toLocaleString()} this week` : 'No new this week'}
                    icon="fa-users"
                    gradient="bg-gradient-to-br from-blue-500 to-blue-600"
                />
                <StatCard
                    title="Total Agents"
                    value={stats.totalAgents || 0}
                    sub="Across all tenants"
                    icon="fa-user-tie"
                    gradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
                />
                <StatCard
                    title="Approved Accounts"
                    value={stats.approvedAccounts || 0}
                    sub={[
                        pendingCount > 0 && `${pendingCount} pending`,
                        stats.rejectedAccounts > 0 && `${stats.rejectedAccounts} rejected`,
                        stats.deactivatedAccounts > 0 && `${stats.deactivatedAccounts} inactive`
                    ].filter(Boolean).join(' · ') || 'All accounts active'}
                    icon="fa-shield-check"
                    gradient="bg-gradient-to-br from-orange-500 to-orange-600"
                />
            </div>

            {/* Activity Today — 4 compact cards */}
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
                    <i className="fa-solid fa-bolt text-amber-500"></i>
                    Activity Today
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <MiniMetric icon="fa-user-plus"     label="New Signups"  value={stats.newSignupsToday || 0}  color="text-purple-600" />
                    <MiniMetric icon="fa-address-book"  label="New Leads"    value={stats.leadsToday || 0}       color="text-blue-600" />
                    <MiniMetric icon="fa-whatsapp" iconBrand label="WhatsApp Sent" value={stats.whatsappToday || 0}    color="text-emerald-600" />
                    <MiniMetric icon="fa-envelope"      label="Emails Sent"  value={stats.emailsToday || 0}      color="text-rose-600" />
                </div>
                <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-400">
                    <i className="fa-solid fa-clock mr-1" />
                    Counts since 00:00 today (server time). Refresh for the latest.
                </div>
            </div>

            {/* Global Cloud Usage Widget */}
            {cloudUsage && (
                <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-6">
                        <i className="fa-solid fa-cloud text-blue-500"></i>
                        Platform-Wide Cloud Usage (Current Cycle)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <UsageBar
                            label="WhatsApp Output"
                            sent={cloudUsage.whatsapp.sent}
                            limit={cloudUsage.whatsapp.limit}
                            unit="msgs"
                            iconBrand="fa-whatsapp"
                            barColor="bg-green-500"
                            iconColor="text-green-500 bg-green-50"
                        />
                        <UsageBar
                            label="Email Output"
                            sent={cloudUsage.email.sent}
                            limit={cloudUsage.email.limit}
                            unit="emails"
                            icon="fa-envelope"
                            barColor="bg-blue-500"
                            iconColor="text-blue-500 bg-blue-50"
                        />
                    </div>
                </div>
            )}

            {/* Growth Chart */}
            {chartData && (
                <div className="bg-white rounded-xl shadow-lg p-6 border border-slate-200">
                    <div className="h-80">
                        <Line data={chartData} options={chartOptions} />
                    </div>
                </div>
            )}

            {/* Recent Signups */}
            <div className="bg-white rounded-xl shadow-lg border border-slate-200">
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-clock-rotate-left text-blue-600"></i>
                        Recent Signups
                    </h3>
                    {stats.newSignupsThisWeek > 0 && (
                        <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
                            +{stats.newSignupsThisWeek} this week
                        </span>
                    )}
                </div>
                <div className="p-6">
                    {recentSignups.length > 0 ? (
                        <div className="space-y-3">
                            {recentSignups.map((company, index) => (
                                <div
                                    key={company._id || index}
                                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold text-lg shadow-md">
                                            {company.companyName?.charAt(0).toUpperCase() || 'C'}
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800">{company.companyName || company.name || 'Unnamed Company'}</h4>
                                            <p className="text-sm text-slate-500">{company.email}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-sm text-slate-600">
                                            {new Date(company.createdAt).toLocaleDateString()}
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            {new Date(company.createdAt).toLocaleTimeString()}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12 text-slate-400">
                            <i className="fa-regular fa-building text-5xl mb-3"></i>
                            <p>No recent signups</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Stat Card Component
const StatCard = ({ title, value, sub, icon, gradient }) => (
    <div className={`${gradient} rounded-xl shadow-lg p-6 text-white transform hover:scale-105 transition-transform duration-200`}>
        <div className="flex items-start justify-between">
            <div className="min-w-0">
                <p className="text-white/80 text-sm font-medium mb-1 truncate">{title}</p>
                <h3 className="text-3xl font-bold">{(value || 0).toLocaleString()}</h3>
                {sub && <p className="text-white/70 text-xs font-medium mt-2 truncate">{sub}</p>}
            </div>
            <div className="bg-white/20 w-12 h-12 rounded-lg flex items-center justify-center shadow-md flex-shrink-0">
                <i className={`fa-solid ${icon} text-xl`}></i>
            </div>
        </div>
    </div>
);

// Compact metric for "Activity Today" panel
const MiniMetric = ({ icon, iconBrand, label, value, color }) => (
    <div className="bg-slate-50 rounded-lg p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-white flex items-center justify-center ${color} shadow-sm`}>
            <i className={`${iconBrand ? 'fa-brands' : 'fa-solid'} ${icon} text-lg`} />
        </div>
        <div className="min-w-0">
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider truncate">{label}</div>
            <div className="text-xl font-black text-slate-800">{(value || 0).toLocaleString()}</div>
        </div>
    </div>
);

// Usage progress bar widget
const UsageBar = ({ label, sent, limit, unit, icon, iconBrand, barColor, iconColor }) => {
    const pct = Math.min(100, (sent / (limit || 1)) * 100);
    return (
        <div>
            <div className="flex justify-between items-end mb-2">
                <div>
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">{label}</p>
                    <h4 className="text-2xl font-black text-slate-800">
                        {(sent || 0).toLocaleString()}
                        <span className="text-sm font-medium text-slate-400 ml-1">/ {(limit || 0).toLocaleString()} {unit}</span>
                    </h4>
                </div>
                <div className={`${iconColor} w-10 h-10 flex items-center justify-center rounded-lg shadow-sm`}>
                    <i className={`${iconBrand ? 'fa-brands' : 'fa-solid'} ${iconBrand || icon} text-xl`}></i>
                </div>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-3 mb-1 overflow-hidden">
                <div className={`${barColor} h-3 rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <div className="text-[10px] text-slate-400 font-bold">{pct.toFixed(1)}% of monthly capacity used</div>
        </div>
    );
};

export default DashboardView;
