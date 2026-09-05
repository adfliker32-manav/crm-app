/* eslint-disable no-unused-vars */
import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { CURRENCY_CODES, currencySymbol } from '../../utils/currency';

// Modules surfaceable in the EMBED. Only WhatsApp submodules belong here — the
// embed renders WhatsAppManagement and nothing else, so listing Leads/Email/
// Reports here only ever promised something the embed could not deliver.
const ALL_MODULES = [
    { key: 'whatsapp', label: 'WhatsApp (Inbox, Send, Receive)', group: 'whatsapp' },
    { key: 'whatsapp_templates', label: 'WhatsApp Templates', group: 'whatsapp' },
    { key: 'whatsapp_broadcasts', label: 'WhatsApp Broadcasts', group: 'whatsapp' },
    { key: 'whatsapp_chatbot', label: 'WhatsApp Chatbot (Flows + AI)', group: 'whatsapp' },
    { key: 'whatsapp_analytics', label: 'WhatsApp Analytics', group: 'whatsapp' },
];

// Modules a newly provisioned account's WORKSPACE receives — was hardcoded and
// unreachable from the UI.
const PROVISION_MODULES = [
    { key: 'leads', label: 'Leads' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'email', label: 'Email' },
    { key: 'automations', label: 'Automations' },
    { key: 'reports', label: 'Reports' },
    { key: 'team', label: 'Team' },
];

