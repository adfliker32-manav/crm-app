import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// Human-readable label + colour for each logged action type.
const ACTION_META = {
    LEADS_EXPORTED:      { label: 'Leads exported',   color: 'bg-red-100 text-red-700',       icon: 'fa-file-export' },
    LEAD_CREATED:        { label: 'Lead created',     color: 'bg-green-100 text-green-700',   icon: 'fa-user-plus' },
    LEAD_EDITED:         { label: 'Lead edited',      color: 'bg-blue-100 text-blue-700',     icon: 'fa-pen' },
    LEAD_DELETED:        { label: 'Lead deleted',     color: 'bg-rose-100 text-rose-700',     icon: 'fa-trash' },
    LEAD_STATUS_CHANGED: { label: 'Stage changed',    color: 'bg-indigo-100 text-indigo-700', icon: 'fa-arrows-turn-right' },
    LEAD_ASSIGNED:       { label: 'Lead assigned',    color: 'bg-amber-100 text-amber-700',   icon: 'fa-user-tag' },
    NOTE_ADDED:          { label: 'Note added',       color: 'bg-slate-100 text-slate-600',   icon: 'fa-note-sticky' },
    NOTE_EDITED:         { label: 'Note edited',      color: 'bg-slate-100 text-slate-600',   icon: 'fa-note-sticky' },
    NOTE_DELETED:        { label: 'Note deleted',     color: 'bg-slate-100 text-slate-600',   icon: 'fa-note-sticky' },
    FOLLOWUP_CREATED:    { label: 'Follow-up set',    color: 'bg-cyan-100 text-cyan-700',     icon: 'fa-clock' },
    FOLLOWUP_COMPLETED:  { label: 'Follow-up done',   color: 'bg-cyan-100 text-cyan-700',     icon: 'fa-clock' },
    EMAIL_SENT:          { label: 'Email sent',       color: 'bg-purple-100 text-purple-700', icon: 'fa-envelope' },
    WHATSAPP_SENT:       { label: 'WhatsApp sent',    color: 'bg-green-100 text-green-700',   icon: 'fa-brands fa-whatsapp' },
    STAGE_CREATED:       { label: 'Stage created',    color: 'bg-slate-100 text-slate-600',   icon: 'fa-layer-group' },
    STAGE_DELETED:       { label: 'Stage deleted',    color: 'bg-slate-100 text-slate-600',   icon: 'fa-layer-group' },
    AGENT_CREATED:       { label: 'Agent created',    color: 'bg-teal-100 text-teal-700',     icon: 'fa-user-gear' },
    AGENT_DELETED:       { label: 'Agent removed',    color: 'bg-rose-100 text-rose-700',     icon: 'fa-user-minus' },
    BULK_ACTION:         { label: 'Bulk action',      color: 'bg-slate-100 text-slate-600',   icon: 'fa-layer-group' },
};

// Actions surfaced in the filter dropdown (subset most managers care about).
const FILTERABLE_ACTIONS = [
    'LEADS_EXPORTED', 'LEAD_CREATED', 'LEAD_EDITED', 'LEAD_DELETED',
    'LEAD_ASSIGNED', 'AGENT_CREATED', 'AGENT_DELETED', 'EMAIL_SENT', 'WHATSAPP_SENT',
];

const PAGE_SIZE = 25;

