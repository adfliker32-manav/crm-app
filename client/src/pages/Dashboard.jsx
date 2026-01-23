import React, { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import StatCard from '../components/Dashboard/StatCard';
import ChartsRow from '../components/Dashboard/ChartsRow';
import FollowUpModal from '../components/Dashboard/FollowUpModal';
import SettingsModal from '../components/Dashboard/SettingsModal';

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
    const [error, setError] = useState(null);

    const [isFollowUpModalOpen, setIsFollowUpModalOpen] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

    const fetchDashboardData = useCallback(async () => {
        try {
            const [statsRes, followUpRes] = await Promise.all([
                api.get('/leads/analytics-data'),
                api.get('/leads/follow-up-today')
            ]);
            setStats(statsRes.data);
            setFollowUpStats(followUpRes.data);
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
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-slate-700 to-slate-600 bg-clip-text text-transparent">
                            Dashboard
                        </h1>
                        <p className="text-slate-500 text-sm mt-2">Overview of your sales pipeline</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => fetchDashboardData()}
                            className="px-5 py-2.5 bg-white/80 backdrop-blur-xl text-slate-700 hover:text-slate-900 hover:bg-white rounded-xl transition-all duration-300 text-sm font-medium flex items-center gap-2 shadow-lg shadow-slate-200/50 border border-white/50 hover:shadow-xl hover:-translate-y-0.5"
                        >
                            <i className="fa-solid fa-arrows-rotate"></i>
                            Refresh
                        </button>
                        <button
                            onClick={() => setIsSettingsModalOpen(true)}
                            className="px-5 py-2.5 bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-500 hover:from-violet-500 hover:via-blue-500 hover:to-cyan-400 text-white rounded-xl transition-all duration-300 text-sm font-medium flex items-center gap-2 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5"
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
