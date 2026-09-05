/* eslint-disable no-unused-vars */
import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import { CURRENCY_CODES, currencySymbol } from '../../utils/currency';

// Modules the partner may surface in the EMBED. Enforced for real now (the
// embed clamp in authMiddleware + the tab filter in WhatsAppManagement) — this
// grid used to write a field nothing ever read.
const ALL_MODULES = [
    { key: 'whatsapp', label: 'WhatsApp Inbox' },
    { key: 'whatsapp_templates', label: 'Templates' },
    { key: 'whatsapp_broadcasts', label: 'Broadcasts' },
    { key: 'whatsapp_chatbot', label: 'Chatbot (Flows + AI)' },
    { key: 'whatsapp_analytics', label: 'WhatsApp Analytics' },
];

// Modules a NEWLY PROVISIONED account's workspace receives. Distinct from the
// embed grant above: this is what the tenant owns, that is what the partner may
// show. Previously hardcoded to ['leads','whatsapp'] in the create modal with no
// control here at all, so it could never be changed after creation.
const PROVISION_MODULES = [
    { key: 'leads', label: 'Leads' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'email', label: 'Email' },
    { key: 'automations', label: 'Automations' },
    { key: 'reports', label: 'Reports' },
    { key: 'team', label: 'Team' },
];

// Must stay in sync with src/constants/partnerWebhookEvents.js — every entry
// here has a real emitter behind it.
const WEBHOOK_EVENTS = [
    { key: 'message.received',      label: 'Message Received',        desc: 'When a WhatsApp message is received' },
    { key: 'message.status_update', label: 'Message Status Update',   desc: 'Sent / delivered / read / failed' },
    { key: 'account.created',       label: 'Account Created',         desc: 'When a sub-account is provisioned' },
    { key: 'account.frozen',        label: 'Account Frozen/Unfrozen', desc: 'Account status changes' },
    { key: 'account.deleted',       label: 'Account Deleted',         desc: 'When a sub-account is permanently removed' },
];

