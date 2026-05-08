/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Load Facebook JS SDK once
const loadFbSdk = (appId) => {
    return new Promise((resolve) => {
        if (window.FB) { resolve(window.FB); return; }
        window.fbAsyncInit = () => {
            window.FB.init({ appId, cookie: true, xfbml: false, version: 'v21.0' });
            resolve(window.FB);
        };
        if (!document.getElementById('facebook-jssdk')) {
            const s = document.createElement('script');
            s.id  = 'facebook-jssdk';
            s.src = 'https://connect.facebook.net/en_US/sdk.js';
            s.async = true;
            s.defer = true;
            document.body.appendChild(s);
        }
    });
};

const WhatsAppSettings = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [activeTab, setActiveTab] = useState('connection');

    // Connection state
    const [config, setConfig] = useState({
        waBusinessId: '', wabaId: '', waPhoneNumberId: '',
        displayPhone: '', verifiedName: '', waAccessToken: '',
        isConfigured: false, embeddedSignupConnected: false,
        tokenExpiresAt: null, tokenRefreshedAt: null
    });

    // Automations state
    const [settings, setSettings] = useState({
        businessHours: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            monday:    { isOpen: true,  start: '09:00', end: '18:00' },
            tuesday:   { isOpen: true,  start: '09:00', end: '18:00' },
            wednesday: { isOpen: true,  start: '09:00', end: '18:00' },
            thursday:  { isOpen: true,  start: '09:00', end: '18:00' },
            friday:    { isOpen: true,  start: '09:00', end: '18:00' },
            saturday:  { isOpen: false, start: '09:00', end: '13:00' },
            sunday:    { isOpen: false, start: '09:00', end: '13:00' }
        },
        autoReply: {
            outOfOfficeEnabled: false,
            outOfOfficeMessage: 'Thanks for reaching out! We are currently closed and will get back to you during business hours.',
            welcomeEnabled: false,
            welcomeMessage: 'Hi there! How can we help you today?'
        }
    });

    const [loading, setLoading]       = useState(true);
    const [saving, setSaving]         = useState(false);
    const [testing, setTesting]       = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [showToken, setShowToken]   = useState(false);
    const [showManual, setShowManual] = useState(false);

    // Public Meta config (appId + waConfigId)
    const [metaAppId, setMetaAppId]     = useState('');
    const [waConfigId, setWaConfigId]   = useState('');
    const fbReady = useRef(false);

    useEffect(() => { fetchData(); }, []);

    // Load FB SDK once we have the appId
    useEffect(() => {
        if (!metaAppId || fbReady.current) return;
        loadFbSdk(metaAppId).then(() => { fbReady.current = true; });
    }, [metaAppId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [cfgRes, settingsRes, pubRes] = await Promise.all([
                api.get('/whatsapp/config'),
                api.get('/whatsapp/settings').catch(() => ({ data: { settings: null } })),
                api.get('/whatsapp/public-config').catch(() => ({ data: {} }))
            ]);

            setConfig(prev => ({
                ...prev,
                waBusinessId:            cfgRes.data.waBusinessId || '',
                wabaId:                  cfgRes.data.wabaId || '',
                waPhoneNumberId:         cfgRes.data.waPhoneNumberId || '',
                displayPhone:            cfgRes.data.displayPhone || '',
                verifiedName:            cfgRes.data.verifiedName || '',
                embeddedSignupConnected: cfgRes.data.embeddedSignupConnected || false,
                isConfigured:            cfgRes.data.isConfigured || false,
                tokenExpiresAt:          cfgRes.data.tokenExpiresAt || null,
                tokenRefreshedAt:        cfgRes.data.tokenRefreshedAt || null
            }));

            if (settingsRes?.data?.settings) {
                setSettings(prev => ({
                    businessHours: { ...prev.businessHours, ...(settingsRes.data.settings.businessHours || {}) },
                    autoReply:     { ...prev.autoReply,     ...(settingsRes.data.settings.autoReply     || {}) }
                }));
            }

            if (pubRes?.data?.appId) setMetaAppId(pubRes.data.appId);
            if (pubRes?.data?.waConfigId) setWaConfigId(pubRes.data.waConfigId);
        } catch (error) {
            showError('Failed to load settings');
        } finally {
            setLoading(false);
        }
    };

    // ── Embedded Signup ────────────────────────────────────────────────────────
    const handleEmbeddedSignup = async () => {
        if (!metaAppId) { showError('Meta App ID not configured on the server'); return; }

        try {
            if (!window.FB) {
                await loadFbSdk(metaAppId);
                fbReady.current = true;
            }
            if (!window.FB) {
                showError('Facebook SDK failed to load. Disable any ad-blockers and try again.');
                return;
            }
        } catch {
            showError('Facebook SDK failed to load. Disable any ad-blockers and try again.');
            return;
        }

        setConnecting(true);

        const loginOptions = {
            response_type: 'code',
            override_default_response_type: true,
            extras: { setup: {}, sessionInfoVersion: 2 }
        };

        if (waConfigId) {
            loginOptions.config_id = waConfigId;
        } else {
            loginOptions.scope = 'whatsapp_business_management,whatsapp_business_messaging,business_management';
        }

        try {
            window.FB.login(async (response) => {
                if (!response?.authResponse?.code) {
                    setConnecting(false);
                    if (response?.status !== 'unknown') showError('Facebook login was cancelled or failed');
                    return;
                }

                try {
                    const res = await api.post('/whatsapp/connect-embedded', { code: response.authResponse.code });
                    if (res.data.success) {
                        showSuccess(`WhatsApp connected! Phone: ${res.data.displayPhone}`);
                        await fetchData();
                    }
                } catch (err) {
                    showError(err.response?.data?.message || 'Failed to connect WhatsApp');
                } finally {
                    setConnecting(false);
                }
            }, loginOptions);
        } catch {
            showError('Failed to open Facebook login. Please try again.');
            setConnecting(false);
        }
    };

    const handleDisconnect = async () => {
        const ok = await showDanger('Your settings and automations will be preserved, but the WhatsApp connection will be removed.', 'Disconnect WhatsApp');
        if (!ok) return;
        try {
            await api.post('/whatsapp/disconnect');
            showSuccess('WhatsApp disconnected');
            await fetchData();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to disconnect');
        }
    };

    const handleRefreshToken = async () => {
        setRefreshing(true);
        try {
            const res = await api.post('/whatsapp/token/refresh');
            if (res.data.success) {
                showSuccess('Token refreshed — valid for another 60 days');
                setConfig(prev => ({ ...prev, tokenExpiresAt: res.data.tokenExpiresAt, tokenRefreshedAt: new Date().toISOString() }));
            }
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to refresh token');
        } finally {
            setRefreshing(false);
        }
    };

    // ── Manual config handlers ─────────────────────────────────────────────────
    const handleConfigChange = (e) => {
        const { name, value } = e.target;
        setConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        if (!config.waPhoneNumberId.trim()) { showError('Phone Number ID is required'); return; }
        if (!config.waAccessToken.trim())   { showError('Access Token is required');    return; }
        setSaving(true);
        try {
            const res = await api.put('/whatsapp/config', {
                waBusinessId:   config.waBusinessId.trim(),
                waPhoneNumberId: config.waPhoneNumberId.trim(),
                waAccessToken:  config.waAccessToken.trim()
            });
            if (res.data.success) {
                showSuccess('API credentials saved!');
                setConfig(prev => ({ ...prev, waAccessToken: '', isConfigured: true }));
            }
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    const handleTest = async () => {
        if (!config.isConfigured && (!config.waPhoneNumberId || !config.waAccessToken)) {
            showError('Please save your configuration first');
            return;
        }
        setTesting(true);
        try {
            const payload = {};
            if (config.waPhoneNumberId && config.waAccessToken) {
                payload.waPhoneNumberId = config.waPhoneNumberId;
                payload.waAccessToken   = config.waAccessToken;
            }
            const res = await api.post('/whatsapp/config/test', payload);
            if (res.data.success) showSuccess(res.data.message || 'Connection is valid!');
        } catch (error) {
            showError(error.response?.data?.message || 'Connection test failed');
        } finally {
            setTesting(false);
        }
    };

    // ── Automation handlers ────────────────────────────────────────────────────
    const handleBusinessHourChange = (day, field, value) => {
        setSettings(prev => ({
            ...prev,
            businessHours: { ...prev.businessHours, [day]: { ...prev.businessHours[day], [field]: value } }
        }));
    };

    const handleAutoReplyChange = (field, value) => {
        setSettings(prev => ({ ...prev, autoReply: { ...prev.autoReply, [field]: value } }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await api.put('/whatsapp/settings', { businessHours: settings.businessHours, autoReply: settings.autoReply });
            if (res.data.success) showSuccess('Automations saved!');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to save automations');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full">
                <div className="w-10 h-10 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">WhatsApp Settings</h2>

            {/* Tabs */}
            <div className="flex border-b border-slate-200 mb-6">
                {[
                    { id: 'connection',  icon: 'fa-plug',   label: 'Connection' },
                    { id: 'automations', icon: 'fa-robot',  label: 'Automations & OOO' }
                ].map(t => (
                    <button
                        key={t.id}
                        onClick={() => setActiveTab(t.id)}
                        className={`px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${activeTab === t.id ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        <i className={`fa-solid ${t.icon} mr-2`}></i>{t.label}
                    </button>
                ))}
            </div>

            {/* ── CONNECTION TAB ─────────────────────────────────────────────── */}
            {activeTab === 'connection' && (
                <div className="space-y-5">

                    {/* Connected banner */}
                    {config.isConfigured && (() => {
                        const daysLeft = config.tokenExpiresAt
                            ? Math.ceil((new Date(config.tokenExpiresAt) - Date.now()) / 86400000)
                            : null;
                        const isExpired        = daysLeft !== null && daysLeft <= 0;
                        const showTokenHealth  = config.embeddedSignupConnected && daysLeft !== null;
                        const badge = showTokenHealth
                            ? daysLeft > 15
                                ? { color: 'emerald', icon: 'fa-shield-check',        label: `Token valid · ${daysLeft}d left` }
                                : daysLeft >= 5
                                    ? { color: 'amber', icon: 'fa-triangle-exclamation', label: `Expires in ${daysLeft}d — refresh soon` }
                                    : { color: 'red',   icon: 'fa-circle-xmark',         label: isExpired ? 'Token expired' : `Expires in ${daysLeft}d` }
                            : null;
                        return (
                            <>
                                {/* Expired token — prominent action alert */}
                                {isExpired && (
                                    <div className="bg-red-50 border border-red-300 rounded-xl p-4 flex items-start gap-3">
                                        <div className="w-9 h-9 bg-red-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                            <i className="fa-solid fa-circle-exclamation text-red-600 text-lg"></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-bold text-red-800 text-sm">WhatsApp token has expired</p>
                                            <p className="text-xs text-red-600 mt-0.5">
                                                Sending and receiving messages is paused. Click <strong>Continue with Facebook</strong> below to reconnect — your contacts and settings will not be lost.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
                                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                                        <i className="fa-brands fa-whatsapp text-emerald-600 text-xl"></i>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="font-bold text-emerald-800 text-sm">WhatsApp Connected</p>
                                        {config.displayPhone ? (
                                            <p className="text-xs text-emerald-600 mt-0.5">
                                                {config.verifiedName && <span className="font-semibold">{config.verifiedName} · </span>}
                                                {config.displayPhone}
                                                {config.embeddedSignupConnected && <span className="ml-2 bg-emerald-200 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5 rounded-full">via Facebook</span>}
                                            </p>
                                        ) : (
                                            <p className="text-xs text-emerald-600 mt-0.5">Phone ID: {config.waPhoneNumberId}</p>
                                        )}
                                        {badge && (
                                            <p className={`text-[11px] font-semibold mt-1 text-${badge.color}-600`}>
                                                <i className={`fa-solid ${badge.icon} mr-1`}></i>{badge.label}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        {showTokenHealth && !isExpired && daysLeft <= 15 && (
                                            <button
                                                onClick={handleRefreshToken}
                                                disabled={refreshing}
                                                className="text-xs font-semibold px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
                                            >
                                                <i className={`fa-solid ${refreshing ? 'fa-spinner fa-spin' : 'fa-rotate'}`}></i>
                                                {refreshing ? 'Refreshing…' : 'Refresh Now'}
                                            </button>
                                        )}
                                        <button
                                            onClick={handleDisconnect}
                                            className="text-xs text-red-500 hover:text-red-700 font-semibold px-3 py-1.5 hover:bg-red-50 rounded-lg transition"
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                </div>
                            </>
                        );
                    })()}

                    {/* ── Embedded Signup Card ─────────────────────────────── */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center gap-3 mb-4 pb-4 border-b border-slate-100">
                            <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                                <i className="fa-brands fa-facebook text-blue-600 text-xl"></i>
                            </div>
                            <div>
                                <h3 className="text-base font-bold text-slate-800">Connect via Facebook <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full ml-1">Recommended</span></h3>
                                <p className="text-xs text-slate-500">One-click setup — no credentials to copy-paste</p>
                            </div>
                        </div>

                        {/* What clients need */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                            {[
                                { icon: 'fa-building', label: 'Meta Business Manager', sub: 'Will be created if you don\'t have one' },
                                { icon: 'fa-whatsapp fa-brands', label: 'WhatsApp Business Account', sub: 'Created during signup' },
                                { icon: 'fa-phone', label: 'Business Phone Number', sub: 'Not already on WhatsApp' }
                            ].map((item, i) => (
                                <div key={i} className="flex items-start gap-2.5 bg-slate-50 rounded-lg p-3">
                                    <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shrink-0 shadow-sm border border-slate-100">
                                        <i className={`fa-solid ${item.icon} text-[#00a884] text-xs`}></i>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-700">{item.label}</p>
                                        <p className="text-[10px] text-slate-400 mt-0.5">{item.sub}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Permissions note */}
                        <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 mb-5 flex items-start gap-2">
                            <i className="fa-solid fa-shield-halved text-amber-500 text-sm mt-0.5 shrink-0"></i>
                            <p className="text-xs text-amber-700">
                                Your app will request <strong>whatsapp_business_management</strong> and <strong>whatsapp_business_messaging</strong> permissions — required for sending/receiving messages and running chatbots. You grant these during the Facebook popup.
                            </p>
                        </div>

                        <button
                            onClick={handleEmbeddedSignup}
                            disabled={connecting}
                            className="w-full py-3 bg-[#1877F2] hover:bg-[#166FE5] text-white rounded-xl font-bold text-sm transition shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
                        >
                            {connecting ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i> Connecting…</>
                            ) : (
                                <><i className="fa-brands fa-facebook text-lg"></i> Continue with Facebook</>
                            )}
                        </button>

                        {!metaAppId && (
                            <p className="text-center text-xs text-red-500 mt-2 font-medium">
                                <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                                META_APP_ID not configured on server — add it to Render environment variables.
                            </p>
                        )}
                        {metaAppId && !waConfigId && (
                            <p className="text-center text-xs text-amber-600 mt-2">
                                <i className="fa-solid fa-info-circle mr-1"></i>
                                WA_EMBEDDED_CONFIG_ID not set — will use manual permission scopes. Add your Embedded Signup Config ID for best results.
                            </p>
                        )}
                    </div>

                    {/* ── Manual / Advanced credentials ───────────────────── */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                        <button
                            onClick={() => setShowManual(v => !v)}
                            className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition"
                        >
                            <div className="flex items-center gap-3">
                                <i className="fa-solid fa-terminal text-slate-400"></i>
                                <div>
                                    <p className="text-sm font-bold text-slate-700">Manual API Credentials</p>
                                    <p className="text-xs text-slate-400">For advanced users with a System User token</p>
                                </div>
                            </div>
                            <i className={`fa-solid fa-chevron-${showManual ? 'up' : 'down'} text-slate-400 text-xs`}></i>
                        </button>

                        {showManual && (
                            <div className="px-6 pb-6 border-t border-slate-100 pt-4">
                                <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 mb-5">
                                    <p className="text-xs font-bold text-blue-800 mb-2 flex items-center gap-1.5">
                                        <i className="fa-solid fa-circle-info"></i> Where to find these
                                    </p>
                                    <ol className="space-y-1.5 text-xs text-blue-700">
                                        <li><span className="font-bold">1.</span> business.facebook.com → Business Settings → WhatsApp Accounts → your account → copy <strong>Account ID</strong></li>
                                        <li><span className="font-bold">2.</span> WhatsApp Accounts → Phone Numbers → click your number → copy <strong>Phone Number ID</strong></li>
                                        <li><span className="font-bold">3.</span> Business Settings → Users → System Users → Generate Token → enable <strong>whatsapp_business_messaging</strong> → copy token</li>
                                    </ol>
                                </div>

                                <form onSubmit={handleSaveConfig} className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Business Account ID <span className="text-slate-400 font-normal">(Optional)</span></label>
                                        <input type="text" name="waBusinessId" value={config.waBusinessId} onChange={handleConfigChange}
                                            placeholder="123456789012345"
                                            className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none font-mono text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Phone Number ID <span className="text-red-500">*</span></label>
                                        <input type="text" name="waPhoneNumberId" value={config.waPhoneNumberId} onChange={handleConfigChange}
                                            placeholder="123456789012345" required
                                            className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none font-mono text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1">Access Token <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <input type={showToken ? 'text' : 'password'} name="waAccessToken" value={config.waAccessToken} onChange={handleConfigChange}
                                                placeholder={config.isConfigured ? 'Enter new token to update' : 'Paste your system user token'}
                                                required={!config.isConfigured}
                                                className="w-full p-2.5 pr-12 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none font-mono text-sm" />
                                            <button type="button" onClick={() => setShowToken(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                                <i className={`fa-solid ${showToken ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex gap-3 pt-2">
                                        <button type="button" onClick={handleTest} disabled={testing || (!config.isConfigured && (!config.waPhoneNumberId || !config.waAccessToken))}
                                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-sm transition disabled:opacity-50">
                                            <i className={`fa-solid ${testing ? 'fa-spinner fa-spin' : 'fa-vial'} mr-1.5`}></i>Test
                                        </button>
                                        <button type="submit" disabled={saving}
                                            className="flex-1 px-4 py-2 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-lg font-semibold text-sm transition shadow-sm disabled:opacity-50">
                                            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-1.5`}></i>Save Credentials
                                        </button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ── AUTOMATIONS TAB ────────────────────────────────────────────── */}
            {activeTab === 'automations' && (
                <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl pb-10">

                    {/* Auto-Replies */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center gap-2 mb-5">
                            <i className="fa-solid fa-reply-all text-[#00a884] text-lg"></i>
                            <h3 className="text-base font-bold text-slate-800">Auto-Replies</h3>
                        </div>
                        <div className="space-y-4">
                            {[
                                { key: 'welcomeEnabled', msgKey: 'welcomeMessage', label: 'Welcome Message', sub: 'Sent when a new contact messages you for the first time.', placeholder: 'Hi! Welcome. How can we help you?' },
                                { key: 'outOfOfficeEnabled', msgKey: 'outOfOfficeMessage', label: 'Out-of-Office Message', sub: 'Sent when a message arrives outside business hours.', placeholder: 'Thanks for reaching out! We\'ll reply during business hours.' }
                            ].map(({ key, msgKey, label, sub, placeholder }) => (
                                <div key={key} className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                                    <div className="flex items-center justify-between mb-2">
                                        <div>
                                            <h4 className="font-bold text-slate-800 text-sm">{label}</h4>
                                            <p className="text-[11px] text-slate-500">{sub}</p>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" className="sr-only peer" checked={settings.autoReply[key]} onChange={e => handleAutoReplyChange(key, e.target.checked)} />
                                            <div className="w-11 h-6 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00a884]"></div>
                                        </label>
                                    </div>
                                    {settings.autoReply[key] && (
                                        <textarea value={settings.autoReply[msgKey]} onChange={e => handleAutoReplyChange(msgKey, e.target.value)}
                                            className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm resize-none mt-2" rows="3"
                                            placeholder={placeholder} />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Business Hours */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2">
                                <i className="fa-solid fa-clock text-[#00a884] text-lg"></i>
                                <h3 className="text-base font-bold text-slate-800">Business Hours</h3>
                            </div>
                            <select
                                value={settings.businessHours.timezone}
                                onChange={e => setSettings(prev => ({ ...prev, businessHours: { ...prev.businessHours, timezone: e.target.value } }))}
                                className="p-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 font-medium outline-none cursor-pointer"
                            >
                                <option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>Local ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                                <option value="Asia/Dubai">Asia/Dubai (GST +4)</option>
                                <option value="Asia/Riyadh">Asia/Riyadh (AST +3)</option>
                                <option value="Asia/Kolkata">Asia/Kolkata (IST +5:30)</option>
                                <option value="UTC">UTC</option>
                                <option value="America/New_York">America/New_York (EST -5)</option>
                                <option value="America/Los_Angeles">America/Los_Angeles (PST -8)</option>
                                <option value="Europe/London">Europe/London (GMT)</option>
                                <option value="Europe/Paris">Europe/Paris (CET +1)</option>
                                <option value="Australia/Sydney">Australia/Sydney (AEST +11)</option>
                                <option value="Asia/Singapore">Asia/Singapore (SGT +8)</option>
                            </select>
                        </div>

                        <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                            {DAYS.map(day => {
                                const d = settings.businessHours[day];
                                return (
                                    <div key={day} className={`flex items-center justify-between p-3.5 ${!d.isOpen ? 'bg-slate-50' : 'bg-white'}`}>
                                        <div className="flex items-center gap-3 w-1/3">
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" className="sr-only peer" checked={d.isOpen} onChange={e => handleBusinessHourChange(day, 'isOpen', e.target.checked)} />
                                                <div className="w-9 h-5 bg-slate-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00a884]"></div>
                                            </label>
                                            <span className={`text-sm font-semibold capitalize ${d.isOpen ? 'text-slate-800' : 'text-slate-400'}`}>{day}</span>
                                        </div>
                                        {d.isOpen ? (
                                            <div className="flex items-center gap-3 w-2/3 justify-end">
                                                <input type="time" value={d.start} onChange={e => handleBusinessHourChange(day, 'start', e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white shadow-sm outline-none focus:border-[#00a884]" required />
                                                <span className="text-slate-400 text-xs font-bold">TO</span>
                                                <input type="time" value={d.end} onChange={e => handleBusinessHourChange(day, 'end', e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white shadow-sm outline-none focus:border-[#00a884]" required />
                                            </div>
                                        ) : (
                                            <div className="w-2/3 flex justify-end">
                                                <span className="text-sm font-semibold text-slate-400 bg-slate-100 px-3 py-1 rounded-lg">Closed</span>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <button type="submit" disabled={saving} className="px-6 py-3 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl font-bold text-sm transition shadow-md disabled:opacity-50 flex items-center gap-2">
                            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`}></i> Save Automations
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default WhatsAppSettings;
