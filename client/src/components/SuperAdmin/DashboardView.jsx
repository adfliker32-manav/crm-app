import React, { useState, useEffect } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
} from 'chart.js';
import api from '../../services/api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const DashboardView = () => {
    const [stats, setStats] = useState({
        totalCompanies: 0,
        totalLeads: 0,
        totalAgents: 0,
        activeSubscriptions: 0
    });
    const [recentSignups, setRecentSignups] = useState([]);
    const [growthData, setGrowthData] = useState(null);
    const [cloudUsage, setCloudUsage] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchDashboardData();
    }, []);

    const fetchDashboardData = async () => {
        try {
            const [statsRes, signupsRes, growthRes, cloudRes] = await Promise.all([
                api.get('/superadmin/stats'),
                api.get('/superadmin/recent-signups'),
                api.get('/superadmin/growth-data'),
                api.get('/superadmin/cloud-usage')
            ]);

            setStats(statsRes.data);
            setRecentSignups(signupsRes.data);
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
            {
                label: 'Companies',
                data: growthData.companies || [],
                borderColor: '#8B5CF6',
                backgroundColor: 'rgba(139, 92, 246, 0.1)',
                tension: 0.4,
                fill: true,
            },
            {
                label: 'Leads',
                data: growthData.leads || [],
                borderColor: '#10B981',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                tension: 0.4,
                fill: true,
            }
        ]
    } : null;

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top',
            },
            title: {
                display: true,
                text: 'Growth Analytics (Last 30 Days)',
                font: { size: 16, weight: 'bold' }
            }
        },
        scales: {
            y: {
                beginAtZero: true
            }
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400"></i>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Super Admin Dashboard</h1>
                    <p className="text-slate-500 mt-1">Overview of all companies and system metrics</p>
                </div>
                <button
                    onClick={fetchDashboardData}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition shadow-md flex items-center gap-2"
                >
                    <i className="fa-solid fa-rotate"></i>
                    Refresh
                </button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard
                    title="Total Companies"
                    value={stats.totalCompanies}
                    icon="fa-building"
                    gradient="bg-gradient-to-br from-purple-500 to-purple-600"
                    iconBg="bg-purple-100 text-purple-600"
                />
                <StatCard
                    title="Total Leads"
                    value={stats.totalLeads}
                    icon="fa-users"
                    gradient="bg-gradient-to-br from-blue-500 to-blue-600"
                    iconBg="bg-blue-100 text-blue-600"
                />
                <StatCard
                    title="Total Agents"
                    value={stats.totalAgents}
                    icon="fa-user-tie"
                    gradient="bg-gradient-to-br from-emerald-500 to-emerald-600"
                    iconBg="bg-emerald-100 text-emerald-600"
                />
                <StatCard
                    title="Active Subscriptions"
                    value={stats.activeSubscriptions}
                    icon="fa-check-circle"
                    gradient="bg-gradient-to-br from-orange-500 to-orange-600"
                    iconBg="bg-orange-100 text-orange-600"
                />
            </div>

            {/* Global Cloud Usage Widget */}
            {cloudUsage && (
                <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-6">
                        <i className="fa-solid fa-cloud text-blue-500"></i>
                        Platform-Wide Cloud Usage (Current Cycle)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* WhatsApp Metric */}
                        <div>
                            <div className="flex justify-between items-end mb-2">
                                <div>
                                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">WhatsApp Output</p>
                                    <h4 className="text-2xl font-black text-slate-800">
                                        {cloudUsage.whatsapp.sent.toLocaleString()} 
                                        <span className="text-sm font-medium text-slate-400 ml-1">/ {cloudUsage.whatsapp.limit.toLocaleString()} msgs</span>
                                    </h4>
                                </div>
                                <div className="text-green-500 bg-green-50 w-10 h-10 flex items-center justify-center rounded-lg shadow-sm">
                                    <i className="fa-brands fa-whatsapp text-xl"></i>
                                </div>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-3 mb-1 overflow-hidden">
                                <div 
                                    className="bg-green-500 h-3 rounded-full" 
                                    style={{ width: `${Math.min(100, (cloudUsage.whatsapp.sent / (cloudUsage.whatsapp.limit || 1)) * 100)}%` }}
                                ></div>
                            </div>
                        </div>

                        {/* Email Metric */}
                        <div>
                            <div className="flex justify-between items-end mb-2">
                                <div>
                                    <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">Email Output</p>
                                    <h4 className="text-2xl font-black text-slate-800">
                                        {cloudUsage.email.sent.toLocaleString()} 
                                        <span className="text-sm font-medium text-slate-400 ml-1">/ {cloudUsage.email.limit.toLocaleString()} emails</span>
                                    </h4>
                                </div>
                                <div className="text-blue-500 bg-blue-50 w-10 h-10 flex items-center justify-center rounded-lg shadow-sm">
                                    <i className="fa-regular fa-envelope text-xl"></i>
                                </div>
                            </div>
                            <div className="w-full bg-slate-100 rounded-full h-3 mb-1 overflow-hidden">
                                <div 
                                    className="bg-blue-500 h-3 rounded-full" 
                                    style={{ width: `${Math.min(100, (cloudUsage.email.sent / (cloudUsage.email.limit || 1)) * 100)}%` }}
                                ></div>
                            </div>
                        </div>
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
                <div className="p-6 border-b border-slate-200">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-clock-rotate-left text-blue-600"></i>
                        Recent Signups
                    </h3>
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
                                            <h4 className="font-bold text-slate-800">{company.companyName}</h4>
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
const StatCard = ({ title, value, icon, gradient, iconBg }) => {
    return (
        <div className={`${gradient} rounded-xl shadow-lg p-6 text-white transform hover:scale-105 transition-transform duration-200`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-white/80 text-sm font-medium mb-1">{title}</p>
                    <h3 className="text-3xl font-bold">{value.toLocaleString()}</h3>
                </div>
                <div className={`${iconBg} w-14 h-14 rounded-lg flex items-center justify-center shadow-md`}>
                    <i className={`fa-solid ${icon} text-2xl`}></i>
                </div>
            </div>
        </div>
    );
};

export default DashboardView;
