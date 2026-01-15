import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const EmailSettings = () => {
    const { showSuccess, showError, showInfo } = useNotification();
    const [config, setConfig] = useState({
        emailUser: '',
        emailPassword: '',
        emailFromName: '',
        isConfigured: false
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await api.get('/email/config');
            setConfig(prev => ({
                ...prev,
                emailUser: res.data.emailUser || '',
                emailFromName: res.data.emailFromName || '',
                isConfigured: res.data.isConfigured || false
            }));
        } catch (error) {
            console.error('Error fetching config:', error);
            showError('Failed to load email configuration');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setConfig(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSave = async (e) => {
        e.preventDefault();

        if (!config.emailUser.trim()) {
            showError('Email address is required');
            return;
        }

        if (!config.emailPassword.trim() && !config.isConfigured) {
            showError('Password is required');
            return;
        }

        setSaving(true);

        try {
            const payload = {
                emailUser: config.emailUser.trim(),
                emailFromName: config.emailFromName.trim()
            };

            if (config.emailPassword.trim()) {
                payload.emailPassword = config.emailPassword.trim();
            }

            const res = await api.put('/email/config', payload);

            if (res.data.success) {
                showSuccess('Email configuration saved successfully!');
                setConfig(prev => ({
                    ...prev,
                    emailPassword: '', // Clear password from form
                    isConfigured: true
                }));
            }
        } catch (error) {
            console.error('Error saving config:', error);
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
        showInfo('Sending test email... This may take a few seconds.');

        try {
            const payload = {};
            if (config.emailUser && config.emailPassword) {
                payload.emailUser = config.emailUser;
                payload.emailPassword = config.emailPassword;
            }

            const res = await api.post('/email/config/test', payload);

            if (res.data.success) {
                showSuccess(res.data.message || 'Test email sent successfully!');
            }
        } catch (error) {
            console.error('Error testing config:', error);
            showError(error.response?.data?.message || 'Failed to send test email');
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="p-8 text-center text-slate-500">
                <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                <p>Loading configuration...</p>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-3xl mx-auto">
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-200">
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <i className="fa-solid fa-envelope text-2xl text-blue-600"></i>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Email Configuration</h2>
                        <p className="text-sm text-gray-500">Configure your SMTP email settings (Gmail)</p>
                    </div>
                </div>

                {/* Status Indicator */}
                {config.isConfigured && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                        <i className="fa-solid fa-check-circle text-green-600 text-xl"></i>
                        <div>
                            <p className="font-medium text-green-800">Configuration Active</p>
                            <p className="text-sm text-green-600">Your email integration is configured and ready to use</p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-5">
                    {/* Email Address */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Gmail Address <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="email"
                            name="emailUser"
                            value={config.emailUser}
                            onChange={handleChange}
                            placeholder="your-email@gmail.com"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Your Gmail address for sending emails
                        </p>
                    </div>

                    {/* App Password */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            App Password <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                name="emailPassword"
                                value={config.emailPassword}
                                onChange={handleChange}
                                placeholder={config.isConfigured ? "Enter new password to update" : "Enter your app password"}
                                className="w-full p-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                                required={!config.isConfigured}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Use a Gmail App Password, not your regular password
                        </p>
                    </div>

                    {/* From Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            From Name <span className="text-gray-400">(Optional)</span>
                        </label>
                        <input
                            type="text"
                            name="emailFromName"
                            value={config.emailFromName}
                            onChange={handleChange}
                            placeholder="Your Name or Company Name"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            The name that will appear in the "From" field
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-4 border-t border-gray-200">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
                        >
                            {saving ? (
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-save"></i>
                                    Save Configuration
                                </>
                            )}
                        </button>
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={testing || (!config.isConfigured && (!config.emailUser || !config.emailPassword))}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
                        >
                            {testing ? (
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                    Testing...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-paper-plane"></i>
                                    Send Test Email
                                </>
                            )}
                        </button>
                    </div>
                </form>

                {/* Help Section */}
                <div className="mt-6 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <h3 className="font-bold text-yellow-900 mb-2 flex items-center gap-2">
                        <i className="fa-solid fa-lightbulb"></i>
                        How to create a Gmail App Password
                    </h3>
                    <ol className="text-sm text-yellow-800 space-y-1 list-decimal list-inside">
                        <li>Go to your <a href="https://myaccount.google.com/" target="_blank" rel="noopener noreferrer" className="underline">Google Account</a></li>
                        <li>Select Security → 2-Step Verification (enable if not already)</li>
                        <li>Scroll down and select "App passwords"</li>
                        <li>Create a new app password for "Mail"</li>
                        <li>Copy the 16-character password</li>
                        <li>Paste it here (without spaces)</li>
                    </ol>
                    <p className="text-xs text-yellow-700 mt-2">
                        ⚠️ Never use your regular Gmail password. Always use App Passwords for security.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default EmailSettings;