const PartnerSettingsTab = ({ partner, onRefresh }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [saving, setSaving] = useState(false);

    const [form, setForm] = useState({
        appName: partner.appName || '',
        contactPerson: partner.contactPerson || '',
        contactEmail: partner.contactEmail || '',
        contactPhone: partner.contactPhone || '',
        pricePerAccount: partner.pricePerAccount || 0,
        currency: partner.currency || 'INR',
        allowedModules: partner.allowedModules || [],
        maxAccounts: partner.maxAccounts || 100,
        accountDefaults: {
            leadLimit:     partner.accountDefaults?.leadLimit ?? 500,
            agentLimit:    partner.accountDefaults?.agentLimit ?? 3,
            activeModules: partner.accountDefaults?.activeModules || ['leads', 'whatsapp'],
        },
        rateLimit: partner.rateLimit || { perAccountPerMinute: 30, perAccountPerDay: 500, floor: 30 },
        allowDirectLogin: partner.allowDirectLogin || false,
        showPoweredBy: partner.showPoweredBy !== false,
        allowedOrigins: partner.allowedOrigins || [],
        webhookUrl: partner.webhookUrl || '',
        webhookEvents: partner.webhookEvents || [],
    });

    const [originInput, setOriginInput] = useState('');

    const addOrigin = () => {
        const raw = originInput.trim();
        if (!raw) return;
        // Normalise here too so the admin sees immediately what will be stored,
        // rather than having the server quietly rewrite it.
        let normalised;
        try {
            const u = new URL(raw);
            if (!['http:', 'https:'].includes(u.protocol) || raw.includes('*')) throw new Error();
            normalised = u.origin;
        } catch {
            return showError('Enter an exact origin like https://crm.partner.com — no paths, no wildcards.');
        }
        if (form.allowedOrigins.includes(normalised)) return setOriginInput('');
        setForm(prev => ({ ...prev, allowedOrigins: [...prev.allowedOrigins, normalised] }));
        setOriginInput('');
    };

    const removeOrigin = (origin) =>
        setForm(prev => ({ ...prev, allowedOrigins: prev.allowedOrigins.filter(o => o !== origin) }));

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));
    const handleNested = (parent, field, value) => setForm(prev => ({
        ...prev,
        [parent]: { ...prev[parent], [field]: value }
    }));

    const toggleModule = (key) => {
        setForm(prev => ({
            ...prev,
            allowedModules: prev.allowedModules.includes(key)
                ? prev.allowedModules.filter(m => m !== key)
                : [...prev.allowedModules, key]
        }));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.put(`/superadmin/partner-apps/${partner._id}`, form);
            showSuccess('Settings saved');
            onRefresh();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const handleDeactivate = async () => {
        const confirmed = await showDanger(
            'This will immediately block all API access for this partner and their customers. Embed iframes will stop working.',
            'Deactivate Partner?'
        );
        if (!confirmed) return;
        try {
            await api.delete(`/superadmin/partner-apps/${partner._id}`);
            showSuccess('Partner deactivated');
            onRefresh();
        } catch { showError('Failed to deactivate partner'); }
    };

    const handleActivate = async () => {
        try {
            await api.put(`/superadmin/partner-apps/${partner._id}`, { isActive: true });
            showSuccess('Partner activated — API access restored');
            onRefresh();
        } catch { showError('Failed to activate partner'); }
    };

    return (
        <div className="space-y-8 max-w-2xl">
            {/* Basic Info */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Basic Info</h3>
                <div className="space-y-3">
                    <div>
                        <label className="text-sm font-medium text-slate-700">App Name</label>
                        <input value={form.appName} onChange={e => handleChange('appName', e.target.value)}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-sm font-medium text-slate-700">Contact Person</label>
                            <input value={form.contactPerson} onChange={e => handleChange('contactPerson', e.target.value)}
                                className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                        </div>
                        <div>
                            <label className="text-sm font-medium text-slate-700">Contact Email</label>
                            <input value={form.contactEmail} onChange={e => handleChange('contactEmail', e.target.value)}
                                className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                        </div>
                    </div>
                </div>
            </section>

            {/* Pricing */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Pricing</h3>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-sm font-medium text-slate-700">Price / Active Account / Month</label>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="text-slate-500 text-sm w-6 text-center">{currencySymbol(form.currency)}</span>
                            <input type="number" min="0" value={form.pricePerAccount}
                                onChange={e => handleChange('pricePerAccount', Number(e.target.value))}
                                className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                        </div>
                    </div>
                    <div>
                        {/* Currency was stored but not editable anywhere, so it was
                            stuck on INR while being rendered as a literal "INR". */}
                        <label className="text-sm font-medium text-slate-700">Currency</label>
                        <select value={form.currency} onChange={e => handleChange('currency', e.target.value)}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500">
                            {CURRENCY_CODES.map(c => (
                                <option key={c} value={c}>{c} ({currencySymbol(c)})</option>
                            ))}
                        </select>
                        <p className="text-xs text-slate-400 mt-1">Applies to new bills only — existing invoices keep their original currency.</p>
                    </div>
                </div>
            </section>

            {/* Module Access */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Embed Module Access</h3>
                <p className="text-xs text-slate-400 mb-3">
                    What this partner's customers can see and use inside the embedded UI. Enforced
                    server-side — unchecked modules are removed from the session, not just hidden.
                </p>
                <div className="grid grid-cols-2 gap-2">
                    {ALL_MODULES.map(mod => (
                        <label key={mod.key} className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                            <input type="checkbox" checked={form.allowedModules.includes(mod.key)}
                                onChange={() => toggleModule(mod.key)}
                                className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500" />
                            <span className="text-sm text-slate-700">{mod.label}</span>
                        </label>
                    ))}
                </div>
                {!form.allowedModules.includes('whatsapp') && (
                    <p className="mt-2 text-xs text-amber-600">
                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                        Without <strong>WhatsApp Inbox</strong> the embed renders nothing — it is the base module every tab hangs off.
                    </p>
                )}
            </section>

            {/* Embed Origins */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Embed Origins</h3>
                <p className="text-xs text-slate-400 mb-3">
                    Domains allowed to load the embed in an iframe. <strong>Required</strong> — the browser
                    blocks framing from anywhere not listed here, so an empty list means the partner's
                    iframe stays blank.
                </p>
                <div className="flex gap-2">
                    <input
                        value={originInput}
                        onChange={e => setOriginInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOrigin(); } }}
                        placeholder="https://crm.partner.com"
                        className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    />
                    <button type="button" onClick={addOrigin}
                        className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200 transition">
                        Add
                    </button>
                </div>
                {form.allowedOrigins.length > 0 ? (
                    <div className="flex flex-wrap gap-2 mt-3">
                        {form.allowedOrigins.map(origin => (
                            <span key={origin} className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-50 border border-cyan-200 rounded-lg text-xs font-mono text-cyan-800">
                                {origin}
                                <button type="button" onClick={() => removeOrigin(origin)} className="text-cyan-400 hover:text-red-500">
                                    <i className="fa-solid fa-xmark" />
                                </button>
                            </span>
                        ))}
                    </div>
                ) : (
                    <p className="mt-3 text-xs text-amber-600">
                        <i className="fa-solid fa-triangle-exclamation mr-1" />
                        No origins registered — this partner's embed will not render anywhere.
                    </p>
                )}
            </section>

            {/* Provisioning Defaults */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">New Account Modules</h3>
                <p className="text-xs text-slate-400 mb-3">
                    Modules a newly provisioned account's workspace receives. The embed grant above can
                    only ever be a subset of what the account actually owns.
                </p>
                <div className="grid grid-cols-3 gap-2">
                    {PROVISION_MODULES.map(mod => (
                        <label key={mod.key} className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                            <input type="checkbox"
                                checked={form.accountDefaults.activeModules.includes(mod.key)}
                                onChange={() => handleNested('accountDefaults', 'activeModules',
                                    form.accountDefaults.activeModules.includes(mod.key)
                                        ? form.accountDefaults.activeModules.filter(m => m !== mod.key)
                                        : [...form.accountDefaults.activeModules, mod.key]
                                )}
                                className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500" />
                            <span className="text-sm text-slate-700">{mod.label}</span>
                        </label>
                    ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">Applies to accounts created from now on — existing accounts are unchanged.</p>
            </section>

            {/* Account Limits */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Account Limits</h3>
                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label className="text-sm font-medium text-slate-700">Max Accounts</label>
                        <input type="number" value={form.maxAccounts} onChange={e => handleChange('maxAccounts', Number(e.target.value))}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-slate-700">Leads/Account</label>
                        <input type="number" value={form.accountDefaults.leadLimit}
                            onChange={e => handleNested('accountDefaults', 'leadLimit', Number(e.target.value))}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-slate-700">Agents/Account</label>
                        <input type="number" value={form.accountDefaults.agentLimit}
                            onChange={e => handleNested('accountDefaults', 'agentLimit', Number(e.target.value))}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>
                </div>
            </section>

            {/* API Rate Limits */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">API Rate Limits</h3>
                <p className="text-xs text-slate-400 mb-3">
                    Limits scale with account count: <strong>accounts × per-account rate</strong>
                </p>
                <div className="grid grid-cols-3 gap-3">
                    <div>
                        <label className="text-sm font-medium text-slate-700">Per Account / min</label>
                        <input type="number" value={form.rateLimit.perAccountPerMinute}
                            onChange={e => handleNested('rateLimit', 'perAccountPerMinute', Number(e.target.value))}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-slate-700">Per Account / day</label>
                        <input type="number" value={form.rateLimit.perAccountPerDay}
                            onChange={e => handleNested('rateLimit', 'perAccountPerDay', Number(e.target.value))}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>
                    <div>
                        <label className="text-sm font-medium text-slate-700">Floor (0 accounts)</label>
                        <input type="number" value={form.rateLimit.floor}
                            onChange={e => handleNested('rateLimit', 'floor', Number(e.target.value))}
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>
                </div>
                {/* Live preview — mirrors partnerApiAuthMiddleware exactly.
                    It previously used a raw account count (0 for a fresh partner)
                    and 200/5000 fallbacks, so it showed a limit the server would
                    never actually apply. */}
                {(() => {
                    const n = Math.max(1, partner.accounts?.length || 0);
                    const perMin = form.rateLimit.perAccountPerMinute || 30;
                    const perDay = form.rateLimit.perAccountPerDay || 500;
                    const floor  = form.rateLimit.floor || 30;
                    const effMin = Math.max(floor, n * perMin);
                    const effDay = Math.max(floor * 48, n * perDay);
                    return (
                        <div className="mt-3 bg-cyan-50 border border-cyan-200 rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm">
                            <i className="fa-solid fa-calculator text-cyan-500" />
                            <span className="text-slate-600">
                                Current effective limit:
                                <strong className="text-cyan-700 ml-1">{effMin.toLocaleString()} req/min</strong>
                                <span className="text-slate-400 mx-1">·</span>
                                <strong className="text-cyan-700">{effDay.toLocaleString()} req/day</strong>
                                <span className="text-slate-400 ml-2">({n} account{n === 1 ? '' : 's'} × {perMin}/min)</span>
                            </span>
                        </div>
                    );
                })()}
            </section>

            {/* Access Control */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Access Control</h3>
                <div className="space-y-2">
                    <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={form.allowDirectLogin}
                            onChange={e => handleChange('allowDirectLogin', e.target.checked)}
                            className="w-4 h-4 text-cyan-600 rounded" />
                        <span className="text-sm text-slate-700">Allow direct login at adfliker.com</span>
                    </label>
                    <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={form.showPoweredBy}
                            onChange={e => handleChange('showPoweredBy', e.target.checked)}
                            className="w-4 h-4 text-cyan-600 rounded" />
                        <span className="text-sm text-slate-700">Show "Powered by Adfliker" in embed</span>
                    </label>
                </div>
            </section>

            {/* Webhook */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Webhook</h3>
                <div className="space-y-3">
                    <div>
                        <label className="text-sm font-medium text-slate-700">Webhook URL</label>
                        <input value={form.webhookUrl} onChange={e => handleChange('webhookUrl', e.target.value)}
                            placeholder="https://partner-crm.com/webhooks/adfliker"
                            className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
                    </div>

                    {/* Webhook Events */}
                    <div>
                        <label className="text-sm font-medium text-slate-700 block mb-2">Subscribed Events</label>
                        <div className="space-y-1">
                            {WEBHOOK_EVENTS.map(ev => (
                                <label key={ev.key} className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                                    <input
                                        type="checkbox"
                                        checked={(form.webhookEvents || []).includes(ev.key)}
                                        onChange={() => {
                                            const current = form.webhookEvents || [];
                                            handleChange('webhookEvents',
                                                current.includes(ev.key)
                                                    ? current.filter(e => e !== ev.key)
                                                    : [...current, ev.key]
                                            );
                                        }}
                                        className="w-4 h-4 text-cyan-600 rounded mt-0.5 flex-shrink-0"
                                    />
                                    <div>
                                        <p className="text-sm text-slate-700 font-medium">{ev.label}</p>
                                        <p className="text-xs text-slate-400">{ev.desc}</p>
                                    </div>
                                </label>
                            ))}
                        </div>
                    </div>

                    <p className="text-xs text-slate-400 mt-2">
                        <i className="fa-solid fa-lock mr-1" />
                        {partner.hasWebhookSecret
                            ? 'Deliveries are HMAC-signed. The secret is not stored in a retrievable form — issue a new one from the API Key tab.'
                            : 'No signing secret yet — set one from the API Key tab so the partner can verify deliveries.'}
                    </p>
                    {(partner.webhookPending > 0 || partner.webhookFailed > 0) && (
                        <div className="mt-2 flex items-center gap-3 text-xs">
                            {partner.webhookPending > 0 && (
                                <span className="text-amber-600">
                                    <i className="fa-solid fa-clock mr-1" />
                                    {partner.webhookPending} delivery(s) retrying
                                </span>
                            )}
                            {partner.webhookFailed > 0 && (
                                <span className="text-red-600">
                                    <i className="fa-solid fa-circle-xmark mr-1" />
                                    {partner.webhookFailed} failed this month
                                </span>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* Save */}
            <div className="flex gap-3 pt-4 border-t border-slate-200">
                <button onClick={handleSave} disabled={saving}
                    className="px-8 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-semibold hover:shadow-lg transition disabled:opacity-50">
                    {saving ? <><i className="fa-solid fa-spinner fa-spin mr-2" />Saving...</> : 'Save Changes'}
                </button>
            </div>

            {/* Danger Zone */}
            <section className="border-t border-red-200 pt-6">
                <h3 className="text-sm font-bold text-red-500 uppercase tracking-wider mb-3">Danger Zone</h3>

                {partner.isActive ? (
                    <>
                        <button onClick={handleDeactivate}
                            className="px-5 py-2.5 border-2 border-red-300 text-red-600 rounded-xl font-semibold hover:bg-red-50 transition text-sm">
                            <i className="fa-solid fa-power-off mr-2" />
                            Deactivate Partner
                        </button>
                        <p className="text-xs text-slate-400 mt-2">Stops all API access immediately. Embed iframes will stop working.</p>
                    </>
                ) : (
                    <>
                        <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-700 font-medium">
                            <i className="fa-solid fa-circle-xmark" />
                            This partner is currently <strong>deactivated</strong>. All API access is blocked.
                        </div>
                        <button onClick={handleActivate}
                            className="px-5 py-2.5 border-2 border-emerald-400 text-emerald-700 rounded-xl font-semibold hover:bg-emerald-50 transition text-sm">
                            <i className="fa-solid fa-circle-check mr-2" />
                            Activate Partner
                        </button>
                        <p className="text-xs text-slate-400 mt-2">Restores full API access for this partner and their customers.</p>
                    </>
                )}
            </section>
        </div>
    );
};

export default PartnerSettingsTab;
