import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const INTERVAL_OPTIONS = [
    { value: 5, label: '5 min' },
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 60, label: '60 min' }
];

const SettingsModal = ({ isOpen, onClose, onSuccess }) => {
    const { showSuccess, showError, showInfo } = useNotification();
    const [sheetLink, setSheetLink] = useState('');
    const [autoSync, setAutoSync] = useState(false);
    const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(15);
    const [loading, setLoading] = useState(false);
    const [configLoading, setConfigLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState(null);
    const [lastSyncStatus, setLastSyncStatus] = useState(null);
    const [lastSyncError, setLastSyncError] = useState(null);

    // Load saved settings from server when modal opens
    useEffect(() => {
        if (isOpen) {
            fetchConfig();
        }
    }, [isOpen]);

    const fetchConfig = async () => {
        try {
            setConfigLoading(true);
            const res = await api.get('/leads/sheet-sync-config');
            const config = res.data.googleSheetSync || {};
            setSheetLink(config.sheetUrl || '');
            setAutoSync(config.syncEnabled || false);
            setSyncIntervalMinutes(config.syncIntervalMinutes || 15);
            setLastSyncAt(config.lastSyncAt ? new Date(config.lastSyncAt) : null);
            setLastSyncStatus(config.lastSyncStatus || null);
            setLastSyncError(config.lastSyncError || null);
        } catch (err) {
            console.error('Failed to load sync config:', err);
        } finally {
            setConfigLoading(false);
        }
    };

    // Save settings to server (persisted in DB, runs via server-side Agenda queue)
    const handleSaveSettings = async () => {
        setSaving(true);
        try {
            const res = await api.put('/leads/sheet-sync-config', {
                sheetUrl: sheetLink.trim() || null,
                syncEnabled: autoSync,
                syncIntervalMinutes
            });
            showSuccess(res.data.message || 'Sync settings saved!');

            // Update status from response
            const updated = res.data.googleSheetSync || {};
            setLastSyncAt(updated.lastSyncAt ? new Date(updated.lastSyncAt) : lastSyncAt);
            setLastSyncStatus(updated.lastSyncStatus || lastSyncStatus);
            setLastSyncError(updated.lastSyncError || null);
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    // Manual one-time sync (uses existing endpoint)
    const handleManualSync = async () => {
        if (!sheetLink) {
            showError('Please enter a Google Sheet link');
            return;
        }
        setLoading(true);
        try {
            const res = await api.post('/leads/sync-sheet', { sheetUrl: sheetLink });
            if (res.data.success) {
                setLastSyncAt(new Date());
                setLastSyncStatus('success');
                showSuccess(res.data.message || 'Synced successfully!');
                if (onSuccess) onSuccess();
            } else {
                showError(res.data.message || 'Sync failed');
            }
        } catch (error) {
            showError(error.response?.data?.message || 'Sync failed');
        } finally {
            setLoading(false);
        }
    };

    const handleAutoSyncToggle = (enabled) => {
        setAutoSync(enabled);
    };

    const getStatusBadge = () => {
        if (!lastSyncStatus) return null;
        const config = {
            success: { bg: 'bg-green-100', text: 'text-green-700', label: '✅ Success' },
            error: { bg: 'bg-red-100', text: 'text-red-700', label: '❌ Error' },
            rate_limited: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: '⚠️ Rate Limited' }
        };
        const s = config[lastSyncStatus] || { bg: 'bg-gray-100', text: 'text-gray-600', label: lastSyncStatus };
        return <span className={`${s.bg} ${s.text} px-2 py-0.5 rounded-full text-xs font-semibold`}>{s.label}</span>;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
                <div className="flex justify-between items-center mb-4 border-b pb-3 border-gray-100">
                    <h3 className="text-xl font-bold text-gray-800">⚙️ Google Sheet Sync</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {configLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-500"></i>
                        <span className="ml-3 text-gray-500">Loading settings...</span>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Sheet Link */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Google Sheet Link
                            </label>
                            <input
                                type="text"
                                value={sheetLink}
                                onChange={(e) => setSheetLink(e.target.value)}
                                placeholder="https://docs.google.com/spreadsheets/d/..."
                                className="w-full p-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Make sure the sheet is publicly accessible
                            </p>
                        </div>

                        {/* Auto-Sync Toggle */}
                        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <i className="fa-solid fa-robot text-blue-600"></i>
                                    <span className="font-medium text-gray-800">Auto-Sync</span>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={autoSync}
                                        onChange={(e) => handleAutoSyncToggle(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>
                            {autoSync && (
                                <div className="mt-3">
                                    <label className="block text-xs font-medium text-gray-600 mb-2">
                                        Sync Interval
                                    </label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {INTERVAL_OPTIONS.map(opt => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setSyncIntervalMinutes(opt.value)}
                                                className={`py-2 rounded-lg text-xs font-semibold border-2 transition ${
                                                    syncIntervalMinutes === opt.value
                                                        ? 'border-blue-500 bg-blue-100 text-blue-700'
                                                        : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                                                }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Save Settings Button */}
                        <button
                            onClick={handleSaveSettings}
                            disabled={saving}
                            className="w-full bg-green-600 hover:bg-green-700 text-white py-2.5 rounded-lg transition font-medium shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
                        >
                            {saving ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</>
                            ) : (
                                <><i className="fa-solid fa-save"></i> Save Settings</>
                            )}
                        </button>

                        {/* Last Sync Status */}
                        {lastSyncAt && (
                            <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                <i className="fa-solid fa-clock"></i>
                                Last synced: {lastSyncAt.toLocaleString()}
                                {getStatusBadge()}
                            </div>
                        )}
                        {lastSyncError && lastSyncStatus !== 'success' && (
                            <p className="text-xs text-red-500">
                                <i className="fa-solid fa-circle-exclamation mr-1"></i>{lastSyncError}
                            </p>
                        )}

                        {/* Manual Sync Button */}
                        <button
                            onClick={handleManualSync}
                            disabled={loading || !sheetLink}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg transition font-medium shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i> Syncing...</>
                            ) : (
                                <><i className="fa-solid fa-rotate"></i> Sync Now</>
                            )}
                        </button>

                        {/* Info Box */}
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <h4 className="text-xs font-bold text-gray-700 mb-2 flex items-center gap-1">
                                <i className="fa-solid fa-info-circle text-blue-500"></i>
                                How it works
                            </h4>
                            <ul className="text-xs text-gray-600 space-y-1">
                                <li>• Sheet must have columns: Name, Phone, Email</li>
                                <li>• Duplicate leads (by phone/email) are skipped</li>
                                <li>• Auto-sync runs on the server — works even when browser is closed</li>
                                <li>• New leads are marked as "New" status</li>
                                <li>• Click "Save Settings" to persist your configuration</li>
                            </ul>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsModal;
