import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';

// ─────────────────────────────────────────────────────────────────────────────
// Delivery log.
//
// GET /email-logs/logs has existed (with search, status and automation filters
// and full pagination) but nothing in the UI ever called it. The only signal a
// user had about a failed email was a number on the stats bar — the recipient,
// the subject and the stored `error` string were all unreachable.
// ─────────────────────────────────────────────────────────────────────────────

const TRIGGER_LABELS = {
    on_lead_create:  'Lead created',
    on_stage_change: 'Stage change',
    manual:          'Manual',
    template:        'Template',
    workflow:        'Workflow',
    automation_rule: 'Automation rule',
    sequence:        'Sequence',
    follow_up:       'Follow-up',
    chatbot:         'Chatbot',
    api:             'API',
    campaign:        'Campaign'
};

const PAGE_SIZE = 25;

const EmailLogs = () => {
    const [logs, setLogs] = useState([]);
    const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('');
    const [automated, setAutomated] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [expanded, setExpanded] = useState(null);
    // The list query uses .select('-body'), so the message preview comes from
    // GET /email-logs/logs/:id — an endpoint that existed but nothing called.
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const toggleRow = async (logId) => {
        if (expanded === logId) { setExpanded(null); setDetail(null); return; }
        setExpanded(logId);
        setDetail(null);
        setDetailLoading(true);
        try {
            const res = await api.get(`/email-logs/logs/${logId}`);
            setDetail(res.data);
        } catch {
            setDetail(null);
        } finally {
            setDetailLoading(false);
        }
    };

    // Debounced search term — typing must not fire one request per keystroke.
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const firstLoad = useRef(true);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
        return () => clearTimeout(t);
    }, [search]);

    // Any filter change resets to page 1, otherwise you can land on an empty page.
    useEffect(() => { setPage(1); }, [status, automated, debouncedSearch]);

    const fetchLogs = useCallback(async () => {
        if (!firstLoad.current) setLoading(true);
        try {
            const params = { page, limit: PAGE_SIZE };
            if (status) params.status = status;
            if (automated !== '') params.isAutomated = automated;
            if (debouncedSearch) params.search = debouncedSearch;

            const res = await api.get('/email-logs/logs', { params });
            setLogs(res.data.logs || []);
            setPagination(res.data.pagination || { page: 1, pages: 1, total: 0 });
        } catch (error) {
            console.error('Error fetching email logs:', error);
            setLogs([]);
        } finally {
            firstLoad.current = false;
            setLoading(false);
        }
    }, [page, status, automated, debouncedSearch]);

    useEffect(() => { fetchLogs(); }, [fetchLogs]);

    const filterBtn = (active) =>
        `px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
            active ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
        }`;

    return (
        <div className="p-6 flex flex-col gap-5">
            {/* Toolbar */}
            <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
                <div className="relative w-full lg:w-80">
                    <i className="fa-solid fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                    <input
                        type="text"
                        placeholder="Search recipient or subject..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border-transparent focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-100 border rounded-xl text-sm transition outline-none"
                    />
                </div>

                <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">Status</span>
                        <button onClick={() => setStatus('')} className={filterBtn(status === '')}>All</button>
                        <button onClick={() => setStatus('sent')} className={filterBtn(status === 'sent')}>Sent</button>
                        <button onClick={() => setStatus('failed')} className={filterBtn(status === 'failed')}>Failed</button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mr-1">Source</span>
                        <button onClick={() => setAutomated('')} className={filterBtn(automated === '')}>All</button>
                        <button onClick={() => setAutomated('false')} className={filterBtn(automated === 'false')}>Manual</button>
                        <button onClick={() => setAutomated('true')} className={filterBtn(automated === 'true')}>Automated</button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-64 gap-3">
                    <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm text-slate-500 font-medium">Loading delivery log...</p>
                </div>
            ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center">
                        <i className="fa-solid fa-list-check text-3xl text-slate-300"></i>
                    </div>
                    <div className="text-center">
                        <p className="text-slate-600 font-semibold text-base">No delivery records</p>
                        <p className="text-slate-400 text-sm mt-1">
                            {search || status || automated !== '' ? 'Try a different filter' : 'Sent emails will appear here'}
                        </p>
                    </div>
                </div>
            ) : (
                <>
                    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                        {/* Wide table must scroll inside its own container */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm min-w-[720px]">
                                <thead>
                                    <tr className="bg-slate-50/70 border-b border-slate-100">
                                        <th className="text-left px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                        <th className="text-left px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Recipient</th>
                                        <th className="text-left px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Subject</th>
                                        <th className="text-left px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Source</th>
                                        <th className="text-left px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Engagement</th>
                                        <th className="text-right px-5 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Sent</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {logs.map(log => {
                                        const failed = log.status === 'failed';
                                        const isOpen = expanded === log._id;
                                        return (
                                            <React.Fragment key={log._id}>
                                                <tr
                                                    onClick={() => toggleRow(log._id)}
                                                    className={`cursor-pointer transition ${failed ? 'hover:bg-rose-50/40' : 'hover:bg-slate-50'}`}
                                                >
                                                    <td className="px-5 py-3">
                                                        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
                                                            failed ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
                                                        }`}>
                                                            <i className={`fa-solid ${failed ? 'fa-xmark' : 'fa-check'} text-[9px]`}></i>
                                                            {failed ? 'Failed' : 'Sent'}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3">
                                                        <p className="font-semibold text-slate-700 text-[13px] truncate max-w-[200px]">
                                                            {log.leadId?.name || log.to}
                                                        </p>
                                                        {log.leadId?.name && (
                                                            <p className="text-[11px] text-slate-400 truncate max-w-[200px]">{log.to}</p>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 text-slate-600 text-[13px] truncate max-w-[260px]">
                                                        {log.subject || '(No subject)'}
                                                    </td>
                                                    <td className="px-5 py-3">
                                                        <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded-md whitespace-nowrap">
                                                            {TRIGGER_LABELS[log.triggerType] || log.triggerType || 'Manual'}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3">
                                                        {failed ? (
                                                            <span className="text-slate-300 text-xs">—</span>
                                                        ) : (
                                                            <span className="flex items-center gap-3 text-[11px] font-semibold">
                                                                <span className={log.opens > 0 ? 'text-emerald-600' : 'text-slate-300'}>
                                                                    <i className="fa-solid fa-envelope-open mr-1"></i>{log.opens || 0}
                                                                </span>
                                                                <span className={log.clicks > 0 ? 'text-blue-600' : 'text-slate-300'}>
                                                                    <i className="fa-solid fa-arrow-pointer mr-1"></i>{log.clicks || 0}
                                                                </span>
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-5 py-3 text-right text-[11px] text-slate-400 font-medium whitespace-nowrap">
                                                        {new Date(log.sentAt).toLocaleString([], {
                                                            month: 'short', day: 'numeric',
                                                            hour: '2-digit', minute: '2-digit'
                                                        })}
                                                    </td>
                                                </tr>
                                                {isOpen && (
                                                    <tr className="bg-slate-50/60">
                                                        <td colSpan={6} className="px-5 py-4">
                                                            <div className="space-y-2 text-[12px]">
                                                                {failed && log.error && (
                                                                    <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3">
                                                                        <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest mb-1">Failure reason</p>
                                                                        <p className="text-rose-700 font-medium break-words">{log.error}</p>
                                                                    </div>
                                                                )}
                                                                {/* Message preview — needs the detail fetch, the
                                                                    list response deliberately omits the body. */}
                                                                <div>
                                                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Message</p>
                                                                    {detailLoading ? (
                                                                        <p className="text-slate-400 text-xs"><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Loading…</p>
                                                                    ) : detail?.body ? (
                                                                        <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 max-h-32 overflow-y-auto">
                                                                            <p className="text-slate-600 whitespace-pre-wrap break-words">{detail.body}</p>
                                                                            {detail.bodyTruncated && (
                                                                                <p className="text-[10px] text-slate-400 mt-1 italic">
                                                                                    Preview truncated — full content is not retained in the log.
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    ) : (
                                                                        <p className="text-slate-400 text-xs">No preview available</p>
                                                                    )}
                                                                </div>

                                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                                    <div>
                                                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Template</p>
                                                                        <p className="text-slate-600 font-semibold">{log.templateId?.name || '—'}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Attachments</p>
                                                                        <p className="text-slate-600 font-semibold">{log.attachments?.length || 0}</p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">First opened</p>
                                                                        <p className="text-slate-600 font-semibold">
                                                                            {log.openedAt ? new Date(log.openedAt).toLocaleString() : '—'}
                                                                        </p>
                                                                    </div>
                                                                    <div>
                                                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last clicked</p>
                                                                        <p className="text-slate-600 font-semibold">
                                                                            {log.clickedAt ? new Date(log.clickedAt).toLocaleString() : '—'}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between">
                        <p className="text-xs text-slate-400 font-medium">
                            Page {pagination.page} of {pagination.pages || 1} · {pagination.total} record{pagination.total === 1 ? '' : 's'}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setPage(p => Math.max(1, p - 1))}
                                disabled={page <= 1}
                                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                            >
                                <i className="fa-solid fa-chevron-left mr-1.5"></i> Previous
                            </button>
                            <button
                                onClick={() => setPage(p => p + 1)}
                                disabled={page >= (pagination.pages || 1)}
                                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition"
                            >
                                Next <i className="fa-solid fa-chevron-right ml-1.5"></i>
                            </button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default EmailLogs;
