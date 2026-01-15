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

    // Modal States
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

    if (loading) return <div className="p-10 text-center text-slate-500">Loading Dashboard...</div>;
    if (error) return <div className="p-10 text-center text-red-500">{error}</div>;

    // Prepare Chart Data
    const leadSourceData = {
        labels: stats?.leadSource ? Object.keys(stats.leadSource) : [],
        datasets: [
            {
                data: stats?.leadSource ? Object.values(stats.leadSource) : [],
                backgroundColor: ['#60A5FA', '#34D399', '#F87171', '#FBBF24', '#A78BFA', '#9CA3AF'],
                borderWidth: 0,
            }
        ]
    };

    const leadsOverTimeData = {
        labels: stats?.leadsOverTime ? stats.leadsOverTime.map(d => d.date) : [],
        datasets: [
            {
                label: 'Leads',
                data: stats?.leadsOverTime ? stats.leadsOverTime.map(d => d.count) : [],
                borderColor: '#3B82F6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4,
                fill: true
            }
        ]
    };

    const stageDistributionData = {
        labels: stats?.stageDistribution ? Object.keys(stats.stageDistribution) : [],
        datasets: [
            {
                label: 'Leads by Stage',
                data: stats?.stageDistribution ? Object.values(stats.stageDistribution) : [],
                backgroundColor: ['#60A5FA', '#34D399', '#F87171', '#FBBF24', '#A78BFA', '#9CA3AF'],
                borderWidth: 0
            }
        ]
    };

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                        <i className="fa-solid fa-chart-line text-blue-600"></i>
                        Dashboard
                    </h1>
                    <p className="text-slate-500 mt-1">Analytics and insights overview</p>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={() => setIsSettingsModalOpen(true)}
                        className="bg-gray-100 hover:bg-gray-200 text-gray-600 px-4 py-2 rounded-lg font-medium transition border border-gray-200 flex items-center gap-2"
                        title="Google Sheet Settings"
                    >
                        <i className="fa-solid fa-gear"></i>
                        Settings
                    </button>
                </div>
            </div>

            {/* KPI Cards Row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard
                    title="Total Leads"
                    value={stats?.totalLeads || 0}
                    icon="fa-users"
                    gradient="bg-gradient-to-br from-blue-500 to-blue-600"
                    subtext="All time leads"
                />
                <StatCard
                    title="New Today"
                    value={stats?.leadsToday || 0}
                    icon="fa-calendar-day"
                    gradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
                    subtext="Leads added today"
                />
                <StatCard
                    title="Conversion Rate"
                    value={`${stats?.conversionRate || 0}%`}
                    icon="fa-chart-pie"
                    gradient="bg-gradient-to-br from-purple-500 to-purple-600"
                    subtext="Leads won / Total"
                />
                <div
                    onClick={() => setIsFollowUpModalOpen(true)}
                    className="cursor-pointer hover:shadow-xl transition-shadow"
                >
                    <StatCard
                        title="Follow-up Today"
                        value={Array.isArray(followUpStats) ? followUpStats.length : 0}
                        icon="fa-bell"
                        gradient="bg-gradient-to-br from-orange-500 to-orange-600"
                        subtext="Click to view details"
                    />
                </div>
            </div>

            {/* Follow-up Analytics Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Overdue"
                    value={stats?.followUpOverdue || 0}
                    icon="fa-exclamation-triangle"
                    gradient="bg-gradient-to-br from-red-500 to-red-600"
                    subtext="Follow-ups past due date"
                />
                <StatCard
                    title="Upcoming"
                    value={stats?.followUpUpcoming || 0}
                    icon="fa-calendar-week"
                    gradient="bg-gradient-to-br from-yellow-500 to-yellow-600"
                    subtext="Next 7 days"
                />
                <StatCard
                    title="Total Scheduled"
                    value={stats?.followUpTotal || 0}
                    icon="fa-list-check"
                    gradient="bg-gradient-to-br from-purple-500 to-purple-600"
                    subtext="All scheduled follow-ups"
                />
            </div>

            {/* Charts Row */}
            <ChartsRow
                leadSourceData={leadSourceData}
                leadsOverTimeData={leadsOverTimeData}
                stageDistributionData={stageDistributionData}
            />

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
    );
};

export default Dashboard;
