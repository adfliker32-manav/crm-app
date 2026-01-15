import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const WhatsAppSettings = () => {
    const { showSuccess, showError } = useNotification();
    const [config, setConfig] = useState({
        waBusinessId: '',
        waPhoneNumberId: '',
        waAccessToken: '',
        isConfigured: false
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [showToken, setShowToken] = useState(false);

    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            const res = await api.get('/whatsapp/config');
            setConfig(prev => ({
                ...prev,
                waBusinessId: res.data.waBusinessId || '',
                waPhoneNumberId: res.data.waPhoneNumberId || '',
                isConfigured: res.data.isConfigured || false
            }));
        } catch (error) {
            console.error('Error fetching config:', error);
            showError('Failed to load WhatsApp configuration');
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

        if (!config.waPhoneNumberId.trim()) {
            showError('Phone Number ID is required');
            return;
        }

        if (!config.waAccessToken.trim()) {
            showError('Access Token is required');
            return;
        }

        setSaving(true);

        try {
            const res = await api.put('/whatsapp/config', {
                waBusinessId: config.waBusinessId.trim(),
                waPhoneNumberId: config.waPhoneNumberId.trim(),
                waAccessToken: config.waAccessToken.trim()
            });

            if (res.data.success) {
                showSuccess('WhatsApp configuration saved successfully!');
                setConfig(prev => ({
                    ...prev,
                    waAccessToken: '', // Clear token from form after save
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
        if (!config.isConfigured && (!config.waPhoneNumberId || !config.waAccessToken)) {
            showError('Please save your configuration first');
            return;
        }

        setTesting(true);

        try {
            const payload = {};
            // If user just entered new credentials, test them
            if (config.waPhoneNumberId && config.waAccessToken) {
                payload.waPhoneNumberId = config.waPhoneNumberId;
                payload.waAccessToken = config.waAccessToken;
            }

            const res = await api.post('/whatsapp/config/test', payload);

            if (res.data.success) {
                showSuccess(res.data.message || 'WhatsApp configuration is valid!');
            }
        } catch (error) {
            console.error('Error testing config:', error);
            showError(error.response?.data?.message || 'Failed to test configuration');
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
                    <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                        <i className="fa-brands fa-whatsapp text-2xl text-green-600"></i>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">WhatsApp Business API Configuration</h2>
                        <p className="text-sm text-gray-500">Configure your Meta WhatsApp Business API credentials</p>
                    </div>
                </div>

                {/* Status Indicator */}
                {config.isConfigured && (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-center gap-3">
                        <i className="fa-solid fa-check-circle text-green-600 text-xl"></i>
                        <div>
                            <p className="font-medium text-green-800">Configuration Active</p>
                            <p className="text-sm text-green-600">Your WhatsApp integration is configured and ready to use</p>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-5">
                    {/* Business Account ID */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Business Account ID <span className="text-gray-400">(Optional)</span>
                        </label>
                        <input
                            type="text"
                            name="waBusinessId"
                            value={config.waBusinessId}
                            onChange={handleChange}
                            placeholder="123456789012345"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none font-mono text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            Your WhatsApp Business Account ID from Meta Business Manager
                        </p>
                    </div>

                    {/* Phone Number ID */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Phone Number ID <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            name="waPhoneNumberId"
                            value={config.waPhoneNumberId}
                            onChange={handleChange}
                            placeholder="123456789012345"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none font-mono text-sm"
                            required
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            The Phone Number ID from your WhatsApp Business API setup
                        </p>
                    </div>

                    {/* Access Token */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Access Token <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                            <input
                                type={showToken ? 'text' : 'password'}
                                name="waAccessToken"
                                value={config.waAccessToken}
                                onChange={handleChange}
                                placeholder={config.isConfigured ? "Enter new token to update" : "Enter your access token"}
                                className="w-full p-3 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none font-mono text-sm"
                                required={!config.isConfigured}
                            />
                            <button
                                type="button"
                                onClick={() => setShowToken(!showToken)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                            >
                                <i className={`fa-solid ${showToken ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            Your permanent access token from Meta Developer Console
                        </p>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-3 pt-4 border-t border-gray-200">
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
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
                            disabled={testing || (!config.isConfigured && (!config.waPhoneNumberId || !config.waAccessToken))}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
                        >
                            {testing ? (
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                    Testing...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-vial"></i>
                                    Test Connection
                                </>
                            )}
                        </button>
                    </div>
                </form>

                {/* Help Section */}
                <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
                        <i className="fa-solid fa-info-circle"></i>
                        How to get your credentials
                    </h3>
                    <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                        <li>Go to <a href="https://developers.facebook.com/" target="_blank" rel="noopener noreferrer" className="underline">Meta for Developers</a></li>
                        <li>Create or select your WhatsApp Business App</li>
                        <li>Navigate to WhatsApp → Getting Started</li>
                        <li>Copy your Phone Number ID and Access Token</li>
                        <li>Paste them here and click "Save Configuration"</li>
                        <li>Click "Test Connection" to verify</li>
                    </ol>
                </div>
            </div>
        </div>
    );
};

export default WhatsAppSettings;
