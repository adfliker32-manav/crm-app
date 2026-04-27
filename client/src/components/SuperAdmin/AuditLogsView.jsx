/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const AuditLogsView = () => {
    const { showError } = useNotification();
    const [logs, setLogs] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    
    // Filters
    const [page, setPage] = useState(1);
    const [limit] = useState(50);
    const [category, setCategory] = useState('');
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetchLogs();
    }, [page, category]);

    // Handle search debounce
    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1);
            fetchLogs();
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const res = await api.get('/superadmin/audit-logs', {
                params: { page, limit, category, search }
            });
            setLogs(res.data.logs);
            setTotal(res.data.total);
        } catch (error) {
            console.error('Fetch Audit Logs Error:', error);
            showError('Failed to load audit logs');
        } finally {
            setLoading(false);
        }
    };

    const getCategoryBadge = (cat) => {
        switch (cat) {
            case 'SECURITY': return 'bg-red-100 text-red-700 border-red-200';
            case 'BILLING': return 'bg-green-100 text-green-700 border-green-200';
            case 'IMPERSONATION': return 'bg-purple-100 text-purple-700 border-purple-200';
            case 'COMPANY_MANAGEMENT': return 'bg-orange-100 text-orange-700 border-orange-200';
            default: return 'bg-blue-100 text-blue-700 border-blue-200'; // SYSTEM
        }
    };

    const getCategoryIcon = (cat) => {
        switch (cat) {
            case 'SECURITY': return 'fa-shield-halved';
            case 'BILLING': return 'fa-credit-card';
            case 'IMPERSONATION': return 'fa-user-secret';
            case 'COMPANY_MANAGEMENT': return 'fa-building';
            default: return 'fa-server';
        }
    };

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg">
                        <i className="fa-solid fa-terminal text-xl"></i>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Command Center</h1>
                        <p className="text-slate-500 text-sm">Forensic visibility and platform audit logs</p>
                    </div>
                </div>
                <div className="text-right">
                    <p className="text-sm text-slate-500 font-medium">Total Captured Events</p>
                    <p className="text-2xl font-bold text-slate-800">{total.toLocaleString()}</p>
                </div>
            </div>

            {/* Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4">
                <div className="flex-1 relative">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input 
                        type="text" 
                        placeholder="Search by actor, target, or action..." 
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none transition"
                    />
                </div>
                <div className="w-full md:w-64">
                    <select 
                        value={category}
                        onChange={e => { setCategory(e.target.value); setPage(1); }}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-400 outline-none transition font-medium text-slate-700"
                    >
                        <option value="">All Event Categories</option>
                        <option value="SECURITY">Security Alerts</option>
                        <option value="BILLING">Billing Changes</option>
                        <option value="IMPERSONATION">Impersonation Logs</option>
                        <option value="COMPANY_MANAGEMENT">Company Management</option>
                        <option value="SYSTEM">System Events</option>
                    </select>
                </div>
                <button 
                    onClick={fetchLogs}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition flex items-center gap-2"
                >
                    <i className="fa-solid fa-rotate"></i> Sync
                </button>
            </div>

            {/* Log Table */}
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto min-h-[400px]">
                    <table className="w-full text-left">
                        <thead className="bg-slate-900 text-slate-300">
                            <tr>
                                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Timestamp / ID</th>
                                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Event Category</th>
                                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Actor (Who)</th>
                                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Action & Details</th>
                                <th className="px-6 py-4 font-semibold text-xs uppercase tracking-wider">Metadata</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {loading && logs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-slate-400">
                                        <i className="fa-solid fa-circle-notch fa-spin text-3xl mb-3"></i>
                                        <p>Scanning global logs...</p>
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-slate-400">
                                        <i className="fa-solid fa-folder-open text-3xl mb-3 text-slate-300"></i>
                                        <p>No audit logs found matching criteria.</p>
                                    </td>
                                </tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log._id} className="hover:bg-slate-50 transition group">
                                        <td className="px-6 py-4 whitespace-nowrap">
                                            <p className="font-semibold text-slate-700 text-sm">
                                                {new Date(log.timestamp).toLocaleString()}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-mono mt-1 opacity-60 group-hover:opacity-100">
                                                ID: {log._id.slice(-6)}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 text-xs font-bold rounded border ${getCategoryBadge(log.actionCategory)} flex items-center gap-1.5 w-max`}>
                                                <i className={`fa-solid ${getCategoryIcon(log.actionCategory)}`}></i>
                                                {log.actionCategory}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-medium text-slate-800 text-sm">{log.actorName}</p>
                                            <p className="text-xs text-slate-500 mt-0.5 uppercase tracking-wide">
                                                Role: {log.actorRole}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4 min-w-[300px]">
                                            <p className="font-bold text-slate-800 text-sm mb-1">{log.action}</p>
                                            {log.targetName && (
                                                <p className="text-xs text-slate-600 mb-2">
                                                    <span className="text-slate-400">Target:</span> <span className="font-medium bg-slate-100 px-1 py-0.5 rounded">{log.targetName}</span>
                                                </p>
                                            )}
                                            {log.details && Object.keys(log.details).length > 0 && (
                                                <div className="bg-slate-900 rounded p-2 overflow-x-auto">
                                                    <pre className="text-[10px] text-green-400 font-mono">
                                                        {JSON.stringify(log.details, null, 2)}
                                                    </pre>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-6 py-4">
                                            {log.ipAddress && (
                                                <p className="text-xs text-slate-600 font-mono mb-1">
                                                    <i className="fa-solid fa-globe mr-1 text-slate-400"></i> {log.ipAddress}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {total > limit && (
                    <div className="bg-slate-50 border-t border-slate-200 p-4 flex items-center justify-between">
                        <p className="text-sm text-slate-600 font-medium">
                            Showing <span className="font-bold text-slate-800">{(page - 1) * limit + 1}</span> to <span className="font-bold text-slate-800">{Math.min(page * limit, total)}</span> of <span className="font-bold text-slate-800">{total}</span> entries
                        </p>
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page === 1}
                                className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                                Previous
                            </button>
                            <button 
                                onClick={() => setPage(p => p + 1)}
                                disabled={page * limit >= total}
                                className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuditLogsView;
