/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// Default CRM fields — user can toggle these on/off and set required
const DEFAULT_CRM_FIELDS = [
    { key: 'name',  label: 'Name',         enabled: true, required: false },
    { key: 'phone', label: 'Phone',         enabled: true, required: false },
    { key: 'email', label: 'Email',         enabled: true, required: false },
    { key: 'source', label: 'Source',       enabled: false, required: false },
    { key: 'status', label: 'Status/Stage', enabled: false, required: false },
];

const SheetSyncSettings = () => {
    const { showSuccess, showError, showInfo } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Google auth state
    const [googleConnected, setGoogleConnected] = useState(false);
    const [googleAccessToken, setGoogleAccessToken] = useState(null);
    const [sheetsLoading, setSheetsLoading] = useState(false);
    const [sheetsList, setSheetsList] = useState([]);

    // Config state
    const [selectedSheet, setSelectedSheet] = useState(null);
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState(null);

    // Field mapping
    const [sheetHeaders, setSheetHeaders] = useState([]);
    const [headersLoading, setHeadersLoading] = useState(false);
    const [fieldMapping, setFieldMapping] = useState({});
    const [customFields, setCustomFields] = useState([]);

    // Dynamic field selection — replaces hardcoded CORE_FIELDS
    const [selectedFields, setSelectedFields] = useState([]);

    // Status
    const [lastPushAt, setLastPushAt] = useState(null);
    const [lastPushStatus, setLastPushStatus] = useState(null);
    const [totalPushes, setTotalPushes] = useState(0);

    // UI state
    const [showScript, setShowScript] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showFieldPicker, setShowFieldPicker] = useState(false);

    useEffect(() => { fetchConfig(); }, []);

    // Build the master list of available fields (default + custom)
    const buildAvailableFields = useCallback((cfDefs, existingSelection) => {
        // Start with default fields
        const allDefaults = DEFAULT_CRM_FIELDS.map(f => ({ ...f }));

        // Add custom field definitions
        const cfFields = (cfDefs || []).map(cf => ({
            key: cf.key,
            label: cf.label,
            enabled: false,
            required: false,
            isCustom: true
        }));

        const masterList = [...allDefaults, ...cfFields];

        // If we have a saved selection, merge enabled/required state
        if (existingSelection && existingSelection.length > 0) {
            const savedMap = {};
            existingSelection.forEach(sf => { savedMap[sf.key] = sf; });

            return masterList.map(f => ({
                ...f,
                enabled: savedMap[f.key]?.enabled ?? f.enabled,
                required: savedMap[f.key]?.required ?? f.required
            }));
        }

        return masterList;
    }, []);

    const fetchConfig = async () => {
        try {
            setLoading(true);
            const [configRes, cfRes] = await Promise.all([
                api.get('/leads/sheet-sync-config'),
                api.get('/custom-fields')
            ]);
            const config = configRes.data.googleSheetSync || {};
            const cfDefs = Array.isArray(cfRes.data) ? cfRes.data : [];
            setCustomFields(cfDefs);

            if (config.sheetId) {
                setSelectedSheet({ id: config.sheetId, name: config.sheetName || 'Unknown Sheet' });
            }
            setSyncEnabled(config.syncEnabled || false);
            setFieldMapping(config.fieldMapping || {});
            setSheetHeaders(config.sheetHeaders || []);
            setLastPushAt(config.lastPushAt || null);
            setLastPushStatus(config.lastPushStatus || null);
            setTotalPushes(config.totalPushes || 0);
            setWebhookUrl(configRes.data.webhookUrl || null);

            // Build selected fields from saved config or defaults
            setSelectedFields(buildAvailableFields(cfDefs, config.selectedFields || []));
        } catch (err) {
            showError('Failed to load sync configuration');
        } finally {
            setLoading(false);
        }
    };

    // Fetch custom field definitions for this workspace (backup/refresh)
    useEffect(() => {
        if (customFields.length === 0) {
            api.get('/custom-fields')
                .then(res => {
                    const cfDefs = Array.isArray(res.data) ? res.data : [];
                    setCustomFields(cfDefs);
                })
                .catch((err) => { console.error('Failed to load custom fields:', err.message); });
        }
    }, []);

    // Google Login — needs drive + spreadsheets read scope
    const googleLogin = useGoogleLogin({
        onSuccess: async (tokenResponse) => {
            setGoogleAccessToken(tokenResponse.access_token);
            setGoogleConnected(true);
            showSuccess('Connected to Google!');
            await fetchSheetsList(tokenResponse.access_token);
        },
        onError: () => showError('Failed to connect to Google'),
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly'
    });

    const fetchSheetsList = async (token) => {
        setSheetsLoading(true);
        try {
            const res = await api.post('/leads/google-sheets-list', { accessToken: token });
            setSheetsList(res.data.sheets || []);
            if (res.data.sheets.length === 0) showInfo('No Google Sheets found');
        } catch (err) {
            if (err.response?.status === 401) {
                showError('Google session expired. Please reconnect.');
                setGoogleConnected(false);
                setGoogleAccessToken(null);
            } else {
                showError('Failed to load Google Sheets');
            }
        } finally {
            setSheetsLoading(false);
        }
    };

    // When a sheet is selected, fetch its column headers
    const handleSelectSheet = async (sheet) => {
        setSelectedSheet(sheet);
        setFieldMapping({});
        setSheetHeaders([]);

        if (!googleAccessToken) return;
        setHeadersLoading(true);
        try {
            const res = await api.post('/leads/sheet-headers', {
                accessToken: googleAccessToken,
                sheetId: sheet.id
            });
            setSheetHeaders(res.data.headers || []);
        } catch (err) {
            showError(err.response?.data?.message || 'Could not read sheet headers. Make sure row 1 has column names.');
        } finally {
            setHeadersLoading(false);
        }
    };

    const handleMappingChange = (crmKey, sheetCol) => {
        setFieldMapping(prev => ({ ...prev, [crmKey]: sheetCol }));
    };

    // Toggle a field enabled/disabled
    const handleFieldToggle = (key) => {
        setSelectedFields(prev => prev.map(f =>
            f.key === key ? { ...f, enabled: !f.enabled, required: !f.enabled ? f.required : false } : f
        ));
        // If disabling, also remove its mapping
        setFieldMapping(prev => {
            const next = { ...prev };
            const field = selectedFields.find(f => f.key === key);
            if (field?.enabled) delete next[key]; // was enabled, now disabling
            return next;
        });
    };

    // Toggle required flag for a field
    const handleFieldRequired = (key) => {
        setSelectedFields(prev => prev.map(f =>
            f.key === key && f.enabled ? { ...f, required: !f.required } : f
        ));
    };

    // Only enabled fields participate in mapping
    const enabledFields = selectedFields.filter(f => f.enabled);
    const requiredFields = enabledFields.filter(f => f.required);

    // Mapping is complete if all user-marked-required fields have a mapping
    const mappingComplete = enabledFields.length > 0 &&
        requiredFields.every(f => fieldMapping[f.key]);

    // Save configuration + field mapping + selected fields
    const handleSave = async () => {
        if (!selectedSheet) { showError('Please select a Google Sheet first'); return; }
        if (enabledFields.length === 0) { showError('Please enable at least one field for sync'); return; }
        if (!mappingComplete) {
            const missing = requiredFields.filter(f => !fieldMapping[f.key]).map(f => f.label);
            showError(`Please map required fields: ${missing.join(', ')}`);
            return;
        }
        setSaving(true);
        try {
            const res = await api.put('/leads/sheet-sync-config', {
                sheetId: selectedSheet.id,
                sheetName: selectedSheet.name,
                sheetUrl: `https://docs.google.com/spreadsheets/d/${selectedSheet.id}`,
                syncEnabled: true,
                fieldMapping,
                sheetHeaders,
                selectedFields: selectedFields.map(f => ({
                    key: f.key,
                    label: f.label,
                    enabled: f.enabled,
                    required: f.required,
                    isCustom: f.isCustom || false
                }))
            });
            setSyncEnabled(true);
            setWebhookUrl(res.data.webhookUrl || null);
            showSuccess('Google Sheet Push Sync enabled!');
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleDisable = async () => {
        setSaving(true);
        try {
            await api.put('/leads/sheet-sync-config', { syncEnabled: false });
            setSyncEnabled(false);
            setWebhookUrl(null);
            showSuccess('Sync disabled');
        } catch (err) {
            showError('Failed to disable sync');
        } finally {
            setSaving(false);
        }
    };

    const getAppsScript = useCallback(() => {
        if (!webhookUrl) return '';
        return `// CRM Auto-Push Script
// Extensions → Apps Script → Paste → Save

const CRM_WEBHOOK_URL = "${webhookUrl}";

function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  if (range.getRow() <= 1) return;
  
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const rowData = sheet.getRange(range.getRow(), 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const row = {};
  headers.forEach((header, i) => {
    if (header && rowData[i] !== '') {
      row[header.toString().trim()] = rowData[i].toString().trim();
    }
  });
  
  if (Object.keys(row).length === 0) return;
  
  try {
    UrlFetchApp.fetch(CRM_WEBHOOK_URL, {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify({ rows: [row], sheetName: sheet.getName() }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error("CRM Push failed:", err);
  }
}

// After pasting: Triggers (⏰) → Add Trigger → onEdit → From spreadsheet → On edit
`;
    }, [webhookUrl]);

    const handleCopy = () => {
        navigator.clipboard.writeText(getAppsScript());
        setCopied(true);
        showSuccess('Copied to clipboard!');
        setTimeout(() => setCopied(false), 3000);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-emerald-500 animate-spin"></div>
                <span className="ml-4 text-slate-500 font-medium">Loading sync settings...</span>
            </div>
        );
    }

    return (
        <div>
            {/* Header */}
            <div className="p-6 border-b border-slate-100">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                        <i className="fa-solid fa-bolt text-white text-lg"></i>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-slate-800">Google Sheet Push Sync</h2>
                        <p className="text-sm text-slate-500">Instant lead import — zero server polling cost</p>
                    </div>
                </div>
            </div>

            <div className="p-6 space-y-6">
                {/* Active Status Banner */}
                {syncEnabled && selectedSheet && (
                    <div className="relative overflow-hidden rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 p-5 text-white">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-1/2 translate-x-1/2"></div>
                        <div className="relative z-10">
                            <div className="flex items-center gap-2 mb-1">
                                <i className="fa-solid fa-circle-check text-emerald-200"></i>
                                <span className="font-bold text-emerald-100 text-sm">PUSH SYNC ACTIVE</span>
                            </div>
                            <p className="text-white font-semibold text-lg">{selectedSheet.name}</p>
                            <div className="flex items-center gap-4 mt-2 text-sm text-emerald-100 flex-wrap">
                                {lastPushAt && <span><i className="fa-solid fa-clock mr-1"></i> Last push: {new Date(lastPushAt).toLocaleString()}</span>}
                                {totalPushes > 0 && <span><i className="fa-solid fa-arrow-down mr-1"></i> {totalPushes} push{totalPushes !== 1 ? 'es' : ''}</span>}
                                <span><i className="fa-solid fa-list-check mr-1"></i> {enabledFields.length} field{enabledFields.length !== 1 ? 's' : ''} mapped</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* STEP 1: Connect Google */}
                <div className="space-y-3">
                    <div className="flex items-center gap-2">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${googleConnected || syncEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                            {googleConnected || syncEnabled ? <i className="fa-solid fa-check"></i> : '1'}
                        </div>
                        <h3 className="font-semibold text-slate-700">Connect Google Account</h3>
                    </div>

                    {!googleConnected && !syncEnabled ? (
                        <button onClick={() => googleLogin()} className="w-full flex items-center justify-center gap-3 py-3.5 px-6 bg-white border-2 border-slate-200 rounded-xl hover:border-blue-400 hover:shadow-lg hover:shadow-blue-500/10 transition-all duration-300 group">
                            <svg className="w-5 h-5" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            <span className="font-semibold text-slate-700 group-hover:text-blue-600 transition">Sign in with Google</span>
                        </button>
                    ) : (
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                            <i className="fa-solid fa-circle-check text-emerald-500"></i>
                            <span className="text-sm font-medium text-emerald-700">Google account connected</span>
                            {!syncEnabled && (
                                <button onClick={() => { setGoogleConnected(false); setGoogleAccessToken(null); setSheetsList([]); setSelectedSheet(null); setSheetHeaders([]); setFieldMapping({}); }} className="ml-auto text-xs text-slate-400 hover:text-red-500 transition">
                                    Disconnect
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* STEP 2: Select Sheet */}
                {(googleConnected || syncEnabled) && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${selectedSheet ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                {selectedSheet ? <i className="fa-solid fa-check"></i> : '2'}
                            </div>
                            <h3 className="font-semibold text-slate-700">Select Google Sheet</h3>
                        </div>

                        {sheetsLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="w-8 h-8 rounded-full border-3 border-slate-200 border-t-blue-500 animate-spin"></div>
                                <span className="ml-3 text-sm text-slate-500">Loading your sheets...</span>
                            </div>
                        ) : sheetsList.length > 0 ? (
                            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                                {sheetsList.map((sheet) => (
                                    <button key={sheet.id} onClick={() => handleSelectSheet(sheet)}
                                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all duration-200 text-left ${selectedSheet?.id === sheet.id ? 'border-emerald-500 bg-emerald-50 shadow-md shadow-emerald-500/10' : 'border-slate-100 bg-white hover:border-slate-300 hover:shadow-sm'}`}
                                    >
                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${selectedSheet?.id === sheet.id ? 'bg-emerald-500 text-white' : 'bg-emerald-50 text-emerald-600'}`}>
                                            <i className="fa-solid fa-table text-sm"></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`font-semibold truncate text-sm ${selectedSheet?.id === sheet.id ? 'text-emerald-700' : 'text-slate-700'}`}>{sheet.name}</p>
                                            {sheet.modifiedTime && <p className="text-xs text-slate-400 mt-0.5">Modified {new Date(sheet.modifiedTime).toLocaleDateString()}</p>}
                                        </div>
                                        {selectedSheet?.id === sheet.id && <i className="fa-solid fa-circle-check text-emerald-500 text-lg"></i>}
                                    </button>
                                ))}
                            </div>
                        ) : googleConnected && !sheetsLoading ? (
                            <div className="text-center py-8 text-slate-400">
                                <i className="fa-solid fa-file-excel text-3xl mb-2"></i>
                                <p className="text-sm">No spreadsheets found in your Google account</p>
                            </div>
                        ) : selectedSheet && syncEnabled ? (
                            <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                                <div className="w-9 h-9 rounded-lg bg-emerald-500 text-white flex items-center justify-center">
                                    <i className="fa-solid fa-table text-sm"></i>
                                </div>
                                <div className="flex-1">
                                    <p className="font-semibold text-emerald-700 text-sm">{selectedSheet.name}</p>
                                    <p className="text-xs text-emerald-500">Currently connected</p>
                                </div>
                                <button onClick={() => googleLogin()} className="text-xs text-slate-500 hover:text-blue-600 font-medium transition">Change</button>
                            </div>
                        ) : null}

                        {headersLoading && (
                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                <div className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-blue-500 animate-spin"></div>
                                Reading column headers from sheet...
                            </div>
                        )}
                    </div>
                )}

                {/* STEP 3: Choose Which Fields to Sync */}
                {selectedSheet && (sheetHeaders.length > 0 || syncEnabled) && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${enabledFields.length > 0 ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                {enabledFields.length > 0 ? <i className="fa-solid fa-check"></i> : '3'}
                            </div>
                            <h3 className="font-semibold text-slate-700">Choose Fields to Sync</h3>
                            <button
                                onClick={() => setShowFieldPicker(!showFieldPicker)}
                                className="ml-auto text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1 transition"
                            >
                                <i className={`fa-solid fa-${showFieldPicker ? 'chevron-up' : 'sliders'} text-[10px]`}></i>
                                {showFieldPicker ? 'Collapse' : 'Configure Fields'}
                            </button>
                        </div>

                        {/* Quick summary of enabled fields */}
                        {!showFieldPicker && enabledFields.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                                {enabledFields.map(f => (
                                    <span key={f.key} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
                                        f.required
                                            ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                                            : 'bg-slate-100 text-slate-600 border border-slate-200'
                                    }`}>
                                        {f.required && <i className="fa-solid fa-asterisk text-[8px] text-red-400"></i>}
                                        {f.label}
                                        {f.isCustom && <i className="fa-solid fa-star text-[8px] text-purple-400 ml-0.5"></i>}
                                    </span>
                                ))}
                                <button
                                    onClick={() => setShowFieldPicker(true)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 transition"
                                >
                                    <i className="fa-solid fa-pen text-[8px]"></i> Edit
                                </button>
                            </div>
                        )}

                        {/* Field picker panel */}
                        {showFieldPicker && (
                            <div className="bg-white rounded-xl border-2 border-blue-200 shadow-lg shadow-blue-500/5 overflow-hidden">
                                <div className="px-4 py-3 bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100">
                                    <p className="text-xs font-bold text-blue-800 flex items-center gap-1.5">
                                        <i className="fa-solid fa-sliders text-blue-500"></i>
                                        Toggle fields ON/OFF and mark which are Required
                                    </p>
                                    <p className="text-[11px] text-blue-600 mt-0.5">Only enabled fields will appear in the column mapping below</p>
                                </div>

                                <div className="divide-y divide-slate-100">
                                    {selectedFields.map((field) => (
                                        <div key={field.key} className={`flex items-center gap-3 px-4 py-3 transition-colors ${field.enabled ? 'bg-white' : 'bg-slate-50/80'}`}>
                                            {/* Toggle ON/OFF */}
                                            <button
                                                onClick={() => handleFieldToggle(field.key)}
                                                className={`relative w-10 h-[22px] rounded-full transition-all duration-300 flex-shrink-0 ${
                                                    field.enabled
                                                        ? 'bg-emerald-500 shadow-inner shadow-emerald-600/30'
                                                        : 'bg-slate-300 shadow-inner shadow-slate-400/20'
                                                }`}
                                            >
                                                <div className={`absolute top-[2px] w-[18px] h-[18px] bg-white rounded-full shadow-md transition-all duration-300 ${
                                                    field.enabled ? 'left-[20px]' : 'left-[2px]'
                                                }`}></div>
                                            </button>

                                            {/* Field name */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-sm font-medium ${field.enabled ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                                                        {field.label}
                                                    </span>
                                                    {field.isCustom && (
                                                        <span className="text-[10px] font-bold text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded">Custom</span>
                                                    )}
                                                </div>
                                                <p className="text-[11px] text-slate-400">
                                                    key: <code className="bg-slate-100 px-1 rounded text-[10px]">{field.key}</code>
                                                </p>
                                            </div>

                                            {/* Required toggle */}
                                            {field.enabled && (
                                                <button
                                                    onClick={() => handleFieldRequired(field.key)}
                                                    className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all border ${
                                                        field.required
                                                            ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                                                            : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100 hover:text-slate-600'
                                                    }`}
                                                >
                                                    <i className={`fa-solid fa-asterisk text-[8px] ${field.required ? 'text-red-500' : 'text-slate-300'}`}></i>
                                                    {field.required ? 'Required' : 'Optional'}
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                                    <span className="text-xs text-slate-500">
                                        <strong className="text-emerald-600">{enabledFields.length}</strong> field{enabledFields.length !== 1 ? 's' : ''} enabled
                                        {requiredFields.length > 0 && <> · <strong className="text-red-500">{requiredFields.length}</strong> required</>}
                                    </span>
                                    <button
                                        onClick={() => setShowFieldPicker(false)}
                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* STEP 4: Map Fields to Sheet Columns */}
                {selectedSheet && enabledFields.length > 0 && (sheetHeaders.length > 0 || syncEnabled) && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${mappingComplete ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                {mappingComplete ? <i className="fa-solid fa-check"></i> : '4'}
                            </div>
                            <h3 className="font-semibold text-slate-700">Map Sheet Columns to CRM Fields</h3>
                        </div>

                        <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                            {/* Table header */}
                            <div className="grid grid-cols-2 gap-4 px-4 py-2 bg-slate-100 border-b border-slate-200">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">CRM Field</span>
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">Sheet Column</span>
                            </div>

                            <div className="divide-y divide-slate-100">
                                {enabledFields.map((field) => (
                                    <div key={field.key} className="grid grid-cols-2 gap-4 px-4 py-3 items-center">
                                        <div className="flex items-center gap-2">
                                            <span className={`text-sm font-medium ${field.required ? 'text-slate-800' : 'text-slate-600'}`}>
                                                {field.label}
                                            </span>
                                            {field.required && (
                                                <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">Required</span>
                                            )}
                                            {field.isCustom && (
                                                <span className="text-[10px] font-bold text-purple-500 bg-purple-50 px-1.5 py-0.5 rounded">Custom</span>
                                            )}
                                        </div>
                                        <select
                                            value={fieldMapping[field.key] || ''}
                                            onChange={e => handleMappingChange(field.key, e.target.value)}
                                            disabled={syncEnabled && sheetHeaders.length === 0}
                                            className={`text-sm border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 transition ${
                                                fieldMapping[field.key]
                                                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                                    : 'border-slate-200 bg-white text-slate-600'
                                            } ${field.required && !fieldMapping[field.key] ? 'border-red-200' : ''}`}
                                        >
                                            <option value="">— Not mapped —</option>
                                            {sheetHeaders.length > 0
                                                ? sheetHeaders.map(h => (
                                                    <option key={h} value={h}>{h}</option>
                                                ))
                                                : fieldMapping[field.key]
                                                    ? <option value={fieldMapping[field.key]}>{fieldMapping[field.key]}</option>
                                                    : null
                                            }
                                        </select>
                                    </div>
                                ))}
                            </div>

                            {sheetHeaders.length === 0 && !syncEnabled && (
                                <div className="px-4 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 flex items-center gap-2">
                                    <i className="fa-solid fa-triangle-exclamation"></i>
                                    Select a sheet above to load its column headers for mapping
                                </div>
                            )}
                            {sheetHeaders.length > 0 && (
                                <div className="px-4 py-3 bg-blue-50 border-t border-blue-100 text-xs text-blue-600 flex items-center gap-2">
                                    <i className="fa-solid fa-circle-info"></i>
                                    {sheetHeaders.length} column{sheetHeaders.length !== 1 ? 's' : ''} detected from your sheet. Unmapped fields will be skipped.
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* STEP 5: Enable & Script */}
                {selectedSheet && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${syncEnabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'}`}>
                                {syncEnabled ? <i className="fa-solid fa-check"></i> : '5'}
                            </div>
                            <h3 className="font-semibold text-slate-700">Setup Auto-Push</h3>
                        </div>

                        {!syncEnabled ? (
                            <button onClick={handleSave} disabled={saving || !mappingComplete || enabledFields.length === 0}
                                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white py-3.5 rounded-xl font-bold shadow-lg shadow-emerald-500/25 transition-all duration-300 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Enabling...</> : <><i className="fa-solid fa-bolt"></i> Enable Push Sync</>}
                            </button>
                        ) : (
                            <>
                                {/* Update mapping button when already enabled */}
                                {sheetHeaders.length > 0 && (
                                    <button onClick={handleSave} disabled={saving}
                                        className="w-full bg-white border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50 py-2.5 rounded-xl font-semibold transition flex items-center justify-center gap-2 text-sm"
                                    >
                                        {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</> : <><i className="fa-solid fa-floppy-disk"></i> Save Updated Mapping</>}
                                    </button>
                                )}

                                {/* Apps Script Section */}
                                <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl overflow-hidden">
                                    <button onClick={() => setShowScript(!showScript)} className="w-full flex items-center justify-between px-5 py-4 text-white hover:bg-white/5 transition">
                                        <div className="flex items-center gap-3">
                                            <i className="fa-solid fa-code text-amber-400"></i>
                                            <span className="font-semibold">Setup Script (One-Time)</span>
                                        </div>
                                        <i className={`fa-solid fa-chevron-${showScript ? 'up' : 'down'} text-slate-400 text-sm`}></i>
                                    </button>

                                    {showScript && (
                                        <div className="px-5 pb-5 space-y-4">
                                            <div className="space-y-2">
                                                {[
                                                    'Open your Google Sheet → Extensions → Apps Script',
                                                    'Delete existing code and paste the script below',
                                                    'Click the clock icon (Triggers) → Add Trigger → onEdit → From spreadsheet → On edit'
                                                ].map((step, i) => (
                                                    <div key={i} className="flex items-start gap-3 text-sm">
                                                        <span className="w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">{i + 1}</span>
                                                        <p className="text-slate-300">{step}</p>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="relative">
                                                <button onClick={handleCopy} className={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${copied ? 'bg-emerald-500 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>
                                                    {copied ? <><i className="fa-solid fa-check mr-1"></i>Copied!</> : <><i className="fa-solid fa-copy mr-1"></i>Copy</>}
                                                </button>
                                                <pre className="bg-black/40 rounded-xl p-4 text-xs text-emerald-300 overflow-x-auto max-h-64 overflow-y-auto font-mono leading-relaxed">
                                                    {getAppsScript()}
                                                </pre>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <button onClick={handleDisable} disabled={saving} className="w-full py-2.5 text-sm font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-xl border border-slate-200 hover:border-red-200 transition-all">
                                    <i className="fa-solid fa-power-off mr-2"></i>Disable Push Sync
                                </button>
                            </>
                        )}
                    </div>
                )}

                {/* Quick Setup Guide */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <h4 className="text-xs font-bold text-slate-700 mb-2.5 flex items-center gap-1.5">
                        <i className="fa-solid fa-book text-blue-500"></i>
                        Quick Setup Guide
                    </h4>
                    <ul className="text-xs text-slate-600 space-y-1.5">
                        <li className="flex items-start gap-2"><span className="font-bold text-slate-400 mt-0.5">1.</span><span>Connect your Google account and select your spreadsheet.</span></li>
                        <li className="flex items-start gap-2"><span className="font-bold text-slate-400 mt-0.5">2.</span><span><strong>Choose which fields</strong> to sync — toggle ON/OFF and set required.</span></li>
                        <li className="flex items-start gap-2"><span className="font-bold text-slate-400 mt-0.5">3.</span><span>Map your sheet columns to the enabled CRM fields.</span></li>
                        <li className="flex items-start gap-2"><span className="font-bold text-slate-400 mt-0.5">4.</span><span>Click "Enable Push Sync" and copy the generated setup script.</span></li>
                        <li className="flex items-start gap-2"><span className="font-bold text-slate-400 mt-0.5">5.</span><span>In your Google Sheet, go to Extensions → Apps Script, paste the code, and set an <code>onEdit</code> trigger.</span></li>
                    </ul>
                    <div className="mt-3 pt-3 border-t border-slate-200">
                        <a href="https://adfliker.com/" target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 inline-flex">
                            <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                            Click here for the full step-by-step setup guide
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SheetSyncSettings;
