import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const GlobalSettingsView = () => {
    const [settings, setSettings] = useState({
        app_name: '',
        support_email: '',
        maintenance_mode: false,
        trial_days_default: 14
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            const res = await api.get('/superadmin/settings');
            if (res.data.success) {
                // Merge loaded settings with defaults to ensure all fields exist
                setSettings(prev => ({ ...prev, ...res.data.settings }));
            }
        } catch (error) {
            console.error("Error fetching settings:", error);
            setMessage({ type: 'error', text: 'Failed to load settings' });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);

        try {
            await api.put('/superadmin/settings', { settings });
            setMessage({ type: 'success', text: 'Settings updated successfully' });

            // Clear success message after 3 seconds
            setTimeout(() => setMessage(null), 3000);
        } catch (error) {
            console.error("Error updating settings:", error);
            setMessage({ type: 'error', text: error.response?.data?.message || 'Failed to update settings' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-slate-500">Loading settings...</div>
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <header className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">Global Settings</h1>
                <p className="text-slate-500">Manage system-wide configurations and defaults.</p>
            </header>

            {message && (
                <div className={`p-4 rounded-lg mb-4 ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
                    }`}>
                    {message.text}
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* General Settings Card */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-sliders text-blue-500"></i> General Configuration
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Application Name</label>
                            <input
                                type="text"
                                name="app_name"
                                value={settings.app_name}
                                onChange={handleChange}
                                placeholder="e.g. My SaaS CRM"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Support Email</label>
                            <input
                                type="email"
                                name="support_email"
                                value={settings.support_email}
                                onChange={handleChange}
                                placeholder="support@example.com"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Default Trial Days</label>
                            <input
                                type="number"
                                name="trial_days_default"
                                value={settings.trial_days_default}
                                onChange={handleChange}
                                min="0"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                            />
                            <p className="text-xs text-slate-500 mt-1">Applied to new company signups automatically.</p>
                        </div>
                    </div>
                </div>

                {/* System Control Card */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-shield-halved text-orange-500"></i> System Control
                    </h2>

                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div>
                            <h3 className="font-medium text-slate-900">Maintenance Mode</h3>
                            <p className="text-sm text-slate-500">Prevent non-admin users from accessing the platform.</p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                name="maintenance_mode"
                                checked={settings.maintenance_mode}
                                onChange={handleChange}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end pt-4">
                    <button
                        type="submit"
                        disabled={saving}
                        className={`flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition shadow-lg ${saving ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                        {saving ? (
                            <>
                                <i className="fa-solid fa-circle-notch fa-spin"></i> Saving...
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-save"></i> Save Changes
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default GlobalSettingsView;
