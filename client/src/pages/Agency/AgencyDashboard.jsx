import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
    Title, Tooltip, Legend, Filler
} from 'chart.js';
import api from '../../services/api';
import TrialBanner from '../../components/TrialBanner';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

const StatCard = ({ label, value, sub, icon, accent, dark }) => (
    <div className={`relative overflow-hidden rounded-2xl border p-6 shadow-sm ${
        dark ? 'bg-gradient-to-br from-indigo-900 to-slate-900 text-white border-transparent shadow-xl shadow-indigo-900/20'
             : 'bg-white border-slate-200/60'
    }`}>
        <div className={`absolute top-0 right-0 p-4 opacity-10`}>
            <i className={`${icon} text-6xl ${dark ? 'text-white' : `text-${accent}-600`}`} />
        </div>
        <p className={`text-sm font-bold tracking-wider uppercase mb-2 ${dark ? 'text-indigo-300' : 'text-slate-500'}`}>{label}</p>
        <h3 className={`text-4xl font-black ${dark ? '' : 'text-slate-900'}`}>{value}</h3>
        {sub && <p className={`text-sm font-semibold mt-2 ${dark ? 'text-indigo-200' : 'text-slate-500'}`}>{sub}</p>}
    </div>
);

const AgencyDashboard = () => {
    const navigate = useNavigate();
    const [stats, setStats] = useState({
        totalClients: 0,
        activeClients: 0,
        pendingClients: 0,
        approvedClients: 0,
        newClientsThisWeek: 0,
        recentSignups: []
    });
    const [growth, setGrowth] = useState({ labels: [], signups: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchAnalytics = async () => {
            try {
                const response = await api.get('/agency/analytics');
                if (response.data?.success) {
                    setStats(prev => ({ ...prev, ...response.data.stats }));
                    if (response.data.growth) setGrowth(response.data.growth);
                }
            } catch (err) {
                console.error("Failed to load agency analytics:", err);
                setError('Failed to load dashboard. Please refresh.');
            } finally {
                setLoading(false);
            }
        };
        fetchAnalytics();
    }, []);

    const inactiveCount = Math.max(0, (stats.totalClients || 0) - (stats.activeClients || 0));

    const chartData = {
        labels: growth.labels,
        datasets: [{
            label: 'New Clients',
            data: growth.signups,
            borderColor: '#6366f1',
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5
        }]
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { mode: 'index', intersect: false }
        },
        scales: {
            x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#94a3b8' } },
            y: { beginAtZero: true, ticks: { precision: 0, font: { size: 10 }, color: '#94a3b8' }, grid: { color: '#f1f5f9' } }
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
        <div className="animate-in fade-in duration-500 max-w-7xl mx-auto space-y-6">
            <TrialBanner />

            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 flex items-center gap-2">
                    <i className="fa-solid fa-circle-exclamation" />{error}
                </div>
            )}

            <div className="mb-2">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Agency Overview</h1>
                <p className="text-slate-500 font-medium mt-1">Manage your white-label platform and analyze sub-tenant growth.</p>
            </div>

            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard
                    label="Total Sub-Clients"
                    value={(stats.totalClients || 0).toLocaleString()}
                    sub={stats.newClientsThisWeek > 0
                        ? <><i className="fa-solid fa-arrow-up mr-1 text-emerald-500" />{stats.newClientsThisWeek} this week</>
                        : <span className="text-slate-400">No new this week</span>}
                    icon="fa-solid fa-buildings"
                    accent="blue"
                />
                <StatCard
                    label="Active Accounts"
                    value={(stats.activeClients || 0).toLocaleString()}
                    sub={inactiveCount > 0 ? `${inactiveCount} not yet live` : 'All clients active'}
                    icon="fa-solid fa-check-circle"
                    accent="emerald"
                />
                <button
                    type="button"
                    onClick={() => navigate('/agency/clients?status=Pending')}
                    className="text-left"
                >
                    <StatCard
                        label="Pending Approval"
                        value={(stats.pendingClients || 0).toLocaleString()}
                        sub={stats.pendingClients > 0
                            ? <><i className="fa-solid fa-hourglass-half mr-1 text-amber-500" />Awaiting Super Admin</>
                            : 'No pending requests'}
                        icon="fa-solid fa-hourglass-half"
                        accent="amber"
                    />
                </button>
                <StatCard
                    label="Approved Total"
                    value={(stats.approvedClients || 0).toLocaleString()}
                    sub="Lifetime approvals"
                    icon="fa-solid fa-shield-check"
                    dark
                />
            </div>

            {/* Growth Chart */}
            <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-6">
                <div className="flex justify-between items-baseline mb-4">
                    <div>
                        <h2 className="text-lg font-black text-slate-800">Client Growth — Last 30 Days</h2>
                        <p className="text-xs text-slate-500 mt-0.5">New sub-client signups by day</p>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-black text-indigo-600">{growth.signups.reduce((a, b) => a + b, 0)}</div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">total in period</div>
                    </div>
                </div>
                <div className="h-64">
                    <Line data={chartData} options={chartOptions} />
                </div>
            </div>

            {/* Recent Clients Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h2 className="text-lg font-bold text-slate-800">Recent Client Signups</h2>
                    <button
                        onClick={() => navigate('/agency/clients')}
                        className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                    >
                        View All
                    </button>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white border-b border-slate-100 text-xs uppercase tracking-widest text-slate-400">
                                <th className="p-4 font-bold">Company Name</th>
                                <th className="p-4 font-bold">Joined</th>
                                <th className="p-4 font-bold">Status</th>
                                <th className="p-4 font-bold text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {stats.recentSignups.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="p-12 text-center text-slate-400">
                                        <i className="fa-regular fa-folder-open text-3xl mb-2 block opacity-50" />
                                        No client signups yet. Create your first client account to get started.
                                    </td>
                                </tr>
                            ) : (
                                stats.recentSignups.map((client) => (
                                    <tr key={client._id} className="hover:bg-slate-50 transition-colors">
                                        <td className="p-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded bg-blue-100 text-blue-600 flex justify-center items-center font-bold text-xs">
                                                    {(client.companyName || client.name || 'U').charAt(0).toUpperCase()}
                                                </div>
                                                <span className="font-semibold text-slate-800">{client.companyName || client.name || 'Unknown Company'}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-slate-500 font-medium">{new Date(client.createdAt).toLocaleDateString()}</td>
                                        <td className="p-4">
                                            {client.is_active ? (
                                                <span className="px-2 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-700">Live</span>
                                            ) : client.status === 'pending' ? (
                                                <span className="px-2 py-1 rounded text-xs font-bold bg-amber-100 text-amber-700">Pending</span>
                                            ) : client.status === 'rejected' ? (
                                                <span className="px-2 py-1 rounded text-xs font-bold bg-red-100 text-red-700">Rejected</span>
                                            ) : (
                                                <span className="px-2 py-1 rounded text-xs font-bold bg-slate-100 text-slate-600">Inactive</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => navigate('/agency/clients')}
                                                className="px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg transition-all shadow-sm"
                                            >
                                                Manage
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AgencyDashboard;
