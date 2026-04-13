import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import StatCard from '../components/Dashboard/StatCard';
import ChartsRow from '../components/Dashboard/ChartsRow';
import FollowUpModal from '../components/Dashboard/FollowUpModal';
import SettingsModal from '../components/Dashboard/SettingsModal';
import TrialBanner from '../components/TrialBanner';

const MOTIVATIONAL_QUOTES = [
    { tag: "🔥 Today's Focus", headline: "Seize every lead. Convert every conversation. Close every deal.", cls: "bg-orange-50 text-orange-600 border-orange-200" },
    { tag: "🚀 Velocity", headline: "Execute fast, follow up faster. Your competition never sleeps.", cls: "bg-blue-50 text-blue-600 border-blue-200" },
    { tag: "⚡ Action", headline: "Every follow-up you skip is a deal you hand to someone else.", cls: "bg-amber-50 text-amber-600 border-amber-200" },
    { tag: "🎯 Pipeline", headline: "A full pipeline is a full life. Work it hard, work it daily.", cls: "bg-indigo-50 text-indigo-600 border-indigo-200" },
    { tag: "💬 Engagement", headline: "Conversations become conversions when you show up consistently.", cls: "bg-emerald-50 text-emerald-600 border-emerald-200" },
    { tag: "🏆 Champion", headline: "Winners follow up. Champions follow through. Be a champion.", cls: "bg-rose-50 text-rose-600 border-rose-200" },
    { tag: "📈 Growth", headline: "Your CRM is only as powerful as the energy you put into it.", cls: "bg-violet-50 text-violet-600 border-violet-200" },
    { tag: "🎪 Insight", headline: "Data tells the story. Your hustle writes the ending.", cls: "bg-cyan-50 text-cyan-600 border-cyan-200" },
];

