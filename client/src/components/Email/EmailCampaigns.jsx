import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { hasEmailPermission } from './emailPermissions';

// ─────────────────────────────────────────────────────────────────────────────
// Bulk campaigns.
//
// POST /api/email/campaign was routed and gated behind the `campaigns` feature
// flag but returned 501. Sending runs as batched Agenda jobs server-side, so
// this view creates campaigns and monitors progress — it never blocks on a send.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
    draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-600',   icon: 'fa-pen' },
    sending:   { label: 'Sending',   cls: 'bg-blue-50 text-blue-600',      icon: 'fa-paper-plane' },
    paused:    { label: 'Paused',    cls: 'bg-amber-50 text-amber-700',    icon: 'fa-pause' },
    completed: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-600', icon: 'fa-check' },
    cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500',   icon: 'fa-ban' },
    failed:    { label: 'Failed',    cls: 'bg-rose-50 text-rose-600',      icon: 'fa-triangle-exclamation' }
};

const EmailCampaigns = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const { user } = useAuth();
    // Creating and stopping campaigns is gated by sendBulkEmails on the server;
    // read-only users still see progress but get no controls that would 403.
    const canSendBulk = hasEmailPermission(user, 'sendBulkEmails');

    const [campaigns, setCampaigns] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [stages, setStages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [unavailable, setUnavailable] = useState(false);
    const [showCreate, setShowCreate] = useState(false);

    // Create form
    const [name, setName] = useState('');
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [templateId, setTemplateId] = useState('');
    const [statuses, setStatuses] = useState([]);
    const [audienceCount, setAudienceCount] = useState(null);
    const [checkingAudience, setCheckingAudience] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const fetchCampaigns = useCallback(async ({ silent = false } = {}) => {
        try {
            const res = await api.get('/email/campaign');
            setCampaigns(res.data.campaigns || []);
            setUnavailable(false);
        } catch (error) {
            // 403 = the tenant's plan doesn't include campaigns. Show an upgrade
            // notice rather than a generic failure.
            if (error.response?.status === 403) setUnavailable(true);
            else if (!silent) console.error('Error fetching campaigns:', error);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchCampaigns();
        api.get('/email-templates').then(r => setTemplates(r.data || [])).catch(() => {});
        api.get('/stages').then(r => setStages(r.data || [])).catch(() => {});
    }, [fetchCampaigns]);

    // Poll only while something is actually in flight.
    const hasActive = campaigns.some(c => c.status === 'sending' || c.status === 'paused');
    useEffect(() => {
        if (!hasActive) return;
        const t = setInterval(() => fetchCampaigns({ silent: true }), 5000);
        return () => clearInterval(t);
    }, [hasActive, fetchCampaigns]);

    // Audience size preview — debounced so toggling filters doesn't spam the API.
    useEffect(() => {
        if (!showCreate) return;
        setCheckingAudience(true);
        const t = setTimeout(async () => {
            try {
                const res = await api.post('/email/campaign/preview', { statuses, tags: [] });
                setAudienceCount(res.data.total);
            } catch {
                setAudienceCount(null);
            } finally {
                setCheckingAudience(false);
            }
        }, 400);
        return () => clearTimeout(t);
    }, [statuses, showCreate]);

    const applyTemplate = (id) => {
        setTemplateId(id);
        const tpl = templates.find(t => t._id === id);
        if (tpl) {
            setSubject(tpl.subject || '');
            setBody(tpl.body || '');
        }
    };

    const resetForm = () => {
        setName(''); setSubject(''); setBody(''); setTemplateId('');
        setStatuses([]); setAudienceCount(null);
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (submitting) return;

        const confirmed = await showDanger(
            `This will email ${audienceCount ?? 'all matching'} contact${audienceCount === 1 ? '' : 's'}. ` +
            `Sending starts immediately and cannot be undone for messages already delivered.`,
            'Start Campaign?'
        );
        if (!confirmed) return;

        setSubmitting(true);
        try {
            const res = await api.post('/email/campaign', {
                name, subject, body,
                templateId: templateId || null,
                statuses,
                tags: [],
                launch: true
            });
            showSuccess(res.data.message || 'Campaign started');
            setShowCreate(false);
            resetForm();
            fetchCampaigns();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to start campaign');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCancel = async (campaign) => {
        const confirmed = await showDanger(
            `Stop "${campaign.name}"? Emails already sent cannot be recalled — this only stops the remaining ${Math.max(0, (campaign.stats?.total || 0) - (campaign.stats?.sent || 0))}.`,
            'Cancel Campaign?'
        );
        if (!confirmed) return;

        try {
            await api.delete(`/email/campaign/${campaign._id}`);
            showSuccess('Campaign cancelled');
            fetchCampaigns();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to cancel');
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-500 font-medium">Loading campaigns...</p>
        </div>
    );

    if (unavailable) return (
        <div className="flex flex-col items-center justify-center py-20 gap-4 px-6 text-center">
            <div className="w-20 h-20 bg-amber-50 rounded-2xl flex items-center justify-center">
                <i className="fa-solid fa-lock text-3xl text-amber-400"></i>
            </div>
            <div>
                <p className="text-slate-700 font-bold text-base">Campaigns aren't included in your plan</p>
                <p className="text-slate-400 text-sm mt-1 max-w-md">
                    Bulk email campaigns are a premium feature. Upgrade your plan to send to
                    a filtered audience with per-recipient delivery tracking.
                </p>
            </div>
        </div>
    );

    return (
        <div className="p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h2 className="text-lg font-bold text-slate-800">Bulk Campaigns</h2>
                    <p className="text-sm text-slate-400 mt-0.5">
                        Sent in batches server-side · respects your daily limit and unsubscribes
                    </p>
                </div>
                {canSendBulk && (
                    <button
                        onClick={() => { resetForm(); setShowCreate(true); }}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-md shadow-blue-200"
                    >
                        <i className="fa-solid fa-bullhorn"></i> New Campaign
                    </button>
                )}
            </div>

            {campaigns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center">
                        <i className="fa-solid fa-bullhorn text-3xl text-slate-300"></i>
                    </div>
                    <div className="text-center">
                        <p className="text-slate-600 font-semibold text-base">No campaigns yet</p>
                        <p className="text-slate-400 text-sm mt-1">Send a templated email to a filtered group of leads</p>
                    </div>
                </div>
            ) : (
                <div className="space-y-3">
                    {campaigns.map(c => {
                        const meta = STATUS_STYLES[c.status] || STATUS_STYLES.draft;
                        const total = c.stats?.total || 0;
                        const done = (c.stats?.sent || 0) + (c.stats?.failed || 0) + (c.stats?.skipped || 0);
                        const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

                        return (
                            <div key={c._id} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                                <div className="flex items-start justify-between gap-4 mb-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-bold text-slate-800 text-[15px] truncate">{c.name}</h3>
                                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${meta.cls}`}>
                                                <i className={`fa-solid ${meta.icon} mr-1`}></i>{meta.label}
                                            </span>
                                        </div>
                                        <p className="text-xs text-slate-500 mt-1 truncate">{c.subject}</p>
                                        {c.audience?.statuses?.length > 0 && (
                                            <p className="text-[11px] text-slate-400 mt-1">
                                                Audience: {c.audience.statuses.join(', ')}
                                            </p>
                                        )}
                                    </div>
                                    {canSendBulk && ['sending', 'paused'].includes(c.status) && (
                                        <button
                                            onClick={() => handleCancel(c)}
                                            className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition flex-shrink-0"
                                        >
                                            Stop
                                        </button>
                                    )}
                                </div>

                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${c.status === 'failed' ? 'bg-rose-400' : c.status === 'completed' ? 'bg-emerald-400' : 'bg-blue-500'}`}
                                        style={{ width: `${pct}%` }}
                                    />
                                </div>

                                <div className="flex items-center gap-4 text-[11px] font-semibold flex-wrap">
                                    <span className="text-slate-400">{done} / {total} processed</span>
                                    <span className="text-emerald-600"><i className="fa-solid fa-check mr-1"></i>{c.stats?.sent || 0} sent</span>
                                    {c.stats?.failed > 0 && <span className="text-rose-500"><i className="fa-solid fa-xmark mr-1"></i>{c.stats.failed} failed</span>}
                                    {c.stats?.skipped > 0 && <span className="text-slate-400"><i className="fa-solid fa-forward mr-1"></i>{c.stats.skipped} skipped</span>}
                                </div>

                                {c.error && (
                                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-2">
                                        <i className="fa-solid fa-circle-info mr-1"></i>{c.error}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create modal */}
            {showCreate && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up max-h-[92vh] flex flex-col">
                        <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700 flex justify-between items-center flex-shrink-0">
                            <h3 className="font-bold text-white text-sm flex items-center gap-2">
                                <i className="fa-solid fa-bullhorn"></i> New Campaign
                            </h3>
                            <button onClick={() => setShowCreate(false)} className="text-white/80 hover:text-white transition">
                                <i className="fa-solid fa-xmark text-base"></i>
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Campaign Name <span className="text-red-500">*</span></label>
                                <input
                                    type="text" required value={name} onChange={e => setName(e.target.value)}
                                    placeholder="October newsletter"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl outline-none text-xs font-bold text-slate-700 transition"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Start From Template (optional)</label>
                                <select
                                    value={templateId} onChange={e => applyTemplate(e.target.value)}
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 rounded-xl outline-none text-xs font-semibold text-slate-700 transition"
                                >
                                    <option value="">— Write from scratch —</option>
                                    {templates.filter(t => t.isActive).map(t => (
                                        <option key={t._id} value={t._id}>{t.name}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Subject <span className="text-red-500">*</span></label>
                                <input
                                    type="text" required value={subject} onChange={e => setSubject(e.target.value)}
                                    placeholder="Hi {{name}}, news from us"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl outline-none text-xs font-bold text-slate-700 transition"
                                />
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Message <span className="text-red-500">*</span></label>
                                <textarea
                                    required value={body} onChange={e => setBody(e.target.value)}
                                    placeholder="Hi {{name}}, ..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl outline-none min-h-[140px] resize-y text-xs font-medium text-slate-700 leading-relaxed transition"
                                />
                                <p className="text-[11px] text-slate-400 mt-1">
                                    Variables: <code className="bg-slate-100 px-1 rounded">{'{{name}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{email}}'}</code> <code className="bg-slate-100 px-1 rounded">{'{{company}}'}</code>
                                </p>
                            </div>

                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Audience — Lead Stages</label>
                                <div className="flex flex-wrap gap-1.5">
                                    {stages.map(s => {
                                        const value = s.name || s;
                                        const active = statuses.includes(value);
                                        return (
                                            <button
                                                key={value} type="button"
                                                onClick={() => setStatuses(prev => active ? prev.filter(x => x !== value) : [...prev, value])}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${active ? 'bg-blue-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                            >
                                                {value}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-2">
                                    {statuses.length === 0 ? 'No stage selected — every lead with an email address.' : 'Only leads in the selected stages.'}
                                </p>
                            </div>

                            {/* Blast radius — shown before the user can commit */}
                            <div className={`rounded-xl px-4 py-3 border ${audienceCount === 0 ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-100'}`}>
                                <p className={`text-sm font-bold ${audienceCount === 0 ? 'text-amber-800' : 'text-blue-800'}`}>
                                    <i className="fa-solid fa-users mr-2"></i>
                                    {checkingAudience
                                        ? 'Counting recipients...'
                                        : audienceCount === null
                                            ? 'Recipient count unavailable'
                                            : `${audienceCount} recipient${audienceCount === 1 ? '' : 's'}`}
                                </p>
                                <p className={`text-[11px] mt-0.5 ${audienceCount === 0 ? 'text-amber-700' : 'text-blue-600'}`}>
                                    {audienceCount === 0
                                        ? 'No leads match — adjust the stage filter.'
                                        : 'Unsubscribed and bounced addresses are skipped automatically.'}
                                </p>
                            </div>

                            <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                                <button type="button" onClick={() => setShowCreate(false)} className="px-5 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition text-xs">
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={submitting || audienceCount === 0}
                                    className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-md shadow-blue-100 flex items-center gap-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {submitting
                                        ? <><i className="fa-solid fa-spinner fa-spin"></i> Starting...</>
                                        : <><i className="fa-solid fa-paper-plane"></i> Start Campaign</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmailCampaigns;
