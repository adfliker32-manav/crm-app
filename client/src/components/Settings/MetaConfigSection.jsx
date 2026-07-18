/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import { useState, useEffect, useRef } from 'react';
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
    const [fetchCooldown, setFetchCooldown] = useState(0); // seconds remaining in cooldown
    const fetchCooldownRef = useRef(null);

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

    // Field mapping (core: name/phone/email/city)
    const [fieldMapping, setFieldMapping] = useState({ name: '', phone: '', email: '', city: '' });
    const [lastRawFields, setLastRawFields] = useState([]);
    const [fieldMappingSaving, setFieldMappingSaving] = useState(false);

    // Custom question mapping (Meta raw field keys → CRM custom fields)
    const [customFieldMappings, setCustomFieldMappings] = useState([]); // [{ key, label, metaKey }]
    const [cfmRawFields, setCfmRawFields] = useState([]); // raw field keys from last Meta lead
    const [cfmSaving, setCfmSaving] = useState(false);
    const [cfmLoaded, setCfmLoaded] = useState(false);

    // Pulling field keys directly from the connected Meta form (no need to wait for a real lead)
    const [fetchingFormFields, setFetchingFormFields] = useState(false);
    const [formFieldLabels, setFormFieldLabels] = useState({}); // { metaKey: humanLabel }


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
        loadCustomFieldMapping();
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

    const startFetchCooldown = (seconds) => {
        setFetchCooldown(seconds);
        if (fetchCooldownRef.current) clearInterval(fetchCooldownRef.current);
        fetchCooldownRef.current = setInterval(() => {
            setFetchCooldown(prev => {
                if (prev <= 1) {
                    clearInterval(fetchCooldownRef.current);
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const handleFetchLeads = async () => {
        if (fetchCooldown > 0) return; // Guard: button should already be disabled
        if (!confirm('Fetch up to 200 recent leads from your connected Meta forms?')) return;
        setFetchingLeads(true);
        try {
            const res = await api.post('/meta/fetch-leads');
            const { created, skipped } = res.data;
            showSuccess(`Imported ${created ?? 0} lead${(created ?? 0) !== 1 ? 's' : ''}${skipped ? `, ${skipped} already existed` : ''}`);
            // Start 2-minute cooldown after a successful fetch
            startFetchCooldown(120);
        } catch (error) {
            const data = error.response?.data;
            if (data?.cooldown && data?.secondsLeft) {
                // Server told us exactly how many seconds are left
                startFetchCooldown(data.secondsLeft);
                showError(`Please wait ${data.secondsLeft}s before fetching again.`);
            } else {
                showError(data?.message || 'Failed to fetch leads');
            }
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

    const loadCustomFieldMapping = async () => {
        try {
            const res = await api.get('/meta/custom-field-mapping');
            setCustomFieldMappings(res.data.customFields || []);
            setCfmRawFields(res.data.lastRawFields || []);
            setCfmLoaded(true);
        } catch (e) {
            console.error('Failed to load custom field mapping:', e);
            showError('Failed to load custom field mapping');
            setCfmLoaded(true);
        }
    };

    const handleFetchFormFields = async () => {
        try {
            setFetchingFormFields(true);
            const res = await api.get('/meta/form-fields');
            const rawKeys = res.data.rawKeys || [];
            const labelMap = {};
            (res.data.fields || []).forEach(f => { labelMap[f.key] = f.label; });
            setLastRawFields(rawKeys);
            setCfmRawFields(rawKeys);
            setFormFieldLabels(labelMap);
            showSuccess(rawKeys.length > 0
                ? `Fetched ${rawKeys.length} field${rawKeys.length !== 1 ? 's' : ''} from your Meta form`
                : 'No fields found on this form yet');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to fetch fields from Meta form');
        } finally {
            setFetchingFormFields(false);
        }
    };

    // Saves both the core field mapping and the custom question mapping together,
    // since they're really the same concept (Meta field key -> CRM field) shown in one table.
    const handleSaveAllFieldMappings = async () => {
        try {
            setFieldMappingSaving(true);
            setCfmSaving(true);
            const calls = [api.post('/meta/field-mapping', fieldMapping)];
            if (customFieldMappings.length > 0) {
                const mappings = customFieldMappings.map(f => ({ fieldKey: f.key, metaKey: f.metaKey || null }));
                calls.push(api.post('/meta/custom-field-mapping', { mappings }));
            }
            await Promise.all(calls);
            showSuccess('Field mapping saved! New leads will use this mapping.');
        } catch (e) {
            showError('Failed to save field mapping');
        } finally {
            setFieldMappingSaving(false);
            setCfmSaving(false);
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
        // Core + custom mapping both read from the same "last lead" raw field keys
        const rawFields = lastRawFields.length > 0 ? lastRawFields : cfmRawFields;
        const CORE_FIELDS = [
            { key: 'name', label: 'Name', icon: 'fa-user', placeholder: 'e.g. full_name' },
            { key: 'phone', label: 'Phone', icon: 'fa-phone', placeholder: 'e.g. phone_number' },
            { key: 'email', label: 'Email', icon: 'fa-envelope', placeholder: 'e.g. email' },
            { key: 'city', label: 'City', icon: 'fa-location-dot', placeholder: 'e.g. city' },
        ];
        // Shows the human-readable question text next to the raw key when we have it
        // (only available after "Fetch Fields from Meta", not from a real lead payload)
        const fieldOptionLabel = (rawKey) => {
            const label = formFieldLabels[rawKey];
            return label && label !== rawKey ? `${label} (${rawKey})` : rawKey;
        };
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

                {/* Connected As — shows the Facebook user who linked the account */}
                {(status.connectedUserName || status.connectedUserPicture) && (
                    <div className="flex items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                        {status.connectedUserPicture ? (
                            <img
                                src={status.connectedUserPicture}
                                alt={status.connectedUserName || 'Facebook User'}
                                className="w-9 h-9 rounded-full object-cover"
                                referrerPolicy="no-referrer"
                            />
                        ) : (
                            <div className="w-9 h-9 bg-slate-200 rounded-full flex items-center justify-center">
                                <i className="fa-solid fa-user text-slate-500"></i>
                            </div>
                        )}
                        <p className="text-sm text-slate-600 truncate">
                            <i className="fa-brands fa-facebook text-blue-500 mr-1.5"></i>
                            Connected as <span className="font-semibold text-slate-800">{status.connectedUserName || 'Facebook User'}</span>
                        </p>
                    </div>
                )}

                {/* Lead Sync Section (Active or Setup) */}
                {status.syncEnabled && status.pageId ? (
                    // ACTIVE STATE
                    <div className="bg-white border border-slate-200 rounded-xl p-5">
                        <div className="flex items-center justify-between flex-wrap gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                                {status.pagePicture ? (
                                    <img src={status.pagePicture} alt={status.pageName} className="w-10 h-10 rounded-full object-cover shrink-0" />
                                ) : (
                                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center shrink-0">
                                        <i className="fa-solid fa-check text-green-600"></i>
                                    </div>
                                )}
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 truncate">{status.pageName}</p>
                                    <p className="text-xs text-slate-500 truncate">
                                        <span className="inline-flex items-center gap-1 text-green-600 font-medium mr-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>Syncing
                                        </span>
                                        {status.formName}
                                    </p>
                                </div>
                            </div>

                            <label className="relative inline-flex items-center cursor-pointer shrink-0">
                                <input
                                    type="checkbox"
                                    checked={status.syncEnabled}
                                    onChange={handleToggleSync}
                                    className="sr-only peer"
                                />
                                <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                            </label>
                        </div>

                        {status.lastSyncAt && (
                            <p className="text-xs text-slate-400 mt-3">
                                Last lead synced: {new Date(status.lastSyncAt).toLocaleString()}
                            </p>
                        )}

                        <div className="flex items-center gap-2 flex-wrap mt-4 pt-4 border-t border-slate-100">
                            <button
                                onClick={handleFetchLeads}
                                disabled={fetchingLeads || fetchCooldown > 0}
                                className={`px-4 py-2 rounded-lg border text-sm font-bold flex items-center gap-2 transition
                                    ${fetchCooldown > 0
                                        ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                        : 'text-green-700 hover:bg-green-50 border-green-200 disabled:opacity-50'
                                    }`}
                                title={fetchCooldown > 0 ? `Rate limit protection — wait ${fetchCooldown}s` : 'Import recent leads from your connected Meta form'}
                            >
                                <i className={`fa-solid ${fetchingLeads ? 'fa-spinner fa-spin' : fetchCooldown > 0 ? 'fa-clock' : 'fa-download'}`}></i>
                                {fetchingLeads ? 'Fetching...' : fetchCooldown > 0 ? `Wait ${fetchCooldown}s` : 'Fetch Leads'}
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
                ) : (
                    // SETUP STATE
                    <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                        <p className="text-sm text-slate-600">
                            Select your Facebook Page and Lead Form to start syncing leads.
                        </p>

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
                    </div>
                )}

                {/* Field Mapping — one table for both core fields (name/phone/email/city) and
                    custom CRM fields, since both are just "which Meta question answers this?" */}
                <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6">
                    <div className="flex items-start justify-between flex-wrap gap-3 mb-1">
                        <h4 className="font-bold text-slate-800 text-base flex items-center gap-2">
                            <i className="fa-solid fa-sliders text-blue-500"></i>
                            Field Mapping
                        </h4>
                        <button
                            onClick={handleFetchFormFields}
                            disabled={fetchingFormFields || !status.formId}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-300 disabled:cursor-not-allowed flex items-center gap-1.5"
                            title={!status.formId ? 'Select a specific Lead Form (not "Any Form") to use this' : 'Pull field keys directly from your connected Meta form'}
                        >
                            <i className={`fa-solid ${fetchingFormFields ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-down'}`}></i>
                            {fetchingFormFields ? 'Fetching...' : 'Fetch Fields from Meta'}
                        </button>
                    </div>
                    <p className="text-sm text-slate-500 mb-5">
                        Match each CRM field to the question in your Meta lead form that answers it.
                        {rawFields.length > 0
                            ? <> Available fields: <span className="font-mono text-slate-700">{rawFields.join(', ')}</span></>
                            : <> Click "Fetch Fields from Meta" above, or wait for your first lead — either will fill in the choices below.</>}
                    </p>

                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Standard Fields</p>
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden mb-5">
                        {CORE_FIELDS.map(({ key, label, icon, placeholder }) => (
                            <div key={key} className="flex items-center gap-4 px-4 py-3 bg-white">
                                <div className="w-32 shrink-0 flex items-center gap-2 text-sm font-semibold text-slate-700">
                                    <i className={`fa-solid ${icon} text-slate-400 w-4 text-center`}></i>{label}
                                </div>
                                {rawFields.length > 0 ? (
                                    <select
                                        value={fieldMapping[key] || ''}
                                        onChange={e => setFieldMapping(prev => ({ ...prev, [key]: e.target.value }))}
                                        className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-400 outline-none"
                                    >
                                        <option value="">— Auto-detect —</option>
                                        {rawFields.map(f => (
                                            <option key={f} value={f}>{fieldOptionLabel(f)}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        value={fieldMapping[key] || ''}
                                        onChange={e => setFieldMapping(prev => ({ ...prev, [key]: e.target.value }))}
                                        placeholder={placeholder}
                                        className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none"
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Custom Fields</p>
                        <button
                            onClick={loadCustomFieldMapping}
                            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                            title="Refresh — picks up custom fields created in Settings → Custom Fields"
                        >
                            <i className="fa-solid fa-rotate-right"></i> Refresh
                        </button>
                    </div>
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 overflow-hidden">
                        {!cfmLoaded ? (
                            <div className="flex items-center gap-2 text-slate-400 text-sm px-4 py-3">
                                <i className="fa-solid fa-spinner fa-spin"></i> Loading custom fields...
                            </div>
                        ) : customFieldMappings.length === 0 ? (
                            <p className="text-sm text-slate-400 px-4 py-3">
                                No custom CRM fields yet — create some in <strong>Settings → Custom Fields</strong>, then hit Refresh above to map them here.
                            </p>
                        ) : customFieldMappings.map((field, idx) => (
                            <div key={field.key} className="flex items-center gap-4 px-4 py-3 bg-white">
                                <div className="w-32 shrink-0 min-w-0">
                                    <p className="text-sm font-semibold text-slate-700 truncate">{field.label}</p>
                                </div>
                                {rawFields.length > 0 ? (
                                    <select
                                        value={field.metaKey || ''}
                                        onChange={e => setCustomFieldMappings(prev =>
                                            prev.map((f, i) => i === idx ? { ...f, metaKey: e.target.value || null } : f)
                                        )}
                                        className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-400 outline-none"
                                    >
                                        <option value="">— Not mapped —</option>
                                        {rawFields.map(f => (
                                            <option key={f} value={f}>{fieldOptionLabel(f)}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        value={field.metaKey || ''}
                                        onChange={e => setCustomFieldMappings(prev =>
                                            prev.map((f, i) => i === idx ? { ...f, metaKey: e.target.value || null } : f)
                                        )}
                                        placeholder="e.g. your_business_name_"
                                        className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-400 outline-none"
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={handleSaveAllFieldMappings}
                        disabled={fieldMappingSaving || cfmSaving}
                        className="mt-5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-bold text-sm transition flex items-center gap-2"
                    >
                        <i className={`fa-solid ${(fieldMappingSaving || cfmSaving) ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                        {(fieldMappingSaving || cfmSaving) ? 'Saving...' : 'Save Field Mapping'}
                    </button>
                </div>

                {/* Meta Conversion API Settings (Always Visible when connected) */}
                <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6">
                    <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <i className="fa-solid fa-chart-line text-purple-500"></i>
                        Meta Conversion API <span className="text-slate-400 font-normal">— track lead quality</span>
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
                        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
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

                {/* ── Lead Drop Log ── */}
                <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6" id="meta-lead-drop-log">
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
