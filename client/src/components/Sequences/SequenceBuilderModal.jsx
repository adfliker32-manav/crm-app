/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const TRIGGER_OPTIONS = [
    { value: 'LEAD_CREATED',  label: 'When a lead is created',     icon: 'fa-user-plus',  color: 'from-emerald-400 to-teal-500' },
    { value: 'STAGE_CHANGED', label: 'When a lead changes stage',  icon: 'fa-right-left', color: 'from-violet-400 to-fuchsia-500' },
    { value: 'MANUAL',        label: 'Manual enrollment only',     icon: 'fa-hand-pointer', color: 'from-slate-400 to-slate-500' },
];

const newStep = () => ({
    stepNumber: 1,
    delayHours: 0,
    action: { type: 'SEND_WHATSAPP', templateId: '', emailTemplateId: '', useEmailTemplate: false, subject: '', body: '' }
});

// A step sends ONE channel (action.type) but holds the setup for both, so moving
// between the WhatsApp and Email tabs never costs you what you already typed.
// Which half is live:
const hasWhatsAppSetup = (action) => !!action?.templateId;
const hasEmailSetup = (action) =>
    !!(action?.emailTemplateId || String(action?.subject || '').trim() || String(action?.body || '').trim());

// ── Delay helpers ─────────────────────────────────────────────────────────────
// We store delay as total hours internally (backend model uses delayHours).
// The UI splits this into days + hours for user-friendliness.
const hoursToDaysHours = (totalHours) => {
    const h = Number(totalHours) || 0;
    return { days: Math.floor(h / 24), hours: h % 24 };
};
const daysHoursToTotalHours = (days, hours) => (Number(days) || 0) * 24 + (Number(hours) || 0);