const AuditLogSettings = () => {
    const { showError } = useNotification();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [actionFilter, setActionFilter] = useState('');

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        try {
            const params = { page, limit: PAGE_SIZE };
            if (actionFilter) params.actionType = actionFilter;
            const res = await api.get('/activity-logs', { params });
            setLogs(res.data?.logs || []);
            setPages(res.data?.pagination?.pages || 1);
            setTotal(res.data?.pagination?.total || 0);
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to load the audit log.');
        } finally {
            setLoading(false);
        }
    }, [page, actionFilter, showError]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    const formatTime = (ts) => {
        if (!ts) return '—';
        const d = new Date(ts);
        return d.toLocaleString(undefined, {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    };

    // Build a short, human "what happened" description per row.
    const describe = (log) => {
        if (log.actionType === 'LEADS_EXPORTED') {
            const m = log.metadata || {};
            const scope = m.scope === 'selected' ? 'selected' : 'filtered';
            const f = m.filters || {};
            const activeFilters = ['stage', 'source', 'tag']
                .filter(k => f[k] && f[k] !== 'All')
                .map(k => `${k}: ${f[k]}`)
                .join(', ');
            return (
                <span>
                    <span className="font-semibold text-slate-700">{m.count ?? '?'} leads</span> exported ({scope})
                    {activeFilters ? <span className="text-slate-400"> · {activeFilters}</span> : null}
                </span>
            );
        }
        return <span className="text-slate-600">{log.entityName || log.entityType || '—'}</span>;
    };

    return (
        <div>
            {/* Info banner */}
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
                <i className="fa-solid fa-shield-halved text-blue-500 mt-0.5"></i>
                <p className="text-sm text-slate-600 leading-relaxed">
                    This is a tamper-evident record of important actions in your workspace — including
                    every <span className="font-semibold text-slate-700">lead export</span> (who exported, how many rows, and when).
                    Only you (the account owner) can see this. Entries are retained for 90 days.
                </p>
            </div>

            {/* Toolbar */}
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <select
                        value={actionFilter}
                        onChange={(e) => { setPage(1); setActionFilter(e.target.value); }}
                        className="px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        <option value="">All actions</option>
                        {FILTERABLE_ACTIONS.map(a => (
                            <option key={a} value={a}>{ACTION_META[a]?.label || a}</option>
                        ))}
                    </select>
                    <span className="text-sm text-slate-400">{total} {total === 1 ? 'entry' : 'entries'}</span>
                </div>
                <button
                    onClick={fetchLogs}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-2 transition"
                >
                    <i className="fa-solid fa-rotate-right"></i> Refresh
                </button>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-left">
                                <th className="px-4 py-3 font-bold text-slate-500 uppercase text-xs tracking-wider">When</th>
                                <th className="px-4 py-3 font-bold text-slate-500 uppercase text-xs tracking-wider">User</th>
                                <th className="px-4 py-3 font-bold text-slate-500 uppercase text-xs tracking-wider">Action</th>
                                <th className="px-4 py-3 font-bold text-slate-500 uppercase text-xs tracking-wider">Details</th>
                                <th className="px-4 py-3 font-bold text-slate-500 uppercase text-xs tracking-wider">IP</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                                    <i className="fa-solid fa-spinner fa-spin mr-2"></i> Loading audit log…
                                </td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                                    <i className="fa-solid fa-inbox text-2xl block mb-2"></i>
                                    No activity recorded yet.
                                </td></tr>
                            ) : (
                                logs.map((log) => {
                                    const meta = ACTION_META[log.actionType] || { label: log.actionType, color: 'bg-slate-100 text-slate-600', icon: 'fa-circle-info' };
                                    return (
                                        <tr key={log._id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                                            <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{formatTime(log.timestamp)}</td>
                                            <td className="px-4 py-3 text-slate-700 font-medium whitespace-nowrap">{log.userName || '—'}</td>
                                            <td className="px-4 py-3 whitespace-nowrap">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${meta.color}`}>
                                                    <i className={`fa-solid ${meta.icon}`}></i> {meta.label}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">{describe(log)}</td>
                                            <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{log.ipAddress || '—'}</td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination */}
            {pages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1 || loading}
                        className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                        <i className="fa-solid fa-chevron-left mr-1"></i> Previous
                    </button>
                    <span className="text-sm text-slate-500">Page {page} of {pages}</span>
                    <button
                        onClick={() => setPage(p => Math.min(pages, p + 1))}
                        disabled={page >= pages || loading}
                        className="px-4 py-2 text-sm font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                    >
                        Next <i className="fa-solid fa-chevron-right ml-1"></i>
                    </button>
                </div>
            )}
        </div>
    );
};

export default AuditLogSettings;
