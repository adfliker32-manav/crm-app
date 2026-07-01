import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import RuleBuilderModal from '../Automations/RuleBuilderModal';
import MetaFormAgentMapping from './MetaFormAgentMapping';

// ─── helpers ───────────────────────────────────────────────────────────────
const SOURCE_META = {
    webLead: {
        label: 'Web-to-Lead',
        desc: 'Leads from your embedded website snippet',
        icon: 'fa-code',
        color: 'from-blue-500 to-indigo-500',
        bg: 'bg-blue-50',
        border: 'border-blue-100',
        badge: 'bg-blue-100 text-blue-700',
    },
    sheet: {
        label: 'Google Sheet Sync',
        desc: 'Leads pushed from your connected Google Sheet',
        icon: 'fa-table',
        color: 'from-emerald-500 to-teal-500',
        bg: 'bg-emerald-50',
        border: 'border-emerald-100',
        badge: 'bg-emerald-100 text-emerald-700',
    },
    meta: {
        label: 'Meta (Facebook) Ads',
        desc: 'Leads from Facebook Lead Ads webhook',
        icon: 'fa-brands fa-facebook',
        color: 'from-blue-600 to-sky-500',
        bg: 'bg-sky-50',
        border: 'border-sky-100',
        badge: 'bg-sky-100 text-sky-700',
    },
};

const TRIGGER_LABEL = {
    LEAD_CREATED: { label: 'Lead Created', icon: 'fa-user-plus', cls: 'bg-emerald-50 text-emerald-700' },
    STAGE_CHANGED: { label: 'Stage Changed', icon: 'fa-right-left', cls: 'bg-violet-50 text-violet-700' },
    TIME_IN_STAGE: { label: 'Time in Stage', icon: 'fa-clock', cls: 'bg-amber-50 text-amber-700' },
};

