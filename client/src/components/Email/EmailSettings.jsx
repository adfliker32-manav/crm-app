/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const Field = ({ label, hint, required, children }) => (
    <div className="flex flex-col gap-1.5">
        <label className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
            {label}
            {required && <span className="text-rose-500 text-xs">*</span>}
            {hint && <span className="text-slate-400 text-xs font-normal">({hint})</span>}
        </label>
        {children}
    </div>
);

const inputCls = "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:bg-white transition-all";

const EmailSettings = () => {
    const { showSuccess, showError, showInfo } = useNotification();
    const [config, setConfig] = useState({
        emailServiceType: 'gmail',
        smtpHost: '',
        smtpPort: 587,
        emailUser: '',
        emailPassword: '',
        emailFromName: '',
        emailSignature: '',
        businessAddress: '',
        imapHost: '',
        imapPort: 993,
        imapSecure: null,
        smtpSecure: null,
        authType: 'password',
        imapEnabled: true,
        inboundSupported: true,
        imapLastSyncAt: null,
        imapLastError: null,
        imapLastErrorAt: null,
        isConfigured: false
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showCredentials, setShowCredentials] = useState(false);

    useEffect(() => { fetchConfig(); }, []);

    const fetchConfig = async () => {
        try {
            const res = await api.get('/email/config');
            setConfig(prev => ({
                ...prev,
                emailServiceType: res.data.emailServiceType || 'gmail',
                smtpHost: res.data.smtpHost || '',
                smtpPort: res.data.smtpPort || 587,
                emailUser: res.data.emailUser || '',
                emailPassword: res.data.emailPassword || '',
                emailFromName: res.data.emailFromName || '',
                emailSignature: res.data.emailSignature || '',
                businessAddress: res.data.businessAddress || '',
                imapHost: res.data.imapHost || '',
                imapPort: res.data.imapPort || 993,
                // Tri-state: null means "infer from the port". Coercing to a
                // boolean here would force an override the user never chose.
                imapSecure: typeof res.data.imapSecure === 'boolean' ? res.data.imapSecure : null,
                smtpSecure: typeof res.data.smtpSecure === 'boolean' ? res.data.smtpSecure : null,
                authType: res.data.authType || 'password',
                imapEnabled: res.data.imapEnabled !== false,
                inboundSupported: res.data.inboundSupported !== false,
                imapLastSyncAt: res.data.imapLastSyncAt || null,
                imapLastError: res.data.imapLastError || null,
                imapLastErrorAt: res.data.imapLastErrorAt || null,
                isConfigured: res.data.isConfigured || false
            }));
        } catch (error) {
            showError('Failed to load email configuration');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!config.emailUser.trim()) { showError('Email address is required'); return; }
        if (!config.emailPassword.trim() && !config.isConfigured) { showError('Password is required'); return; }
        setSaving(true);
        try {
            const payload = {
                emailServiceType: config.emailServiceType,
                smtpHost: config.smtpHost,
                smtpPort: parseInt(config.smtpPort, 10) || 587,
                emailUser: config.emailUser.trim(),
                emailFromName: config.emailFromName.trim(),
                emailSignature: config.emailSignature,
                businessAddress: config.businessAddress.trim(),
                imapHost: config.imapHost.trim(),
                imapPort: parseInt(config.imapPort, 10) || 993,
                imapSecure: config.imapSecure,
                smtpSecure: config.smtpSecure,
                imapEnabled: config.imapEnabled
            };
            if (config.emailPassword.trim() && config.emailPassword !== '••••••••') {
                payload.emailPassword = config.emailPassword.trim();
            }
            const res = await api.put('/email/config', payload);
            if (res.data.success) {
                showSuccess('Email configuration saved!');
                setConfig(prev => ({
                    ...prev,
                    emailPassword: '••••••••',
                    isConfigured: true,
                    inboundSupported: res.data.inboundSupported !== false
                }));
                setShowCredentials(false);
            }
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    // ── Google mailbox connection ────────────────────────────────────────
    const [google, setGoogle] = useState({ available: false, connected: false, email: null });
    const [connecting, setConnecting] = useState(false);
    const [testingImap, setTestingImap] = useState(false);

    const loadGoogleStatus = useCallback(async () => {
        try {
            const res = await api.get('/email/oauth/google/status');
            setGoogle({
                available: res.data.available === true,
                connected: res.data.connected === true,
                email: res.data.email || null
            });
        } catch {
            // A server without OAuth configured is a normal state, not an error.
            setGoogle({ available: false, connected: false, email: null });
        }
    }, []);

    useEffect(() => { loadGoogleStatus(); }, [loadGoogleStatus]);

    // The OAuth callback redirects the browser back here with the outcome in the
    // query string — it cannot return JSON to an XHR, because the round trip
    // goes through Google and leaves the SPA entirely.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const outcome = params.get('mailbox');
        if (!outcome) return;

        if (outcome === 'connected') {
            showSuccess(`Mailbox ${params.get('email') || ''} connected`.trim());
            loadGoogleStatus();
            fetchConfig();
        } else if (outcome === 'cancelled') {
            showInfo('Google sign-in was cancelled — nothing was changed.');
        } else if (outcome === 'error') {
            showError(params.get('reason') || 'Could not connect the mailbox.');
        }

        // Strip the params so a refresh does not replay the toast.
        params.delete('mailbox'); params.delete('email'); params.delete('reason');
        const qs = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }, []);

    const handleConnectGoogle = async () => {
        setConnecting(true);
        try {
            const res = await api.get('/email/oauth/google/start', {
                params: config.emailUser ? { email: config.emailUser } : {}
            });
            // Full navigation, not a popup: Google blocks its consent screen in
            // many embedded/popup contexts, and the callback redirects back here
            // anyway.
            window.location.href = res.data.url;
        } catch (error) {
            showError(error.response?.data?.message || 'Could not start Google sign-in');
            setConnecting(false);
        }
    };

    const handleDisconnectGoogle = async () => {
        setConnecting(true);
        try {
            await api.post('/email/oauth/google/disconnect');
            showSuccess('Mailbox disconnected');
            await loadGoogleStatus();
            await fetchConfig();
        } catch (error) {
            showError(error.response?.data?.message || 'Could not disconnect the mailbox');
        } finally {
            setConnecting(false);
        }
    };

    const handleTestImap = async () => {
        setTestingImap(true);
        showInfo('Checking incoming mail connection...');
        try {
            const res = await api.post('/email/config/test-imap');
            showSuccess(res.data.message || 'Incoming mail is working');
            fetchConfig(); // clears a stale error banner
        } catch (error) {
            showError(error.response?.data?.message || 'Could not connect for incoming mail');
        } finally {
            setTestingImap(false);
        }
    };

    const handleTest = async () => {
        if (!config.isConfigured && (!config.emailUser || !config.emailPassword)) {
            showError('Please save your configuration first');
            return;
        }
        setTesting(true);
        showInfo('Sending test email...');
        try {
            const payload = {};
            if (config.emailUser && config.emailPassword && config.emailPassword !== '••••••••') {
                payload.emailUser = config.emailUser;
                payload.emailPassword = config.emailPassword;
            }
            const res = await api.post('/email/config/test', payload);
            if (res.data.success) showSuccess(res.data.message || 'Test email sent!');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to send test email');
        } finally {
            setTesting(false);
        }
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-500 font-medium">Loading configuration...</p>
        </div>
    );

    return (
        <div className="p-6 max-w-2xl mx-auto space-y-5">
            {/* Status banner */}
            {config.isConfigured ? (
                <div className="flex items-center gap-4 bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <i className="fa-solid fa-circle-check text-emerald-600 text-lg"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-emerald-800">Email Connected</p>
                        <p className="text-xs text-emerald-600 truncate">{config.emailUser}</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={testing}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-white hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-xl transition"
                        >
                            {testing ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-paper-plane"></i>}
                            {testing ? 'Testing...' : 'Test'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowCredentials(v => !v)}
                            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-xl transition"
                        >
                            <i className={`fa-solid ${showCredentials ? 'fa-eye-slash' : 'fa-pen'}`}></i>
                            {showCredentials ? 'Hide' : 'Edit'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-4 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <i className="fa-solid fa-triangle-exclamation text-amber-600 text-lg"></i>
                    </div>
                    <div>
                        <p className="text-sm font-bold text-amber-800">Not Configured</p>
                        <p className="text-xs text-amber-600">Fill in the form below to connect your email account.</p>
                    </div>
                </div>
            )}

            {/* The mailbox IS configured for receiving but the last sync failed.
                Without this the only symptom is "no replies ever arrive", which
                is indistinguishable from nobody having written. */}
            {config.isConfigured && config.inboundSupported && config.imapLastError && (
                <div className="flex items-start gap-4 bg-red-50 border border-red-200 rounded-2xl px-5 py-4">
                    <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <i className="fa-solid fa-triangle-exclamation text-red-600 text-lg"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-red-800">Incoming mail is not being received</p>
                        <p className="text-xs text-red-700 mt-0.5 break-words">{config.imapLastError}</p>
                        {config.imapLastErrorAt && (
                            <p className="text-[11px] text-red-500 mt-1">
                                Last failed {new Date(config.imapLastErrorAt).toLocaleString()}
                                {config.imapLastSyncAt && ` · last successful sync ${new Date(config.imapLastSyncAt).toLocaleString()}`}
                            </p>
                        )}
                    </div>
                </div>
            )}

            {/* Send works, receive doesn't — make that explicit rather than
                leaving the user to wonder why no replies ever arrive. */}
            {config.isConfigured && !config.inboundSupported && (
                <div className="flex items-start gap-4 bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
                    <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <i className="fa-solid fa-inbox text-amber-600 text-lg"></i>
                    </div>
                    <div className="flex-1">
                        <p className="text-sm font-bold text-amber-800">Sending only — replies won't reach your Inbox</p>
                        <p className="text-xs text-amber-700 mt-0.5">
                            This account has no IMAP server configured, so incoming email cannot be synced.
                            Add an IMAP host under "Receiving" to enable two-way conversations.
                        </p>
                    </div>
                    {!showCredentials && (
                        <button type="button" onClick={() => setShowCredentials(true)}
                            className="text-xs font-semibold px-3 py-2 bg-white hover:bg-amber-100 text-amber-700 border border-amber-200 rounded-xl transition flex-shrink-0">
                            Configure
                        </button>
                    )}
                </div>
            )}

            {/* ── Connected-with-Google summary ───────────────────────────────
                Shown outside the form: once a mailbox is connected this way
                there is no address or password to type, so the form below is
                about the remaining settings only. */}
            {google.connected && (
                <div className="flex items-start gap-4 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm">
                    <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center flex-shrink-0">
                        <i className="fa-brands fa-google text-emerald-600 text-lg"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800">Connected with Google</p>
                        <p className="text-xs text-slate-500 mt-0.5 break-all">
                            {google.email || config.emailUser} — sending and receiving are authorised by
                            sign-in, so no app password is needed.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleDisconnectGoogle}
                        disabled={connecting}
                        className="text-xs font-semibold px-3 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 rounded-xl transition flex-shrink-0 disabled:opacity-50"
                    >
                        Disconnect
                    </button>
                </div>
            )}

            {/* ── Connect with Google ─────────────────────────────────────────
                The recommended path for Gmail. Google removed password access
                for mail clients in 2022, so the alternative is an App Password,
                which requires 2-Step Verification and is where most setups
                stall. Hidden when the server has no OAuth credentials
                configured, rather than offering a button that cannot work. */}
            {!google.connected && google.available && config.emailServiceType === 'gmail' && (
                <div className="flex items-start gap-4 bg-white border border-slate-200 rounded-2xl px-5 py-4 shadow-sm">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center flex-shrink-0">
                        <i className="fa-brands fa-google text-slate-500 text-lg"></i>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800">Connect with Google</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Sign in once to authorise sending and receiving. No App Password and no
                            2-Step Verification setup required.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleConnectGoogle}
                        disabled={connecting}
                        className="text-xs font-semibold px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition flex-shrink-0 disabled:opacity-50 flex items-center gap-2"
                    >
                        <i className={`fa-solid ${connecting ? 'fa-spinner fa-spin' : 'fa-right-to-bracket'} text-[11px]`}></i>
                        {connecting ? 'Opening…' : 'Connect'}
                    </button>
                </div>
            )}

            {/* Config Form */}
            {(!config.isConfigured || showCredentials) && (
                <form onSubmit={handleSave} className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                    {/* Section: Provider */}
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">1 — Provider</p>
                    </div>
                    <div className="p-6 border-b border-slate-100 space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { value: 'gmail', label: 'Gmail / Google Workspace', icon: 'fa-google', color: 'text-rose-500' },
                                { value: 'smtp', label: 'Custom SMTP Server', icon: 'fa-server', color: 'text-slate-500' }
                            ].map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setConfig(p => ({ ...p, emailServiceType: opt.value }))}
                                    className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${config.emailServiceType === opt.value ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                                >
                                    <i className={`fa-brands ${opt.icon} text-xl ${config.emailServiceType === opt.value ? 'text-blue-500' : opt.color}`}></i>
                                    <span className={`text-sm font-semibold ${config.emailServiceType === opt.value ? 'text-blue-700' : 'text-slate-700'}`}>{opt.label}</span>
                                </button>
                            ))}
                        </div>

                        {config.emailServiceType === 'smtp' && (
                            <div className="grid grid-cols-3 gap-3">
                                <div className="col-span-2">
                                    <Field label="SMTP Host" required>
                                        <input type="text" name="smtpHost" value={config.smtpHost} onChange={handleChange}
                                            placeholder="smtp.yourprovider.com" required className={inputCls} />
                                    </Field>
                                </div>
                                <Field label="Port" required>
                                    <input type="number" name="smtpPort" value={config.smtpPort} onChange={handleChange}
                                        placeholder="587" required className={inputCls} />
                                </Field>
                                <div className="col-span-3">
                                    <Field label="Encryption" hint="leave on Automatic unless your provider says otherwise">
                                        <select
                                            className={inputCls}
                                            value={config.smtpSecure === null ? 'auto' : String(config.smtpSecure)}
                                            onChange={(e) => setConfig(p => ({
                                                ...p,
                                                smtpSecure: e.target.value === 'auto' ? null : e.target.value === 'true'
                                            }))}
                                        >
                                            <option value="auto">Automatic (SSL on 465, STARTTLS otherwise)</option>
                                            <option value="true">SSL/TLS on connect</option>
                                            <option value="false">STARTTLS</option>
                                        </select>
                                    </Field>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Section: Credentials */}
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">2 — Credentials</p>
                    </div>
                    <div className="p-6 border-b border-slate-100 space-y-4">
                        <Field label={config.emailServiceType === 'gmail' ? 'Gmail Address' : 'Email Address'} required>
                            <input type="email" name="emailUser" value={config.emailUser} onChange={handleChange}
                                placeholder={config.emailServiceType === 'gmail' ? 'you@gmail.com' : 'you@yourcompany.com'}
                                required className={inputCls} />
                        </Field>

                        <Field
                            label={config.emailServiceType === 'gmail' ? 'App Password' : 'SMTP Password'}
                            hint={config.isConfigured ? 'leave blank to keep current' : undefined}
                            required={!config.isConfigured}
                        >
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    name="emailPassword"
                                    value={config.emailPassword}
                                    onChange={handleChange}
                                    placeholder={config.isConfigured ? 'Enter new password to update' : 'Enter app password'}
                                    required={!config.isConfigured}
                                    className={`${inputCls} pr-11 font-mono`}
                                />
                                <button type="button" onClick={() => setShowPassword(v => !v)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                                    <i className={`fa-solid text-sm ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                </button>
                            </div>
                            {config.emailServiceType === 'gmail' && (
                                <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                    <i className="fa-solid fa-circle-info"></i>
                                    Use a Gmail App Password — never your regular password
                                </p>
                            )}
                        </Field>
                    </div>

                    {/* Section: Identity */}
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">3 — Sender Identity</p>
                    </div>
                    <div className="p-6 border-b border-slate-100 space-y-4">
                        <Field label="From Name" hint="optional">
                            <input type="text" name="emailFromName" value={config.emailFromName} onChange={handleChange}
                                placeholder="Your Name or Company Name" className={inputCls} />
                        </Field>

                        <Field label="Email Signature" hint="optional, HTML supported">
                            <textarea name="emailSignature" value={config.emailSignature} onChange={handleChange}
                                placeholder={'Best regards,\nYour Name'}
                                className={`${inputCls} min-h-[90px] resize-y`} />
                        </Field>

                        {/* The backend has always appended this to the unsubscribe
                            footer, but there was no field to set it — so every
                            marketing email went out without the postal address
                            CAN-SPAM requires. */}
                        <Field label="Business Postal Address" hint="required by law for marketing email">
                            <textarea name="businessAddress" value={config.businessAddress} onChange={handleChange}
                                placeholder={'123 Business Street, City, State 12345, Country'}
                                className={`${inputCls} min-h-[60px] resize-y`} />
                            <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                                <i className="fa-solid fa-circle-info"></i>
                                Shown in the unsubscribe footer of bulk and automated emails
                            </p>
                        </Field>
                    </div>

                    {/* Section: Receiving */}
                    <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">4 — Receiving (IMAP)</p>
                    </div>
                    <div className="p-6 border-b border-slate-100 space-y-4">
                        <label className="flex items-center gap-3 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={config.imapEnabled}
                                onChange={(e) => setConfig(p => ({ ...p, imapEnabled: e.target.checked }))}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-semibold text-slate-700">Sync incoming replies into the Inbox</span>
                        </label>

                        {config.emailServiceType === 'gmail' ? (
                            <p className="text-xs text-slate-400 flex items-center gap-1.5">
                                <i className="fa-solid fa-circle-check text-emerald-500"></i>
                                Gmail uses imap.gmail.com automatically — no extra setup needed.
                            </p>
                        ) : (
                            <>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="col-span-2">
                                        <Field label="IMAP Host">
                                            <input type="text" name="imapHost" value={config.imapHost} onChange={handleChange}
                                                placeholder="imap.yourprovider.com" className={inputCls} />
                                        </Field>
                                    </div>
                                    <Field label="IMAP Port">
                                        <input type="number" name="imapPort" value={config.imapPort} onChange={handleChange}
                                            placeholder="993" className={inputCls} />
                                    </Field>
                                    <div className="col-span-3">
                                        <Field label="Encryption" hint="leave on Automatic unless your provider says otherwise">
                                            <select
                                                className={inputCls}
                                                value={config.imapSecure === null ? 'auto' : String(config.imapSecure)}
                                                onChange={(e) => setConfig(p => ({
                                                    ...p,
                                                    imapSecure: e.target.value === 'auto' ? null : e.target.value === 'true'
                                                }))}
                                            >
                                                <option value="auto">Automatic (SSL on 993, STARTTLS on 143)</option>
                                                <option value="true">SSL/TLS on connect</option>
                                                <option value="false">STARTTLS</option>
                                            </select>
                                        </Field>
                                    </div>
                                </div>
                                {/* Custom SMTP tenants were silently skipped by the sync
                                    service, so their inbox was one-way with no explanation. */}
                                {!config.imapHost && (
                                    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                                        <i className="fa-solid fa-triangle-exclamation text-amber-600 mt-0.5"></i>
                                        <div>
                                            <p className="text-xs font-bold text-amber-800">Incoming email is not configured</p>
                                            <p className="text-xs text-amber-700 mt-0.5">
                                                Without an IMAP host you can send email, but replies from your contacts
                                                will never appear in the Inbox. Ask your provider for their IMAP server.
                                            </p>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Sending has had a Test button since day one; receiving —
                            the half that can fail silently — had none, so there was
                            no way for a user to ask whether it worked. */}
                        {config.isConfigured && config.imapEnabled && (
                            <button
                                type="button"
                                onClick={handleTestImap}
                                disabled={testingImap}
                                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-700 transition disabled:opacity-50"
                            >
                                <i className={`fa-solid ${testingImap ? 'fa-spinner fa-spin' : 'fa-inbox'} text-slate-400`}></i>
                                {testingImap ? 'Checking…' : 'Test incoming mail'}
                            </button>
                        )}
                    </div>

                    {/* Actions */}
                    <div className="px-6 py-4 flex items-center justify-between gap-3 bg-slate-50/50">
                        {config.isConfigured && (
                            <button type="button" onClick={() => setShowCredentials(false)}
                                className="text-sm text-slate-500 hover:text-slate-700 font-medium flex items-center gap-1.5 transition">
                                <i className="fa-solid fa-xmark"></i> Cancel
                            </button>
                        )}
                        <div className="flex gap-3 ml-auto">
                            <button type="submit" disabled={saving}
                                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition shadow-md shadow-blue-200">
                                {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</> : <><i className="fa-solid fa-floppy-disk"></i> Save Configuration</>}
                            </button>
                        </div>
                    </div>
                </form>
            )}

            {/* Gmail Help */}
            {config.emailServiceType === 'gmail' && (!config.isConfigured || showCredentials) && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                    <div className="flex items-center gap-2 mb-3">
                        <i className="fa-solid fa-lightbulb text-amber-500"></i>
                        <h3 className="text-sm font-bold text-amber-900">How to create a Gmail App Password</h3>
                    </div>
                    <ol className="text-sm text-amber-800 space-y-1.5 list-decimal list-inside leading-relaxed">
                        <li>Go to <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" className="underline font-medium">myaccount.google.com</a></li>
                        <li>Security → 2-Step Verification (enable if needed)</li>
                        <li>Search "App passwords" → create one for "Mail"</li>
                        <li>Copy the 16-character code and paste it above (without spaces)</li>
                    </ol>
                </div>
            )}
        </div>
    );
};

export default EmailSettings;
