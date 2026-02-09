import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const MetaConfigSection = () => {
    const { showSuccess, showError } = useNotification();

    const [status, setStatus] = useState({
        connected: false,
        pageId: null,
        pageName: null,
        formId: null,
        formName: null,
        syncEnabled: false,
        lastSyncAt: null
    });
    const [pages, setPages] = useState([]);
    const [forms, setForms] = useState([]);
    const [selectedPage, setSelectedPage] = useState(null);
    const [selectedForm, setSelectedForm] = useState(null);
    const [loading, setLoading] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);

    // CAPI Settings
    const [capiSettings, setCapiSettings] = useState({
        pixelId: '',
        capiAccessToken: '',
        testEventCode: '',
        capiEnabled: false,
        stageMapping: {
            first: 'New',
            middle: 'Contacted',
            qualified: 'Won',
            dead: 'Dead Lead'
        }
    });
    const [stages, setStages] = useState([]);

    // Check URL params for OAuth result
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const metaSuccess = params.get('meta_success');
        const metaError = params.get('meta_error');

        if (metaSuccess) {
            showSuccess('Successfully connected to Facebook!');
            // Clean up URL
            window.history.replaceState({}, '', '/settings');
        } else if (metaError) {
            showError(metaError);
            window.history.replaceState({}, '', '/settings');
        }
    }, [showSuccess, showError]);

    // Load status on mount
    useEffect(() => {
        loadStatus();
        loadCapiSettings();
        loadStages();
    }, []);

    const loadStatus = async () => {
        try {
            setLoading(true);
            const res = await api.get('/meta/status');
            setStatus(res.data);

            // If connected, load pages
            if (res.data.connected) {
                loadPages();
            }
        } catch (error) {
            console.error('Failed to load Meta status:', error);
        } finally {
            setLoading(false);
        }
    };

    const loadPages = async () => {
        try {
            const res = await api.get('/meta/pages');
            setPages(res.data.pages || []);
        } catch (error) {
            console.error('Failed to load pages:', error);
            showError('Failed to load Facebook pages');
        }
    };

    const loadForms = async (pageId) => {
        try {
            const res = await api.get(`/meta/forms/${pageId}`);
            setForms(res.data.forms || []);
        } catch (error) {
            console.error('Failed to load forms:', error);
            showError('Failed to load lead forms');
        }
    };

    const loadCapiSettings = async () => {
        try {
            const res = await api.get('/meta/capi-settings');
            setCapiSettings({
                pixelId: res.data.pixelId || '',
                capiAccessToken: res.data.capiAccessToken || '',
                testEventCode: res.data.testEventCode || '',
                capiEnabled: res.data.capiEnabled || false,
                stageMapping: res.data.stageMapping || {
                    first: 'New',
                    middle: 'Contacted',
                    qualified: 'Won',
                    dead: 'Dead Lead'
                }
            });
        } catch (error) {
            console.error('Failed to load CAPI settings:', error);
        }
    };

    const loadStages = async () => {
        try {
            const res = await api.get('/stages');
            setStages(res.data || []);
        } catch (error) {
            console.error('Failed to load stages:', error);
        }
    };

    const handleConnectFacebook = async () => {
        try {
            setConnecting(true);
            const res = await api.get('/meta/auth');
            if (res.data.authUrl) {
                window.location.href = res.data.authUrl;
            }
        } catch (error) {
            console.error('Failed to get auth URL:', error);
            showError(error.response?.data?.message || 'Failed to connect to Facebook');
            setConnecting(false);
        }
    };

    const handlePageChange = (e) => {
        const pageId = e.target.value;
        const page = pages.find(p => p.id === pageId);
        setSelectedPage(page);
        setSelectedForm(null);
        setForms([]);

        if (page) {
            loadForms(pageId);
        }
    };

    const handleFormChange = (e) => {
        const formId = e.target.value;
        const form = forms.find(f => f.id === formId);
        setSelectedForm(form);
    };

    const handleStartSync = async () => {
        if (!selectedPage || !selectedForm) {
            showError('Please select both a Page and a Form');
            return;
        }

        try {
            setSaving(true);
            await api.post('/meta/connect', {
                pageId: selectedPage.id,
                pageName: selectedPage.name,
                pageAccessToken: selectedPage.accessToken,
                formId: selectedForm.id,
                formName: selectedForm.name
            });

            showSuccess('Meta Lead Sync enabled successfully!');
            loadStatus();
        } catch (error) {
            console.error('Failed to enable sync:', error);
            showError(error.response?.data?.message || 'Failed to enable sync');
        } finally {
            setSaving(false);
        }
    };

    const handleDisconnect = async () => {
        if (!confirm('Are you sure you want to disconnect Meta Lead Sync?')) return;

        try {
            await api.post('/meta/disconnect');
            showSuccess('Meta disconnected successfully');
            setStatus({
                connected: false,
                pageId: null,
                pageName: null,
                formId: null,
                formName: null,
                syncEnabled: false,
                lastSyncAt: null
            });
            setPages([]);
            setForms([]);
            setSelectedPage(null);
            setSelectedForm(null);
        } catch (error) {
            console.error('Failed to disconnect:', error);
            showError('Failed to disconnect');
        }
    };

    const handleToggleSync = async () => {
        try {
            const newStatus = !status.syncEnabled;
            await api.post('/meta/toggle-sync', { enabled: newStatus });
            setStatus(prev => ({ ...prev, syncEnabled: newStatus }));
            showSuccess(newStatus ? 'Lead sync enabled' : 'Lead sync paused');
        } catch (error) {
            console.error('Failed to toggle sync:', error);
            showError('Failed to toggle sync');
        }
    };

    const handleSaveCapiSettings = async () => {
        try {
            setSaving(true);
            await api.post('/meta/capi-settings', capiSettings);
            showSuccess('Conversion API settings saved!');
        } catch (error) {
            console.error('Failed to save CAPI settings:', error);
            showError('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        try {
            setTesting(true);
            const res = await api.post('/meta/test-capi');
            showSuccess(res.data.message);
            if (res.data.details?.messages && res.data.details.messages.length > 0) {
                console.log('Meta CAPI Test Details:', res.data.details);
            }
        } catch (error) {
            console.error('Test CAPI failed:', error);
            const errorMessage = error.response?.data?.message || 'Failed to test connection';
            showError(errorMessage);
        } finally {
            setTesting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-500"></i>
            </div>
        );
    }

    // State 2 & 3: Connected - Show Configuration & CAPI
    if (status.connected) {
        return (
            <div className="space-y-6">
                {/* Lead Sync Section (Active or Setup) */}
                {status.syncEnabled && status.pageId && status.formId ? (
                    // ACTIVE STATE
                    <>
                        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
                                    <i className="fa-solid fa-check text-white"></i>
                                </div>
                                <div>
                                    <h3 className="font-bold text-green-800">Meta Lead Sync Active</h3>
                                    <p className="text-sm text-green-600">Leads are automatically syncing to your CRM</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                <div className="bg-white rounded-lg p-4 border border-green-100">
                                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Facebook Page</p>
                                    <p className="font-semibold text-slate-700">{status.pageName}</p>
                                </div>
                                <div className="bg-white rounded-lg p-4 border border-green-100">
                                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Lead Form</p>
                                    <p className="font-semibold text-slate-700">{status.formName}</p>
                                </div>
                            </div>

                            {status.lastSyncAt && (
                                <p className="text-xs text-green-600 mt-4">
                                    <i className="fa-solid fa-clock mr-1"></i>
                                    Last lead synced: {new Date(status.lastSyncAt).toLocaleString()}
                                </p>
                            )}
                        </div>

                        {/* Toggle & Disconnect */}
                        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
                            <div className="flex items-center gap-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={status.syncEnabled}
                                        onChange={handleToggleSync}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                                </label>
                                <span className="text-sm font-medium text-slate-700">
                                    Auto-sync leads
                                </span>
                            </div>

                            <button
                                onClick={handleDisconnect}
                                className="text-red-600 hover:text-red-700 text-sm font-medium flex items-center gap-1"
                            >
                                <i className="fa-solid fa-unlink"></i>
                                Disconnect
                            </button>
                        </div>
                    </>
                ) : (
                    // SETUP STATE
                    <>
                        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                            <div className="flex items-center gap-2 text-blue-700">
                                <i className="fa-brands fa-facebook text-xl"></i>
                                <span className="font-semibold">Connected to Facebook</span>
                            </div>
                            <p className="text-sm text-blue-600 mt-1">
                                Select your Facebook Page and Lead Form to start syncing leads.
                            </p>
                        </div>

                        {/* Page Selector */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Facebook Page
                            </label>
                            <select
                                value={selectedPage?.id || ''}
                                onChange={handlePageChange}
                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="">Select a page...</option>
                                {pages.map(page => (
                                    <option key={page.id} value={page.id}>{page.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Form Selector */}
                        {selectedPage && (
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Lead Form
                                </label>
                                {forms.length === 0 ? (
                                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
                                        <i className="fa-solid fa-exclamation-triangle mr-2"></i>
                                        No active lead forms found on this page. Please create a Lead Form in Facebook Ads Manager.
                                    </div>
                                ) : (
                                    <select
                                        value={selectedForm?.id || ''}
                                        onChange={handleFormChange}
                                        className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="">Select a form...</option>
                                        {forms.map(form => (
                                            <option key={form.id} value={form.id}>{form.name}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        )}

                        {/* Start Sync Button */}
                        <div className="flex items-center gap-4">
                            <button
                                onClick={handleStartSync}
                                disabled={!selectedPage || !selectedForm || saving}
                                className={`flex-1 py-3 px-6 rounded-lg font-bold text-white transition flex items-center justify-center gap-2 ${selectedPage && selectedForm
                                    ? 'bg-green-600 hover:bg-green-700'
                                    : 'bg-slate-300 cursor-not-allowed'
                                    }`}
                            >
                                {saving ? (
                                    <>
                                        <i className="fa-solid fa-spinner fa-spin"></i>
                                        Enabling...
                                    </>
                                ) : (
                                    <>
                                        <i className="fa-solid fa-bolt"></i>
                                        Start Syncing Leads
                                    </>
                                )}
                            </button>

                            <button
                                onClick={handleDisconnect}
                                className="text-slate-500 hover:text-red-600 transition"
                                title="Disconnect"
                            >
                                <i className="fa-solid fa-times text-xl"></i>
                            </button>
                        </div>
                    </>
                )}

                {/* Meta Conversion API Settings (Always Visible when connected) */}
                <div className="mt-6 bg-purple-50 border border-purple-200 rounded-xl p-6">
                    <h4 className="font-bold text-purple-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-line"></i>
                        Meta Conversion API (Track Lead Quality)
                    </h4>

                    <div className="space-y-4">
                        {/* Pixel ID Input */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Meta Pixel ID
                            </label>
                            <input
                                type="text"
                                value={capiSettings.pixelId}
                                onChange={(e) => setCapiSettings(prev => ({ ...prev, pixelId: e.target.value }))}
                                placeholder="Enter your Pixel ID"
                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                        </div>

                        {/* CAPI Access Token Input */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Conversion API Access Token
                                <a
                                    href="https://business.facebook.com/events_manager2/list"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-2 text-xs text-purple-600 hover:text-purple-700"
                                >
                                    <i className="fa-solid fa-circle-question"></i> Get from Events Manager
                                </a>
                            </label>
                            <input
                                type="password"
                                value={capiSettings.capiAccessToken}
                                onChange={(e) => setCapiSettings(prev => ({ ...prev, capiAccessToken: e.target.value }))}
                                placeholder="Paste CAPI Access Token from Events Manager"
                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                                In Events Manager: Select Pixel → Settings → Conversions API → Generate Access Token
                            </p>
                        </div>

                        {/* Test Event Code (Optional) */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2">
                                Test Event Code (Optional)
                            </label>
                            <input
                                type="text"
                                value={capiSettings.testEventCode}
                                onChange={(e) => setCapiSettings(prev => ({ ...prev, testEventCode: e.target.value }))}
                                placeholder="For testing in Events Manager"
                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                            <p className="text-xs text-slate-500 mt-1">
                                Get from Events Manager → Test Events tab. Remove after testing.
                            </p>
                        </div>

                        {/* Stage Mapping */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1">First Funnel (Entry)</label>
                                <select
                                    value={capiSettings.stageMapping.first}
                                    onChange={(e) => setCapiSettings(prev => ({ ...prev, stageMapping: { ...prev.stageMapping, first: e.target.value } }))}
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                >
                                    {stages.map(stage => (
                                        <option key={stage._id} value={stage.name}>{stage.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1">Middle Funnel</label>
                                <select
                                    value={capiSettings.stageMapping.middle}
                                    onChange={(e) => setCapiSettings(prev => ({ ...prev, stageMapping: { ...prev.stageMapping, middle: e.target.value } }))}
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                >
                                    {stages.map(stage => (
                                        <option key={stage._id} value={stage.name}>{stage.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1">Qualified (Won)</label>
                                <select
                                    value={capiSettings.stageMapping.qualified}
                                    onChange={(e) => setCapiSettings(prev => ({ ...prev, stageMapping: { ...prev.stageMapping, qualified: e.target.value } }))}
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                >
                                    {stages.map(stage => (
                                        <option key={stage._id} value={stage.name}>{stage.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1">Dead Lead</label>
                                <select
                                    value={capiSettings.stageMapping.dead}
                                    onChange={(e) => setCapiSettings(prev => ({ ...prev, stageMapping: { ...prev.stageMapping, dead: e.target.value } }))}
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm"
                                >
                                    {stages.map(stage => (
                                        <option key={stage._id} value={stage.name}>{stage.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* Enable Toggle & Save */}
                        <div className="flex items-center justify-between pt-4 border-t border-purple-200">
                            <div className="flex items-center gap-3">
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={capiSettings.capiEnabled}
                                        onChange={(e) => setCapiSettings(prev => ({ ...prev, capiEnabled: e.target.checked }))}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                                </label>
                                <span className="text-sm font-medium text-slate-700">
                                    Enable Conversion API
                                </span>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleTestConnection}
                                    disabled={testing || !capiSettings.pixelId || !capiSettings.capiAccessToken}
                                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-bold transition flex items-center gap-2"
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

                                <button
                                    onClick={handleSaveCapiSettings}
                                    disabled={saving}
                                    className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-bold transition"
                                >
                                    {saving ? 'Saving...' : 'Save Settings'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // State 1: Not connected - Show connect button
    return (
        <div className="space-y-6">
            <div className="text-center py-8">
                <div className="w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
                    <i className="fa-brands fa-facebook-f text-4xl text-white"></i>
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">
                    Connect Meta Lead Ads
                </h3>
                <p className="text-slate-500 max-w-md mx-auto mb-6">
                    Automatically sync leads from your Facebook & Instagram Lead Ads directly into your CRM.
                </p>

                <button
                    onClick={handleConnectFacebook}
                    disabled={connecting}
                    className="bg-[#1877F2] hover:bg-[#166FE5] text-white px-8 py-3 rounded-lg font-bold shadow-lg transition flex items-center gap-3 mx-auto"
                >
                    {connecting ? (
                        <>
                            <i className="fa-solid fa-spinner fa-spin"></i>
                            Connecting...
                        </>
                    ) : (
                        <>
                            <i className="fa-brands fa-facebook-f text-lg"></i>
                            Connect with Facebook
                        </>
                    )}
                </button>
            </div>

            {/* Benefits */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i className="fa-solid fa-bolt text-blue-600"></i>
                    </div>
                    <h4 className="font-bold text-slate-700 text-sm">Instant Sync</h4>
                    <p className="text-xs text-slate-500 mt-1">Leads appear in real-time</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i className="fa-solid fa-robot text-green-600"></i>
                    </div>
                    <h4 className="font-bold text-slate-700 text-sm">Fully Automatic</h4>
                    <p className="text-xs text-slate-500 mt-1">No manual export needed</p>
                </div>
                <div className="bg-slate-50 rounded-xl p-4 text-center">
                    <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <i className="fa-solid fa-shield-halved text-purple-600"></i>
                    </div>
                    <h4 className="font-bold text-slate-700 text-sm">Secure</h4>
                    <p className="text-xs text-slate-500 mt-1">OAuth 2.0 authentication</p>
                </div>
            </div>
        </div>
    );
};

export default MetaConfigSection;
