/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import ReportFilters from '../components/Reports/ReportFilters';
import ConversionReport from '../components/Reports/ConversionReport';
import AgentPerformance from '../components/Reports/AgentPerformance';
import AgentPerformanceDetail from '../components/Reports/AgentPerformanceDetail';
import RevenueReport from '../components/Reports/RevenueReport';
import GoalTracker from '../components/Reports/GoalTracker';
import FunnelChart from '../components/Reports/FunnelChart';
import ActivityMetrics from '../components/Reports/ActivityMetrics';
import ExportReport from '../components/Reports/ExportReport';

const Reports = () => {
    const { user } = useAuth();
    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const canViewReports = canManageTeam || user?.permissions?.viewReports === true;

    const [activeTab, setActiveTab] = useState('conversion');
    const [period, setPeriod] = useState('month');
    const [dateRange, setDateRange] = useState({ start: null, end: null });
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [selectedAgentId, setSelectedAgentId] = useState(null);

    const handleViewAgentDetails = (agentId) => {
        setSelectedAgentId(agentId);
        setActiveTab('agent-detail');
    };

    // Tabs that fetch their own data independently (no central fetch needed)
    const selfManagedTabs = ['agent-detail', 'goals', 'funnel', 'activity', 'export'];

    const fetchReportData = useCallback(async () => {
        if (selfManagedTabs.includes(activeTab)) {
            setLoading(false);
            return;
        }

        setLoading(true);
        setError(null);
        try {
            let endpoint = '/reports/';
            switch (activeTab) {
                case 'conversion': endpoint += 'conversion'; break;
                case 'agents': endpoint += 'agent-performance'; break;
                case 'revenue': endpoint += 'revenue'; break;
                default: endpoint += 'comprehensive';
            }

            const params = new URLSearchParams({ period });
            if (period === 'custom' && dateRange.start && dateRange.end) {
                params.append('startDate', dateRange.start);
                params.append('endDate', dateRange.end);
            }

            const res = await api.get(`${endpoint}?${params.toString()}`);
            setData(res.data);
        } catch (err) {
            console.error('Failed to fetch report:', err);
            setError(err.response?.data?.message || 'Failed to load report data. Please try again.');
        } finally {
            setLoading(false);
        }
    }, [activeTab, period, dateRange]);

    useEffect(() => {
        fetchReportData();
    }, [fetchReportData]);

    const tabs = [
        { id: 'conversion', label: 'Conversion', icon: 'fa-chart-pie', group: 'core' },
        { id: 'agents', label: 'Agent Performance', icon: 'fa-users', group: 'core' },
        { id: 'agent-detail', label: 'Agent Detail', icon: 'fa-user-chart', group: 'core' },
        { id: 'revenue', label: 'Revenue', icon: 'fa-indian-rupee-sign', group: 'core' },
        { id: 'funnel', label: 'Funnel & Close Time', icon: 'fa-filter', group: 'advanced', badge: 'New' },
        { id: 'activity', label: 'Activity Metrics', icon: 'fa-bolt', group: 'advanced', badge: 'New' },
        { id: 'goals', label: 'Goal Tracking', icon: 'fa-bullseye', group: 'advanced', badge: 'New' },
        { id: 'export', label: 'Export', icon: 'fa-download', group: 'export', badge: 'New' },
    ];

    if (!canViewReports) return <Navigate to="/dashboard" replace />;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/50 to-violet-50/50">
            {/* Background orbs */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-20 left-20 w-72 h-72 bg-emerald-400/20 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-20 right-20 w-96 h-96 bg-violet-400/20 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
            </div>

            <div className="relative z-10 p-8 space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-slate-800 via-slate-700 to-slate-600 bg-clip-text text-transparent flex items-center gap-3">
                            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                                <i className="fa-solid fa-chart-line text-white text-sm"></i>
                            </span>
                            Reports & Analytics
                        </h1>
                        <p className="text-slate-500 text-sm mt-2">Track performance, conversions, revenue, funnels, and goals</p>
                    </div>
                    <button
                        onClick={fetchReportData}
                        className="px-5 py-2.5 bg-white/80 backdrop-blur-xl text-slate-700 hover:text-slate-900 hover:bg-white rounded-xl transition-all duration-300 text-sm font-medium flex items-center gap-2 shadow-lg shadow-slate-200/50 border border-white/50"
                    >
                        <i className={`fa-solid fa-arrows-rotate ${loading ? 'animate-spin' : ''}`}></i>
                        Refresh
                    </button>
                </div>

                {/* Filters */}
                <ReportFilters
                    period={period}
                    setPeriod={setPeriod}
                    dateRange={dateRange}
                    setDateRange={setDateRange}
                />

                {/* Tabs */}
                <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/50 shadow-xl p-2 flex flex-wrap gap-2">
                    {/* Core tabs */}
                    <div className="flex flex-wrap gap-2 flex-1">
                        {tabs.filter(t => t.group === 'core').map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-300 flex items-center gap-2 ${activeTab === tab.id
                                    ? 'bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/25'
                                    : 'text-slate-600 hover:bg-slate-100'}`}
                            >
                                <i className={`fa-solid ${tab.icon}`}></i>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    {/* Separator */}
                    <div className="w-px bg-slate-200 self-stretch mx-1 hidden sm:block"></div>
                    {/* Advanced tabs */}
                    {tabs.filter(t => t.group === 'advanced' || t.group === 'export').map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-4 py-2.5 rounded-xl font-medium text-sm transition-all duration-300 flex items-center gap-2 ${activeTab === tab.id
                                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/25'
                                : 'text-slate-600 hover:bg-slate-100'}`}
                        >
                            <i className={`fa-solid ${tab.icon}`}></i>
                            {tab.label}
                            {tab.badge && activeTab !== tab.id && (
                                <span className="bg-emerald-100 text-emerald-700 text-[9px] font-bold px-1.5 rounded-full">{tab.badge}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Report Content */}
                <div className="bg-white/80 backdrop-blur-xl rounded-2xl border border-white/50 shadow-xl p-6">
                    {loading && !selfManagedTabs.includes(activeTab) ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="text-center">
                                <div className="relative">
                                    <div className="w-16 h-16 border-4 border-blue-200 rounded-full animate-spin mx-auto mb-6"></div>
                                    <div className="w-16 h-16 border-4 border-transparent border-t-blue-600 rounded-full animate-spin mx-auto mb-6 absolute top-0 left-1/2 -translate-x-1/2"></div>
                                </div>
                                <p className="text-slate-500 text-sm font-medium">Loading report data...</p>
                            </div>
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="text-center">
                                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-500/25">
                                    <i className="fa-solid fa-exclamation text-white text-2xl"></i>
                                </div>
                                <p className="text-rose-600 font-semibold text-lg mb-2">{error}</p>
                                <button
                                    onClick={fetchReportData}
                                    className="mt-4 px-6 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl font-medium text-sm shadow-lg shadow-blue-500/25 hover:shadow-xl transition-all duration-300 flex items-center gap-2 mx-auto"
                                >
                                    <i className="fa-solid fa-arrows-rotate"></i>
                                    Try Again
                                </button>
                            </div>
                        </div>
                    ) : (
                        <>
                            {activeTab === 'conversion' && <ConversionReport data={data} />}
                            {activeTab === 'agents' && <AgentPerformance data={data} onViewDetails={handleViewAgentDetails} />}
                            {activeTab === 'agent-detail' && <AgentPerformanceDetail period={period} dateRange={dateRange} preSelectedAgentId={selectedAgentId} />}
                            {activeTab === 'revenue' && <RevenueReport data={data} />}
                            {activeTab === 'funnel' && <FunnelChart period={period} />}
                            {activeTab === 'activity' && <ActivityMetrics period={period} />}
                            {activeTab === 'goals' && <GoalTracker period={period} />}
                            {activeTab === 'export' && <ExportReport period={period} dateRange={dateRange} />}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Reports;
