/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import MetaLeadDropLog from './MetaLeadDropLog';

const MetaConfigSection = () => {
    const { showSuccess, showError } = useNotification();

    const [status, setStatus] = useState({
        connected: false,
        tokenExpired: false,
        pageId: null,
        pageName: null,
        formId: null,
        formName: null,
        syncEnabled: false,
        lastSyncAt: null,
        connectedUserName: null,
        connectedUserPicture: null
    });
    const [pages, setPages] = useState([]);
    const [pagesDiagnostic, setPagesDiagnostic] = useState(null);
    const [forms, setForms] = useState([]);
    const [selectedPage, setSelectedPage] = useState(null);
    const [selectedForm, setSelectedForm] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingPages, setLoadingPages] = useState(false);
    const [loadingForms, setLoadingForms] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [fetchingLeads, setFetchingLeads] = useState(false);

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

    // Field mapping
    const [fieldMapping, setFieldMapping] = useState({ name: '', phone: '', email: '', city: '' });
    const [lastRawFields, setLastRawFields] = useState([]);
    const [fieldMappingSaving, setFieldMappingSaving] = useState(false);

    // WhatsApp lead arrival alert
    const [leadAlert, setLeadAlert] = useState({ enabled: false, phone: '', sources: ['Meta'] });
    const [leadAlertSaving, setLeadAlertSaving] = useState(false);

    // Check URL params for OAuth result
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const metaSuccess = params.get('meta_success');
        const metaError = params.get('meta_error');
        const metaCode = params.get('meta_code');

        if (metaCode) {
            // SECURITY FIX: Exchange authorization code securely via authenticated frontend API call
            setLoading(true);
            api.post('/meta/exchange-token', { code: metaCode })
                .then(res => {
                    if (res.data.success) {
                        showSuccess('Successfully connected to Facebook!');
                        loadStatus();
                    } else {
                        showError(res.data.message || 'Failed to link Facebook account.');
                    }
                })
                .catch(err => {
                    console.error('Meta Token Exchange Error:', err);
                    showError(err.response?.data?.message || 'Error occurred during Facebook link.');
                })
                .finally(() => {
                    setLoading(false);
                    window.history.replaceState({}, '', '/settings');
                });
        } else if (metaSuccess) {
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
        const params = new URLSearchParams(window.location.search);
        if (params.get('meta_code')) return;

        loadStatus();
        loadCapiSettings();
        loadStages();
        loadFieldMapping();
        loadLeadAlertConfig();
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
            setLoadingPages(true);
            const res = await api.get('/meta/pages');
            setPages(res.data.pages || []);
            setPagesDiagnostic(res.data.diagnostic || null);
        } catch (error) {
            console.error('Failed to load pages:', error);
            showError(error.response?.data?.message || 'Failed to load Facebook pages');
        } finally {
            setLoadingPages(false);
        }
    };

    const loadForms = async (pageId) => {
        try {
            setLoadingForms(true);
            setForms([]);
            const res = await api.get(`/meta/forms/${pageId}`);
            setForms(res.data.forms || []);
        } catch (error) {
            console.error('Failed to load forms:', error);
            showError(error.response?.data?.message || 'Failed to load lead forms');
        } finally {
            setLoadingForms(false);
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
        if (formId === 'any') {
            setSelectedForm({ id: null, name: 'Any Form' });
        } else {
            const form = forms.find(f => f.id === formId);
            setSelectedForm(form || null);
        }
    };

    const handleStartSync = async () => {
        if (!selectedPage || selectedForm === null) {
            showError('Please select a Page and a Form (or choose "Any Form")');
            return;
        }

        try {
            setSaving(true);
            const res = await api.post('/meta/connect', {
                pageId: selectedPage.id,
                pageName: selectedPage.name,
                pagePicture: selectedPage.picture,
                formId: selectedForm.id,
                formName: selectedForm.name
            });
            if (!res.data.webhookSubscribed) {
                showError('Lead Sync enabled, but webhook subscription failed. You may need to subscribe manually in Facebook Page Settings → Advanced Messaging.');
            }

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
                tokenExpired: false,
                pageId: null,
                pageName: null,
                pagePicture: null,
                formId: null,
                formName: null,
                syncEnabled: false,
                lastSyncAt: null,
                connectedUserName: null,
                connectedUserPicture: null
            });
            setPages([]);
            setPagesDiagnostic(null);
            setForms([]);
            setSelectedPage(null);
            setSelectedForm(null);
        } catch (error) {
            console.error('Failed to disconnect:', error);
            showError('Failed to disconnect');
        }
    };

    const handleFetchLeads = async () => {
        if (!confirm('Fetch up to 100 recent leads from your connected Meta form?')) return;
        setFetchingLeads(true);
        try {
            const res = await api.post('/meta/fetch-leads');
            const { imported, skipped, failed } = res.data;
            showSuccess(`Imported ${imported} lead${imported !== 1 ? 's' : ''}${skipped ? `, ${skipped} already existed` : ''}${failed ? `, ${failed} failed` : ''}`);
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to fetch leads');
        } finally {
            setFetchingLeads(false);
        }
    };

    const handleChangePage = async () => {
        try {
            await api.post('/meta/reset-page');
            setStatus(prev => ({
                ...prev,
                syncEnabled: false,
                pageId: null,
                pageName: null,
                pagePicture: null,
                formId: null,
                formName: null
            }));
            setSelectedPage(null);
            setSelectedForm(null);
            setForms([]);
            showSuccess('Page selection cleared. Choose a new page below.');
        } catch (error) {
            console.error('Failed to reset page:', error);
            showError('Failed to reset page selection. Please try again.');
        }
    };

    const loadFieldMapping = async () => {
        try {
            const mappingRes = await api.get('/meta/field-mapping');
            setFieldMapping({
                name: mappingRes.data.fieldMapping?.name || '',
                phone: mappingRes.data.fieldMapping?.phone || '',
                email: mappingRes.data.fieldMapping?.email || '',
                city: mappingRes.data.fieldMapping?.city || '',
            });
            setLastRawFields(mappingRes.data.lastRawFields || []);
        } catch (e) {
            console.error('Failed to load field mapping:', e);
        }
    };

    const handleSaveFieldMapping = async () => {
        try {
            setFieldMappingSaving(true);
            await api.post('/meta/field-mapping', fieldMapping);
            showSuccess('Field mapping saved! New leads will use this mapping.');
        } catch (e) {
            showError('Failed to save field mapping');
        } finally {
            setFieldMappingSaving(false);
        }
    };

    const loadLeadAlertConfig = async () => {
        try {
            const res = await api.get('/meta/lead-alert-config');
            if (res.data.success) {
                setLeadAlert({
                    enabled: res.data.leadAlertWhatsappEnabled || false,
                    phone: res.data.leadAlertWhatsappNumber || '',
                    sources: res.data.leadAlertWhatsappSources || ['Meta']
                });
            }
        } catch (e) {
            console.error('Failed to load lead alert config:', e);
        }
    };

    const handleSaveLeadAlertConfig = async () => {
        try {
            setLeadAlertSaving(true);
            await api.post('/meta/lead-alert-config', {
                leadAlertWhatsappEnabled: leadAlert.enabled,
                leadAlertWhatsappNumber: leadAlert.phone,
                leadAlertWhatsappSources: leadAlert.sources
            });
            showSuccess('Lead alert settings saved!');
        } catch (e) {
            showError('Failed to save lead alert settings');
        } finally {
            setLeadAlertSaving(false);
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
            // Save current settings first so the test uses what's on screen, not stale DB values
            await api.post('/meta/capi-settings', capiSettings);
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
                {/* Token expired warning */}
                {status.tokenExpired && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                        <i className="fa-solid fa-triangle-exclamation text-amber-600 text-lg mt-0.5"></i>
                        <div>
                            <p className="text-amber-800 font-semibold text-sm">Facebook session expired</p>
                            <p className="text-amber-700 text-xs mt-1">Your access token has expired and leads are no longer syncing. Log out and reconnect to resume.</p>
                        </div>
                    </div>
                )}

                {/* Connected As Banner — shows the Facebook user who linked the account */}
                {(status.connectedUserName || status.connectedUserPicture) && (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4 flex items-center gap-4">
                        {status.connectedUserPicture ? (
                            <img
                                src={status.connectedUserPicture}
                                alt={status.connectedUserName || 'Facebook User'}
                                className="w-12 h-12 rounded-full border-2 border-blue-300 shadow-sm object-cover"
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center border-2 border-blue-300">
                                <i className="fa-solid fa-user text-blue-500 text-lg"></i>
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-blue-500 font-semibold uppercase tracking-wide">Connected As</p>
                            <p className="text-base font-bold text-slate-800 truncate">{status.connectedUserName || 'Facebook User'}</p>
                            <p className="text-[11px] text-blue-400 mt-0.5">
                                <i className="fa-brands fa-facebook mr-1"></i>Business Asset User Profile
                            </p>
                        </div>
                        <div className="shrink-0">
                            <span className="inline-flex items-center gap-1.5 bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1.5 rounded-full">
                                <i className="fa-solid fa-circle-check"></i> Linked
                            </span>
                        </div>
                    </div>
                )}

                {/* Lead Sync Section (Active or Setup) */}
                {status.syncEnabled && status.pageId ? (
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
                                <div className="bg-white rounded-lg p-4 border border-green-100 flex items-center gap-3">
                                    {status.pagePicture && (
                                        <img src={status.pagePicture} alt={status.pageName} className="w-10 h-10 rounded-full border border-slate-200 object-cover" />
                                    )}
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Facebook Page</p>
                                        <p className="font-semibold text-slate-700">{status.pageName}</p>
                                    </div>
                                </div>
                                <div className="bg-white rounded-lg p-4 border border-green-100 flex items-center gap-3">
                                    <div>
                                        <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Lead Form</p>
                                        <p className="font-semibold text-slate-700">{status.formName}</p>
                                    </div>
                                </div>
                            </div>

                            {status.lastSyncAt && (
                                <p className="text-xs text-green-600 mt-4">
                                    <i className="fa-solid fa-clock mr-1"></i>
                                    Last lead synced: {new Date(status.lastSyncAt).toLocaleString()}
                                </p>
                            )}
                        </div>

                        {/* Toggle & Actions */}
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

                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={handleFetchLeads}
                                    disabled={fetchingLeads}
                                    className="text-green-700 hover:bg-green-50 px-4 py-2 rounded-lg border border-green-200 text-sm font-bold flex items-center gap-2 transition disabled:opacity-50"
                                    title="Import recent leads from your connected Meta form"
                                >
                                    <i className={`fa-solid ${fetchingLeads ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                                    {fetchingLeads ? 'Fetching...' : 'Fetch Leads'}
                                </button>
                                <button
                                    onClick={handleChangePage}
                                    className="text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg border border-blue-200 text-sm font-bold flex items-center gap-2 transition"
                                    title="Change connected page without logging out"
                                >
                                    <i className="fa-solid fa-arrows-rotate"></i>
                                    Change Page
                                </button>
                                <button
                                    onClick={handleDisconnect}
                                    className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg border border-red-200 text-sm font-bold flex items-center gap-2 transition"
                                >
                                    <i className="fa-solid fa-sign-out-alt"></i>
                                    Log out of Meta
                                </button>
                            </div>
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

                            {selectedPage && selectedPage.picture && (
                                <div className="flex items-center gap-3 mb-3 p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                                    <img src={selectedPage.picture} alt={selectedPage.name} className="w-10 h-10 rounded-full border border-slate-200 object-cover" />
                                    <span className="font-medium text-slate-800">{selectedPage.name}</span>
                                </div>
                            )}

                            <div className="relative">
                                <select
                                    value={selectedPage?.id || ''}
                                    onChange={handlePageChange}
                                    disabled={loadingPages}
                                    className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400"
                                >
                                    <option value="">
                                        {loadingPages ? 'Loading pages...' : 'Select a page...'}
                                    </option>
                                    {pages.map(page => (
                                        <option key={page.id} value={page.id}>{page.name}</option>
                                    ))}
                                </select>
                                {loadingPages && (
                                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                                        <i className="fa-solid fa-spinner fa-spin text-blue-500"></i>
                                    </div>
                                )}
                            </div>

                            {/* Explain an empty dropdown instead of leaving the user guessing */}
                            {!loadingPages && pages.length === 0 && pagesDiagnostic && (
                                <div className="mt-3 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                                    <i className="fa-solid fa-circle-info text-amber-500 mt-0.5"></i>
                                    <div className="text-sm text-amber-700">
                                        <p className="font-semibold">No Facebook Page found</p>
                                        <p className="mt-0.5">{pagesDiagnostic.message}</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Form Selector */}
                        {selectedPage && (
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Lead Form
                                </label>
                                {loadingForms ? (
                                    <div className="flex items-center gap-2 p-3 border border-slate-200 rounded-lg text-slate-500 text-sm bg-slate-50">
                                        <i className="fa-solid fa-spinner fa-spin text-blue-500"></i>
                                        Fetching lead forms...
                                    </div>
                                ) : (
                                    <>
                                        <select
                                            value={selectedForm === null ? '' : (selectedForm.id === null ? 'any' : selectedForm.id)}
                                            onChange={handleFormChange}
                                            className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        >
                                            <option value="">Select a form...</option>
                                            <option value="any">★ Any Form — receive leads from all active forms on this page</option>
                                            {forms.map(form => (
                                                <option key={form.id} value={form.id}>{form.name}</option>
                                            ))}
                                        </select>
                                        {forms.length === 0 && (
                                            <p className="text-xs text-amber-700 mt-2">
                                                <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                                                No active forms found on this page — you can still choose "Any Form" or create a Lead Form in Ads Manager.
                                            </p>
                                        )}
                                    </>
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
                                className="px-5 py-3 border-2 border-slate-200 text-slate-600 hover:border-red-200 hover:text-red-600 hover:bg-red-50 rounded-lg font-bold transition flex items-center justify-center gap-2"
                                title="Log out of Meta"
                            >
                                <i className="fa-solid fa-sign-out-alt"></i>
                                Log out
                            </button>
                        </div>
                    </>
                )}

                {/* Lead Field Mapping — lets user tell the system which Meta field = Name/Phone */}
                <div className="mt-6 bg-orange-50 border border-orange-200 rounded-xl p-6">
                    <h4 className="font-bold text-orange-800 mb-1 flex items-center gap-2">
                        <i className="fa-solid fa-sliders"></i>
                        Lead Field Mapping
                    </h4>
                    <p className="text-xs text-orange-600 mb-4">
                        Tell the system which field in your Meta form contains the Name, Phone, etc.
                        {lastRawFields.length > 0
                            ? <> Detected fields from your last lead: <span className="font-mono font-semibold">{lastRawFields.join(', ')}</span></>
                            : <> No leads received yet — field keys will appear here after your first lead comes in.</>}
                    </p>

                    {[
                        { key: 'name',  label: 'Name Field',  icon: 'fa-user',  placeholder: 'e.g. full_name' },
                        { key: 'phone', label: 'Phone Field', icon: 'fa-phone', placeholder: 'e.g. phone_number' },
                        { key: 'email', label: 'Email Field', icon: 'fa-envelope', placeholder: 'e.g. email' },
                        { key: 'city',  label: 'City Field',  icon: 'fa-location-dot', placeholder: 'e.g. city' },
                    ].map(({ key, label, icon, placeholder }) => (
                        <div key={key} className="mb-3">
                            <label className="block text-xs font-semibold text-slate-600 mb-1">
                                <i className={`fa-solid ${icon} mr-1 text-orange-500`}></i>{label}
                            </label>
                            {lastRawFields.length > 0 ? (
                                <select
                                    value={fieldMapping[key] || ''}
                                    onChange={e => setFieldMapping(prev => ({ ...prev, [key]: e.target.value }))}
                                    className="w-full p-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-orange-400 outline-none"
                                >
                                    <option value="">— Auto-detect —</option>
                                    {lastRawFields.map(f => (
                                        <option key={f} value={f}>{f}</option>
                                    ))}
                                </select>
                            ) : (
                                <input
                                    type="text"
                                    value={fieldMapping[key] || ''}
                                    onChange={e => setFieldMapping(prev => ({ ...prev, [key]: e.target.value }))}
                                    placeholder={placeholder}
                                    className="w-full p-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-400 outline-none"
                                />
                            )}
                        </div>
                    ))}

                    <button
                        onClick={handleSaveFieldMapping}
                        disabled={fieldMappingSaving}
                        className="mt-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-bold text-sm transition flex items-center gap-2"
                    >
                        <i className={`fa-solid ${fieldMappingSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                        {fieldMappingSaving ? 'Saving...' : 'Save Field Mapping'}
                    </button>

                </div>

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
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white"
                                >
                                    {stages.length === 0 && <option value={capiSettings.stageMapping.first}>{capiSettings.stageMapping.first || 'Loading...'}</option>}
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
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white"
                                >
                                    {stages.length === 0 && <option value={capiSettings.stageMapping.middle}>{capiSettings.stageMapping.middle || 'Loading...'}</option>}
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
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white"
                                >
                                    {stages.length === 0 && <option value={capiSettings.stageMapping.qualified}>{capiSettings.stageMapping.qualified || 'Loading...'}</option>}
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
                                    className="w-full p-2 border border-slate-200 rounded-lg text-sm bg-white"
                                >
                                    {stages.length === 0 && <option value={capiSettings.stageMapping.dead}>{capiSettings.stageMapping.dead || 'Loading...'}</option>}
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

                {/* ── WhatsApp Lead Arrival Alert ── */}
                <div className="mt-6 bg-green-50 border border-green-200 rounded-xl p-6" id="lead-arrival-alert">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                            <i className="fa-brands fa-whatsapp text-white text-xl" />
                        </div>
                        <div>
                            <h4 className="font-bold text-green-800">WhatsApp Lead Arrival Alert</h4>
                            <p className="text-xs text-green-600 mt-0.5">Get a WhatsApp message on your phone the moment a new lead arrives in your CRM.</p>
                        </div>
                        {/* Toggle */}
                        <label className="relative inline-flex items-center cursor-pointer ml-auto shrink-0">
                            <input
                                type="checkbox"
                                id="lead-alert-toggle"
                                checked={leadAlert.enabled}
                                onChange={e => setLeadAlert(prev => ({ ...prev, enabled: e.target.checked }))}
                                className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500" />
                        </label>
                    </div>

                    {leadAlert.enabled && (
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="lead-alert-phone" className="block text-sm font-semibold text-slate-700 mb-1">
                                    <i className="fa-solid fa-phone mr-1.5 text-green-600" />
                                    Alert Phone Number
                                    <span className="text-xs font-normal text-slate-400 ml-2">(with country code, e.g. 919876543210)</span>
                                </label>
                                <input
                                    id="lead-alert-phone"
                                    type="tel"
                                    value={leadAlert.phone}
                                    onChange={e => setLeadAlert(prev => ({ ...prev, phone: e.target.value.replace(/\s/g, '') }))}
                                    placeholder="919876543210"
                                    className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none font-mono text-sm"
                                />
                            </div>

                            {/* Lead Sources Selection */}
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    <i className="fa-solid fa-filter mr-1.5 text-green-600" />
                                    Select Lead Sources for WhatsApp Alerts
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-white border border-slate-200 rounded-xl p-4">
                                    {[
                                        { id: 'Meta', label: 'Meta (Ads)', icon: 'fa-brands fa-facebook text-blue-600' },
                                        { id: 'Web', label: 'Web (Landing Page)', icon: 'fa-solid fa-globe text-indigo-500' },
                                        { id: 'Manual', label: 'Manual Entry', icon: 'fa-solid fa-user-plus text-amber-500' },
                                        { id: 'Booking', label: 'Booking Page', icon: 'fa-solid fa-calendar-check text-green-600' },
                                        { id: 'Email', label: 'Email Integration', icon: 'fa-solid fa-envelope text-red-500' },
                                        { id: 'WhatsApp', label: 'WhatsApp Chat', icon: 'fa-brands fa-whatsapp text-emerald-500' },
                                        { id: 'Google Sheet', label: 'Google Sheet Sync', icon: 'fa-solid fa-table text-teal-600' }
                                    ].map(src => {
                                        const isChecked = leadAlert.sources?.includes(src.id);
                                        return (
                                            <label
                                                key={src.id}
                                                className={`flex items-center gap-2.5 p-3 rounded-lg border-2 cursor-pointer transition select-none hover:bg-slate-50 ${
                                                    isChecked
                                                        ? 'border-green-500 bg-green-50/20 text-green-800'
                                                        : 'border-slate-100 bg-white text-slate-600 hover:border-slate-200'
                                                }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isChecked}
                                                    onChange={() => {
                                                        const current = leadAlert.sources || [];
                                                        const updated = current.includes(src.id)
                                                            ? current.filter(x => x !== src.id)
                                                            : [...current, src.id];
                                                        setLeadAlert(prev => ({ ...prev, sources: updated }));
                                                    }}
                                                    className="w-4 h-4 rounded text-green-600 focus:ring-green-500 border-slate-300"
                                                />
                                                <div className="flex items-center gap-1.5 text-xs font-semibold">
                                                    <i className={src.icon} />
                                                    <span>{src.label}</span>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    <i className="fa-solid fa-circle-info mr-1" />
                                    Alerts will only be sent for new leads arriving from the selected sources. Note: Bulk CSV imports do not trigger alerts to avoid spam.
                                </p>
                            </div>

                            {/* Message Preview */}
                            <div className="bg-white border border-green-100 rounded-xl p-4">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                                    <i className="fa-regular fa-eye mr-1" /> Message Preview
                                </p>
                                <div className="bg-[#dcf8c6] rounded-xl rounded-tl-none px-4 py-3 text-sm text-slate-800 font-mono leading-relaxed max-w-xs shadow-sm">
                                    <p>🔔 <strong>New Lead Received!</strong></p>
                                    <p className="mt-1">👤 <strong>Name:</strong> Rahul Sharma</p>
                                    <p>📱 <strong>Phone:</strong> +91 98765 43210</p>
                                    <p>✉️ <strong>Email:</strong> rahul@gmail.com</p>
                                    <p>📋 <strong>Source:</strong> Meta (Form: 123…)</p>
                                    <p>🕒 <strong>Time:</strong> 6:35 PM IST</p>
                                    <p className="mt-1 text-slate-500 text-xs">Open your CRM to follow up → adfliker.com</p>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    <i className="fa-solid fa-circle-info mr-1" />
                                    Sent from your configured WhatsApp Business number. Requires an active WhatsApp session.
                                </p>
                            </div>
                        </div>
                    )}

                    <button
                        id="save-lead-alert-btn"
                        onClick={handleSaveLeadAlertConfig}
                        disabled={leadAlertSaving}
                        className="mt-4 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-5 py-2 rounded-lg font-bold text-sm transition flex items-center gap-2"
                    >
                        <i className={`fa-solid ${leadAlertSaving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`} />
                        {leadAlertSaving ? 'Saving...' : 'Save Alert Settings'}
                    </button>
                </div>

                {/* ── Lead Drop Log ── */}
                <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-6" id="meta-lead-drop-log">
                    <MetaLeadDropLog />
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
