/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

const AgencyWhiteLabel = () => {
    const { user } = useAuth();
    const { showError } = useNotification();
    const [settings, setSettings] = useState({
        brandName: 'Adfliker',
        logoUrl: '',
        primaryColor: '#6366f1',
        secondaryColor: '#8b5cf6',
        customDomain: ''
    });
    const [usage, setUsage] = useState({ whatsappSent: 0, emailsSent: 0 });
    const [limits, setLimits] = useState({ whatsappMessagesPerMonth: 1000, emailsPerMonth: 5000 });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        // Load current settings + usage
        api.get('/agency/branding/' + user?._id).then(r => setSettings(r.data)).catch((err) => {
            console.error('Failed to load branding settings:', err.message);
        });
        api.get('/agency/usage').then(r => {
            setUsage(r.data.usage || {});
            setLimits(r.data.planLimits || {});
        }).catch((err) => {
            console.error('Failed to load usage data:', err.message);
        });
    }, [user]);

    const handleSave = async () => {
        try {
            setSaving(true);
            await api.put('/agency/branding', settings);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (e) {
            showError('Failed to save settings.');
        } finally {
            setSaving(false);
        }
    };

    const pct = (used, max) => Math.min(100, Math.round((used / max) * 100)) || 0;

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-4xl mx-auto pb-20">
            <div className="mb-8">
                <h1 className="text-3xl font-black text-slate-900">White-Label Settings</h1>
                <p className="text-slate-500 mt-1">Customize branding that all your sub-clients will see in their CRM.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Branding Panel */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-5">
                    <h2 className="font-bold text-slate-800 text-lg">Brand Identity</h2>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Brand Name</label>
                        <input
                            value={settings.brandName}
                            onChange={e => setSettings({...settings, brandName: e.target.value})}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                            placeholder="Your Agency Name"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Logo URL</label>
                        <input
                            value={settings.logoUrl}
                            onChange={e => setSettings({...settings, logoUrl: e.target.value})}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium"
                            placeholder="https://..." 
                        />
                        {settings.logoUrl && (
                            <img src={settings.logoUrl} alt="Logo preview" className="mt-3 h-12 object-contain rounded-lg border border-slate-200 p-1" />
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Primary Color</label>
                            <div className="flex items-center gap-3">
                                <input type="color" value={settings.primaryColor} onChange={e => setSettings({...settings, primaryColor: e.target.value})} className="w-12 h-10 rounded-lg cursor-pointer border border-slate-200" />
                                <span className="font-mono text-sm text-slate-600">{settings.primaryColor}</span>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Secondary Color</label>
                            <div className="flex items-center gap-3">
                                <input type="color" value={settings.secondaryColor} onChange={e => setSettings({...settings, secondaryColor: e.target.value})} className="w-12 h-10 rounded-lg cursor-pointer border border-slate-200" />
                                <span className="font-mono text-sm text-slate-600">{settings.secondaryColor}</span>
                            </div>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">Custom Domain</label>
                        <input
                            value={settings.customDomain}
                            onChange={e => setSettings({...settings, customDomain: e.target.value})}
                            className="w-full border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-medium font-mono text-sm"
                            placeholder="app.your-agency.com"
                        />
                    </div>

                    <button onClick={handleSave} disabled={saving} className="w-full py-3 bg-black text-white font-bold rounded-xl hover:bg-slate-800 transition-all active:scale-95 disabled:opacity-70 flex items-center justify-center gap-2">
                        {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</> : saved ? <><i className="fa-solid fa-check text-green-400"></i> Saved!</> : 'Save Branding'}
                    </button>
                </div>

                {/* Usage Panel */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
                    <h2 className="font-bold text-slate-800 text-lg">Current Period Usage</h2>

                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-semibold text-slate-700"><i className="fa-brands fa-whatsapp text-green-500 mr-2"></i>WhatsApp Messages</span>
                            <span className="text-xs font-bold text-slate-500">{usage.whatsappSent || 0} / {limits.whatsappMessagesPerMonth}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5">
                            <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct(usage.whatsappSent, limits.whatsappMessagesPerMonth)}%`, background: 'linear-gradient(90deg, #22c55e, #16a34a)' }}></div>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 text-right">{pct(usage.whatsappSent, limits.whatsappMessagesPerMonth)}% used</p>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-semibold text-slate-700"><i className="fa-solid fa-envelope text-blue-500 mr-2"></i>Emails Sent</span>
                            <span className="text-xs font-bold text-slate-500">{usage.emailsSent || 0} / {limits.emailsPerMonth}</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5">
                            <div className="h-2.5 rounded-full transition-all" style={{ width: `${pct(usage.emailsSent, limits.emailsPerMonth)}%`, background: 'linear-gradient(90deg, #3b82f6, #2563eb)' }}></div>
                        </div>
                        <p className="text-xs text-slate-400 mt-1 text-right">{pct(usage.emailsSent, limits.emailsPerMonth)}% used</p>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
                        <i className="fa-solid fa-circle-info text-indigo-500 mr-2"></i>
                        Usage resets every 30 days from the date your plan was activated.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AgencyWhiteLabel;
