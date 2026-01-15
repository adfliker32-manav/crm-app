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
    }, [filters.page, filters.status, filters.isAutomated]); // Auto-fetch on these changes

    const handleSearch = (e) => {
        if (e.key === 'Enter') {
            setFilters(prev => ({ ...prev, page: 1, search: e.target.value }));
        }
    };

    // Revised useEffect to include search
    useEffect(() => {
        fetchLogs();
    }, [filters.page, filters.status, filters.isAutomated, filters.search]);


    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= pagination.pages) {
            setFilters(prev => ({ ...prev, page: newPage }));
        }
    };

    const formatDate = (dateString) => {
        return new Date(dateString).toLocaleString();
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const prices = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + prices[i];
    };

    return (
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col h-[calc(100vh-250px)]">
            {/* Filters Header */}
            <div className="p-4 border-b border-slate-100 flex flex-wrap gap-4 items-center justify-between bg-slate-50">
                <div className="flex items-center gap-3 flex-1 min-w-[200px]">
                    <div className="relative w-full max-w-md">
                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input
                            type="text"
                            placeholder="Search by email or subject..."
                            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            onKeyDown={handleSearch}
                            onBlur={(e) => setFilters(prev => ({ ...prev, page: 1, search: e.target.value }))}
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <select
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        value={filters.status}
                        onChange={(e) => setFilters(prev => ({ ...prev, page: 1, status: e.target.value }))}
                    >
                        <option value="">All Status</option>
                        <option value="sent">Sent</option>
                        <option value="failed">Failed</option>
                    </select>

                    <select
                        className="px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                        value={filters.isAutomated}
                        onChange={(e) => setFilters(prev => ({ ...prev, page: 1, isAutomated: e.target.value }))}
                    >
                        <option value="">All Types</option>
                        <option value="true">Automated</option>
                        <option value="false">Manual</option>
                    </select>

                    <button
                        onClick={fetchLogs}
                        className="p-2 text-slate-500 hover:text-blue-600 transition"
                        title="Refresh"
                    >
                        <i className="fa-solid fa-sync"></i>
                    </button>
                </div>
            </div>

            {/* Table Content */}
            <div className="flex-1 overflow-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-3">To</th>
                            <th className="px-6 py-3">Subject</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3">Type</th>
                            <th className="px-6 py-3">Date</th>
                            <th className="px-6 py-3 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {loading ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-12 text-center text-slate-400">
                                    <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                                    <p>Loading emails...</p>
                                </td>
                            </tr>
                        ) : logs.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-12 text-center text-slate-400">
                                    <i className="fa-regular fa-envelope-open text-3xl mb-2"></i>
                                    <p>No emails found</p>
                                </td>
                            </tr>
                        ) : (
                            logs.map(log => (
                                <tr
                                    key={log._id}
                                    onClick={() => setSelectedLog(log)}
                                    className="hover:bg-slate-50 cursor-pointer transition"
                                >
                                    <td className="px-6 py-4 text-sm text-slate-700 font-medium">{log.to}</td>
                                    <td className="px-6 py-4 text-sm text-slate-600 max-w-xs truncate" title={log.subject}>
                                        {log.subject || '(No Subject)'}
                                    </td>
                                    <td className="px-6 py-4">
                                        {log.status === 'sent' ? (
                                            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-bold">
                                                Sent
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full font-bold">
                                                Failed
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        {log.isAutomated ? (
                                            <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                                                Auto
                                            </span>
                                        ) : (
                                            <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium">
                                                Manual
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">
                                        {formatDate(log.sentAt)}
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSelectedLog(log); }}
                                            className="text-blue-600 hover:bg-blue-50 p-2 rounded-lg transition"
                                        >
                                            <i className="fa-solid fa-eye"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
                <button
                    onClick={() => handlePageChange(filters.page - 1)}
                    disabled={filters.page <= 1}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition"
                >
                    Previous
                </button>
                <span className="text-sm text-slate-600 font-medium">
                    Page {pagination.page} of {pagination.pages} ({pagination.total} total)
                </span>
                <button
                    onClick={() => handlePageChange(filters.page + 1)}
                    disabled={filters.page >= pagination.pages}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 transition"
                >
                    Next
                </button>
            </div>

            {/* Log Detail Modal */}
            {selectedLog && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[100] animate-fade-in-up p-4">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Email Details</h3>
                                <p className="text-sm text-slate-500">{formatDate(selectedLog.sentAt)}</p>
                            </div>
                            <button onClick={() => setSelectedLog(null)} className="text-slate-400 hover:text-slate-600">
                                <i className="fa-solid fa-times text-xl"></i>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase">To</label>
                                    <p className="font-medium text-slate-800">{selectedLog.to}</p>
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase">Status</label>
                                    <div>
                                        {selectedLog.status === 'sent' ? (
                                            <span className="text-green-600 font-bold flex items-center gap-2">
                                                <i className="fa-solid fa-check-circle"></i> Sent Successfully
                                            </span>
                                        ) : (
                                            <span className="text-red-600 font-bold flex items-center gap-2">
                                                <i className="fa-solid fa-exclamation-circle"></i> Failed
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase">Subject</label>
                                <p className="font-medium text-slate-800 border-b border-slate-100 pb-2">{selectedLog.subject}</p>
                            </div>

                            {selectedLog.error && (
                                <div className="bg-red-50 p-3 rounded-lg border border-red-100">
                                    <label className="text-xs font-bold text-red-500 uppercase">Error Details</label>
                                    <p className="text-sm text-red-700 font-mono mt-1">{selectedLog.error}</p>
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Attachments</label>
                                {selectedLog.attachments && selectedLog.attachments.length > 0 ? (
                                    <div className="space-y-2">
                                        {selectedLog.attachments.map((att, index) => (
                                            <div key={index} className="flex items-center gap-3 bg-slate-50 p-3 rounded-lg border border-slate-100">
                                                <i className="fa-solid fa-file text-blue-500"></i>
                                                <div>
                                                    <p className="text-sm font-medium text-slate-700">{att.originalName || att.filename}</p>
                                                    <p className="text-xs text-slate-500">{formatFileSize(att.size || 0)}</p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-sm text-slate-500 italic">No attachments</p>
                                )}
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                            <button
                                onClick={() => setSelectedLog(null)}
                                className="px-5 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg font-medium transition"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmailInbox;
