/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

// 5 leads / batch × 1 batch / 5 s = 60 msgs/min
const MSGS_PER_MIN = 60;

const timeEstimate = (total) => {
    if (!total || total <= 0) return null;
    if (total < MSGS_PER_MIN) return '< 1 min';
    const mins = Math.ceil(total / MSGS_PER_MIN);
    if (mins === 1) return '~1 min';
    if (mins < 60) return `~${mins} mins`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
};

const progressPct = (stats) => {
    if (!stats?.totalTargets) return 0;
    return Math.min(100, Math.round(((stats.sent + stats.failed) / stats.totalTargets) * 100));
};

const WhatsAppBroadcasts = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    const [broadcasts, setBroadcasts]   = useState([]);
    const [templates, setTemplates]     = useState([]);
    const [stages, setStages]           = useState([]);
    const [leads, setLeads]             = useState([]);
    const [loading, setLoading]         = useState(true);
    const [refreshing, setRefreshing]   = useState(false);
    const [showNewModal, setShowNewModal] = useState(false);

    // New broadcast form
    const [newBroadcast, setNewBroadcast] = useState({
        name: '',
        templateId: '',
        targetAudience: { selectionType: 'ALL', tags: [], stages: [] },
        scheduledFor: ''
    });

    // CSV upload state
    const [csvStep, setCsvStep]       = useState(0);   // 0=none 1=mapping 2=ready
    const [csvRaw, setCsvRaw]         = useState([]);
    const [csvColumns, setCsvColumns] = useState([]);
    const [csvMapping, setCsvMapping] = useState({ phone: '', name: '', email: '' });
    const [csvFileName, setCsvFileName] = useState('');
    const csvInputRef = useRef(null);

    // Auto-refresh interval ref
    const autoRefreshRef = useRef(null);

    // ── Data fetching ──────────────────────────────────────────────────────────
    const fetchBroadcasts = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            else setRefreshing(true);
            const res = await api.get('/whatsapp/broadcasts');
            setBroadcasts(res.data.broadcasts || []);
        } catch (error) {
            const d = error.response;
            if (!silent) showError(`Failed to load broadcasts (${d ? `${d.status}: ${d.data?.message}` : error.message})`);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/whatsapp/templates');
            const data = res.data.templates || res.data;
            setTemplates(data.filter(t => t.status === 'APPROVED'));
        } catch {}
    };

    const fetchStagesAndLeads = async () => {
        try {
            const [sRes, lRes] = await Promise.all([api.get('/stages'), api.get('/leads')]);
            setStages(sRes.data || []);
            setLeads(lRes.data.leads || lRes.data || []);
        } catch {}
    };

    useEffect(() => {
        fetchBroadcasts();
        fetchTemplates();
        fetchStagesAndLeads();
    }, []);

    // Auto-refresh every 5 s while any broadcast is PROCESSING
    useEffect(() => {
        const hasProcessing = broadcasts.some(b => b.status === 'PROCESSING');
        if (hasProcessing && !autoRefreshRef.current) {
            autoRefreshRef.current = setInterval(() => fetchBroadcasts(true), 5000);
        } else if (!hasProcessing && autoRefreshRef.current) {
            clearInterval(autoRefreshRef.current);
            autoRefreshRef.current = null;
        }
        return () => {
            if (autoRefreshRef.current) {
                clearInterval(autoRefreshRef.current);
                autoRefreshRef.current = null;
            }
        };
    }, [broadcasts]);

    // ── Broadcast actions ──────────────────────────────────────────────────────
    const handleRefresh = () => fetchBroadcasts(true);

    const buildCsvContacts = () => {
        if (!csvMapping.phone || csvRaw.length === 0) return [];
        return csvRaw
            .map(row => ({
                phone: (row[csvMapping.phone] || '').toString().trim(),
                name:  csvMapping.name  ? (row[csvMapping.name]  || '').toString().trim() : '',
                email: csvMapping.email ? (row[csvMapping.email] || '').toString().trim() : ''
            }))
            .filter(c => c.phone);
    };

    const handleCreateBroadcast = async (e) => {
        e.preventDefault();
        try {
            if (!newBroadcast.name || !newBroadcast.templateId) {
                showError('Name and Template are required');
                return;
            }

            const body = { ...newBroadcast };

            if (newBroadcast.targetAudience.selectionType === 'CSV') {
                const contacts = buildCsvContacts();
                if (contacts.length === 0) {
                    showError('Please upload a CSV and map the phone column');
                    return;
                }
                body.csvContacts = contacts;
            }

            await api.post('/whatsapp/broadcasts', body);
            showSuccess('Broadcast created successfully');
            setShowNewModal(false);
            resetForm();
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to create broadcast');
        }
    };

    const resetForm = () => {
        setNewBroadcast({ name: '', templateId: '', targetAudience: { selectionType: 'ALL', tags: [], stages: [] }, scheduledFor: '' });
        setCsvStep(0); setCsvRaw([]); setCsvColumns([]); setCsvMapping({ phone: '', name: '', email: '' }); setCsvFileName('');
    };

    const handleStartBroadcast = async (id) => {
        const ok = await showDanger('Messages will be sent immediately to all target contacts.', 'Start Broadcast');
        if (!ok) return;
        try {
            await api.post(`/whatsapp/broadcasts/${id}/start`);
            showSuccess('Broadcast started!');
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to start broadcast');
        }
    };

    const handleCancelBroadcast = async (id) => {
        const ok = await showDanger('Are you sure you want to cancel this broadcast?', 'Cancel Broadcast');
        if (!ok) return;
        try {
            await api.post(`/whatsapp/broadcasts/${id}/cancel`);
            showSuccess('Broadcast cancelled');
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to cancel broadcast');
        }
    };

    const handleDeleteBroadcast = async (id) => {
        const ok = await showDanger('This action is permanent and cannot be undone.', 'Delete Broadcast');
        if (!ok) return;
        try {
            await api.delete(`/whatsapp/broadcasts/${id}`);
            showSuccess('Broadcast deleted');
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to delete broadcast');
        }
    };

    const handleExportCsv = async (id, name) => {
        try {
            const res = await api.get(`/whatsapp/broadcasts/${id}/export`, { responseType: 'blob' });
            const url = URL.createObjectURL(res.data);
            const a   = document.createElement('a');
            a.href     = url;
            a.download = `broadcast-${name.replace(/[^a-z0-9]/gi, '_')}-report.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            showError('Failed to export report');
        }
    };

    const handleRetargetFailed = async (id) => {
        try {
            const res = await api.post(`/whatsapp/broadcasts/${id}/retarget-failed`);
            showSuccess(res.data.message || 'Retarget draft created');
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to create retarget broadcast');
        }
    };

    // ── CSV upload ─────────────────────────────────────────────────────────────
    const handleCsvFile = (file) => {
        if (!file) return;
        setCsvFileName(file.name);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (result) => {
                setCsvRaw(result.data);
                const cols = result.meta.fields || [];
                setCsvColumns(cols);
                // Auto-detect common column names
                const find = (candidates) => cols.find(c => candidates.includes(c.toLowerCase())) || '';
                setCsvMapping({
                    phone: find(['phone', 'mobile', 'number', 'contact', 'whatsapp', 'tel', 'cell']),
                    name:  find(['name', 'fullname', 'full_name', 'first_name', 'firstname', 'contact_name']),
                    email: find(['email', 'email_address', 'mail'])
                });
                setCsvStep(1);
            },
            error: () => showError('Failed to parse CSV file')
        });
    };

    const handleDrop = (e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file?.name.endsWith('.csv')) handleCsvFile(file);
        else showError('Please drop a .csv file');
    };

    // ── UI helpers ─────────────────────────────────────────────────────────────
    const getStatusBadge = (status) => {
        const cfg = {
            DRAFT:      'bg-slate-100 text-slate-700',
            SCHEDULED:  'bg-indigo-50 text-indigo-700',
            PROCESSING: 'bg-blue-50 text-blue-700 animate-pulse',
            COMPLETED:  'bg-emerald-50 text-emerald-700',
            FAILED:     'bg-red-50 text-red-700',
            CANCELLED:  'bg-amber-50 text-amber-700'
        };
        return (
            <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${cfg[status] || cfg.DRAFT}`}>
                {status}
            </span>
        );
    };

    // ── Loading state ──────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="w-10 h-10 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    const csvPreview = csvRaw.slice(0, 5);
    const csvContactCount = buildCsvContacts().length;

    return (
        <div className="p-6 max-w-7xl mx-auto">

            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Broadcast Campaigns</h2>
                    <p className="text-slate-500 text-sm mt-1">Send bulk messages to your leads using approved templates.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleRefresh}
                        disabled={refreshing}
                        title="Refresh"
                        className="w-10 h-10 flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded-xl transition"
                    >
                        <i className={`fa-solid fa-rotate-right ${refreshing ? 'animate-spin text-[#00a884]' : ''}`}></i>
                    </button>
                    <button
                        onClick={() => { setShowNewModal(true); resetForm(); }}
                        className="px-5 py-2.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl text-sm font-semibold transition shadow-sm flex items-center gap-2"
                    >
                        <i className="fa-solid fa-bullhorn"></i> New Broadcast
                    </button>
                </div>
            </div>

            {/* ── Broadcasts List ─────────────────────────────────────────────── */}
            {broadcasts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
                    <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                        <i className="fa-solid fa-paper-plane"></i>
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">No broadcasts yet</h3>
                    <p className="text-slate-500 text-sm mb-6 max-w-md mx-auto">
                        Create a broadcast campaign to send announcements, offers, or updates to multiple contacts at once.
                    </p>
                    <button
                        onClick={() => setShowNewModal(true)}
                        className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition"
                    >
                        Create First Broadcast
                    </button>
                </div>
            ) : (
                <div className="grid gap-4">
                    {broadcasts.map(broadcast => {
                        const pct   = progressPct(broadcast.stats);
                        const est   = timeEstimate(broadcast.stats?.totalTargets);
                        const canExport   = broadcast.status === 'COMPLETED';
                        const canRetarget = broadcast.status === 'COMPLETED' && (broadcast.stats?.failed || 0) > 0;

                        return (
                            <div key={broadcast._id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex items-start gap-4 min-w-0">
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                                            broadcast.status === 'COMPLETED'  ? 'bg-emerald-50 text-emerald-600' :
                                            broadcast.status === 'PROCESSING' ? 'bg-blue-50 text-blue-600' :
                                            'bg-slate-50 text-slate-500'
                                        }`}>
                                            <i className="fa-solid fa-bullhorn"></i>
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-3 flex-wrap">
                                                {broadcast.name} {getStatusBadge(broadcast.status)}
                                            </h3>
                                            <div className="flex flex-wrap items-center gap-4 mt-1.5 text-sm text-slate-500">
                                                <span className="flex items-center gap-1.5">
                                                    <i className="fa-regular fa-file-lines text-slate-400"></i>
                                                    {broadcast.templateId?.name || 'Unknown Template'}
                                                </span>
                                                <span className="flex items-center gap-1.5">
                                                    <i className="fa-solid fa-users text-slate-400"></i>
                                                    {broadcast.targetAudience.selectionType}
                                                    {broadcast.targetAudience.selectionType === 'CSV' &&
                                                        ` (${broadcast.csvContacts?.length || 0} contacts)`}
                                                </span>
                                                <span className="flex items-center gap-1.5">
                                                    <i className="fa-regular fa-calendar text-slate-400"></i>
                                                    {new Date(broadcast.createdAt).toLocaleDateString()}
                                                </span>
                                                {broadcast.status === 'PROCESSING' && est && (
                                                    <span className="flex items-center gap-1.5 text-blue-600 font-medium">
                                                        <i className="fa-regular fa-clock text-blue-400"></i>
                                                        Est. {est} total
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex items-center gap-2 shrink-0">
                                        {broadcast.status === 'DRAFT' && (
                                            <button
                                                onClick={() => handleStartBroadcast(broadcast._id)}
                                                className="px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition"
                                            >
                                                <i className="fa-solid fa-play mr-2"></i>Start Now
                                            </button>
                                        )}
                                        {['SCHEDULED', 'PROCESSING'].includes(broadcast.status) && (
                                            <button
                                                onClick={() => handleCancelBroadcast(broadcast._id)}
                                                className="px-4 py-2 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg text-sm font-medium transition"
                                            >
                                                <i className="fa-solid fa-stop mr-2"></i>Cancel
                                            </button>
                                        )}
                                        {canExport && (
                                            <button
                                                onClick={() => handleExportCsv(broadcast._id, broadcast.name)}
                                                title="Export CSV Report"
                                                className="px-3 py-2 bg-slate-50 text-slate-600 hover:bg-slate-100 rounded-lg text-sm font-medium transition flex items-center gap-1.5"
                                            >
                                                <i className="fa-solid fa-download"></i>
                                                <span className="hidden sm:inline">Export</span>
                                            </button>
                                        )}
                                        {canRetarget && (
                                            <button
                                                onClick={() => handleRetargetFailed(broadcast._id)}
                                                title={`Retarget ${broadcast.stats.failed} failed contacts`}
                                                className="px-3 py-2 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-sm font-medium transition flex items-center gap-1.5"
                                            >
                                                <i className="fa-solid fa-rotate-left"></i>
                                                <span className="hidden sm:inline">Retarget Failed</span>
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleDeleteBroadcast(broadcast._id)}
                                            className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition"
                                            title="Delete"
                                        >
                                            <i className="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                </div>

                                {/* Progress bar (PROCESSING only) */}
                                {broadcast.status === 'PROCESSING' && broadcast.stats?.totalTargets > 0 && (
                                    <div className="mt-4">
                                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                                            <span>{broadcast.stats.sent + broadcast.stats.failed} / {broadcast.stats.totalTargets} processed</span>
                                            <span>{pct}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 rounded-full h-2">
                                            <div
                                                className="bg-[#00a884] h-2 rounded-full transition-all duration-500"
                                                style={{ width: `${pct}%` }}
                                            ></div>
                                        </div>
                                    </div>
                                )}

                                {/* Stats bar (COMPLETED or PROCESSING) */}
                                {(broadcast.status === 'COMPLETED' || broadcast.status === 'PROCESSING') && (
                                    <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-5 gap-3">
                                        <div className="bg-slate-50 rounded-lg p-3">
                                            <div className="text-[10px] font-bold text-slate-500 uppercase mb-1">Targets</div>
                                            <div className="text-xl font-bold text-slate-800">{broadcast.stats?.totalTargets || 0}</div>
                                        </div>
                                        <div className="bg-blue-50 rounded-lg p-3">
                                            <div className="text-[10px] font-bold text-blue-600 uppercase mb-1">Sent</div>
                                            <div className="text-xl font-bold text-blue-700">{broadcast.stats?.sent || 0}</div>
                                        </div>
                                        <div className="bg-emerald-50 rounded-lg p-3">
                                            <div className="text-[10px] font-bold text-emerald-600 uppercase mb-1">Delivered</div>
                                            <div className="text-xl font-bold text-emerald-700">{broadcast.stats?.delivered || 0}</div>
                                        </div>
                                        <div className="bg-purple-50 rounded-lg p-3">
                                            <div className="text-[10px] font-bold text-purple-600 uppercase mb-1">Read</div>
                                            <div className="text-xl font-bold text-purple-700">{broadcast.stats?.read || 0}</div>
                                        </div>
                                        <div className="bg-red-50 rounded-lg p-3">
                                            <div className="text-[10px] font-bold text-red-600 uppercase mb-1">Failed</div>
                                            <div className="text-xl font-bold text-red-700">{broadcast.stats?.failed || 0}</div>
                                        </div>
                                    </div>
                                )}

                                {broadcast.errorMessage && (
                                    <div className="mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-lg flex items-start gap-2">
                                        <i className="fa-solid fa-triangle-exclamation mt-0.5 shrink-0"></i>
                                        {broadcast.errorMessage}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Create Broadcast Modal ───────────────────────────────────────── */}
            {showNewModal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Modal header */}
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
                            <h3 className="text-lg font-bold text-slate-800">New Broadcast Campaign</h3>
                            <button onClick={() => { setShowNewModal(false); resetForm(); }} className="text-slate-400 hover:text-slate-600">
                                <i className="fa-solid fa-times text-xl"></i>
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto">
                            <form onSubmit={handleCreateBroadcast} className="space-y-4">

                                {/* Campaign name */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Campaign Name</label>
                                    <input
                                        type="text"
                                        value={newBroadcast.name}
                                        onChange={e => setNewBroadcast({ ...newBroadcast, name: e.target.value })}
                                        placeholder="e.g. Diwali Offer Blast"
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm"
                                        required
                                    />
                                </div>

                                {/* Template */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp Template</label>
                                    <select
                                        value={newBroadcast.templateId}
                                        onChange={e => {
                                            setNewBroadcast({ ...newBroadcast, templateId: e.target.value, media: undefined });
                                        }}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm bg-white"
                                        required
                                    >
                                        <option value="">Select an approved template</option>
                                        {templates.map(t => (
                                            <option key={t._id} value={t._id}>{t.name} ({t.category})</option>
                                        ))}
                                    </select>
                                    {templates.length === 0 && (
                                        <p className="text-xs text-red-500 mt-1">No approved templates found. Create one first.</p>
                                    )}
                                </div>

                                {/* Media Upload for Headers */}
                                {(() => {
                                    const selectedTemplate = templates.find(t => t._id === newBroadcast.templateId);
                                    const headerComp = selectedTemplate?.components?.find(c => c.type === 'HEADER' && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(c.format));
                                    if (!headerComp) return null;

                                    return (
                                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                                <i className="fa-solid fa-paperclip text-[#00a884] mr-2"></i>
                                                Header Media Required ({headerComp.format})
                                            </label>
                                            <div className="flex items-center gap-3">
                                                <input
                                                    type="file"
                                                    accept={
                                                        headerComp.format === 'IMAGE' ? 'image/jpeg,image/png' :
                                                        headerComp.format === 'VIDEO' ? 'video/mp4,video/3gpp' :
                                                        'application/pdf'
                                                    }
                                                    onChange={async (e) => {
                                                        const file = e.target.files?.[0];
                                                        if (!file) return;
                                                        
                                                        const formData = new FormData();
                                                        formData.append('file', file);
                                                        
                                                        try {
                                                            const res = await api.post('/whatsapp/upload-broadcast-media', formData, {
                                                                headers: { 'Content-Type': 'multipart/form-data' }
                                                            });
                                                            setNewBroadcast(prev => ({
                                                                ...prev,
                                                                media: {
                                                                    type: headerComp.format,
                                                                    media_id: res.data.media_id,
                                                                    filename: res.data.filename
                                                                }
                                                            }));
                                                            showSuccess('Media uploaded to Meta successfully');
                                                        } catch (error) {
                                                            showError(error.response?.data?.message || 'Failed to upload media');
                                                            e.target.value = ''; // clear input
                                                        }
                                                    }}
                                                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                                                />
                                            </div>
                                            {newBroadcast.media?.media_id && (
                                                <p className="text-xs text-emerald-600 mt-2 font-medium">
                                                    <i className="fa-solid fa-check-circle mr-1"></i> Attached: {newBroadcast.media.filename}
                                                </p>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Audience type */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Target Audience</label>
                                    <select
                                        value={newBroadcast.targetAudience.selectionType}
                                        onChange={e => {
                                            setNewBroadcast({ ...newBroadcast, targetAudience: { selectionType: e.target.value, stages: [], tags: [] } });
                                            if (e.target.value !== 'CSV') { setCsvStep(0); setCsvRaw([]); setCsvColumns([]); }
                                        }}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm bg-white"
                                    >
                                        <option value="ALL">All Leads ({leads.filter(l => l.phone).length} with phone)</option>
                                        <option value="STAGES">Specific Stages</option>
                                        <option value="CSV">CSV Upload</option>
                                    </select>
                                </div>

                                {/* Stage picker */}
                                {newBroadcast.targetAudience.selectionType === 'STAGES' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-2">Select Target Stage(s)</label>
                                        <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                                            {stages.map(stage => {
                                                const count = leads.filter(l => l.status === stage.name && l.phone).length;
                                                const sel   = newBroadcast.targetAudience.stages.includes(stage.name);
                                                return (
                                                    <label key={stage._id} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${sel ? 'border-[#00a884] bg-[#00a884]/5' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                                        <div className="flex items-center gap-3">
                                                            <input
                                                                type="checkbox"
                                                                checked={sel}
                                                                onChange={(e) => {
                                                                    const cur = [...newBroadcast.targetAudience.stages];
                                                                    if (e.target.checked) cur.push(stage.name);
                                                                    else cur.splice(cur.indexOf(stage.name), 1);
                                                                    setNewBroadcast({ ...newBroadcast, targetAudience: { ...newBroadcast.targetAudience, stages: cur } });
                                                                }}
                                                                className="w-4 h-4 text-[#00a884] rounded border-slate-300"
                                                            />
                                                            <span className="text-sm font-medium text-slate-700">{stage.name}</span>
                                                        </div>
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${count > 0 ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                                                            {count} leads
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                            {stages.length === 0 && <p className="text-xs text-amber-500">No stages found.</p>}
                                        </div>
                                    </div>
                                )}

                                {/* CSV upload */}
                                {newBroadcast.targetAudience.selectionType === 'CSV' && (
                                    <div className="space-y-3">
                                        {/* Drop zone */}
                                        {csvStep === 0 && (
                                            <div
                                                onDragOver={e => e.preventDefault()}
                                                onDrop={handleDrop}
                                                onClick={() => csvInputRef.current?.click()}
                                                className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center cursor-pointer hover:border-[#00a884] hover:bg-[#00a884]/5 transition"
                                            >
                                                <i className="fa-solid fa-file-csv text-3xl text-slate-400 mb-3"></i>
                                                <p className="text-sm font-medium text-slate-600">Drop a CSV file here or click to upload</p>
                                                <p className="text-xs text-slate-400 mt-1">Must include a phone/mobile column</p>
                                                <input
                                                    ref={csvInputRef}
                                                    type="file"
                                                    accept=".csv"
                                                    className="hidden"
                                                    onChange={e => handleCsvFile(e.target.files?.[0])}
                                                />
                                            </div>
                                        )}

                                        {/* Column mapping */}
                                        {csvStep >= 1 && (
                                            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <p className="text-sm font-semibold text-slate-700">
                                                        <i className="fa-solid fa-table-columns mr-2 text-[#00a884]"></i>
                                                        Map Columns — <span className="text-slate-500 font-normal">{csvFileName}</span>
                                                    </p>
                                                    <button type="button" onClick={() => { setCsvStep(0); setCsvRaw([]); setCsvColumns([]); setCsvFileName(''); }} className="text-xs text-slate-400 hover:text-red-500">
                                                        Change file
                                                    </button>
                                                </div>
                                                <p className="text-xs text-slate-500">{csvRaw.length} rows detected</p>

                                                {[
                                                    { key: 'phone', label: 'Phone / WhatsApp Number', required: true },
                                                    { key: 'name',  label: 'Contact Name', required: false },
                                                    { key: 'email', label: 'Email', required: false }
                                                ].map(({ key, label, required }) => (
                                                    <div key={key}>
                                                        <label className="block text-xs font-medium text-slate-600 mb-1">
                                                            {label} {required && <span className="text-red-500">*</span>}
                                                        </label>
                                                        <select
                                                            value={csvMapping[key]}
                                                            onChange={e => setCsvMapping(m => ({ ...m, [key]: e.target.value }))}
                                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#00a884]/30 outline-none"
                                                        >
                                                            <option value="">{required ? '— Select column —' : '— None —'}</option>
                                                            {csvColumns.map(col => (
                                                                <option key={col} value={col}>{col}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ))}

                                                {/* Preview */}
                                                {csvMapping.phone && csvPreview.length > 0 && (
                                                    <div>
                                                        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Preview (first {csvPreview.length} rows)</p>
                                                        <div className="overflow-x-auto rounded-lg border border-slate-200">
                                                            <table className="w-full text-xs">
                                                                <thead className="bg-slate-100">
                                                                    <tr>
                                                                        {['phone', 'name', 'email'].filter(k => csvMapping[k]).map(k => (
                                                                            <th key={k} className="px-3 py-2 text-left font-semibold text-slate-600 capitalize">{k}</th>
                                                                        ))}
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {csvPreview.map((row, i) => (
                                                                        <tr key={i} className="border-t border-slate-100">
                                                                            {['phone', 'name', 'email'].filter(k => csvMapping[k]).map(k => (
                                                                                <td key={k} className="px-3 py-2 text-slate-700 truncate max-w-[140px]">{row[csvMapping[k]] || '—'}</td>
                                                                            ))}
                                                                        </tr>
                                                                    ))}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                        {csvContactCount > 10000 ? (
                                                            <p className="text-xs text-red-600 mt-2 font-medium">
                                                                <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                                                                {csvContactCount} contacts — limit is 10,000 per campaign
                                                            </p>
                                                        ) : (
                                                            <p className="text-xs text-emerald-600 mt-2 font-medium">
                                                                <i className="fa-solid fa-circle-check mr-1"></i>
                                                                {csvContactCount} valid contacts will be used
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Schedule (optional) */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Schedule For <span className="text-xs text-slate-400 font-normal">(optional — leave blank to run as draft)</span>
                                    </label>
                                    <input
                                        type="datetime-local"
                                        value={newBroadcast.scheduledFor}
                                        onChange={e => setNewBroadcast({ ...newBroadcast, scheduledFor: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm"
                                    />
                                    {newBroadcast.scheduledFor && newBroadcast.media?.media_id && new Date(newBroadcast.scheduledFor) > new Date(Date.now() + 29 * 24 * 60 * 60 * 1000) && (
                                        <p className="text-xs text-amber-600 mt-2 font-medium flex items-start gap-1">
                                            <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
                                            Warning: Meta media links expire after 30 days. Since this broadcast is scheduled more than 29 days out, the attached media might fail to send.
                                        </p>
                                    )}
                                </div>

                                {/* Time estimate info */}
                                {(() => {
                                    let count = 0;
                                    const st = newBroadcast.targetAudience.selectionType;
                                    if (st === 'ALL') count = leads.filter(l => l.phone).length;
                                    else if (st === 'STAGES') count = leads.filter(l => newBroadcast.targetAudience.stages.includes(l.status) && l.phone).length;
                                    else if (st === 'CSV') count = csvContactCount;
                                    if (!count) return null;
                                    return (
                                        <div className="bg-blue-50 text-blue-700 rounded-xl p-3 text-sm flex items-center gap-2">
                                            <i className="fa-regular fa-clock text-blue-400 shrink-0"></i>
                                            <span>
                                                <strong>{count}</strong> contacts → estimated <strong>{timeEstimate(count)}</strong> at 60 msgs/min
                                            </span>
                                        </div>
                                    );
                                })()}

                                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100">
                                    <button
                                        type="button"
                                        onClick={() => { setShowNewModal(false); resetForm(); }}
                                        className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={
                                            templates.length === 0 ||
                                            (newBroadcast.targetAudience.selectionType === 'CSV' && (csvContactCount === 0 || csvContactCount > 10000))
                                        }
                                        className="px-5 py-2.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl text-sm font-medium transition shadow-sm disabled:opacity-50"
                                    >
                                        Create Campaign
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WhatsAppBroadcasts;