const SequenceBuilderModal = ({ isOpen, onClose, onSave, editingSequence = null }) => {
    const { showNotification } = useNotification();
    const [loading, setLoading] = useState(false);
    const [stages, setStages] = useState([]);
    const [whatsappTemplates, setWhatsappTemplates] = useState([]);
    const [emailTemplates, setEmailTemplates] = useState([]);

    const defaultSeq = {
        name: '',
        trigger: 'LEAD_CREATED',
        triggerStage: '',
        stopOnReply: true,
        isActive: true,
        // Both on by default: a sequence is a follow-up, and a follow-up that can use
        // both channels is the point. Either can be switched off per sequence.
        sendWhatsApp: true,
        sendEmail: true,
        steps: [newStep()]
    };
    const [seq, setSeq] = useState(defaultSeq);

    useEffect(() => {
        if (!isOpen) return;
        fetchContext();
        if (editingSequence) {
            // A sequence saved before the channel switches existed has null on both.
            // Derive them from what its steps were actually set to send, so opening it
            // shows the truth - and saving it writes the switches explicitly.
            const legacyChannels = editingSequence.sendWhatsApp === null || editingSequence.sendWhatsApp === undefined;
            const stepTypes = (editingSequence.steps || []).map(s => s.action?.type);
            setSeq({
                ...defaultSeq,
                ...editingSequence,
                sendWhatsApp: legacyChannels
                    ? stepTypes.includes('SEND_WHATSAPP')
                    : editingSequence.sendWhatsApp === true,
                sendEmail: legacyChannels
                    ? stepTypes.includes('SEND_EMAIL')
                    : editingSequence.sendEmail === true,
                triggerStage: editingSequence.triggerStage || '',
                steps: (editingSequence.steps && editingSequence.steps.length)
                    ? editingSequence.steps.map((s, i) => ({
                        // Carried through untouched: this id is how leads already
                        // inside the sequence know which step they are on. Drop it
                        // and every edit looks like "all steps deleted and replaced".
                        stepId: s.stepId || null,
                        stepNumber: i + 1,
                        delayHours: s.delayHours || 0,
                        action: {
                            type: s.action?.type || 'SEND_WHATSAPP',
                            templateId:      s.action?.templateId      || '',
                            emailTemplateId: s.action?.emailTemplateId || '',
                            // emailMode is authoritative; steps saved before it existed
                            // fall back to the old "has an id = uses a template" rule.
                            useEmailTemplate: s.action?.emailMode
                                ? s.action.emailMode === 'template'
                                : !!s.action?.emailTemplateId,
                            subject: s.action?.subject || '',
                            body:    s.action?.body    || ''
                        }
                    }))
                    : [newStep()]
            });
        } else {
            setSeq(defaultSeq);
        }
    }, [isOpen, editingSequence]);

    const fetchContext = async () => {
        try {
            const [stageRes, waRes, etRes] = await Promise.all([
                api.get('/stages').catch(() => ({ data: [] })),
                api.get('/whatsapp/templates').catch(() => ({ data: {} })),
                api.get('/email-templates').catch(() => ({ data: [] })),
            ]);
            setStages(stageRes.data || []);
            const tList = waRes.data?.templates || waRes.data?.data || [];
            setWhatsappTemplates(tList.filter(t => t.status === 'APPROVED'));
            // email-templates endpoint returns array directly or { templates: [] }
            const etList = Array.isArray(etRes.data)
                ? etRes.data
                : (etRes.data?.templates || etRes.data?.data || []);
            setEmailTemplates(etList.filter(t => t.isActive !== false));
        } catch (err) {
            console.error('Failed to load context', err);
        }
    };

    const updateStep = (idx, patch) => {
        const steps = [...seq.steps];
        steps[idx] = { ...steps[idx], ...patch };
        setSeq({ ...seq, steps });
    };

    const updateStepAction = (idx, patch) => {
        const steps = [...seq.steps];
        steps[idx] = { ...steps[idx], action: { ...steps[idx].action, ...patch } };
        setSeq({ ...seq, steps });
    };

    const addStep = () => {
        setSeq({ ...seq, steps: [...seq.steps, { ...newStep(), delayHours: 24, stepNumber: seq.steps.length + 1 }] });
    };

    const removeStep = (idx) => {
        if (seq.steps.length === 1) {
            showNotification('error', 'A sequence must have at least one step');
            return;
        }
        const steps = seq.steps.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepNumber: i + 1 }));
        setSeq({ ...seq, steps });
    };

    const moveStep = (idx, dir) => {
        const target = idx + dir;
        if (target < 0 || target >= seq.steps.length) return;
        const steps = [...seq.steps];
        [steps[idx], steps[target]] = [steps[target], steps[idx]];
        steps.forEach((s, i) => { s.stepNumber = i + 1; });
        setSeq({ ...seq, steps });
    };

    const handleSave = async () => {
        if (!seq.name.trim()) return showNotification('error', 'Sequence name is required');
        if (seq.trigger === 'STAGE_CHANGED' && !seq.triggerStage) {
            return showNotification('error', 'Pick a stage that triggers enrollment');
        }
        if (!seq.sendWhatsApp && !seq.sendEmail) {
            return showNotification('error', 'Switch on WhatsApp, email, or both — a sequence with no channel sends nothing');
        }
        // Mirrors validateSteps() on the server: a step must be able to send on at
        // least one switched-on channel, and does not have to fill both.
        for (const [i, step] of seq.steps.entries()) {
            const hasWhatsApp = !!step.action.templateId;
            const hasEmail = step.action.useEmailTemplate
                ? !!step.action.emailTemplateId
                : !!(step.action.subject?.trim() && step.action.body?.trim());

            if (seq.sendWhatsApp && !seq.sendEmail && !hasWhatsApp) {
                return showNotification('error', `Step ${i + 1}: pick a WhatsApp template`);
            }
            if (seq.sendEmail && !seq.sendWhatsApp && !hasEmail) {
                return showNotification('error', step.action.useEmailTemplate
                    ? `Step ${i + 1}: pick an email template`
                    : `Step ${i + 1}: email subject and body are required`);
            }
            if (seq.sendWhatsApp && seq.sendEmail && !hasWhatsApp && !hasEmail) {
                return showNotification('error', `Step ${i + 1}: add a WhatsApp template or an email — this step sends nothing`);
            }
            if (step.delayHours < 0) {
                return showNotification('error', `Step ${i + 1}: delay cannot be negative`);
            }
        }

        setLoading(true);
        try {
            // Both channels are written out, whichever one the step sends.
            // This used to null out the half that action.type did not point at, so
            // setting up WhatsApp, switching to the Email tab and hitting Save threw
            // the WhatsApp template away without a word - and the same in reverse.
            // Only the fields matching action.type are read at send time, so keeping
            // the other half changes nothing about what goes out.
            const resolveAction = (action) => {
                const tpl = action.useEmailTemplate && action.emailTemplateId
                    ? emailTemplates.find(t => t._id === action.emailTemplateId || t.id === action.emailTemplateId)
                    : null;
                return {
                    // Legacy field: the sequence's channel switches are what decide what
                    // sends now. It stays required by the schema and is the fallback for
                    // any reader that predates the switches, so keep it honest.
                    type: seq.sendWhatsApp ? 'SEND_WHATSAPP' : 'SEND_EMAIL',
                    // WhatsApp half
                    templateId: action.templateId || null,
                    // Email half. emailMode records which composer is in use, so the
                    // template id can survive a switch to Custom without the server
                    // mistaking the step for a template-backed one.
                    emailMode: action.useEmailTemplate ? 'template' : 'custom',
                    emailTemplateId: action.emailTemplateId || null,
                    // In template mode subject/body are a snapshot the engine falls back
                    // to only if the template has since been deleted; in custom mode they
                    // are the message itself.
                    subject: (tpl ? tpl.subject : action.subject) || null,
                    body:    (tpl ? tpl.body    : action.body)    || null,
                };
            };

            const payload = {
                name: seq.name.trim(),
                trigger: seq.trigger,
                triggerStage: seq.trigger === 'STAGE_CHANGED' ? seq.triggerStage : null,
                stopOnReply: seq.stopOnReply,
                isActive: seq.isActive,
                sendWhatsApp: seq.sendWhatsApp,
                sendEmail: seq.sendEmail,
                steps: seq.steps.map((s, i) => ({
                    // A new step has no id yet — the server mints one.
                    ...(s.stepId ? { stepId: s.stepId } : {}),
                    stepNumber: i + 1,
                    delayHours: Number(s.delayHours) || 0,
                    action: resolveAction(s.action)
                }))
            };
            if (editingSequence?._id) {
                await api.put(`/sequences/${editingSequence._id}`, payload);
                showNotification('success', 'Sequence updated');
            } else {
                await api.post('/sequences', payload);
                showNotification('success', 'Sequence created');
            }
            onSave?.();
            onClose();
        } catch (err) {
            showNotification('error', err.response?.data?.message || 'Failed to save sequence');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const formatDelay = (hours) => {
        const h = Number(hours) || 0;
        if (h === 0) return 'Immediately';
        const d = Math.floor(h / 24);
        const rem = h % 24;
        if (d === 0) return `Wait ${rem}h`;
        if (rem === 0) return `Wait ${d}d`;
        return `Wait ${d}d ${rem}h`;
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8 max-h-[92vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 py-5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                            <i className="fa-solid fa-wand-magic-sparkles text-white text-lg"></i>
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">
                                {editingSequence ? 'Edit Sequence' : 'New Drip Sequence'}
                            </h2>
                            <p className="text-blue-100 text-xs">Multi-step automated WhatsApp + Email follow-ups</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 text-white transition flex items-center justify-center">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

                    {/* Basics */}
                    <section>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Sequence Name</label>
                        <input
                            type="text"
                            value={seq.name}
                            onChange={(e) => setSeq({ ...seq, name: e.target.value })}
                            placeholder="e.g. Welcome onboarding series"
                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition"
                        />
                    </section>

                    {/* Trigger */}
                    <section>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">When to enroll</label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {TRIGGER_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setSeq({ ...seq, trigger: opt.value })}
                                    className={`relative text-left p-3 rounded-xl border-2 transition-all ${
                                        seq.trigger === opt.value
                                            ? 'border-indigo-500 bg-indigo-50/60 shadow-sm'
                                            : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                                >
                                    <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${opt.color} flex items-center justify-center mb-2`}>
                                        <i className={`fa-solid ${opt.icon} text-white text-xs`}></i>
                                    </div>
                                    <div className="text-xs font-semibold text-slate-800">{opt.label}</div>
                                    {seq.trigger === opt.value && (
                                        <i className="fa-solid fa-circle-check absolute top-2 right-2 text-indigo-500 text-xs"></i>
                                    )}
                                </button>
                            ))}
                        </div>

                        {seq.trigger === 'STAGE_CHANGED' && (
                            <div className="mt-3">
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Trigger when a lead moves to:</label>
                                <select
                                    value={seq.triggerStage}
                                    onChange={(e) => setSeq({ ...seq, triggerStage: e.target.value })}
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                                >
                                    <option value="">— Select a stage —</option>
                                    {stages.map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
                                </select>
                            </div>
                        )}
                    </section>

                    {/* Channels — what this sequence is allowed to send */}
                    <section>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Channels</label>
                        <div className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-4 space-y-3">
                            <ToggleRow
                                checked={seq.sendWhatsApp}
                                onChange={(v) => setSeq({ ...seq, sendWhatsApp: v })}
                                title="Send WhatsApp"
                                subtitle="Every step sends its WhatsApp template"
                                icon="fa-whatsapp fa-brands"
                            />
                            <ToggleRow
                                checked={seq.sendEmail}
                                onChange={(v) => setSeq({ ...seq, sendEmail: v })}
                                title="Send Email"
                                subtitle="Every step sends its email"
                                icon="fa-envelope"
                            />
                            <p className="text-[11px] text-slate-500 pt-1 border-t border-slate-200/70">
                                {seq.sendWhatsApp && seq.sendEmail
                                    ? 'Both are on: each step sends its WhatsApp template AND its email, together.'
                                    : seq.sendWhatsApp
                                        ? 'Only WhatsApp goes out. Email written on a step is kept, but not sent.'
                                        : seq.sendEmail
                                            ? 'Only email goes out. WhatsApp templates on a step are kept, but not sent.'
                                            : 'Nothing will be sent — switch on at least one channel.'}
                            </p>
                        </div>
                    </section>

                    {/* Settings */}
                    <section className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-4 space-y-3">
                        <ToggleRow
                            checked={seq.stopOnReply}
                            onChange={(v) => setSeq({ ...seq, stopOnReply: v })}
                            title="Pause when lead replies"
                            subtitle="Industry best practice — never spam someone who's already engaged"
                            icon="fa-comments"
                        />
                        <ToggleRow
                            checked={seq.isActive}
                            onChange={(v) => setSeq({ ...seq, isActive: v })}
                            title="Active"
                            subtitle="Inactive sequences won't enroll new leads"
                            icon="fa-power-off"
                        />
                    </section>

                    {/* Steps Timeline */}
                    <section>
                        <div className="flex items-center justify-between mb-3">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Drip Timeline</label>
                            <span className="text-xs text-slate-400">{seq.steps.length} step{seq.steps.length !== 1 ? 's' : ''}</span>
                        </div>

                        <div className="relative">
                            {/* Vertical rail */}
                            <div className="absolute left-[19px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-indigo-300 via-violet-300 to-pink-300 rounded-full" />

                            <div className="space-y-3">
                                {seq.steps.map((step, idx) => (
                                    <StepCard
                                        key={idx}
                                        step={step}
                                        idx={idx}
                                        total={seq.steps.length}
                                        whatsappTemplates={whatsappTemplates}
                                        emailTemplates={emailTemplates}
                                        sendWhatsApp={seq.sendWhatsApp}
                                        sendEmail={seq.sendEmail}
                                        onUpdate={(patch) => updateStep(idx, patch)}
                                        onUpdateAction={(patch) => updateStepAction(idx, patch)}
                                        onRemove={() => removeStep(idx)}
                                        onMoveUp={() => moveStep(idx, -1)}
                                        onMoveDown={() => moveStep(idx, 1)}
                                        formatDelay={formatDelay}
                                    />
                                ))}
                            </div>

                            {/* End marker */}
                            <div className="relative flex items-center gap-3 mt-3">
                                <div className="w-10 h-10 rounded-full bg-emerald-100 border-4 border-white ring-2 ring-emerald-200 flex items-center justify-center shrink-0 z-10">
                                    <i className="fa-solid fa-flag-checkered text-emerald-600 text-xs"></i>
                                </div>
                                <span className="text-xs font-semibold text-emerald-700">Sequence complete</span>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={addStep}
                            className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/50 text-indigo-600 rounded-xl text-sm font-semibold transition"
                        >
                            <i className="fa-solid fa-plus"></i> Add Step
                        </button>
                    </section>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={loading}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-200/70 transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={loading}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg transition disabled:opacity-50"
                    >
                        {loading
                            ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving…</>
                            : <><i className="fa-solid fa-check"></i> {editingSequence ? 'Update Sequence' : 'Create Sequence'}</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

const ToggleRow = ({ checked, onChange, title, subtitle, icon }) => (
    <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${checked ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-400'}`}>
                <i className={`fa-solid ${icon} text-xs`}></i>
            </div>
            <div>
                <div className="text-sm font-semibold text-slate-800">{title}</div>
                <div className="text-xs text-slate-500">{subtitle}</div>
            </div>
        </div>
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${checked ? 'bg-indigo-500' : 'bg-slate-300'}`}
        >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    </div>
);

// ── Step Card ─────────────────────────────────────────────────────────────────
const StepCard = ({
    step, idx, total,
    whatsappTemplates, emailTemplates,
    sendWhatsApp, sendEmail,
    onUpdate, onUpdateAction,
    onRemove, onMoveUp, onMoveDown, formatDelay
}) => {
    // What this step sends is decided by the SEQUENCE now, not by a tab on the card.
    // Both on means both go out together, which is what the per-step tabs made
    // impossible however the sequence was set up.
    const bothChannels = sendWhatsApp && sendEmail;

    // Split delayHours into days + hours for the UI
    const { days, hours } = hoursToDaysHours(step.delayHours);

    const handleDaysChange = (e) => {
        const d = Math.max(0, Number(e.target.value) || 0);
        onUpdate({ delayHours: daysHoursToTotalHours(d, hours) });
    };
    const handleHoursChange = (e) => {
        const h = Math.min(23, Math.max(0, Number(e.target.value) || 0));
        onUpdate({ delayHours: daysHoursToTotalHours(days, h) });
    };

    // The step can be sitting on a template id it is not currently composing with
    // (Custom mode keeps your pick), so the preview reads the template list rather
    // than the saved subject — which is what the send path resolves too.
    const selectedEmailTemplate = step.action.emailTemplateId
        ? emailTemplates.find(t => (t._id || t.id) === step.action.emailTemplateId)
        : null;

    // When an email template is selected, prefill subject/body for preview
    const handleEmailTemplateSelect = (e) => {
        const id = e.target.value;
        if (!id) {
            onUpdateAction({ emailTemplateId: '', subject: '', body: '' });
            return;
        }
        const tpl = emailTemplates.find(t => (t._id || t.id) === id);
        onUpdateAction({
            emailTemplateId: id,
            subject: tpl?.subject || '',
            body:    tpl?.body    || '',
        });
    };

    return (
        <div className="relative">
            {/* Step label */}
            <div className="relative flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-full bg-white border-4 border-white ring-2 ring-indigo-300 flex items-center justify-center text-indigo-600 font-bold text-xs shrink-0 z-10 shadow-sm">
                    {idx + 1}
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    {idx === 0 ? 'After enrollment' : 'After previous step'} · {formatDelay(step.delayHours)}
                </span>
                {/* Say out loud what this step will actually send. */}
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${
                    bothChannels
                        ? 'bg-violet-50 text-violet-700 ring-violet-200'
                        : sendWhatsApp
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                            : 'bg-blue-50 text-blue-700 ring-blue-200'
                }`}>
                    {sendWhatsApp && <i className="fa-brands fa-whatsapp text-[10px]"></i>}
                    {sendEmail && <i className="fa-solid fa-envelope text-[10px]"></i>}
                    Sends {bothChannels ? 'WhatsApp + Email' : sendWhatsApp ? 'WhatsApp' : 'Email'}
                </span>
            </div>

            <div className="ml-12 bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition">

                {/* Controls. The channel tabs that used to live here are gone: the
                    sequence's own switches decide the channels, so a step no longer
                    has a "selected" one that silently excluded the other. */}
                <div className="flex items-center justify-between mb-3 gap-2">
                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
                        {hasWhatsAppSetup(step.action) && !sendWhatsApp && (
                            <span title="Kept, but this sequence has WhatsApp switched off"
                                className="inline-flex items-center gap-1 text-slate-400">
                                <i className="fa-brands fa-whatsapp"></i> saved, not sending
                            </span>
                        )}
                        {hasEmailSetup(step.action) && !sendEmail && (
                            <span title="Kept, but this sequence has Email switched off"
                                className="inline-flex items-center gap-1 text-slate-400">
                                <i className="fa-solid fa-envelope"></i> saved, not sending
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                        <button type="button" onClick={onMoveUp} disabled={idx === 0} title="Move up"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition">
                            <i className="fa-solid fa-arrow-up text-xs"></i>
                        </button>
                        <button type="button" onClick={onMoveDown} disabled={idx === total - 1} title="Move down"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition">
                            <i className="fa-solid fa-arrow-down text-xs"></i>
                        </button>
                        <button type="button" onClick={onRemove} disabled={total === 1} title="Remove step"
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:hover:bg-transparent transition">
                            <i className="fa-solid fa-trash-can text-xs"></i>
                        </button>
                    </div>
                </div>

                {/* ── Delay: Days + Hours inputs ─────────────────────────────── */}
                <div className="mb-3">
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                        <i className="fa-regular fa-clock mr-1 text-indigo-400"></i>
                        {idx === 0 ? 'Wait after enrollment:' : 'Wait after previous step:'}
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Days */}
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-400 transition">
                            <input
                                type="number"
                                min="0"
                                max="365"
                                value={days}
                                onChange={handleDaysChange}
                                className="w-14 text-sm font-semibold text-slate-700 text-center bg-transparent focus:outline-none"
                            />
                            <span className="text-xs font-medium text-slate-400">days</span>
                        </div>

                        <span className="text-slate-300 font-bold text-sm">+</span>

                        {/* Hours */}
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/30 focus-within:border-indigo-400 transition">
                            <input
                                type="number"
                                min="0"
                                max="23"
                                value={hours}
                                onChange={handleHoursChange}
                                className="w-14 text-sm font-semibold text-slate-700 text-center bg-transparent focus:outline-none"
                            />
                            <span className="text-xs font-medium text-slate-400">hours</span>
                        </div>

                        {/* Total pill */}
                        {(days > 0 || hours > 0) && (
                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-indigo-100">
                                <i className="fa-solid fa-hourglass-half text-[10px]"></i>
                                {step.delayHours}h total
                            </span>
                        )}

                        {days === 0 && hours === 0 && (
                            <span className="text-[11px] text-emerald-600 font-semibold bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">
                                ⚡ Sends immediately
                            </span>
                        )}
                    </div>
                </div>

                {/* ── Action body — one section per switched-on channel ───────── */}
                <div className="space-y-4">
                {sendWhatsApp && (
                    /* WhatsApp — unchanged template dropdown */
                    <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                            <i className="fa-brands fa-whatsapp text-emerald-500 mr-1"></i> WhatsApp Template
                        </label>
                        {whatsappTemplates.length === 0 ? (
                            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                                No approved templates. Add one in WhatsApp → Templates first.
                            </div>
                        ) : (
                            <select
                                value={step.action.templateId || ''}
                                onChange={(e) => onUpdateAction({ templateId: e.target.value })}
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            >
                                <option value="">— Select template —</option>
                                {whatsappTemplates.map(t => (
                                    <option key={t._id || t.name} value={t.name}>{t.name}</option>
                                ))}
                            </select>
                        )}
                    </div>
                )}

                {sendEmail && (
                    /* Email — template picker OR custom compose */
                    <div className="space-y-3">
                        <label className="block text-xs font-semibold text-slate-600">
                            <i className="fa-solid fa-envelope text-blue-500 mr-1"></i> Email
                        </label>

                        {/* Toggle: use template vs write custom */}
                        <div className="flex items-center gap-2">
                            <div className="inline-flex bg-slate-100 p-0.5 rounded-lg">
                                <button
                                    type="button"
                                    onClick={() => onUpdateAction({ useEmailTemplate: true })}
                                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                                        step.action.useEmailTemplate
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    <i className="fa-solid fa-layer-group text-[10px]"></i> Use Template
                                </button>
                                <button
                                    type="button"
                                    /* The template id is kept, not cleared - switching back to
                                       Use Template restores your pick. emailMode is what tells
                                       the server (and the send path) to ignore it for now. */
                                    onClick={() => onUpdateAction({ useEmailTemplate: false })}
                                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                                        !step.action.useEmailTemplate
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    <i className="fa-solid fa-pen-to-square text-[10px]"></i> Custom
                                </button>
                            </div>
                        </div>

                        {step.action.useEmailTemplate ? (
                            /* Template picker */
                            emailTemplates.length === 0 ? (
                                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
                                    <i className="fa-solid fa-triangle-exclamation"></i>
                                    No email templates found. Create one in Email → Templates first.
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email Template</label>
                                    <select
                                        value={step.action.emailTemplateId || ''}
                                        onChange={handleEmailTemplateSelect}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                    >
                                        <option value="">— Select email template —</option>
                                        {emailTemplates.map(t => (
                                            <option key={t._id || t.id} value={t._id || t.id}>
                                                {t.name} {t.subject ? `· "${t.subject.slice(0, 40)}${t.subject.length > 40 ? '…' : ''}"` : ''}
                                            </option>
                                        ))}
                                    </select>
                                    {/* Preview of selected template */}
                                    {selectedEmailTemplate?.subject && (
                                        <div className="mt-2 bg-blue-50/70 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-800">
                                            <span className="font-semibold">Subject:</span> {selectedEmailTemplate.subject}
                                        </div>
                                    )}
                                </div>
                            )
                        ) : (
                            /* Custom compose */
                            <>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Subject</label>
                                    <input
                                        type="text"
                                        value={step.action.subject || ''}
                                        onChange={(e) => onUpdateAction({ subject: e.target.value })}
                                        placeholder="e.g. Quick follow-up, {{leadName}}"
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Body</label>
                                    <textarea
                                        rows="4"
                                        value={step.action.body || ''}
                                        onChange={(e) => onUpdateAction({ body: e.target.value })}
                                        placeholder={`Hi {{leadName}},\n\nJust checking in…`}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 resize-y"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        Variables: <code className="bg-slate-100 px-1 rounded">{'{{leadName}}'}</code> · <code className="bg-slate-100 px-1 rounded">{'{{leadEmail}}'}</code> · <code className="bg-slate-100 px-1 rounded">{'{{companyName}}'}</code>
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                )}
                </div>
            </div>
        </div>
    );
};

export default SequenceBuilderModal;
