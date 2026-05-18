/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
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

const inputCls = "w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 focus:bg-white transition-all";

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
                emailSignature: config.emailSignature
            };
            if (config.emailPassword.trim() && config.emailPassword !== '••••••••') {
                payload.emailPassword = config.emailPassword.trim();
            }
            const res = await api.put('/email/config', payload);
            if (res.data.success) {
                showSuccess('Email configuration saved!');
                setConfig(prev => ({ ...prev, emailPassword: '••••••••', isConfigured: true }));
                setShowCredentials(false);
            }
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to save configuration');
        } finally {
            setSaving(false);
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
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
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
                                    className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${config.emailServiceType === opt.value ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                                >
                                    <i className={`fa-brands ${opt.icon} text-xl ${config.emailServiceType === opt.value ? 'text-indigo-500' : opt.color}`}></i>
                                    <span className={`text-sm font-semibold ${config.emailServiceType === opt.value ? 'text-indigo-700' : 'text-slate-700'}`}>{opt.label}</span>
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
                                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition shadow-md shadow-indigo-200">
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