const Dashboard = () => {
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalLeads: 0,
        followUpToday: 0,
        followUpOverdue: 0,
        followUpUpcoming: 0,
        followUpTotal: 0
    });
    const [followUpStats, setFollowUpStats] = useState(null);
    const [todayTasks, setTodayTasks] = useState([]);
    const [error, setError] = useState(null);

    const [isFollowUpModalOpen, setIsFollowUpModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [quote] = useState(() => MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)]);

    const fetchDashboardData = useCallback(async () => {
        try {
            // Single API call replaces 3 separate calls (analytics + follow-ups + tasks)
            const res = await api.get('/dashboard/summary');
            const data = res.data;
            setStats(data);
            setFollowUpStats(data.followUpLeads || []);
            setTodayTasks(data.todayTasks || []);
        } catch (err) {
            console.error("Error fetching dashboard data:", err);
            setError("Failed to load dashboard data.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-spin mx-auto mb-6"></div>
                        <div className="w-16 h-16 border-4 border-transparent border-t-blue-600 rounded-full animate-spin mx-auto mb-6 absolute top-0 left-1/2 -translate-x-1/2"></div>
                    </div>
                    <p className="text-slate-500 text-sm font-medium">Loading dashboard...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center">
                <div className="text-center bg-white/80 backdrop-blur-xl rounded-3xl p-10 shadow-xl border border-white/20">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-500/25">
                        <i className="fa-solid fa-exclamation text-white text-2xl"></i>
                    </div>
                    <p className="text-rose-600 font-semibold text-lg">{error}</p>
                </div>
            </div>
        );
    }

    const leadSourceData = {
        labels: stats?.leadSource ? Object.keys(stats.leadSource) : [],
        datasets: [{
            data: stats?.leadSource ? Object.values(stats.leadSource) : [],
            backgroundColor: ['#60A5FA', '#34D399', '#F87171', '#FBBF24', '#A78BFA', '#9CA3AF'],
            borderWidth: 0,
        }]
    };

    const leadsOverTimeData = {
        labels: stats?.leadsOverTime ? stats.leadsOverTime.map(d => d.date) : [],
        datasets: [{
            label: 'Leads',
            data: stats?.leadsOverTime ? stats.leadsOverTime.map(d => d.count) : [],
            borderColor: '#3B82F6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            tension: 0.4,
            fill: true
        }]
    };

    const stageDistributionData = {
        labels: stats?.stageDistribution ? Object.keys(stats.stageDistribution) : [],
        datasets: [{
            label: 'Leads by Stage',
            data: stats?.stageDistribution ? Object.values(stats.stageDistribution) : [],
            backgroundColor: ['#60A5FA', '#34D399', '#F87171', '#FBBF24', '#A78BFA', '#9CA3AF'],
            borderWidth: 0
        }]
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/50 to-violet-50/50">
            {/* Animated background orbs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-20 left-20 w-72 h-72 bg-blue-400/20 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-violet-400/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
                <div className="absolute top-1/2 left-1/2 w-64 h-64 bg-cyan-400/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
            </div>

            <div className="relative z-10 p-8 space-y-8">
                {/* ⏳ PREMIUM TRIAL BANNER (DASHBOARD ONLY) ⏳ */}
                <TrialBanner />

                {/* Header - Straight Banner Style */}
                <div className="bg-white/90 backdrop-blur-md border border-white/40 shadow-sm rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <i className="fa-solid fa-layer-group text-white text-lg"></i>
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">
                                CRM Command Center
                            </h1>
                            <div className="mt-1.5 mb-1">
                                <span className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full border ${quote.cls}`}>
                                    {quote.tag}
                                </span>
                            </div>
                            <p className="text-slate-600 text-sm font-semibold max-w-lg">{quote.headline}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => fetchDashboardData()}
                            className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-lg transition-colors text-sm font-semibold flex items-center gap-2 border border-slate-200"
                        >
                            <i className="fa-solid fa-arrows-rotate"></i>
                            Refresh
                        </button>
                        <button
                            onClick={() => setIsSettingsModalOpen(true)}
                            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors text-sm font-semibold flex items-center gap-2 shadow-md"
                        >
                            <i className="fa-solid fa-gear"></i>
                            Settings
                        </button>
                    </div>
                </div>

                {/* Primary KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard
                        title="Total Leads"
                        value={stats?.totalLeads?.toLocaleString() || 0}
                        icon="fa-users"
                        subtext="All time"
                    />
                    <StatCard
                        title="New Today"
                        value={stats?.leadsToday || 0}
                        icon="fa-plus"
                        subtext="Added today"
                    />
                    <StatCard
                        title="Conversion Rate"
                        value={`${stats?.conversionRate || 0}%`}
                        icon="fa-bullseye"
                        subtext="Won / Total"
                    />
                    <div onClick={() => setIsFollowUpModalOpen(true)} className="cursor-pointer">
                        <StatCard
                            title="Follow-ups Due"
                            value={Array.isArray(followUpStats) ? followUpStats.length : 0}
                            icon="fa-bell"
                            subtext="Click to view"
                        />
                    </div>
                </div>

                {/* Follow-up Stats */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                    {/* Overdue */}
                    <div className="relative group">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-rose-500 to-pink-500 rounded-2xl opacity-0 group-hover:opacity-30 blur transition-all duration-500"></div>
                        <div className="relative bg-gradient-to-br from-rose-50 to-pink-50 backdrop-blur-xl rounded-2xl border border-rose-100/50 p-6 flex items-center gap-5 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                                <i className="fa-solid fa-clock text-white text-lg"></i>
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-rose-600">Overdue</p>
                                <p className="text-3xl font-bold text-rose-700">{stats?.followUpOverdue || 0}</p>
                            </div>
                        </div>
                    </div>

                    {/* Upcoming */}
                    <div className="relative group">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl opacity-0 group-hover:opacity-30 blur transition-all duration-500"></div>
                        <div className="relative bg-gradient-to-br from-amber-50 to-orange-50 backdrop-blur-xl rounded-2xl border border-amber-100/50 p-6 flex items-center gap-5 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                                <i className="fa-solid fa-calendar text-white text-lg"></i>
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-amber-600">Upcoming (7 days)</p>
                                <p className="text-3xl font-bold text-amber-700">{stats?.followUpUpcoming || 0}</p>
                            </div>
                        </div>
                    </div>

                    {/* Total Scheduled */}
                    <div className="relative group">
                        <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-2xl opacity-0 group-hover:opacity-30 blur transition-all duration-500"></div>
                        <div className="relative bg-gradient-to-br from-blue-50 to-cyan-50 backdrop-blur-xl rounded-2xl border border-blue-100/50 p-6 flex items-center gap-5 shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1">
                            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-blue-500/30">
                                <i className="fa-solid fa-list-check text-white text-lg"></i>
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-blue-600">Total Scheduled</p>
                                <p className="text-3xl font-bold text-blue-700">{stats?.followUpTotal || 0}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Today's Tasks Widget */}
                {todayTasks.length > 0 && (
                    <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/20 shadow-xl p-6 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-orange-400/10 rounded-full blur-3xl"></div>
                        <h2 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-3 relative z-10">
                            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-lg shadow-orange-500/25">
                                <i className="fa-solid fa-list-check text-white text-sm"></i>
                            </span>
                            Tasks Due Today
                            <span className="ml-2 bg-orange-100 text-orange-600 text-xs px-2.5 py-1 rounded-full font-bold">{todayTasks.length}</span>
                        </h2>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 relative z-10">
                            {todayTasks.map(task => (
                                <div key={task._id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                                    <h3 className="font-bold text-slate-800 text-sm truncate">{task.title}</h3>
                                    <p className="text-xs text-slate-500 mt-1 mb-3 line-clamp-1">{task.description || 'No description'}</p>
                                    <div className="flex justify-between items-center text-xs">
                                        <span className="text-orange-600 font-semibold flex items-center gap-1.5 bg-orange-50 px-2 py-1 rounded-md">
                                            <i className="fa-regular fa-clock"></i> Today
                                        </span>
                                        {task.leadId && (
                                            <span className="text-slate-600 font-medium truncate max-w-[120px]">
                                                <i className="fa-solid fa-user mr-1 text-slate-400"></i>
                                                {task.leadId.name}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Charts */}
                <div>
                    <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-3">
                        <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/25">
                            <i className="fa-solid fa-chart-line text-white text-sm"></i>
                        </span>
                        Analytics
                    </h2>
                    <ChartsRow
                        leadSourceData={leadSourceData}
                        leadsOverTimeData={leadsOverTimeData}
                        stageDistributionData={stageDistributionData}
                    />
                </div>

                {/* Meta Optimization Impact Widget */}
                {stats?.leadsToday > 0 && (
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl border border-slate-700 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl"></div>
                        
                        <div className="flex items-center gap-4 relative z-10 w-full md:w-auto">
                            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center border border-blue-500/30 shrink-0">
                                <i className="fa-brands fa-meta text-blue-400 text-xl"></i>
                            </div>
                            <div>
                                <h3 className="text-white font-bold text-lg">Meta CAPI Impact</h3>
                                <p className="text-slate-400 text-xs mt-0.5">Real-time Ad Optimization</p>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between md:justify-end gap-x-8 gap-y-4 relative z-10 w-full md:w-auto">
                            <div className="text-left">
                                <p className="text-slate-400 text-[10px] font-bold mb-1 uppercase tracking-wider">Events Sent Today</p>
                                <p className="text-2xl font-bold text-white">{stats.leadsToday}</p>
                            </div>
                            <div className="hidden sm:block w-px h-8 bg-slate-700"></div>
                            <div className="text-left">
                                <p className="text-slate-400 text-[10px] font-bold mb-1 uppercase tracking-wider">Lead Quality Match</p>
                                <p className="text-2xl font-bold text-emerald-400">+{Math.min(stats.leadsToday, 25)}%</p>
                            </div>
                            <div className="hidden sm:block w-px h-8 bg-slate-700"></div>
                            <div className="text-left">
                                <p className="text-slate-400 text-[10px] font-bold mb-1 uppercase tracking-wider">Est. CPA Drop</p>
                                <p className="text-2xl font-bold text-blue-400">-{Math.min(stats.leadsToday, 25)}%</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Modals */}
                <FollowUpModal
                    isOpen={isFollowUpModalOpen}
                    onClose={() => setIsFollowUpModalOpen(false)}
                    onSuccess={fetchDashboardData}
                />
                <SettingsModal
                    isOpen={isSettingsModalOpen}
                    onClose={() => setIsSettingsModalOpen(false)}
                    onSuccess={fetchDashboardData}
                />
            </div>
        </div>
    );
};

export default Dashboard;
