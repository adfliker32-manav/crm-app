/* eslint-disable no-unused-vars */
import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ALL_MODULES = [
    { key: 'whatsapp', label: 'WhatsApp (Inbox, Send, Receive)', group: 'whatsapp' },
    { key: 'whatsapp_templates', label: 'WhatsApp Templates', group: 'whatsapp' },
    { key: 'whatsapp_broadcasts', label: 'WhatsApp Broadcasts', group: 'whatsapp' },
    { key: 'whatsapp_chatbot', label: 'WhatsApp Chatbot (Flows + AI)', group: 'whatsapp' },
    { key: 'whatsapp_analytics', label: 'WhatsApp Analytics', group: 'whatsapp' },
    { key: 'leads', label: 'Leads Module', group: 'other' },
    { key: 'email', label: 'Email Module', group: 'other' },
    { key: 'automations', label: 'Automations / Workflows', group: 'other' },
    { key: 'reports', label: 'Reports', group: 'other' },
];

const CreatePartnerModal = ({ onClose, onCreated }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [createdKey, setCreatedKey] = useState(null);
    const [copied, setCopied] = useState(false);

    const [form, setForm] = useState({
        appName: '',
        contactPerson: '',
        contactEmail: '',
        contactPhone: '',
        pricePerAccount: '',
        allowedModules: ['whatsapp', 'whatsapp_templates', 'whatsapp_broadcasts', 'whatsapp_chatbot', 'whatsapp_analytics'],
        maxAccounts: '100',
        leadLimit: '500',
        agentLimit: '3',
        rateLimitPerMinute: '120',
        rateLimitPerDay: '10000',
        allowDirectLogin: false,
        showPoweredBy: true,
    });

    const handleChange = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

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
                allowedModules: form.allowedModules,
                maxAccounts: Number(form.maxAccounts) || 100,
                accountDefaults: {
                    leadLimit: Number(form.leadLimit) || 500,
                    agentLimit: Number(form.agentLimit) || 3,
                    activeModules: ['leads', 'whatsapp'],
                },
                rateLimit: {
                    perMinute: Number(form.rateLimitPerMinute) || 120,
                    perDay: Number(form.rateLimitPerDay) || 10000,
                },
                allowDirectLogin: form.allowDirectLogin,
                showPoweredBy: form.showPoweredBy,
            });

            setCreatedKey(res.data.data.apiKey);
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
                        <div>
                            <label className="text-sm font-medium text-slate-700">Price Per Account (₹/month) *</label>
                            <input
                                value={form.pricePerAccount}
                                onChange={e => handleChange('pricePerAccount', e.target.value)}
                                type="number"
                                min="0"
                                placeholder="299"
                                className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                            />
                        </div>
                    </div>

                    {/* Module Access */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Module Access</h3>
                        <p className="text-xs text-slate-400 mb-3">Select which modules partner's customers can use</p>
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
                        <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">API Rate Limits</h3>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-sm font-medium text-slate-700">Requests/min</label>
                                <input
                                    value={form.rateLimitPerMinute}
                                    onChange={e => handleChange('rateLimitPerMinute', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
                            <div>
                                <label className="text-sm font-medium text-slate-700">Daily Cap</label>
                                <input
                                    value={form.rateLimitPerDay}
                                    onChange={e => handleChange('rateLimitPerDay', e.target.value)}
                                    type="number" min="1"
                                    className="w-full mt-1 px-3 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 text-sm"
                                />
                            </div>
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
