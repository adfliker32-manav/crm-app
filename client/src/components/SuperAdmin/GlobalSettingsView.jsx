import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const GlobalSettingsView = () => {
    const [settings, setSettings] = useState({
        app_name: '',
        support_email: '',
        company_name: '',
        company_address: '',
        company_gst: '',
        company_logo: '',
        maintenance_mode: false,
        trial_days_default: 14,
        whatsappSync: true,
        emailMarketing: true,
        automations: true,
        apiAccess: true
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

                {/* Company Invoice / Branding Card */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold text-slate-800 mb-1 flex items-center gap-2">
                        <i className="fa-solid fa-file-invoice text-emerald-500"></i> Company Branding & Invoice Details
                    </h2>
                    <p className="text-sm text-slate-500 mb-4">
                        These details appear as <strong>"Billed By"</strong> on every customer invoice and billing email. Set your company name, logo, address, and GST number.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Company Name */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Company Name</label>
                            <input
                                type="text"
                                name="company_name"
                                value={settings.company_name || ''}
                                onChange={handleChange}
                                placeholder="e.g. Adfliker Technologies Pvt. Ltd."
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition"
                            />
                            <p className="text-xs text-slate-400 mt-1">Displayed in email headers and invoice "From" block.</p>
                        </div>

                        {/* Company GST */}
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Company GST Number</label>
                            <input
                                type="text"
                                name="company_gst"
                                value={settings.company_gst || ''}
                                onChange={handleChange}
                                placeholder="e.g. 06AAAAA0000A1Z5"
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition font-mono uppercase"
                            />
                            <p className="text-xs text-slate-400 mt-1">Appears on the invoice under your company name.</p>
                        </div>

                        {/* Company Address - full width */}
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-1">Company Address</label>
                            <textarea
                                name="company_address"
                                value={settings.company_address || ''}
                                onChange={handleChange}
                                placeholder={'e.g. Adfliker Technologies Pvt. Ltd.\n123 Business Park, Sector 18\nGurugram, Haryana 122001, India'}
                                rows={3}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition"
                            />
                            <p className="text-xs text-slate-400 mt-1">Full registered address. Use line breaks for multi-line formatting on the invoice.</p>
                        </div>

                        {/* Company Logo Upload - full width */}
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-slate-700 mb-2">Company Logo</label>
                            <div className="flex items-start gap-6">
                                {/* Preview */}
                                <div className="flex-shrink-0">
                                    {settings.company_logo ? (
                                        <div className="relative group">
                                            <div className="w-28 h-28 rounded-xl border-2 border-emerald-200 bg-white flex items-center justify-center overflow-hidden shadow-sm">
                                                <img src={settings.company_logo} alt="Company Logo" className="max-w-full max-h-full object-contain p-2" />
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setSettings(prev => ({ ...prev, company_logo: '' }))}
                                                className="absolute -top-2 -right-2 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs hover:bg-red-600 transition shadow-md opacity-0 group-hover:opacity-100"
                                                title="Remove logo"
                                            >
                                                <i className="fa-solid fa-times"></i>
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="w-28 h-28 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-slate-400">
                                            <i className="fa-solid fa-image text-2xl mb-1"></i>
                                            <span className="text-xs">No logo</span>
                                        </div>
                                    )}
                                </div>

                                {/* Upload Zone */}
                                <div className="flex-1">
                                    <label
                                        htmlFor="logo-upload"
                                        className="cursor-pointer block border-2 border-dashed border-slate-300 rounded-xl p-5 text-center hover:border-emerald-400 hover:bg-emerald-50/30 transition"
                                        onDragOver={(e) => e.preventDefault()}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            const file = e.dataTransfer?.files?.[0];
                                            if (file && file.type.startsWith('image/')) {
                                                if (file.size > 500 * 1024) {
                                                    setMessage({ type: 'error', text: 'Logo file must be under 500KB.' });
                                                    return;
                                                }
                                                const reader = new FileReader();
                                                reader.onload = (ev) => setSettings(prev => ({ ...prev, company_logo: ev.target.result }));
                                                reader.readAsDataURL(file);
                                            }
                                        }}
                                    >
                                        <i className="fa-solid fa-cloud-arrow-up text-emerald-500 text-xl mb-2"></i>
                                        <p className="text-sm text-slate-600">
                                            <span className="font-semibold text-emerald-600">Click to upload</span> or drag & drop
                                        </p>
                                        <p className="text-xs text-slate-400 mt-1">PNG, JPG, SVG — Max 500KB</p>
                                    </label>
                                    <input
                                        id="logo-upload"
                                        type="file"
                                        accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                        className="hidden"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            if (file.size > 500 * 1024) {
                                                setMessage({ type: 'error', text: 'Logo file must be under 500KB.' });
                                                return;
                                            }
                                            const reader = new FileReader();
                                            reader.onload = (ev) => setSettings(prev => ({ ...prev, company_logo: ev.target.result }));
                                            reader.readAsDataURL(file);
                                            e.target.value = ''; // reset so same file can be re-selected
                                        }}
                                    />
                                    <p className="text-xs text-slate-400 mt-2">
                                        This logo appears in billing emails and invoice headers. Use a transparent-background logo for best results.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {!settings.company_name && !settings.company_address && (
                        <div className="mt-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <i className="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5"></i>
                            <p className="text-sm text-amber-700">
                                <strong>Not set yet.</strong> Every invoice and billing email will show empty branding until you fill in at least the company name and address.
                            </p>
                        </div>
                    )}
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
                                checked={settings.maintenance_mode || false}
                                onChange={handleChange}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </div>

                {/* Feature Flag Card */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-toggle-on text-purple-500"></i> Global Feature Flags
                    </h2>
                    
                    <div className="space-y-4">
                        {[
                            { name: 'whatsappSync', label: 'Meta WhatsApp Cloud API', desc: 'Permit tenants to blast marketing broadcasts via Meta.' },
                            { name: 'emailMarketing', label: 'Email Marketing Engine', desc: 'Activates the global IMAP/SMTP polling service.' },
                            { name: 'automations', label: 'No-Code Automations Engine', desc: 'Determines if background Cron jobs and workflows execute.' },
                            { name: 'apiAccess', label: 'Public REST API Keys', desc: 'Permits tenants to generate developer keys for inbound webhooks.' }
                        ].map(feature => (
                            <div key={feature.name} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <div>
                                    <h3 className="font-medium text-slate-900">{feature.label}</h3>
                                    <p className="text-sm text-slate-500">{feature.desc}</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        name={feature.name}
                                        checked={settings[feature.name] !== false}
                                        onChange={handleChange}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
                                </label>
                            </div>
                        ))}
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