const CreatePartnerModal = ({ onClose, onCreated }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [createdKey, setCreatedKey] = useState(null);
    const [createdSecret, setCreatedSecret] = useState(null);
    const [copied, setCopied] = useState(false);
    const [secretCopied, setSecretCopied] = useState(false);
    const [originInput, setOriginInput] = useState('');

    const [form, setForm] = useState({
        appName: '',
        contactPerson: '',
        contactEmail: '',
        contactPhone: '',
        pricePerAccount: '',
        currency: 'INR',
        allowedModules: ['whatsapp', 'whatsapp_templates', 'whatsapp_broadcasts', 'whatsapp_chatbot', 'whatsapp_analytics'],
        provisionModules: ['leads', 'whatsapp'],
        allowedOrigins: [],
        maxAccounts: '100',
        leadLimit: '500',
        agentLimit: '3',
        rateLimitPerMinute: '30',
        rateLimitPerDay: '500',
        rateLimitFloor: '30',
        allowDirectLogin: false,
        showPoweredBy: true,
    });

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

    const addOrigin = () => {
        const raw = originInput.trim();
        if (!raw) return;
        let normalised;
        try {
            const u = new URL(raw);
            if (!['http:', 'https:'].includes(u.protocol) || raw.includes('*')) throw new Error();
            normalised = u.origin;
        } catch {
            return showError('Enter an exact origin like https://crm.partner.com — no paths, no wildcards.');
        }
        if (!form.allowedOrigins.includes(normalised)) {
            setForm(prev => ({ ...prev, allowedOrigins: [...prev.allowedOrigins, normalised] }));
        }
        setOriginInput('');
    };

    const toggleModule = (key) => {
        setForm(prev => ({
            ...prev,
            allowedModules: prev.allowedModules.includes(key)
                ? prev.allowedModules.filter(m => m !== key)
                : [...prev.allowedModules, key]
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.appName.trim()) return showError('App name is required');

        setLoading(true);
        try {
            const res = await api.post('/superadmin/partner-apps', {
                appName: form.appName.trim(),
                contactPerson: form.contactPerson || null,
                contactEmail: form.contactEmail || null,
                contactPhone: form.contactPhone || null,
                pricePerAccount: Number(form.pricePerAccount) || 0,
                currency: form.currency,
                allowedModules: form.allowedModules,
                allowedOrigins: form.allowedOrigins,
                maxAccounts: Number(form.maxAccounts) || 100,
                accountDefaults: {
                    leadLimit: Number(form.leadLimit) || 500,
                    agentLimit: Number(form.agentLimit) || 3,
                    // Was hardcoded — now whatever the admin picked.
                    activeModules: form.provisionModules,
                },
                rateLimit: {
                    perAccountPerMinute: Number(form.rateLimitPerMinute) || 30,
                    perAccountPerDay: Number(form.rateLimitPerDay) || 500,
                    floor: Number(form.rateLimitFloor) || 30,
                },
                allowDirectLogin: form.allowDirectLogin,
                showPoweredBy: form.showPoweredBy,
            });

            setCreatedKey(res.data.data.apiKey);
            // The webhook signing secret used to be returned here and thrown
            // away, leaving no way for anyone to give it to the partner.
            setCreatedSecret(res.data.data.webhookSecret || null);
            showSuccess('Partner app created!');
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to create partner');
        } finally {
            setLoading(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(createdKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
    };

    // ── API KEY REVEAL (shown after successful creation) ─────────────────────
    if (createdKey) {
        return (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i className="fa-solid fa-check text-3xl text-emerald-600" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-900">Partner App Created!</h2>
                        <p className="text-slate-500 mt-1 text-sm">Copy the API key now — it will NOT be shown again</p>
                    </div>

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                        <div className="flex items-center gap-2 mb-2">
                            <i className="fa-solid fa-triangle-exclamation text-amber-600" />
                            <span className="font-semibold text-amber-800 text-sm">Save this key securely</span>
                        </div>
                        <div className="bg-white border border-amber-300 rounded-lg p-3 font-mono text-xs break-all text-slate-700">
                            {createdKey}
                        </div>
                        <button
                            onClick={handleCopy}
                            className={`mt-3 w-full py-2.5 rounded-lg font-semibold text-sm transition ${
                                copied
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-cyan-600 text-white hover:bg-cyan-700'
                            }`}
                        >
                            {copied ? (
                                <><i className="fa-solid fa-check mr-2" />Copied!</>
                            ) : (
                                <><i className="fa-solid fa-clipboard mr-2" />Copy API Key</>
                            )}
                        </button>
                    </div>

                    {createdSecret && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-6">
                            <div className="flex items-center gap-2 mb-2">
                                <i className="fa-solid fa-signature text-slate-500" />
                                <span className="font-semibold text-slate-700 text-sm">Webhook signing secret</span>
                            </div>
                            <p className="text-xs text-slate-500 mb-2">
                                The partner needs this to verify the <code className="font-mono">X-Partner-Signature</code> header
                                on every delivery. It cannot be retrieved later — only rotated.
                            </p>
                            <div className="bg-white border border-slate-200 rounded-lg p-3 font-mono text-xs break-all text-slate-700">
                                {createdSecret}
                            </div>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(createdSecret);
                                    setSecretCopied(true);
                                    setTimeout(() => setSecretCopied(false), 3000);
                                }}
                                className={`mt-3 w-full py-2 rounded-lg font-semibold text-sm transition ${
                                    secretCopied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700 hover:bg-slate-300'
                                }`}
                            >
                                {secretCopied
                                    ? <><i className="fa-solid fa-check mr-2" />Copied!</>
                                    : <><i className="fa-solid fa-clipboard mr-2" />Copy Signing Secret</>}
                            </button>
                        </div>
                    )}

                    <button
                        onClick={onCreated}
                        className="w-full py-2.5 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition"
                    >
                        Done
                    </button>
                </div>
            </div>
        );
    }

    // ── CREATE FORM ─────────────────────────────────────────────────────────
    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 rounded-t-2xl flex items-center justify-between z-10">
                    <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <i className="fa-solid fa-puzzle-piece text-cyan-500" />
                        Create Partner App
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
                        <i className="fa-solid fa-times text-lg" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Basic Info</h3>
                        <div className="space-y-3">
                            <div>
                                <label className="text-sm font-medium text-slate-700">App Name *</label>
                                <input
                                    value={form.appName}
                                    onChange={e => handleChange('appName', e.target.value)}
                                    placeholder="e.g. Car Dealer CRM"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                    required
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-sm font-medium text-slate-700">Contact Person</label>
                                    <input
                                        value={form.contactPerson}
                                        onChange={e => handleChange('contactPerson', e.target.value)}
                                        className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-sm font-medium text-slate-700">Contact Email</label>
                                    <input
                                        value={form.contactEmail}
                                        onChange={e => handleChange('contactEmail', e.target.value)}
                                        type="email"
                                        className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-700">Contact Phone</label>
                                <input
                                    value={form.contactPhone}
                                    onChange={e => handleChange('contactPhone', e.target.value)}
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Pricing */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Pricing</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium text-slate-700">
                                    Price Per Active Account ({currencySymbol(form.currency)}/month) *
                                </label>
                                <input
                                    value={form.pricePerAccount}
                                    onChange={e => handleChange('pricePerAccount', e.target.value)}
                                    type="number"
                                    min="0"
                                    placeholder="299"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-700">Currency</label>
                                <select
                                    value={form.currency}
                                    onChange={e => handleChange('currency', e.target.value)}
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                >
                                    {CURRENCY_CODES.map(c => (
                                        <option key={c} value={c}>{c} ({currencySymbol(c)})</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Embed Origins — without these the iframe cannot render */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">Embed Origins</h3>
                        <p className="text-xs text-slate-400 mb-3">
                            Domains allowed to load the embed in an iframe. The browser blocks framing from
                            anywhere not listed, so leave this empty only if the partner isn't using the embed yet.
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
                        {form.allowedOrigins.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                                {form.allowedOrigins.map(origin => (
                                    <span key={origin} className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-50 border border-cyan-200 rounded-lg text-xs font-mono text-cyan-800">
                                        {origin}
                                        <button type="button"
                                            onClick={() => handleChange('allowedOrigins', form.allowedOrigins.filter(o => o !== origin))}
                                            className="text-cyan-400 hover:text-red-500">
                                            <i className="fa-solid fa-xmark" />
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Module Access */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Embed Module Access</h3>
                        <p className="text-xs text-slate-400 mb-3">
                            What the partner's customers see inside the embedded UI. Enforced server-side.
                        </p>
                        <div className="space-y-2">
                            {ALL_MODULES.map(mod => (
                                <label key={mod.key} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                                    <input
                                        type="checkbox"
                                        checked={form.allowedModules.includes(mod.key)}
                                        onChange={() => toggleModule(mod.key)}
                                        className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                                    />
                                    <span className="text-sm text-slate-700">{mod.label}</span>
                                    {mod.group === 'whatsapp' && (
                                        <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold">WhatsApp</span>
                                    )}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Provisioning modules */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">New Account Modules</h3>
                        <p className="text-xs text-slate-400 mb-3">
                            Modules each provisioned account's workspace gets. The embed grant above can only
                            ever be a subset of these.
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                            {PROVISION_MODULES.map(mod => (
                                <label key={mod.key} className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                                    <input
                                        type="checkbox"
                                        checked={form.provisionModules.includes(mod.key)}
                                        onChange={() => handleChange('provisionModules',
                                            form.provisionModules.includes(mod.key)
                                                ? form.provisionModules.filter(m => m !== mod.key)
                                                : [...form.provisionModules, mod.key]
                                        )}
                                        className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                                    />
                                    <span className="text-sm text-slate-700">{mod.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Account Limits */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Account Limits</h3>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-sm font-medium text-slate-700">Max Accounts</label>
                                <input
                                    value={form.maxAccounts}
                                    onChange={e => handleChange('maxAccounts', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-700">Leads/Account</label>
                                <input
                                    value={form.leadLimit}
                                    onChange={e => handleChange('leadLimit', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-700">Agents/Account</label>
                                <input
                                    value={form.agentLimit}
                                    onChange={e => handleChange('agentLimit', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* API Settings */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-1">API Rate Limits</h3>
                        <p className="text-xs text-slate-400 mb-3">Scales automatically: <strong>accounts × per-account rate</strong></p>
                        <div className="grid grid-cols-3 gap-3">
                            <div>
                                <label className="text-sm font-medium text-slate-700">Per Account / min</label>
                                <input
                                    value={form.rateLimitPerMinute}
                                    onChange={e => handleChange('rateLimitPerMinute', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-700">Per Account / day</label>
                                <input
                                    value={form.rateLimitPerDay}
                                    onChange={e => handleChange('rateLimitPerDay', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-700">Floor (min)</label>
                                <input
                                    value={form.rateLimitFloor}
                                    onChange={e => handleChange('rateLimitFloor', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                        </div>
                        <div className="mt-2 bg-cyan-50 border border-cyan-200 rounded-lg px-3 py-2 text-xs text-slate-500">
                            <i className="fa-solid fa-circle-info text-cyan-500 mr-1" />
                            Example with {form.maxAccounts || 100} accounts:
                            <strong className="text-cyan-700 ml-1">
                                {Math.max(Number(form.rateLimitFloor) || 200, (Number(form.maxAccounts) || 100) * (Number(form.rateLimitPerMinute) || 200)).toLocaleString()} req/min
                            </strong>
                        </div>
                    </div>

                    {/* Access Control */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Access Control</h3>
                        <div className="space-y-3">
                            <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                                <input
                                    type="checkbox"
                                    checked={form.allowDirectLogin}
                                    onChange={e => handleChange('allowDirectLogin', e.target.checked)}
                                    className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                                />
                                <div>
                                    <span className="text-sm text-slate-700">Allow direct login</span>
                                    <p className="text-xs text-slate-400">Customers can also login at adfliker.com</p>
                                </div>
                            </label>
                            <label className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 cursor-pointer transition">
                                <input
                                    type="checkbox"
                                    checked={form.showPoweredBy}
                                    onChange={e => handleChange('showPoweredBy', e.target.checked)}
                                    className="w-4 h-4 text-cyan-600 rounded focus:ring-cyan-500"
                                />
                                <div>
                                    <span className="text-sm text-slate-700">Show "Powered by Adfliker" in embed</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-4 border-t border-slate-200">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-semibold hover:bg-slate-200 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-semibold hover:shadow-lg transition disabled:opacity-50"
                        >
                            {loading ? (
                                <><i className="fa-solid fa-spinner fa-spin mr-2" />Creating...</>
                            ) : (
                                <><i className="fa-solid fa-plus mr-2" />Create Partner</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreatePartnerModal;