// ─── component ─────────────────────────────────────────────────────────────
const LeadAssignmentSettings = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    // ── State ─────────────────────────────────────────────────────────────
    const [teamUsers, setTeamUsers] = useState([]);
    const [loadingData, setLoadingData] = useState(true);

    // Per-source defaults: { value: agentId|'', saving, savedValue }
    const [sources, setSources] = useState({
        webLead: { value: '', saving: false, savedValue: '' },
        sheet:   { value: '', saving: false, savedValue: '' },
        meta:    { value: '', saving: false, savedValue: '' },
    });

    // Assignment rules
    const [allRules, setAllRules] = useState([]);
    const [rulesLoading, setRulesLoading] = useState(true);
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const [editingRule, setEditingRule] = useState(null);

    // WhatsApp lead arrival alert (Agent notification)
    const [leadAlert, setLeadAlert] = useState({
        enabled: false,
        customMessage: '',
        templateName: '',
        globalNumber: ''
    });
    const [leadAlertSaving, setLeadAlertSaving] = useState(false);

    // ── Load all data ─────────────────────────────────────────────────────
    const loadAll = useCallback(async () => {
        setLoadingData(true);
        try {
            const [teamRes, webRes, sheetRes, metaRes, alertRes] = await Promise.all([
                api.get('/auth/my-team?includeManager=true').catch(() => ({ data: [] })),
                api.get('/web-leads/config').catch(() => ({ data: {} })),
                api.get('/leads/sheet-sync-config').catch(() => ({ data: {} })),
                api.get('/meta/field-mapping').catch(() => ({ data: {} })),
                api.get('/meta/lead-alert-config').catch(() => ({ data: {} }))
            ]);

            setTeamUsers(Array.isArray(teamRes.data) ? teamRes.data : []);

            const webAgent   = webRes.data?.defaultAgent || '';
            const sheetAgent = sheetRes.data?.googleSheetSync?.defaultAssignedAgent || '';
            const metaAgent  = metaRes.data?.defaultAssignedAgent || '';

            setSources({
                webLead: { value: webAgent,   saving: false, savedValue: webAgent },
                sheet:   { value: sheetAgent, saving: false, savedValue: sheetAgent },
                meta:    { value: metaAgent,  saving: false, savedValue: metaAgent },
            });

            if (alertRes.data) {
                setLeadAlert({
                    enabled: alertRes.data.leadAlertWhatsappEnabled || false,
                    customMessage: alertRes.data.leadAlertWhatsappCustomMessage || '',
                    templateName: alertRes.data.leadAlertWhatsappTemplateName || '',
                    globalNumber: alertRes.data.leadAlertWhatsappNumber || ''
                });
            }
        } catch (e) {
            showError('Failed to load assignment data');
        } finally {
            setLoadingData(false);
        }
    }, []);

    const loadRules = useCallback(async () => {
        setRulesLoading(true);
        try {
            const res = await api.get('/automations');
            setAllRules(res.data || []);
        } catch {
            showError('Failed to load automation rules');
        } finally {
            setRulesLoading(false);
        }
    }, []);

    useEffect(() => {
        loadAll();
        loadRules();
    }, [loadAll, loadRules]);

    // Only show rules that have at least one ASSIGN_USER action
    const assignmentRules = allRules.filter(r =>
        r.actions?.some(a => a.type === 'ASSIGN_USER')
    );

    // ── Source default save ───────────────────────────────────────────────
    const saveSource = async (key) => {
        const val = sources[key].value;
        setSources(s => ({ ...s, [key]: { ...s[key], saving: true } }));
        try {
            if (key === 'webLead') {
                await api.put('/web-leads/config', { defaultAgent: val || null });
            } else if (key === 'sheet') {
                await api.post('/leads/update-sheet-sync-config', { defaultAssignedAgent: val || null });
            } else if (key === 'meta') {
                await api.post('/meta/default-agent', { defaultAssignedAgent: val || null });
            }
            setSources(s => ({ ...s, [key]: { ...s[key], saving: false, savedValue: val } }));
            showSuccess(`${SOURCE_META[key].label} default agent saved`);
        } catch {
            showError(`Failed to save ${SOURCE_META[key].label} default agent`);
            setSources(s => ({ ...s, [key]: { ...s[key], saving: false } }));
        }
    };

    const setSourceValue = (key, val) =>
        setSources(s => ({ ...s, [key]: { ...s[key], value: val } }));

    // ── Save Agent Alerts ──────────────────────────────────────────────────
    const handleSaveAlerts = async () => {
        setLeadAlertSaving(true);
        try {
            await api.post('/meta/lead-alert-config', {
                leadAlertWhatsappEnabled: leadAlert.enabled,
                leadAlertWhatsappCustomMessage: leadAlert.customMessage,
                leadAlertWhatsappTemplateName: leadAlert.templateName,
                leadAlertWhatsappNumber: leadAlert.globalNumber
            });
            showSuccess('Agent alert settings saved');
        } catch {
            showError('Failed to save agent alert settings');
        } finally {
            setLeadAlertSaving(false);
        }
    };

    // ── Rule actions ──────────────────────────────────────────────────────
    const toggleRule = async (id, current) => {
        try {
            await api.patch(`/automations/${id}/toggle`, { isActive: !current });
            setAllRules(r => r.map(rule => rule._id === id ? { ...rule, isActive: !current } : rule));
        } catch {
            showError('Failed to toggle rule');
        }
    };

    const deleteRule = async (id) => {
        const ok = await showDanger('Delete this assignment rule? This cannot be undone.', 'Delete Rule');
        if (!ok) return;
        try {
            await api.delete(`/automations/${id}`);
            setAllRules(r => r.filter(rule => rule._id !== id));
            showSuccess('Rule deleted');
        } catch {
            showError('Failed to delete rule');
        }
    };

    // ── Helper: resolve agent name from id ────────────────────────────────
    const agentName = (id) => {
        if (!id) return null;
        const u = teamUsers.find(u => u._id === id || u._id?.toString() === id?.toString());
        return u ? u.name : 'Unknown agent';
    };

    // ── Conditions summary for table ──────────────────────────────────────
    const condSummary = (conditions) => {
        if (!conditions?.length) return <span className="text-slate-400 text-xs italic">All leads</span>;
        return (
            <span className="text-xs text-slate-600">
                {conditions.map((c, i) => (
                    <span key={i}>
                        {i > 0 && <span className="text-slate-300 mx-1">·</span>}
                        <span className="font-medium">{c.field}</span> {c.operator} <span className="font-medium">{c.value}</span>
                    </span>
                ))}
            </span>
        );
    };

    // ── Assigned agents in rule ───────────────────────────────────────────
    const ruleAgents = (rule) => {
        const ids = rule.actions?.filter(a => a.type === 'ASSIGN_USER').map(a => a.userId) || [];
        return ids.map(id => agentName(id)).filter(Boolean);
    };

    // ─── Render ────────────────────────────────────────────────────────────
    return (
        <div className="p-6 md:p-8 space-y-8 animate-in fade-in duration-300">

            {/* ── Page Header ─────────────────────────────────────────── */}
            <div className="flex items-center gap-4 pb-4 border-b border-slate-100">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/25 shrink-0">
                    <i className="fa-solid fa-user-tag text-white text-lg"></i>
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-800">Lead Assignment</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                        Control who gets leads from each source and build automated assignment rules.
                    </p>
                </div>
            </div>

            {/* ══ SECTION 1: Source Default Agents ════════════════════════ */}
            <section>
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center">
                        <i className="fa-solid fa-arrow-right-to-bracket text-indigo-600 text-xs"></i>
                    </div>
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Default Agent per Source</h3>
                </div>
                <p className="text-xs text-slate-500 mb-5 -mt-2">
                    When a lead arrives from a source, it is immediately assigned to this agent.
                    Automation rules can still reassign it afterwards.
                </p>

                {loadingData ? (
                    <div className="flex items-center gap-3 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                        <i className="fa-solid fa-spinner fa-spin text-indigo-400"></i>
                        <span className="text-sm text-slate-500">Loading source configurations…</span>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {Object.entries(SOURCE_META).map(([key, meta]) => {
                            const src = sources[key];
                            const isDirty = src.value !== src.savedValue;
                            const currentAgent = agentName(src.savedValue);
                            return (
                                <div key={key} className={`rounded-2xl border ${meta.border} ${meta.bg} p-5 transition-all`}>
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                                        {/* Source identity */}
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${meta.color} flex items-center justify-center shadow-md shrink-0`}>
                                                <i className={`fa-solid ${meta.icon} text-white text-sm`}></i>
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-semibold text-slate-800 text-sm">{meta.label}</div>
                                                <div className="text-xs text-slate-500 truncate">{meta.desc}</div>
                                                {currentAgent && (
                                                    <span className={`mt-1 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${meta.badge}`}>
                                                        <i className="fa-solid fa-user-check text-[10px]"></i>
                                                        Currently: {currentAgent}
                                                    </span>
                                                )}
                                                {!currentAgent && (
                                                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                                                        <i className="fa-solid fa-user-xmark text-[10px]"></i>
                                                        Unassigned
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Agent picker + save */}
                                        <div className="flex items-center gap-2 w-full sm:w-auto">
                                            <select
                                                className="flex-1 sm:w-52 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition shadow-sm"
                                                value={src.value}
                                                onChange={e => setSourceValue(key, e.target.value)}
                                            >
                                                <option value="">— No default (unassigned) —</option>
                                                {teamUsers.map(u => (
                                                    <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => saveSource(key)}
                                                disabled={src.saving || !isDirty}
                                                className={`px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-1.5 shrink-0 ${
                                                    isDirty
                                                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/25'
                                                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                                                }`}
                                            >
                                                <i className={`fa-solid ${src.saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'} text-xs`}></i>
                                                {src.saving ? 'Saving…' : 'Save'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* ── Per-form agent routing (Meta only) ── */}
                                    {key === 'meta' && (
                                        <MetaFormAgentMapping teamUsers={teamUsers} />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* ══ SECTION 2: Assignment Automation Rules ═══════════════════ */}
            <section>
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center">
                            <i className="fa-solid fa-robot text-violet-600 text-xs"></i>
                        </div>
                        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Assignment Automation Rules</h3>
                        {!rulesLoading && (
                            <span className="text-xs font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                {assignmentRules.length}
                            </span>
                        )}
                    </div>
                    <button
                        onClick={() => { setEditingRule(null); setIsBuilderOpen(true); }}
                        className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-md shadow-indigo-500/20 transition-all hover:-translate-y-0.5"
                    >
                        <i className="fa-solid fa-plus text-xs"></i>
                        Create Assignment Rule
                    </button>
                </div>
                <p className="text-xs text-slate-500 mb-5 -mt-2">
                    Automation rules that include an "Assign to Agent" action. They fire after leads are created or change stage.
                    Build complex routing logic — e.g. "if source contains Meta → assign to Sales Team".
                </p>

                {rulesLoading ? (
                    <div className="flex items-center gap-3 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                        <i className="fa-solid fa-spinner fa-spin text-violet-400"></i>
                        <span className="text-sm text-slate-500">Loading rules…</span>
                    </div>
                ) : assignmentRules.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center">
                        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/25">
                            <i className="fa-solid fa-wand-magic-sparkles text-white text-xl"></i>
                        </div>
                        <h4 className="font-semibold text-slate-700 mb-1.5">No assignment rules yet</h4>
                        <p className="text-xs text-slate-400 mb-5 max-w-xs mx-auto">
                            Create a rule with an "Assign to Agent" action to automatically route leads based on source, stage, or any condition.
                        </p>
                        <button
                            onClick={() => { setEditingRule(null); setIsBuilderOpen(true); }}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md shadow-indigo-500/20 hover:shadow-lg transition-all"
                        >
                            <i className="fa-solid fa-plus"></i>
                            Create First Rule
                        </button>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                        {/* Column headers */}
                        <div className="grid grid-cols-[2fr_1fr_2fr_1fr_auto] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-wider">
                            <span>Rule</span>
                            <span>Trigger</span>
                            <span>Conditions</span>
                            <span className="text-center">Status</span>
                            <span className="text-center">Actions</span>
                        </div>

                        <div className="divide-y divide-slate-50">
                            {assignmentRules.map(rule => {
                                const agents = ruleAgents(rule);
                                const tm = TRIGGER_LABEL[rule.trigger] || TRIGGER_LABEL.LEAD_CREATED;
                                return (
                                    <div key={rule._id} className="grid grid-cols-[2fr_1fr_2fr_1fr_auto] gap-3 px-5 py-4 items-center hover:bg-indigo-50/30 transition-colors group">
                                        {/* Rule name + agents */}
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-800 truncate">{rule.name}</div>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {agents.map((a, i) => (
                                                    <span key={i} className="inline-flex items-center gap-1 text-[11px] font-medium bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">
                                                        <i className="fa-solid fa-user-check text-[9px]"></i> {a}
                                                    </span>
                                                ))}
                                                {agents.length === 0 && (
                                                    <span className="text-xs text-slate-400 italic">No agent set</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Trigger */}
                                        <div>
                                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${tm.cls}`}>
                                                <i className={`fa-solid ${tm.icon} text-xs`}></i>
                                                {tm.label}
                                            </span>
                                        </div>

                                        {/* Conditions */}
                                        <div className="min-w-0">
                                            {condSummary(rule.conditions)}
                                        </div>

                                        {/* Toggle */}
                                        <div className="flex justify-center">
                                            <button
                                                onClick={() => toggleRule(rule._id, rule.isActive)}
                                                title={rule.isActive ? 'Pause rule' : 'Activate rule'}
                                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${rule.isActive ? 'bg-indigo-500' : 'bg-slate-200'}`}
                                            >
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${rule.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => { setEditingRule(rule); setIsBuilderOpen(true); }}
                                                title="Edit"
                                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                                            >
                                                <i className="fa-solid fa-pen-to-square text-xs"></i>
                                            </button>
                                            <button
                                                onClick={() => deleteRule(rule._id)}
                                                title="Delete"
                                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 transition"
                                            >
                                                <i className="fa-solid fa-trash-can text-xs"></i>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="px-5 py-3 bg-slate-50/50 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
                            <i className="fa-solid fa-circle-info text-indigo-300"></i>
                            To edit full rule logic (WhatsApp, emails, etc.) open the <span className="font-semibold text-indigo-500">Automations</span> page.
                            Assignment rules created here also appear there.
                        </div>
                    </div>
                )}
            </section>

            {/* ══ SECTION 3: Agent Notifications ═══════════════════════════ */}
            <section>
                <div className="flex items-center gap-2 mb-4">
                    <div className="w-6 h-6 rounded-lg bg-green-100 flex items-center justify-center">
                        <i className="fa-brands fa-whatsapp text-green-600 text-xs"></i>
                    </div>
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Agent WhatsApp Notifications</h3>
                </div>
                <p className="text-xs text-slate-500 mb-5 -mt-2">
                    Automatically send a WhatsApp message to the assigned agent when a new lead is assigned to them.
                </p>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-6 pb-6 border-b border-slate-100">
                        <div>
                            <h4 className="font-semibold text-slate-800">Enable Agent Alerts</h4>
                            <p className="text-xs text-slate-500 mt-1">Notify agents immediately on their personal WhatsApp number.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                checked={leadAlert.enabled}
                                onChange={e => setLeadAlert(prev => ({ ...prev, enabled: e.target.checked }))}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                    </div>

                    {leadAlert.enabled && (
                        <div className="space-y-5">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">
                                    Custom Notification Message
                                </label>
                                <p className="text-xs text-slate-500 mb-2">
                                    This message will be sent to the agent. You can use variables like <code>{`{{leadName}}`}</code>, <code>{`{{leadPhone}}`}</code>, and <code>{`{{leadSource}}`}</code>.
                                </p>
                                <textarea
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-green-400 outline-none min-h-[100px]"
                                    placeholder="Hey! A new lead {{leadName}} has been assigned to you. Phone: {{leadPhone}}"
                                    value={leadAlert.customMessage}
                                    onChange={e => setLeadAlert(prev => ({ ...prev, customMessage: e.target.value }))}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">
                                    Fallback Template Name
                                </label>
                                <p className="text-xs text-slate-500 mb-2">
                                    If the custom message fails (e.g. outside 24-hour window), this pre-approved WhatsApp template will be sent instead.
                                </p>
                                <input
                                    type="text"
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-green-400 outline-none"
                                    placeholder="e.g. agent_new_lead_alert"
                                    value={leadAlert.templateName}
                                    onChange={e => setLeadAlert(prev => ({ ...prev, templateName: e.target.value }))}
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1">
                                    Admin Fallback WhatsApp Number
                                </label>
                                <p className="text-xs text-slate-500 mb-2">
                                    If a lead is <strong>not assigned</strong> to an agent, the notification will be sent to this global admin number instead. Include country code (e.g. 919876543210).
                                </p>
                                <input
                                    type="text"
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-green-400 outline-none"
                                    placeholder="e.g. 919876543210"
                                    value={leadAlert.globalNumber}
                                    onChange={e => setLeadAlert(prev => ({ ...prev, globalNumber: e.target.value }))}
                                />
                            </div>
                        </div>
                    )}

                    <div className="mt-6 pt-6 border-t border-slate-100 flex justify-end">
                        <button
                            onClick={handleSaveAlerts}
                            disabled={leadAlertSaving}
                            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-md shadow-green-500/20 transition flex items-center gap-2 disabled:opacity-50"
                        >
                            <i className={`fa-solid ${leadAlertSaving ? 'fa-spinner fa-spin' : 'fa-check'}`}></i>
                            {leadAlertSaving ? 'Saving...' : 'Save Alert Settings'}
                        </button>
                    </div>
                </div>
            </section>

            {/* RuleBuilderModal — reuse existing */}
            <RuleBuilderModal
                isOpen={isBuilderOpen}
                onClose={() => { setIsBuilderOpen(false); setEditingRule(null); }}
                onSave={loadRules}
                editingRule={editingRule}
            />
        </div>
    );
};

export default LeadAssignmentSettings;
