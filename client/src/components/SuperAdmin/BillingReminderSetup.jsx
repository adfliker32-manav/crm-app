/* eslint-disable no-unused-vars */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

/**
 * BillingReminderSetup
 *
 * One-time Super Admin setup: assign a Meta-approved WhatsApp template to each
 * billing reminder step (Day 0, Day 5, Day 7, Day 10).
 *
 * You create the templates in Meta Business Manager → they appear here once
 * approved → select the right one for each step → Save. Done.
 */

const STEPS = [
    {
        key: 'day0',
        label: 'Day 0 — Initial Invoice',
        icon: 'fa-file-invoice',
        color: 'bg-blue-500',
        lightColor: 'bg-blue-50 border-blue-200',
        textColor: 'text-blue-700',
        description: 'Sent immediately when a payment is created (pending). Should introduce the invoice.'
    },
    {
        key: 'day5',
        label: 'Day 5 — First Reminder',
        icon: 'fa-bell',
        color: 'bg-amber-500',
        lightColor: 'bg-amber-50 border-amber-200',
        textColor: 'text-amber-700',
        description: 'Sent 5 days after the invoice if payment is still pending. Friendly nudge.'
    },
    {
        key: 'day7',
        label: 'Day 7 — Second Reminder',
        icon: 'fa-bell-exclamation',
        color: 'bg-orange-500',
        lightColor: 'bg-orange-50 border-orange-200',
        textColor: 'text-orange-700',
        description: 'Sent 7 days after the invoice if still unpaid. More urgent tone.'
    },
    {
        key: 'day10',
        label: 'Day 10 — Final Notice',
        icon: 'fa-triangle-exclamation',
        color: 'bg-red-500',
        lightColor: 'bg-red-50 border-red-200',
        textColor: 'text-red-700',
        description: 'Sent 10 days after the invoice if still unpaid. Last warning before escalation.'
    },
    {
        key: 'receipt',
        label: '✅ Payment Receipt — Confirmation',
        icon: 'fa-circle-check',
        color: 'bg-emerald-600',
        lightColor: 'bg-emerald-50 border-emerald-200',
        textColor: 'text-emerald-700',
        description: 'Sent instantly when you click “Received” and confirm a payment. Notifies the client their payment is verified.'
    }
];

const LANGUAGES = [
    { code: 'en',    label: 'English' },
    { code: 'en_US', label: 'English (US)' },
    { code: 'en_GB', label: 'English (UK)' },
    { code: 'hi',    label: 'Hindi' },
    { code: 'ar',    label: 'Arabic' },
    { code: 'es',    label: 'Spanish' },
    { code: 'pt_BR', label: 'Portuguese (BR)' },
    { code: 'fr',    label: 'French' },
    { code: 'de',    label: 'German' },
];

