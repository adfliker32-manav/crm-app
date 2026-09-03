/* eslint-disable no-unused-vars */
import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const ALL_MODULES = [
    { key: 'whatsapp', label: 'WhatsApp Inbox' },
    { key: 'whatsapp_templates', label: 'Templates' },
    { key: 'whatsapp_broadcasts', label: 'Broadcasts' },
    { key: 'whatsapp_chatbot', label: 'Chatbot (Flows + AI)' },
    { key: 'whatsapp_analytics', label: 'WhatsApp Analytics' },
    { key: 'leads', label: 'Leads Module' },
    { key: 'email', label: 'Email Module' },
    { key: 'automations', label: 'Automations' },
    { key: 'reports', label: 'Reports' },
];

const WEBHOOK_EVENTS = [
    { key: 'message.received',      label: 'Message Received',        desc: 'When a WhatsApp message is received' },
    { key: 'message.status_update', label: 'Message Status Update',   desc: 'Sent / delivered / read / failed' },
    { key: 'account.created',       label: 'Account Created',         desc: 'When a sub-account is provisioned' },
    { key: 'account.frozen',        label: 'Account Frozen/Unfrozen', desc: 'Account status changes' },
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
        allowedModules: partner.allowedModules || [],
        maxAccounts: partner.maxAccounts || 100,
        accountDefaults: partner.accountDefaults || { leadLimit: 500, agentLimit: 3 },
        rateLimit: partner.rateLimit || { perAccountPerMinute: 200, perAccountPerDay: 5000, floor: 200 },
        allowDirectLogin: partner.allowDirectLogin || false,
        showPoweredBy: partner.showPoweredBy !== false,
        webhookUrl: partner.webhookUrl || '',
        webhookEvents: partner.webhookEvents || [],
    });

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

            {/* Module Access */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Module Access</h3>
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
                {/* Live preview */}
                {(() => {
                    const n = partner.accounts?.length || 0;
                    const effMin = Math.max(form.rateLimit.floor || 200, n * (form.rateLimit.perAccountPerMinute || 200));
                    const effDay = Math.max((form.rateLimit.floor || 200) * 48, n * (form.rateLimit.perAccountPerDay || 5000));
                    return (
                        <div className="mt-3 bg-cyan-50 border border-cyan-200 rounded-lg px-4 py-2.5 flex items-center gap-3 text-sm">
                            <i className="fa-solid fa-calculator text-cyan-500" />
                            <span className="text-slate-600">
                                Current effective limit:
                                <strong className="text-cyan-700 ml-1">{effMin.toLocaleString()} req/min</strong>
                                <span className="text-slate-400 mx-1">·</span>
                                <strong className="text-cyan-700">{effDay.toLocaleString()} req/day</strong>
                                <span className="text-slate-400 ml-2">({n} accounts × {form.rateLimit.perAccountPerMinute || 200})</span>
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

                    {partner.webhookSecret && (
                        <p className="text-xs text-slate-400 mt-2">
                            <i className="fa-solid fa-lock mr-1" />
                            Signing Secret: {partner.webhookSecret.slice(0, 10)}{'•'.repeat(20)}
                        </p>
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
