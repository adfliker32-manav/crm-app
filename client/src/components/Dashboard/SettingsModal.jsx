import React, { useState, useEffect, useCallback } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// Core CRM fields that can be mapped to Google Sheet columns
const CORE_CRM_FIELDS = [
    { key: 'name',   label: 'Name',   required: true,  icon: 'fa-user' },
    { key: 'phone',  label: 'Phone',  required: true,  icon: 'fa-phone' },
    { key: 'email',  label: 'Email',  required: false, icon: 'fa-envelope' },
    { key: 'source', label: 'Source', required: false, icon: 'fa-share-nodes' },
    { key: 'status', label: 'Status', required: false, icon: 'fa-flag' },
];

const SettingsModal = ({ isOpen, onClose, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [configLoading, setConfigLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Google auth
    const [googleConnected, setGoogleConnected] = useState(false);
    const [googleAccessToken, setGoogleAccessToken] = useState(null);
    const [sheetsLoading, setSheetsLoading] = useState(false);
    const [sheetsList, setSheetsList] = useState([]);

    // Config state
    const [selectedSheet, setSelectedSheet] = useState(null);
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [webhookUrl, setWebhookUrl] = useState(null);

    // Status
    const [lastPushAt, setLastPushAt] = useState(null);
    const [lastPushStatus, setLastPushStatus] = useState(null);
    const [totalPushes, setTotalPushes] = useState(0);

    // Field mapping state
    const [sheetHeaders, setSheetHeaders] = useState([]);
    const [headersLoading, setHeadersLoading] = useState(false);
    const [customFields, setCustomFields] = useState([]);
    const [fieldMapping, setFieldMapping] = useState({});
    const [existingFieldMapping, setExistingFieldMapping] = useState(null);

    // UI state
    const [showScript, setShowScript] = useState(false);
    const [copied, setCopied] = useState(false);
    const [mappingStep, setMappingStep] = useState(false);

    // Load config on open
    useEffect(() => {
        if (isOpen) {
            fetchConfig();
            fetchCustomFields();
        }
    }, [isOpen]);

    const fetchConfig = async () => {
        try {
            setConfigLoading(true);
            const res = await api.get('/leads/sheet-sync-config');
            const config = res.data.googleSheetSync || {};
            if (config.sheetId) {
                setSelectedSheet({ id: config.sheetId, name: config.sheetName || 'Unknown Sheet' });
            }
            setSyncEnabled(config.syncEnabled || false);
            setLastPushAt(config.lastPushAt || null);
            setLastPushStatus(config.lastPushStatus || null);
            setTotalPushes(config.totalPushes || 0);
            setWebhookUrl(res.data.webhookUrl || null);
            if (config.fieldMapping && Object.keys(config.fieldMapping).length > 0) {
                setFieldMapping(config.fieldMapping);
                setExistingFieldMapping(config.fieldMapping);
            }
            if (config.sheetHeaders && config.sheetHeaders.length > 0) {
                setSheetHeaders(config.sheetHeaders);
            }
        } catch (err) {
            console.error('Failed to load sync config:', err);
        } finally {
            setConfigLoading(false);
        }
    };

    const fetchCustomFields = async () => {
        try {
            const res = await api.get('/custom-fields');
            setCustomFields(res.data || []);
        } catch (err) {
            console.error('Failed to load custom fields:', err);
        }
    };

    // Google Login
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
        } catch (err) {
            showError('Failed to load Google Sheets');
        } finally {
            setSheetsLoading(false);
        }
    };

    const fetchHeaders = async (sheetId) => {
        if (!googleAccessToken) return;
        setHeadersLoading(true);
        try {
            const res = await api.post('/leads/sheet-headers', {
                accessToken: googleAccessToken,
                sheetId
            });
            const headers = res.data.headers || [];
            setSheetHeaders(headers);
            // Auto-map fields that match header names (case-insensitive)
            const autoMapping = {};
            CORE_CRM_FIELDS.forEach(f => {
                const match = headers.find(h => h.toLowerCase() === f.label.toLowerCase());
                if (match) autoMapping[f.key] = match;
            });
            // Also try to auto-map custom fields
            customFields.forEach(cf => {
                const match = headers.find(h => h.toLowerCase() === cf.label.toLowerCase());
                if (match) autoMapping[cf.key] = match;
            });
            setFieldMapping(autoMapping);
            setMappingStep(true);
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to fetch sheet headers');
        } finally {
            setHeadersLoading(false);
        }
    };

    const handleSelectSheet = async (sheet) => {
        setSelectedSheet(sheet);
        setMappingStep(false);
        setSheetHeaders([]);
        setFieldMapping({});
        await fetchHeaders(sheet.id);
    };

    const handleFieldMappingChange = (fieldKey, headerValue) => {
        setFieldMapping(prev => {
            const updated = { ...prev };
            if (headerValue === '') {
                delete updated[fieldKey];
            } else {
                updated[fieldKey] = headerValue;
            }
            return updated;
        });
    };

    const isMappingValid = () => {
        return CORE_CRM_FIELDS
            .filter(f => f.required)
            .every(f => fieldMapping[f.key] && fieldMapping[f.key].trim() !== '');
    };

    const handleSave = async () => {
        if (!selectedSheet) { showError('Please select a sheet'); return; }
        if (!isMappingValid()) {
            showError('Name and Phone mappings are required');
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
                sheetHeaders
            });
            setSyncEnabled(true);
            setWebhookUrl(res.data.webhookUrl || null);
            setExistingFieldMapping(fieldMapping);
            showSuccess('Push Sync enabled with field mapping!');
            if (onSuccess) onSuccess();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    const handleUpdateMapping = async () => {
        if (!isMappingValid()) {
            showError('Name and Phone mappings are required');
            return;
        }
        setSaving(true);
        try {
            await api.put('/leads/sheet-sync-config', {
                fieldMapping,
                sheetHeaders
            });
            setExistingFieldMapping(fieldMapping);
            showSuccess('Field mapping updated!');
        } catch (err) {
            showError('Failed to update mapping');
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
            showError('Failed to disable');
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
      payload: JSON.stringify({
        rows: [row],
        sheetName: sheet.getName()
      }),
      muteHttpExceptions: true
    });
  } catch (err) {
    console.error("CRM Push failed:", err);
  }
}