const BillingReminderSetup = () => {
    const { showSuccess, showError } = useNotification();

    const [templates, setTemplates] = useState([]);      // Approved WA templates
    const [loadingTemplates, setLoadingTemplates] = useState(true);
    const [saving, setSaving] = useState(false);

    // Config state
    const [config, setConfig] = useState({
        day0TemplateName: '', day0LanguageCode: 'en',
        day5TemplateName: '', day5LanguageCode: 'en',
        day7TemplateName: '', day7LanguageCode: 'en',
        day10TemplateName: '', day10LanguageCode: 'en',
        receiptTemplateName: '', receiptLanguageCode: 'en',
        sendEmail: true
    });

    // Load templates + saved config on mount
    useEffect(() => {
        const load = async () => {
            try {
                const [tplRes, cfgRes] = await Promise.all([
                    api.get('/superadmin/billing-reminder-config/templates'),
                    api.get('/superadmin/billing-reminder-config')
                ]);
                setTemplates(tplRes.data.templates || []);
                if (cfgRes.data.config) setConfig(cfgRes.data.config);
            } catch (err) {
                showError('Failed to load billing reminder config');
            } finally {
                setLoadingTemplates(false);
            }
        };
        load();
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put('/superadmin/billing-reminder-config', config);
            showSuccess('Billing reminder templates saved!');
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save config');
        } finally {
            setSaving(false);
        }
    };

    const setStep = (key, field, value) => {
        setConfig(prev => ({ ...prev, [`${key}${field}`]: value }));
    };

    // Get the body text preview from a template
    const getPreview = (templateName) => {
        const tpl = templates.find(t => t.name === templateName);
        if (!tpl) return null;
        const body = tpl.components?.find(c => c.type === 'BODY');
        return body?.text ? body.text.substring(0, 120) + (body.text.length > 120 ? '…' : '') : null;
    };

    if (loadingTemplates) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="flex flex-col items-center gap-3">
                    <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                    <p className="text-sm text-slate-500">Loading templates from your WhatsApp account…</p>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="mb-8 flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center shadow-lg flex-shrink-0">
                    <i className="fa-brands fa-whatsapp text-white text-xl"></i>
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Billing Reminder Templates</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        One-time setup. Assign a Meta-approved WhatsApp template to each billing reminder step.
                        When a client payment is pending, these templates will be sent automatically.
                    </p>
                </div>
            </div>

            {/* Steps */}
            {templates.length === 0 ? (
                /* No templates found */
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-8 text-center">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i className="fa-brands fa-whatsapp text-amber-500 text-3xl"></i>
                    </div>
                    <h3 className="text-lg font-bold text-amber-900 mb-2">No Approved Templates Found</h3>
                    <p className="text-amber-700 text-sm max-w-md mx-auto mb-4">
                        Your WhatsApp account doesn't have any approved templates yet. Create them in
                        <strong> Meta Business Manager</strong>, get them approved, then come back here to assign them.
                    </p>
                    <div className="bg-white border border-amber-200 rounded-xl p-4 text-left max-w-md mx-auto text-sm text-slate-600 space-y-1.5">
                        <p className="font-semibold text-slate-700 mb-2">💡 Steps to create billing templates:</p>
                        <p>1. Go to <strong>Communication Setup → WhatsApp</strong> tab and connect your WABA</p>
                        <p>2. Create 4 templates in <strong>Meta Business Manager</strong> (one per billing step)</p>
                        <p>3. Wait for Meta to approve them (usually 1–2 hours)</p>
                        <p>4. Come back here and assign each template to a reminder step</p>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Email toggle card */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between shadow-sm">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                                <i className="fa-solid fa-envelope text-blue-500"></i>
                            </div>
                            <div>
                                <p className="font-semibold text-slate-800 text-sm">Also send Email</p>
                                <p className="text-xs text-slate-500">Send a billing email alongside the WhatsApp template</p>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={config.sendEmail}
                                onChange={e => setConfig(prev => ({ ...prev, sendEmail: e.target.checked }))}
                            />
                            <div className="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                        </label>
                    </div>

                    {/* Reminder steps + receipt step — all rendered from STEPS array */}
                    {STEPS.map((step, idx) => {
                        const templateName = config[`${step.key}TemplateName`];
                        const langCode     = config[`${step.key}LanguageCode`];
                        const preview      = getPreview(templateName);

                        // Section divider before the receipt card
                        const showDivider = step.key === 'receipt';

                        return (
                            <React.Fragment key={step.key}>
                                {showDivider && (
                                    <div className="flex items-center gap-3 pt-2">
                                        <div className="flex-1 h-px bg-slate-200" />
                                        <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 border border-emerald-200 rounded-full">
                                            <i className="fa-solid fa-circle-check text-emerald-500 text-xs" />
                                            <span className="text-xs font-bold text-emerald-700">Payment Confirmation</span>
                                        </div>
                                        <div className="flex-1 h-px bg-slate-200" />
                                    </div>
                                )}
                                <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden ${showDivider ? 'border-emerald-200 ring-1 ring-emerald-100' : ''}`}>
                                    {/* Step header */}
                                    <div className={`flex items-center gap-4 px-6 py-4 border-b ${showDivider ? 'border-emerald-100 bg-emerald-50/40' : 'border-slate-100'}`}>
                                        <div className={`w-9 h-9 ${step.color} rounded-xl flex items-center justify-center flex-shrink-0`}>
                                            <i className={`fa-solid ${step.icon} text-white text-sm`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-slate-800 text-sm">{step.label}</p>
                                            <p className="text-xs text-slate-500">{step.description}</p>
                                        </div>
                                        {/* Status pill */}
                                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full flex-shrink-0 ${
                                            templateName
                                                ? 'bg-emerald-100 text-emerald-700'
                                                : 'bg-slate-100 text-slate-500'
                                        }`}>
                                            {templateName ? '✓ Configured' : 'Not set'}
                                        </span>
                                    </div>

                                    {/* Template selector + language */}
                                    <div className="px-6 py-5 space-y-3">
                                        <div className="grid grid-cols-[1fr_160px] gap-3">
                                            {/* Template dropdown */}
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                                                    WhatsApp Template
                                                </label>
                                                <select
                                                    value={templateName}
                                                    onChange={e => setStep(step.key, 'TemplateName', e.target.value)}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400 outline-none bg-slate-50 cursor-pointer"
                                                >
                                                    <option value="">— Select approved template —</option>
                                                    {templates.map(t => (
                                                        <option key={t._id || t.name} value={t.name}>
                                                            {t.name}  ({t.category})
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Language */}
                                            <div>
                                                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                                                    Language
                                                </label>
                                                <select
                                                    value={langCode}
                                                    onChange={e => setStep(step.key, 'LanguageCode', e.target.value)}
                                                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400 outline-none bg-slate-50 cursor-pointer"
                                                >
                                                    {LANGUAGES.map(l => (
                                                        <option key={l.code} value={l.code}>{l.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        </div>

                                        {/* Body preview */}
                                        {preview && (
                                            <div className={`rounded-xl border px-4 py-3 ${step.lightColor}`}>
                                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-1">Template Preview</p>
                                                <p className={`text-xs ${step.textColor} leading-relaxed`}>{preview}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </React.Fragment>
                        );
                    })}

                    {/* Save button */}
                    <div className="flex justify-end pt-2 pb-8">
                        <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2.5 px-8 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm rounded-xl shadow-lg shadow-emerald-200 transition-all"
                        >
                            {saving ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i> Saving…</>
                            ) : (
                                <><i className="fa-solid fa-floppy-disk"></i> Save Template Config</>
                            )}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BillingReminderSetup;
