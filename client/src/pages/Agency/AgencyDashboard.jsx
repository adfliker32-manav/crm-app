import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import TrialBanner from '../../components/TrialBanner';

const AgencyDashboard = () => {
    const [stats, setStats] = useState({
        totalClients: 0,
        activeClients: 0,
        totalMRR: 0,
        recentSignups: []
    });

    useEffect(() => {
        const fetchAnalytics = async () => {
            try {
                const response = await api.get('/agency/analytics');
                if (response.data?.success) {
                    setStats((prev) => ({
                        ...prev,
                        ...response.data.stats
                    }));
                }
            } catch (error) {
                console.error("Failed to load agency analytics:", error);
            }
        };
        fetchAnalytics();
    }, []);

    return (
        <div className="animate-in fade-in duration-500 max-w-7xl mx-auto space-y-6">
            {/* ⏳ PREMIUM TRIAL BANNER (DASHBOARD ONLY) ⏳ */}
            <TrialBanner />

            <div className="mb-8">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Agency Overview</h1>
                <p className="text-slate-500 font-medium mt-1">Manage your white-label platform and analyze sub-tenant growth.</p>
            </div>

            {/* Top Metric Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4 opacity-10"><i className="fa-solid fa-buildings text-6xl text-blue-600"></i></div>
                    <p className="text-sm font-bold tracking-wider text-slate-500 uppercase mb-2">Total Sub-Clients</p>
                    <h3 className="text-4xl font-black text-slate-900">{stats.totalClients || 0}</h3>
                    <p className="text-emerald-500 text-sm font-semibold mt-2"><i className="fa-solid fa-arrow-up mr-1"></i> 2 this week</p>
                </div>
                
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4 opacity-10"><i className="fa-solid fa-check-circle text-6xl text-emerald-600"></i></div>
                    <p className="text-sm font-bold tracking-wider text-slate-500 uppercase mb-2">Active Subscriptions</p>
                    <h3 className="text-4xl font-black text-slate-900">{stats.activeClients || 0}</h3>
                    <p className="text-slate-400 text-sm font-semibold mt-2">{(stats.totalClients || 0) - (stats.activeClients || 0)} in grace period</p>
                </div>

                <div className="bg-gradient-to-br from-indigo-900 to-slate-900 p-6 rounded-2xl shadow-xl shadow-indigo-900/20 overflow-hidden relative text-white">
                    <div className="absolute top-0 right-0 p-4 opacity-10"><i className="fa-solid fa-sack-dollar text-6xl text-white"></i></div>
                    <p className="text-sm font-bold tracking-wider text-indigo-300 uppercase mb-2">Estimated MRR</p>
                    <h3 className="text-4xl font-black">${(stats.totalMRR || 0).toLocaleString()}</h3>
                    <p className="text-indigo-200 text-sm font-semibold mt-2">After platform processing fees</p>
                </div>
            </div>

            {/* Recent Clients Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200/60 overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <h2 className="text-lg font-bold text-slate-800">Recent Client Signups</h2>
                    <button className="text-sm font-semibold text-blue-600 hover:text-blue-700">View All</button>
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
                            {stats.recentSignups.map((client) => (
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
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                                            client.status === 'Active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                        }`}>
                                            {client.status}
                                        </span>
                                    </td>
                                    <td className="p-4 text-right">
                                        <button className="px-3 py-1.5 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg transition-all shadow-sm">
                                            Manage
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default AgencyDashboard;
