import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const WhatsAppSettings = () => {
    const { showSuccess, showError } = useNotification();
    const [activeTab, setActiveTab] = useState('connection');
    
    // Connection State
    const [config, setConfig] = useState({
        waBusinessId: '',
        waPhoneNumberId: '',
        waAccessToken: '',
        isConfigured: false
    });
    
    // Automations State
    const [settings, setSettings] = useState({
        businessHours: {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            monday: { isOpen: true, start: '09:00', end: '18:00' },
            tuesday: { isOpen: true, start: '09:00', end: '18:00' },
            wednesday: { isOpen: true, start: '09:00', end: '18:00' },
            thursday: { isOpen: true, start: '09:00', end: '18:00' },
            friday: { isOpen: true, start: '09:00', end: '18:00' },
            saturday: { isOpen: false, start: '09:00', end: '13:00' },
            sunday: { isOpen: false, start: '09:00', end: '13:00' }
        },
        autoReply: {
            outOfOfficeEnabled: false,
            outOfOfficeMessage: 'Thanks for reaching out! We are currently closed and will get back to you during business hours.',
            welcomeEnabled: false,
            welcomeMessage: 'Hi there! How can we help you today?'
        }
    });

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [showToken, setShowToken] = useState(false);

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        try {
            const [configRes, settingsRes] = await Promise.all([
                api.get('/whatsapp/config'),
                api.get('/whatsapp/settings').catch(() => ({ data: { settings: null } }))
            ]);
            
            setConfig(prev => ({
                ...prev,
                waBusinessId: configRes.data.waBusinessId || '',
                waPhoneNumberId: configRes.data.waPhoneNumberId || '',
                isConfigured: configRes.data.isConfigured || false
            }));

            if (settingsRes && settingsRes.data && settingsRes.data.settings) {
                // Merge with default settings to avoid undefined errors
                setSettings(prev => ({
                    businessHours: { ...prev.businessHours, ...(settingsRes.data.settings.businessHours || {}) },
                    autoReply: { ...prev.autoReply, ...(settingsRes.data.settings.autoReply || {}) }
                }));
            }
        } catch (error) {
            console.error('Error fetching data:', error);
            showError('Failed to load settings');
        } finally {
            setLoading(false);
        }
    };

    // --- Connection Handlers ---
    const handleConfigChange = (e) => {
        const { name, value } = e.target;
        setConfig(prev => ({ ...prev, [name]: value }));
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        if (!config.waPhoneNumberId.trim()) { showError('Phone Number ID is required'); return; }
        if (!config.waAccessToken.trim()) { showError('Access Token is required'); return; }

        setSaving(true);
        try {
            const res = await api.put('/whatsapp/config', {
                waBusinessId: config.waBusinessId.trim(),
                waPhoneNumberId: config.waPhoneNumberId.trim(),
                waAccessToken: config.waAccessToken.trim()
            });

            if (res.data.success) {
                showSuccess('API Connection saved successfully!');
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
                payload.waAccessToken = config.waAccessToken;
            }

            const res = await api.post('/whatsapp/config/test', payload);
            if (res.data.success) showSuccess(res.data.message || 'WhatsApp configuration is valid!');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to test configuration');
        } finally {
            setTesting(false);
        }
    };

    // --- Settings Handlers ---
    const handleBusinessHourChange = (day, field, value) => {
        setSettings(prev => ({
            ...prev,
            businessHours: {
                ...prev.businessHours,
                [day]: { ...prev.businessHours[day], [field]: value }
            }
        }));
    };

    const handleAutoReplyChange = (field, value) => {
        setSettings(prev => ({
            ...prev,
            autoReply: { ...prev.autoReply, [field]: value }
        }));
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const res = await api.put('/whatsapp/settings', {
                businessHours: settings.businessHours,
                autoReply: settings.autoReply
            });
            if (res.data.success) showSuccess('Automations saved successfully!');
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

    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

    return (
        <div className="p-6 max-w-4xl mx-auto h-full overflow-y-auto">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">WhatsApp Settings</h2>
            
            {/* Tabs */}
            <div className="flex border-b border-slate-200 mb-6">
                <button 
                    onClick={() => setActiveTab('connection')}
                    className={`px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${activeTab === 'connection' ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-plug mr-2"></i> API Connection
                </button>
                <button 
                    onClick={() => setActiveTab('automations')}
                    className={`px-6 py-3 font-semibold text-sm border-b-2 transition-colors ${activeTab === 'automations' ? 'border-[#00a884] text-[#00a884]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                >
                    <i className="fa-solid fa-robot mr-2"></i> Automations & OOO
                </button>
            </div>

            {/* Content: Connection */}
            {activeTab === 'connection' && (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
                        <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                            <i className="fa-brands fa-whatsapp text-xl text-green-600"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">API Credentials</h3>
                            <p className="text-sm text-slate-500">Link your Meta WhatsApp Business API</p>
                        </div>
                    </div>

                    {config.isConfigured && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex items-start gap-3">
                            <i className="fa-solid fa-check-circle text-green-600 mt-0.5"></i>
                            <div>
                                <p className="text-sm font-bold text-green-800">Connection Active</p>
                                <p className="text-xs text-green-600 mt-1">Your WhatsApp API is successfully linked and operational.</p>
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSaveConfig} className="space-y-4 max-w-2xl">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Business Account ID <span className="text-slate-400 font-normal">(Optional)</span></label>
                            <input type="text" name="waBusinessId" value={config.waBusinessId} onChange={handleConfigChange} placeholder="123456789012345" className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none font-mono text-sm" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Phone Number ID <span className="text-red-500">*</span></label>
                            <input type="text" name="waPhoneNumberId" value={config.waPhoneNumberId} onChange={handleConfigChange} placeholder="123456789012345" className="w-full p-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none font-mono text-sm" required />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Access Token <span className="text-red-500">*</span></label>
                            <div className="relative">
                                <input type={showToken ? 'text' : 'password'} name="waAccessToken" value={config.waAccessToken} onChange={handleConfigChange} placeholder={config.isConfigured ? "Enter new token to update" : "Enter access token"} className="w-full p-2.5 pr-12 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none font-mono text-sm" required={!config.isConfigured} />
                                <button type="button" onClick={() => setShowToken(!showToken)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><i className={`fa-solid ${showToken ? 'fa-eye-slash' : 'fa-eye'}`}></i></button>
                            </div>
                        </div>

                        <div className="flex gap-3 pt-4 border-t border-slate-100 mt-6">
                            <button type="button" onClick={handleTest} disabled={testing || (!config.isConfigured && (!config.waPhoneNumberId || !config.waAccessToken))} className="px-5 py-2.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg font-semibold text-sm transition disabled:opacity-50">
                                <i className={`fa-solid ${testing ? 'fa-spinner fa-spin' : 'fa-vial'} mr-2`}></i> Test Connection
                            </button>
                            <button type="submit" disabled={saving} className="px-5 py-2.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-lg font-semibold text-sm transition shadow-sm disabled:opacity-50 flex-1">
                                <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`}></i> Save Credentials
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* Content: Automations */}
            {activeTab === 'automations' && (
                <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl pb-10">
                    
                    {/* Auto-Replies */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center gap-2 mb-5">
                            <i className="fa-solid fa-reply-all text-[#00a884] text-lg"></i>
                            <h3 className="text-lg font-bold text-slate-800">Auto-Replies</h3>
                        </div>

                        <div className="space-y-6">
                            {/* Welcome Message */}
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm">Welcome Message</h4>
                                        <p className="text-[11px] text-slate-500">Sent automatically when a new lead messages you for the first time.</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" className="sr-only peer" checked={settings.autoReply.welcomeEnabled} onChange={(e) => handleAutoReplyChange('welcomeEnabled', e.target.checked)} />
                                        <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00a884]"></div>
                                    </label>
                                </div>
                                {settings.autoReply.welcomeEnabled && (
                                    <textarea 
                                        value={settings.autoReply.welcomeMessage} 
                                        onChange={(e) => handleAutoReplyChange('welcomeMessage', e.target.value)}
                                        className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm resize-none" rows="3"
                                        placeholder="Hi! Welcome to our business. How can we help you today?"
                                    />
                                )}
                            </div>

                            {/* OOO Message */}
                            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl">
                                <div className="flex items-center justify-between mb-3">
                                    <div>
                                        <h4 className="font-bold text-slate-800 text-sm">Out-of-Office (OOO) Message</h4>
                                        <p className="text-[11px] text-slate-500">Sent automatically when you receive a message outside of your business hours.</p>
                                    </div>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input type="checkbox" className="sr-only peer" checked={settings.autoReply.outOfOfficeEnabled} onChange={(e) => handleAutoReplyChange('outOfOfficeEnabled', e.target.checked)} />
                                        <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#00a884]"></div>
                                    </label>
                                </div>
                                {settings.autoReply.outOfOfficeEnabled && (
                                    <textarea 
                                        value={settings.autoReply.outOfOfficeMessage} 
                                        onChange={(e) => handleAutoReplyChange('outOfOfficeMessage', e.target.value)}
                                        className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm resize-none" rows="3"
                                        placeholder="Thanks for reaching out! We are currently closed and will get back to you during business hours."
                                    />
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Business Hours */}
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                        <div className="flex items-center justify-between mb-6">
                            <div className="flex items-center gap-2">
                                <i className="fa-solid fa-clock text-[#00a884] text-lg"></i>
                                <h3 className="text-lg font-bold text-slate-800">Business Hours</h3>
                            </div>
                            <div className="text-sm">
                                <select 
                                    value={settings.businessHours.timezone}
                                    onChange={(e) => setSettings(prev => ({ ...prev, businessHours: { ...prev.businessHours, timezone: e.target.value } }))}
                                    className="p-1.5 border border-slate-200 rounded-lg text-xs bg-slate-50 font-medium outline-none cursor-pointer"
                                >
                                    <option value={Intl.DateTimeFormat().resolvedOptions().timeZone}>Local Time ({Intl.DateTimeFormat().resolvedOptions().timeZone})</option>
                                    <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                                    <option value="UTC">UTC</option>
                                    <option value="America/New_York">America/New_York (EST)</option>
                                    <option value="Europe/London">Europe/London (GMT)</option>
                                    <option value="Australia/Sydney">Australia/Sydney (AEST)</option>
                                </select>
                            </div>
                        </div>

                        <div className="space-y-0 border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
                            {days.map(day => {
                                const dayConfig = settings.businessHours[day];
                                return (
                                    <div key={day} className={`flex items-center justify-between p-3.5 ${!dayConfig.isOpen ? 'bg-slate-50' : 'bg-white'}`}>
                                        <div className="flex items-center gap-4 w-1/3">
                                            <label className="relative inline-flex items-center cursor-pointer">
                                                <input type="checkbox" className="sr-only peer" checked={dayConfig.isOpen} onChange={(e) => handleBusinessHourChange(day, 'isOpen', e.target.checked)} />
                                                <div className="w-9 h-5 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#00a884]"></div>
                                            </label>
                                            <span className={`text-sm font-semibold capitalize ${dayConfig.isOpen ? 'text-slate-800' : 'text-slate-400'}`}>{day}</span>
                                        </div>
                                        
                                        {dayConfig.isOpen ? (
                                            <div className="flex items-center gap-3 w-2/3 justify-end">
                                                <input type="time" value={dayConfig.start} onChange={(e) => handleBusinessHourChange(day, 'start', e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white shadow-sm outline-none focus:border-[#00a884]" required />
                                                <span className="text-slate-400 text-xs font-bold">TO</span>
                                                <input type="time" value={dayConfig.end} onChange={(e) => handleBusinessHourChange(day, 'end', e.target.value)} className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white shadow-sm outline-none focus:border-[#00a884]" required />
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

                    <div className="flex justify-end pt-2">
                        <button type="submit" disabled={saving} className="px-6 py-3 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl font-semibold text-sm transition shadow-md disabled:opacity-50 flex items-center gap-2">
                            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
                            Save Automations
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
};

export default WhatsAppSettings;