// After pasting: Click Triggers (clock icon)
// → Add Trigger → onEdit → From spreadsheet → On edit
`;
    }, [webhookUrl]);

    const handleCopy = () => {
        navigator.clipboard.writeText(getAppsScript());
        setCopied(true);
        showSuccess('Copied!');
        setTimeout(() => setCopied(false), 3000);
    };

    // Build the full list of mappable fields (core + custom)
    const allMappableFields = [
        ...CORE_CRM_FIELDS,
        ...customFields.map(cf => ({
            key: cf.key,
            label: cf.label || cf.key,
            required: false,
            icon: 'fa-pen-nib',
            isCustom: true
        }))
    ];

    // Check which headers are already used by other fields
    const getUsedHeaders = (currentFieldKey) => {
        return Object.entries(fieldMapping)
            .filter(([key]) => key !== currentFieldKey)
            .map(([, value]) => value);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10 rounded-t-2xl">
                    <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                            <i className="fa-solid fa-bolt text-white text-sm"></i>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">Google Sheet Sync</h3>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times"></i>
                    </button>
                </div>

                {configLoading ? (
                    <div className="flex items-center justify-center py-16">
                        <div className="w-10 h-10 rounded-full border-4 border-slate-200 border-t-emerald-500 animate-spin"></div>
                        <span className="ml-3 text-slate-500">Loading...</span>
                    </div>
                ) : (
                    <div className="p-6 space-y-5">

                        {/* Active Status */}
                        {syncEnabled && selectedSheet && (
                            <div className="bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl p-4 text-white">
                                <div className="flex items-center gap-2 mb-1">
                                    <i className="fa-solid fa-circle-check text-emerald-200"></i>
                                    <span className="font-bold text-sm text-emerald-100">PUSH SYNC ACTIVE</span>
                                </div>
                                <p className="font-semibold">{selectedSheet.name}</p>
                                {totalPushes > 0 && (
                                    <p className="text-xs text-emerald-200 mt-1">{totalPushes} push{totalPushes !== 1 ? 'es' : ''} received</p>
                                )}
                                {existingFieldMapping && Object.keys(existingFieldMapping).length > 0 && (
                                    <p className="text-xs text-emerald-200 mt-1">
                                        <i className="fa-solid fa-link mr-1"></i>
                                        {Object.keys(existingFieldMapping).length} fields mapped
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Active Sync — Show current mapping & allow editing */}
                        {syncEnabled && existingFieldMapping && sheetHeaders.length > 0 && (
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                        <i className="fa-solid fa-arrows-left-right text-blue-500"></i>
                                        Field Mapping
                                    </h4>
                                </div>
                                <div className="space-y-2 bg-slate-50 rounded-xl p-3 border border-slate-200">
                                    {allMappableFields.map(field => (
                                        <div key={field.key} className="flex items-center gap-3">
                                            <div className="flex items-center gap-2 w-28 shrink-0">
                                                <i className={`fa-solid ${field.icon} text-xs ${field.required ? 'text-rose-500' : field.isCustom ? 'text-violet-500' : 'text-slate-400'}`}></i>
                                                <span className={`text-xs font-semibold truncate ${field.required ? 'text-slate-800' : 'text-slate-600'}`}>
                                                    {field.label}
                                                    {field.required && <span className="text-rose-500 ml-0.5">*</span>}
                                                </span>
                                            </div>
                                            <i className="fa-solid fa-arrow-right text-[10px] text-slate-300"></i>
                                            <select
                                                value={fieldMapping[field.key] || ''}
                                                onChange={(e) => handleFieldMappingChange(field.key, e.target.value)}
                                                className={`flex-1 text-xs py-1.5 px-2.5 rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                                                    fieldMapping[field.key]
                                                        ? 'bg-white border-emerald-300 text-emerald-700 font-medium'
                                                        : 'bg-white border-slate-200 text-slate-500'
                                                }`}
                                            >
                                                <option value="">— Skip —</option>
                                                {sheetHeaders.map(header => (
                                                    <option
                                                        key={header}
                                                        value={header}
                                                        disabled={getUsedHeaders(field.key).includes(header)}
                                                    >
                                                        {header}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={handleUpdateMapping}
                                    disabled={saving || !isMappingValid()}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-bold shadow-md disabled:opacity-50 flex items-center justify-center gap-2 transition"
                                >
                                    {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</> : <><i className="fa-solid fa-check"></i> Update Mapping</>}
                                </button>
                            </div>
                        )}

                        {/* Step 1: Google Login */}
                        {!googleConnected && !syncEnabled ? (
                            <button
                                onClick={() => googleLogin()}
                                className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white border-2 border-slate-200 rounded-xl hover:border-blue-400 hover:shadow-md transition-all"
                            >
                                <svg className="w-5 h-5" viewBox="0 0 24 24">
                                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                </svg>
                                <span className="font-semibold text-slate-700">Sign in with Google</span>
                            </button>
                        ) : !syncEnabled ? (
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl">
                                <i className="fa-solid fa-circle-check text-emerald-500"></i>
                                <span className="text-sm font-medium text-emerald-700">Google connected</span>
                            </div>
                        ) : null}

                        {/* Step 2: Sheet Selector */}
                        {googleConnected && !syncEnabled && !mappingStep && (
                            <>
                                {sheetsLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <div className="w-7 h-7 rounded-full border-3 border-slate-200 border-t-blue-500 animate-spin"></div>
                                        <span className="ml-2 text-sm text-slate-500">Loading sheets...</span>
                                    </div>
                                ) : sheetsList.length > 0 ? (
                                    <div className="space-y-1.5">
                                        <label className="text-sm font-semibold text-slate-700">Select Sheet</label>
                                        <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                                            {sheetsList.map(sheet => (
                                                <button
                                                    key={sheet.id}
                                                    onClick={() => handleSelectSheet(sheet)}
                                                    disabled={headersLoading}
                                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all text-sm ${
                                                        selectedSheet?.id === sheet.id
                                                            ? 'border-emerald-500 bg-emerald-50'
                                                            : 'border-slate-100 hover:border-slate-300'
                                                    }`}
                                                >
                                                    <i className={`fa-solid fa-table ${selectedSheet?.id === sheet.id ? 'text-emerald-500' : 'text-slate-400'}`}></i>
                                                    <span className={`truncate ${selectedSheet?.id === sheet.id ? 'text-emerald-700 font-medium' : 'text-slate-600'}`}>{sheet.name}</span>
                                                    {selectedSheet?.id === sheet.id && headersLoading && <i className="fa-solid fa-spinner fa-spin text-emerald-500 ml-auto"></i>}
                                                    {selectedSheet?.id === sheet.id && !headersLoading && <i className="fa-solid fa-check text-emerald-500 ml-auto"></i>}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-center text-sm text-slate-400 py-4">No sheets found</p>
                                )}
                            </>
                        )}

                        {/* Step 3: Field Mapping (new setup flow) */}
                        {googleConnected && !syncEnabled && mappingStep && sheetHeaders.length > 0 && (
                            <div className="space-y-4">
                                {/* Sheet selection confirmation */}
                                <div className="flex items-center justify-between bg-blue-50 rounded-xl px-4 py-3 border border-blue-200">
                                    <div className="flex items-center gap-2">
                                        <i className="fa-solid fa-table text-blue-500"></i>
                                        <span className="text-sm font-semibold text-blue-800">{selectedSheet?.name}</span>
                                    </div>
                                    <button
                                        onClick={() => { setMappingStep(false); setSheetHeaders([]); setFieldMapping({}); }}
                                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition"
                                    >
                                        Change
                                    </button>
                                </div>

                                {/* Mapping Header */}
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
                                        <i className="fa-solid fa-arrows-left-right text-blue-500"></i>
                                        Map Your Fields
                                    </h4>
                                    <p className="text-xs text-slate-500">
                                        Match your CRM fields to the column headers in your Google Sheet.
                                        <span className="text-rose-500 font-semibold ml-1">* = required</span>
                                    </p>
                                </div>

                                {/* Mapping Grid */}
                                <div className="space-y-2 bg-slate-50 rounded-xl p-3 border border-slate-200">
                                    {/* Column labels */}
                                    <div className="flex items-center gap-3 pb-2 border-b border-slate-200">
                                        <span className="w-28 shrink-0 text-[10px] font-bold text-slate-400 uppercase tracking-wider">CRM Field</span>
                                        <span className="w-4"></span>
                                        <span className="flex-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sheet Column</span>
                                    </div>

                                    {allMappableFields.map(field => (
                                        <div key={field.key} className="flex items-center gap-3">
                                            <div className="flex items-center gap-2 w-28 shrink-0">
                                                <i className={`fa-solid ${field.icon} text-xs ${field.required ? 'text-rose-500' : field.isCustom ? 'text-violet-500' : 'text-slate-400'}`}></i>
                                                <span className={`text-xs font-semibold truncate ${field.required ? 'text-slate-800' : 'text-slate-600'}`}>
                                                    {field.label}
                                                    {field.required && <span className="text-rose-500 ml-0.5">*</span>}
                                                </span>
                                            </div>
                                            <i className="fa-solid fa-arrow-right text-[10px] text-slate-300"></i>
                                            <select
                                                value={fieldMapping[field.key] || ''}
                                                onChange={(e) => handleFieldMappingChange(field.key, e.target.value)}
                                                className={`flex-1 text-xs py-1.5 px-2.5 rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${
                                                    fieldMapping[field.key]
                                                        ? 'bg-white border-emerald-300 text-emerald-700 font-medium'
                                                        : field.required
                                                            ? 'bg-white border-rose-200 text-slate-500'
                                                            : 'bg-white border-slate-200 text-slate-500'
                                                }`}
                                            >
                                                <option value="">— {field.required ? 'Select (required)' : 'Skip'} —</option>
                                                {sheetHeaders.map(header => (
                                                    <option
                                                        key={header}
                                                        value={header}
                                                        disabled={getUsedHeaders(field.key).includes(header)}
                                                    >
                                                        {header}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    ))}
                                </div>

                                {/* Validation message */}
                                {!isMappingValid() && (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg">
                                        <i className="fa-solid fa-triangle-exclamation text-rose-500 text-xs"></i>
                                        <span className="text-xs font-medium text-rose-600">Name and Phone must be mapped to enable sync</span>
                                    </div>
                                )}

                                {/* Enable Button */}
                                <button
                                    onClick={handleSave}
                                    disabled={saving || !isMappingValid()}
                                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white py-3 rounded-xl font-bold shadow-lg shadow-emerald-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition"
                                >
                                    {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Enabling...</> : <><i className="fa-solid fa-bolt"></i> Enable Push Sync</>}
                                </button>
                            </div>
                        )}

                        {/* Step 4: Script Section (when active) */}
                        {syncEnabled && webhookUrl && (
                            <div className="bg-slate-800 rounded-xl overflow-hidden">
                                <button
                                    onClick={() => setShowScript(!showScript)}
                                    className="w-full flex items-center justify-between px-4 py-3 text-white hover:bg-white/5 transition"
                                >
                                    <div className="flex items-center gap-2">
                                        <i className="fa-solid fa-code text-amber-400"></i>
                                        <span className="font-semibold text-sm">Setup Script (One-Time)</span>
                                    </div>
                                    <i className={`fa-solid fa-chevron-${showScript ? 'up' : 'down'} text-slate-400 text-xs`}></i>
                                </button>
                                {showScript && (
                                    <div className="px-4 pb-4 space-y-3">
                                        <div className="text-xs text-slate-300 space-y-1">
                                            <p><span className="text-amber-400 font-bold">1.</span> Open Sheet → Extensions → Apps Script</p>
                                            <p><span className="text-amber-400 font-bold">2.</span> Paste the code below & Save</p>
                                            <p><span className="text-amber-400 font-bold">3.</span> Add Trigger → onEdit → From spreadsheet → On edit</p>
                                        </div>
                                        <div className="relative">
                                            <button onClick={handleCopy} className={`absolute top-2 right-2 px-2.5 py-1 rounded text-xs font-semibold transition ${copied ? 'bg-emerald-500 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/20'}`}>
                                                {copied ? '✓ Copied' : 'Copy'}
                                            </button>
                                            <pre className="bg-black/40 rounded-lg p-3 text-[11px] text-emerald-300 overflow-x-auto max-h-48 overflow-y-auto font-mono leading-relaxed">
                                                {getAppsScript()}
                                            </pre>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Disable */}
                        {syncEnabled && (
                            <button
                                onClick={handleDisable}
                                disabled={saving}
                                className="w-full py-2 text-xs font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg border border-slate-200 hover:border-red-200 transition"
                            >
                                <i className="fa-solid fa-power-off mr-1.5"></i> Disable Sync
                            </button>
                        )}

                        {/* Setup Guide Box */}
                        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <h4 className="text-xs font-bold text-slate-700 mb-1.5 flex items-center gap-1">
                                <i className="fa-solid fa-book text-blue-500"></i> Quick Setup Guide
                            </h4>
                            <ul className="text-xs text-slate-600 space-y-1.5">
                                <li className="flex gap-2"><span className="font-bold text-slate-400">1.</span> Connect Google & select your sheet.</li>
                                <li className="flex gap-2"><span className="font-bold text-slate-400">2.</span> Map your sheet columns to CRM fields.</li>
                                <li className="flex gap-2"><span className="font-bold text-slate-400">3.</span> Enable sync & copy the Apps Script.</li>
                                <li className="flex gap-2"><span className="font-bold text-slate-400">4.</span> Paste in Apps Script & set onEdit trigger.</li>
                            </ul>
                            <a href="https://adfliker.com/" target="_blank" rel="noopener noreferrer" className="mt-2 text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1 inline-flex">
                                <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i> Click here for full setup guide
                            </a>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsModal;
