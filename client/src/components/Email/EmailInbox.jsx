import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const EmailInbox = () => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
    const [filters, setFilters] = useState({
        page: 1,
        limit: 50,
        status: '',
        isAutomated: '',
        search: ''
    });
    const [selectedLog, setSelectedLog] = useState(null);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: filters.page,
                limit: filters.limit,
                ...(filters.status && { status: filters.status }),
                ...(filters.isAutomated && { isAutomated: filters.isAutomated }),
                ...(filters.search && { search: filters.search })
            });

            const res = await api.get(`/email-logs/logs?${params}`);
            setLogs(res.data.logs || []);
            setPagination(res.data.pagination || { page: 1, pages: 1, total: 0 });
        } catch (error) {
            console.error("Error fetching email logs:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();
    }, [filters.page, filters.status, filters.isAutomated, filters.search]);

    const handleSearch = (e) => {
        if (e.key === 'Enter') {
            setFilters(prev => ({ ...prev, page: 1, search: e.target.value }));
        }
    };


    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= pagination.pages) {
            setFilters(prev => ({ ...prev, page: newPage }));
        }
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const prices = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + prices[i];
    };

    return (
        <div className="flex h-full bg-white rounded-xl overflow-hidden relative">
            {/* Main List Section */}
            <div className={`flex-1 flex flex-col transition-all duration-300 ${selectedLog ? 'mr-[450px]' : ''}`}>

                {/* Filters Header */}
                <div className="p-4 border-b border-slate-100 flex flex-wrap gap-4 items-center justify-between bg-white sticky top-0 z-10">
                    <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                        <div className="relative w-full max-w-md group">
                            <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors"></i>
                            <input
                                type="text"
                                placeholder="Search emails..."
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-sm font-medium text-slate-700 placeholder:text-slate-400"
                                onKeyDown={handleSearch}
                                onBlur={(e) => setFilters(prev => ({ ...prev, page: 1, search: e.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <select
                            className="px-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm font-medium text-slate-600 outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer hover:bg-slate-100 transition-colors appearance-none"
                            value={filters.status}
                            onChange={(e) => setFilters(prev => ({ ...prev, page: 1, status: e.target.value }))}
                        >
                            <option value="">All Status</option>
                            <option value="sent">Sent</option>
                            <option value="failed">Failed</option>
                        </select>

                        <select
                            className="px-4 py-2.5 bg-slate-50 border-none rounded-xl text-sm font-medium text-slate-600 outline-none focus:ring-2 focus:ring-blue-500/20 cursor-pointer hover:bg-slate-100 transition-colors appearance-none"
                            value={filters.isAutomated}
                            onChange={(e) => setFilters(prev => ({ ...prev, page: 1, isAutomated: e.target.value }))}
                        >
                            <option value="">All Types</option>
                            <option value="true">Automated</option>
                            <option value="false">Manual</option>
                        </select>

                        <button
                            onClick={fetchLogs}
                            className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                            title="Refresh"
                        >
                            <i className="fa-solid fa-rotate-right"></i>
                        </button>
                    </div>
                </div>

                {/* Table Content */}
                <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-white sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Recipient</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider w-1/3">Subject</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Type</th>
                                <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Time</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center text-slate-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <i className="fa-solid fa-circle-notch fa-spin text-2xl text-blue-500"></i>
                                            <p className="text-sm font-medium">Syncing mail log...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center text-slate-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                                                <i className="fa-regular fa-envelope-open text-2xl text-slate-300"></i>
                                            </div>
                                            <p className="text-sm font-medium">No emails found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                logs.map(log => (
                                    <tr
                                        key={log._id}
                                        onClick={() => setSelectedLog(log)}
                                        className={`
                                            group cursor-pointer transition-all duration-200 border-l-4
                                            ${selectedLog?._id === log._id
                                                ? 'bg-blue-50/50 border-blue-500'
                                                : 'hover:bg-slate-50 border-transparent hover:border-slate-200'}
                                        `}
                                    >
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white ${log.status === 'sent' ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-gradient-to-br from-rose-400 to-rose-600'
                                                    }`}>
                                                    {log.to.charAt(0).toUpperCase()}
                                                </div>
                                                <span className="text-sm font-semibold text-slate-700">{log.to}</span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm font-medium text-slate-800 truncate max-w-xs group-hover:text-blue-600 transition-colors">
                                                {log.subject || '(No Subject)'}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${log.status === 'sent' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' : 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                                                    }`}></span>
                                                <span className={`text-xs font-medium ${log.status === 'sent' ? 'text-emerald-700' : 'text-rose-700'
                                                    }`}>
                                                    {log.status === 'sent' ? 'Delivered' : 'Failed'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2.5 py-1 rounded-md text-xs font-medium border ${log.isAutomated
                                                ? 'bg-violet-50 text-violet-700 border-violet-100'
                                                : 'bg-slate-50 text-slate-600 border-slate-200'
                                                }`}>
                                                {log.isAutomated ? 'Automated' : 'Manual'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-right text-xs font-medium text-slate-500">
                                            {formatDate(log.sentAt)}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                <div className="p-4 border-t border-slate-100 flex justify-between items-center bg-white">
                    <span className="text-xs font-medium text-slate-500">
                        Showing {((pagination.page - 1) * filters.limit) + 1} - {Math.min(pagination.page * filters.limit, pagination.total)} of {pagination.total}
                    </span>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => handlePageChange(filters.page - 1)}
                            disabled={filters.page <= 1}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <i className="fa-solid fa-chevron-left text-xs"></i>
                        </button>
                        <button
                            onClick={() => handlePageChange(filters.page + 1)}
                            disabled={filters.page >= pagination.pages}
                            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <i className="fa-solid fa-chevron-right text-xs"></i>
                        </button>
                    </div>
                </div>
            </div>

            {/* Slide-over Drawer Details */}
            <div className={`
                absolute top-0 right-0 h-full w-[450px] bg-white border-l border-slate-200 shadow-2xl transform transition-transform duration-300 z-20 flex flex-col
                ${selectedLog ? 'translate-x-0' : 'translate-x-full'}
            `}>
                {selectedLog && (
                    <>
                        <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Email Details</h3>
                                <p className="text-xs text-slate-500 mt-1 font-mono">{selectedLog._id}</p>
                            </div>
                            <button
                                onClick={() => setSelectedLog(null)}
                                className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-8">
                            {/* Status Banner */}
                            <div className={`p-4 rounded-xl border ${selectedLog.status === 'sent'
                                ? 'bg-emerald-50 border-emerald-100'
                                : 'bg-rose-50 border-rose-100'
                                }`}>
                                <div className="flex items-center gap-3">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${selectedLog.status === 'sent' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                                        }`}>
                                        <i className={`fa-solid ${selectedLog.status === 'sent' ? 'fa-check' : 'fa-circle-exclamation'}`}></i>
                                    </div>
                                    <div>
                                        <p className={`text-sm font-bold ${selectedLog.status === 'sent' ? 'text-emerald-800' : 'text-rose-800'
                                            }`}>
                                            {selectedLog.status === 'sent' ? 'Email Delivered' : 'Delivery Failed'}
                                        </p>
                                        <p className={`text-xs ${selectedLog.status === 'sent' ? 'text-emerald-600' : 'text-rose-600'
                                            }`}>
                                            {formatDate(selectedLog.sentAt)}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Main Info */}
                            <div className="space-y-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Recipient</label>
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                                            <i className="fa-solid fa-user"></i>
                                        </div>
                                        <span className="text-sm font-medium text-slate-700">{selectedLog.to}</span>
                                    </div>
                                </div>

                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1 block">Subject</label>
                                    <p className="text-base font-semibold text-slate-800 leading-snug">{selectedLog.subject}</p>
                                </div>
                            </div>

                            {/* Error Box */}
                            {selectedLog.error && (
                                <div className="p-4 bg-slate-900 rounded-xl text-slate-200">
                                    <div className="flex items-center gap-2 mb-2 text-rose-400">
                                        <i className="fa-solid fa-bug text-xs"></i>
                                        <span className="text-xs font-bold uppercase tracking-wider">Error Log</span>
                                    </div>
                                    <p className="text-sm font-mono break-all opacity-80">{selectedLog.error}</p>
                                </div>
                            )}

                            {/* Attachments */}
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 block flex items-center gap-2">
                                    <i className="fa-solid fa-paperclip"></i> Attachments
                                </label>
                                {selectedLog.attachments && selectedLog.attachments.length > 0 ? (
                                    <div className="grid grid-cols-1 gap-2">
                                        {selectedLog.attachments.map((att, index) => (
                                            <div key={index} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-colors group cursor-default">
                                                <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                                                    <i className="fa-solid fa-file-lines"></i>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-slate-700 truncate">{att.originalName || att.filename}</p>
                                                    <p className="text-xs text-slate-400 group-hover:text-blue-400">{formatFileSize(att.size || 0)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-8 border-2 border-dashed border-slate-100 rounded-xl">
                                        <p className="text-xs text-slate-400">No attachments included</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Drawer Actions */}
                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button
                                className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-100 transition shadow-sm hover:shadow"
                                onClick={() => {/* Resend logic could go here */ }}
                            >
                                <i className="fa-solid fa-reply mr-2"></i>Resend
                            </button>
                            <button
                                onClick={() => setSelectedLog(null)}
                                className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-medium hover:bg-slate-900 transition shadow-lg shadow-slate-200"
                            >
                                Close Panel
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default EmailInbox;
