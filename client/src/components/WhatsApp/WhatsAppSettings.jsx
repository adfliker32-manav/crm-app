/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const WhatsAppSettings = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [activeTab, setActiveTab] = useState('connection');

    // Connection state
    const [config, setConfig] = useState({
        wabaId: '', waPhoneNumberId: '',
        displayPhone: '', verifiedName: '', isConfigured: false,
        metaAppId: '', waEmbeddedConfigId: '', embeddedSignupConnected: false
    });

    const [embeddedData, setEmbeddedData] = useState({
        wabaId: '', phoneNumberId: '', code: '',
        receivedMessage: false, receivedCode: false
    });
    const [setupMode, setSetupMode] = useState('meta');

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

    const [loading, setLoading]           = useState(true);
    const [saving, setSaving]             = useState(false);
    const [connecting, setConnecting]     = useState(false);
    const [testing, setTesting]           = useState(false);
    const [testResult, setTestResult]     = useState(null);
    const [connectionError, setConnectionError] = useState('');
    // Credential form state
    const [form, setForm] = useState({
        wabaId: '', phoneNumberId: '', accessToken: ''
    });

    useEffect(() => { fetchData(); }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [cfgRes, settingsRes] = await Promise.all([
                api.get('/whatsapp/config'),
                api.get('/whatsapp/settings').catch(() => ({ data: { settings: null } }))
            ]);

            setConfig({
                wabaId:          cfgRes.data.wabaId || '',
                waPhoneNumberId: cfgRes.data.waPhoneNumberId || '',
                displayPhone:    cfgRes.data.displayPhone || '',
                verifiedName:    cfgRes.data.verifiedName || '',
                isConfigured:    cfgRes.data.isConfigured || false,
                metaAppId:       cfgRes.data.metaAppId || '',
                waEmbeddedConfigId: cfgRes.data.waEmbeddedConfigId || '',
                embeddedSignupConnected: cfgRes.data.embeddedSignupConnected || false
            });

            if (settingsRes?.data?.settings) {
                setSettings(prev => ({
                    businessHours: { ...prev.businessHours, ...(settingsRes.data.settings.businessHours || {}) },
                    autoReply:     { ...prev.autoReply,     ...(settingsRes.data.settings.autoReply     || {}) }
                }));
            }
        } catch (error) {
            showError('Failed to load settings');
        } finally {
            setLoading(false);
        }
    };

    // Dynamic Facebook SDK Setup
    useEffect(() => {
        if (!config.metaAppId) return;

        const id = 'facebook-jssdk';
        if (document.getElementById(id)) {
            if (window.FB) {
                window.FB.init({
                    appId: config.metaAppId,
                    cookie: true,
                    xfbml: true,
                    version: 'v25.0'
                });
            }
            return;
        }

        window.fbAsyncInit = function() {
            window.FB.init({
                appId: config.metaAppId,
                cookie: true,
                xfbml: true,
                version: 'v25.0'
            });
        };

        const fjs = document.getElementsByTagName('script')[0];
        const js = document.createElement('script');
        js.id = id;
        js.src = "https://connect.facebook.net/en_US/sdk.js";
        if (fjs && fjs.parentNode) {
            fjs.parentNode.insertBefore(js, fjs);
        } else {
            document.head.appendChild(js);
        }
    }, [config.metaAppId]);

    // Message Listener for FB/Meta popup events
    useEffect(() => {
        const handleFBMessage = (event) => {
            const isFacebookOrigin = /^https:\/\/(?:[a-zA-Z0-9-]+\.)*facebook\.(?:com|net)$/.test(event.origin);
            if (!isFacebookOrigin) {
                return;
            }

            console.log('📬 Received postMessage from Facebook origin:', event.origin, event.data);

            try {
                let parsedData;
                if (typeof event.data === 'string') {
                    parsedData = JSON.parse(event.data);
                } else {
                    parsedData = event.data;
                }

                if (parsedData.type === 'WA_EMBEDDED_SIGNUP') {
                    if (parsedData.event === 'FINISH' || parsedData.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
                        const { waba_id, phone_number_id } = parsedData.data || {};
                        if (waba_id && phone_number_id) {
                            console.log('✅ Received WA_EMBEDDED_SIGNUP finish event:', parsedData);
                            setEmbeddedData(prev => ({
                                ...prev,
                                wabaId: waba_id,
                                phoneNumberId: phone_number_id,
                                receivedMessage: true
                            }));
                        }
                    } else if (parsedData.event === 'CANCEL') {
                        showError('WhatsApp Signup cancelled by user.');
                        setConnecting(false);
                    }
                }
            } catch (err) {
                // Non-JSON or unrelated messages
            }
        };

        window.addEventListener('message', handleFBMessage);
        return () => {
            window.removeEventListener('message', handleFBMessage);
        };
    }, []);

    // Combine code and message payloads
    useEffect(() => {
        if (embeddedData.receivedMessage && embeddedData.receivedCode) {
            console.log('🔄 Triggering connection backend call with:', {
                wabaId: embeddedData.wabaId,
                phoneNumberId: embeddedData.phoneNumberId,
                code: '***'
            });
            handleConnectEmbedded(embeddedData.wabaId, embeddedData.phoneNumberId, embeddedData.code);
        }
    }, [embeddedData.receivedMessage, embeddedData.receivedCode]);

    const handleConnectEmbedded = async (wabaId, phoneNumberId, code) => {
        setConnecting(true);
        setConnectionError('');
        try {
            const res = await api.post('/whatsapp/connect-embedded', { wabaId, phoneNumberId, code });
            if (res.data.success) {
                showSuccess(`WhatsApp connected via Meta! Phone: ${res.data.displayPhone}`);
                setTestResult(null);
                await fetchData();
                if (!res.data.webhookSubscribed) {
                    setTestResult({
                        success: false,
                        message: 'Connected, but WABA webhook subscription failed',
                        results: {
                            credentials: { ok: true, displayPhone: res.data.displayPhone, verifiedName: res.data.verifiedName },
                            webhookSubscription: {
                                ok: false,
                                error: res.data.webhookSubscriptionError || 'Subscription failed. Callback URL might need setup in Meta Dashboard.'
                            }
                        }
                    });
                }
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Failed to complete WhatsApp onboarding';
            showError(msg);
            setConnectionError(msg);
        } finally {
            setConnecting(false);
            setEmbeddedData({ wabaId: '', phoneNumberId: '', code: '', receivedMessage: false, receivedCode: false });
        }
    };

    const launchEmbeddedSignup = () => {
        if (!window.FB) {
            showError('Facebook SDK not loaded yet. Please wait a moment or refresh.');
            return;
        }
        if (!config.waEmbeddedConfigId) {
            showError('WhatsApp Embedded Configuration ID (WA_EMBEDDED_CONFIG_ID) is missing.');
            return;
        }

        setConnecting(true);
        setConnectionError('');
        setEmbeddedData({ wabaId: '', phoneNumberId: '', code: '', receivedMessage: false, receivedCode: false });

        window.FB.login(
            (response) => {
                console.log('🔑 FB.login response received:', response);
                if (response.authResponse && response.authResponse.code) {
                    const authCode = response.authResponse.code;
                    console.log('✅ Received FB.login code:', authCode);
                    setEmbeddedData(prev => ({
                        ...prev,
                        code: authCode,
                        receivedCode: true
                    }));
                } else {
                    console.warn('⚠️ FB.login failed or was cancelled. response.authResponse:', response.authResponse);
                    showError('Failed to get authorization code from Meta.');
                    setConnecting(false);
                }
            },
            {
                config_id: config.waEmbeddedConfigId,
                response_type: 'code',
                override_default_response_type: true,
                extras: {
                    setup: {},
                    version: 'v4',
                    featureType: 'whatsapp_business_app_onboarding',
                    sessionInfoVersion: '3',
                    coex: true
                }
            }
        );
    };

    const handleConnect = async (e) => {
        e.preventDefault();
        setConnectionError('');
        const { wabaId, phoneNumberId, accessToken } = form;
        if (!wabaId || !phoneNumberId || !accessToken) {
            setConnectionError('All three fields are required.');
            return;
        }
        const numericOnly = /^\d+$/;
        if (!numericOnly.test(wabaId) || !numericOnly.test(phoneNumberId)) {
            setConnectionError('WABA ID and Phone Number ID must be numeric.');
            return;
        }
        setConnecting(true);
        try {
            const res = await api.post('/whatsapp/connect-manual', { wabaId, phoneNumberId, accessToken });
            if (res.data.success) {
                showSuccess(`WhatsApp connected! Phone: ${res.data.displayPhone}`);
                setForm({ wabaId: '', phoneNumberId: '', accessToken: '' });
                setConnectionError('');
                setTestResult(null);
                await fetchData();
                if (!res.data.webhookSubscribed) {
                    setTestResult({
                        success: false,
                        message: 'Connected, but WABA webhook subscription failed',
                        results: {
                            credentials: { ok: true, displayPhone: res.data.displayPhone, verifiedName: res.data.verifiedName },
                            webhookSubscription: {
                                ok: false,
                                error: res.data.webhookSubscriptionError || 'Subscription failed. In your Meta App Dashboard → WhatsApp → Configuration, ensure your Callback URL is set and subscribe the WABA to your app.'
                            }
                        }
                    });
                }
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Failed to connect WhatsApp';
            showError(msg);
            setConnectionError(msg);
        } finally {
            setConnecting(false);
        }
    };

    const handleTestConnection = async () => {
        setTesting(true);
        setTestResult(null);
        try {
            const res = await api.get('/whatsapp/test-connection');
            setTestResult(res.data);
        } catch (err) {
            setTestResult({
                success: false,
                message: err.response?.data?.message || 'Failed to run connection test',
                results: {}
            });
        } finally {
            setTesting(false);
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
                    { id: 'connection',   icon: 'fa-plug',  label: 'Connection' },
                    { id: 'automations', icon: 'fa-robot', label: 'Automations & OOO' }
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

                    {/* Error banner */}
                    {connectionError && (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                            <div className="w-9 h-9 bg-red-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
                                <i className="fa-solid fa-circle-exclamation text-red-600 text-lg"></i>
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-red-800 text-sm">Connection Failed</p>
                                <p className="text-xs text-red-600 mt-0.5">{connectionError}</p>
                            </div>
                            <button onClick={() => setConnectionError('')} className="text-red-400 hover:text-red-600 text-lg shrink-0">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                    )}

                    {/* Connected banner */}
                    {config.isConfigured && (
                        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
                            <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                                <i className="fa-brands fa-whatsapp text-emerald-600 text-xl"></i>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="font-bold text-emerald-800 text-sm">WhatsApp Connected</p>
                                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded shadow-sm ${config.embeddedSignupConnected ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                                        {config.embeddedSignupConnected ? 'Meta Login' : 'Manual API'}
                                    </span>
                                </div>
                                <p className="text-xs text-emerald-600 mt-0.5">
                                    {config.verifiedName && <span className="font-semibold">{config.verifiedName} · </span>}
                                    {config.displayPhone || `Phone ID: ${config.waPhoneNumberId}`}
                                </p>
                                {config.waAppId && (
                                    <p className="text-[11px] text-emerald-500 mt-0.5">App ID: {config.waAppId}</p>
                                )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <button
                                    onClick={handleTestConnection}
                                    disabled={testing}
                                    className="text-xs font-semibold px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition disabled:opacity-50 flex items-center gap-1.5"
                                >
                                    <i className={`fa-solid ${testing ? 'fa-spinner fa-spin' : 'fa-plug-circle-check'}`}></i>
                                    {testing ? 'Testing…' : 'Test Connection'}
                                </button>
                                <button
                                    onClick={handleDisconnect}
                                    className="text-xs text-red-500 hover:text-red-700 font-semibold px-3 py-1.5 hover:bg-red-50 rounded-lg transition"
                                >
                                    Disconnect
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Test result panel */}
                    {testResult && (
                        <div className={`rounded-xl border p-4 ${testResult.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="flex items-center justify-between mb-3">
                                <p className={`font-bold text-sm flex items-center gap-2 ${testResult.success ? 'text-emerald-800' : 'text-red-800'}`}>
                                    <i className={`fa-solid ${testResult.success ? 'fa-circle-check' : 'fa-circle-xmark'}`}></i>
                                    {testResult.message}
                                </p>
                                <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-600 text-sm">
                                    <i className="fa-solid fa-xmark"></i>
                                </button>
                            </div>
                            <div className="space-y-2">
                                {/* Credentials check */}
                                {testResult.results?.credentials && (
                                    <div className={`flex items-start gap-2 text-xs p-2.5 rounded-lg ${testResult.results.credentials.ok ? 'bg-emerald-100/60' : 'bg-red-100/60'}`}>
                                        <i className={`fa-solid ${testResult.results.credentials.ok ? 'fa-check text-emerald-600' : 'fa-xmark text-red-600'} mt-0.5 shrink-0`}></i>
                                        <div>
                                            <span className="font-semibold">Access Token & Phone Number ID</span>
                                            {testResult.results.credentials.ok ? (
                                                <span className="text-emerald-700 ml-1">
                                                    — {testResult.results.credentials.displayPhone}
                                                    {testResult.results.credentials.qualityRating && <span className="ml-1 opacity-70">· Quality: {testResult.results.credentials.qualityRating}</span>}
                                                    {testResult.results.credentials.status && <span className="ml-1 opacity-70">· {testResult.results.credentials.status}</span>}
                                                </span>
                                            ) : (
                                                <span className="text-red-600 ml-1">— {testResult.results.credentials.error}{testResult.results.credentials.code ? ` (code ${testResult.results.credentials.code})` : ''}</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                                {/* Webhook subscription check */}
                                {testResult.results?.webhookSubscription && (
                                    <div className={`flex items-start gap-2 text-xs p-2.5 rounded-lg ${testResult.results.webhookSubscription.ok ? 'bg-emerald-100/60' : 'bg-amber-100/60'}`}>
                                        <i className={`fa-solid ${testResult.results.webhookSubscription.ok ? 'fa-check text-emerald-600' : 'fa-triangle-exclamation text-amber-600'} mt-0.5 shrink-0`}></i>
                                        <div>
                                            <span className="font-semibold">WABA Webhook Subscription</span>
                                            {testResult.results.webhookSubscription.ok ? (
                                                <span className="text-emerald-700 ml-1">— App subscribed to WABA</span>
                                            ) : (
                                                <span className="text-amber-700 ml-1">— {testResult.results.webhookSubscription.error || 'App not subscribed. Go to Meta App Dashboard → WhatsApp → Configuration and subscribe.'}</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Setup Mode Toggle when not configured */}
                    {!config.isConfigured && (
                        <div className="bg-slate-100 p-1.5 rounded-xl flex max-w-md shadow-inner">
                            <button
                                type="button"
                                onClick={() => setSetupMode('meta')}
                                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${setupMode === 'meta' ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                <i className="fa-brands fa-facebook text-blue-600 text-sm"></i>
                                Meta Login (Recommended)
                            </button>
                            <button
                                type="button"
                                onClick={() => setSetupMode('manual')}
                                className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${setupMode === 'manual' ? 'bg-white text-slate-800 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                <i className="fa-solid fa-gears text-slate-500 text-sm"></i>
                                Manual API Setup
                            </button>
                        </div>
                    )}

                    {/* Meta Login Card option */}
                    {!config.isConfigured && setupMode === 'meta' && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
                            <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                                <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                                    <i className="fa-brands fa-whatsapp text-[#00a884] text-xl"></i>
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-800">Connect with Meta Login</h3>
                                    <p className="text-xs text-slate-500">Quick embedded signup with mobile app coexistence</p>
                                </div>
                            </div>
                            <div className="text-xs text-slate-500 space-y-2">
                                <p className="font-semibold text-slate-700">Benefits of Meta Login Onboarding:</p>
                                <ul className="list-disc pl-5 space-y-1.5">
                                    <li>Keep using your mobile WhatsApp Business App seamlessly.</li>
                                    <li>Automated webhook registration and routing (no manual URLs needed).</li>
                                    <li>Mirrors chat history and broadcasts between API and mobile app.</li>
                                </ul>
                            </div>
                            <button
                                type="button"
                                onClick={launchEmbeddedSignup}
                                disabled={connecting}
                                className="w-full py-3.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl font-bold text-sm transition shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
                            >
                                {connecting ? (
                                    <><i className="fa-solid fa-spinner fa-spin"></i> Connecting via Meta...</>
                                ) : (
                                    <><i className="fa-brands fa-facebook text-lg"></i> Continue with Meta Login</>
                                )}
                            </button>
                        </div>
                    )}

                    {/* Credential Form (Visible if configured or setupMode === 'manual') */}
                    {(config.isConfigured || setupMode === 'manual') && (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
                                <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                                    <i className="fa-brands fa-whatsapp text-[#00a884] text-xl"></i>
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-800">
                                        {config.isConfigured ? 'Update Credentials' : 'Connect WhatsApp Manually'}
                                    </h3>
                                    <p className="text-xs text-slate-500">Enter your WhatsApp Business Account details</p>
                                </div>
                            </div>

                            <form onSubmit={handleConnect} className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-600 mb-1">WABA ID <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            value={form.wabaId}
                                            onChange={e => { setConnectionError(''); setForm(p => ({ ...p, wabaId: e.target.value.trim() })); }}
                                            placeholder="WhatsApp Business Account ID"
                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Phone Number ID <span className="text-red-500">*</span></label>
                                        <input
                                            type="text"
                                            value={form.phoneNumberId}
                                            onChange={e => { setConnectionError(''); setForm(p => ({ ...p, phoneNumberId: e.target.value.trim() })); }}
                                            placeholder="WhatsApp Phone Number ID"
                                            className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none"
                                            required
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Access Token <span className="text-red-500">*</span></label>
                                    <input
                                        type="text"
                                        value={form.accessToken}
                                        onChange={e => { setConnectionError(''); setForm(p => ({ ...p, accessToken: e.target.value.trim() })); }}
                                        placeholder="Permanent System User Access Token"
                                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none font-mono"
                                        required
                                    />
                                    <p className="text-[10px] text-slate-400 mt-1">Use a permanent System User token from your Meta Business Manager to avoid expiry.</p>
                                </div>

                                <button
                                    type="submit"
                                    disabled={connecting}
                                    className="w-full py-3 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl font-bold text-sm transition shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
                                >
                                    {connecting ? (
                                        <><i className="fa-solid fa-spinner fa-spin"></i> Connecting…</>
                                    ) : (
                                        <><i className="fa-brands fa-whatsapp text-lg"></i> {config.isConfigured ? 'Update Connection' : 'Connect WhatsApp'}</>
                                    )}
                                </button>
                            </form>
                        </div>
                    )}

                    {/* Where to find credentials + webhook setup */}
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                        <div>
                            <p className="text-xs font-bold text-slate-600 mb-2"><i className="fa-solid fa-circle-info mr-1.5 text-blue-500"></i>Where to find these values</p>
                            <ul className="text-xs text-slate-500 space-y-1.5">
                                <li><span className="font-semibold text-slate-600">WABA ID & Phone Number ID:</span> Meta Business Manager → WhatsApp → Getting Started, or WhatsApp Manager → Phone Numbers.</li>
                                <li><span className="font-semibold text-slate-600">Access Token:</span> Meta Business Manager → System Users → generate a permanent token with <code className="bg-slate-200 px-1 rounded">whatsapp_business_messaging</code> and <code className="bg-slate-200 px-1 rounded">whatsapp_business_management</code> permissions.</li>
                                <li><span className="font-semibold text-slate-600">App ID & App Secret:</span> developers.facebook.com → Your App → Settings → Basic.</li>
                            </ul>
                        </div>
                        <div className="border-t border-slate-200 pt-3">
                            <p className="text-xs font-bold text-amber-700 mb-1.5"><i className="fa-solid fa-triangle-exclamation mr-1.5"></i>Required: Register your webhook in your Meta App</p>
                            <p className="text-xs text-slate-500 mb-1">In your Meta App Dashboard → WhatsApp → Configuration, add these settings:</p>
                            <ul className="text-xs text-slate-500 space-y-1">
                                <li><span className="font-semibold text-slate-600">Callback URL:</span> <code className="bg-slate-200 px-1 rounded">https://your-server.com/webhook/whatsapp</code></li>
                                <li><span className="font-semibold text-slate-600">Verify Token:</span> The value of <code className="bg-slate-200 px-1 rounded">WA_WEBHOOK_VERIFY_TOKEN</code> from your server environment.</li>
                                <li><span className="font-semibold text-slate-600">Subscribed Fields:</span> <code className="bg-slate-200 px-1 rounded">messages</code></li>
                            </ul>
                        </div>
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
