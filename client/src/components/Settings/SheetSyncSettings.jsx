import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const INTERVAL_OPTIONS = [
    { value: 5, label: 'Every 5 minutes' },
    { value: 15, label: 'Every 15 minutes' },
    { value: 30, label: 'Every 30 minutes' },
    { value: 60, label: 'Every 60 minutes' }
];

const SheetSyncSettings = () => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const [sheetUrl, setSheetUrl] = useState('');
    const [syncEnabled, setSyncEnabled] = useState(false);
    const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(15);

    // Status info from last sync
    const [lastSyncAt, setLastSyncAt] = useState(null);
    const [lastSyncStatus, setLastSyncStatus] = useState(null);
    const [lastSyncError, setLastSyncError] = useState(null);

    // Load current config on mount
    useEffect(() => {
        fetchConfig();
    }, []);

    const fetchConfig = async () => {
        try {
            setLoading(true);
            const res = await api.get('/leads/sheet-sync-config');
            const config = res.data.googleSheetSync || {};
            setSheetUrl(config.sheetUrl || '');
            setSyncEnabled(config.syncEnabled || false);
            setSyncIntervalMinutes(config.syncIntervalMinutes || 15);
            setLastSyncAt(config.lastSyncAt || null);
            setLastSyncStatus(config.lastSyncStatus || null);
            setLastSyncError(config.lastSyncError || null);
        } catch (err) {
            console.error('Failed to load sync config:', err);
            showError('Failed to load sync configuration');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);

        try {
            const res = await api.put('/leads/sheet-sync-config', {
                sheetUrl: sheetUrl.trim() || null,
                syncEnabled,
                syncIntervalMinutes
            });
            showSuccess(res.data.message || 'Sync settings saved!');

            // Refresh status
            const updated = res.data.googleSheetSync || {};
            setLastSyncAt(updated.lastSyncAt || null);
            setLastSyncStatus(updated.lastSyncStatus || null);
            setLastSyncError(updated.lastSyncError || null);
        } catch (err) {
            console.error('Failed to save sync config:', err);
            showError(err.response?.data?.message || 'Failed to save sync settings');
        } finally {
            setSaving(false);
        }
    };

    const getStatusBadge = () => {
        if (!lastSyncStatus) return null;
        const styles = {
            success: 'bg-green-100 text-green-700',
            error: 'bg-red-100 text-red-700',
            rate_limited: 'bg-yellow-100 text-yellow-700'
        };
        const labels = {
            success: '✅ Success',
            error: '❌ Error',
            rate_limited: '⚠️ Rate Limited'
        };
        return (
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${styles[lastSyncStatus] || 'bg-slate-100 text-slate-600'}`}>
                {labels[lastSyncStatus] || lastSyncStatus}
            </span>
        );
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <i className="fa-solid fa-spinner fa-spin text-2xl text-blue-500"></i>
                <span className="ml-3 text-slate-500">Loading sync settings...</span>
            </div>
        );
    }

    return (
        <div>
            <div className="p-6 border-b border-slate-100">
                <h2 className="text-lg font-bold text-slate-700">Google Sheet Auto-Sync</h2>
                <p className="text-sm text-slate-500">Automatically import new leads from a Google Sheet on a recurring schedule.</p>
            </div>

            <div className="p-6">
                <form onSubmit={handleSave} className="space-y-6">

                    {/* Google Sheet URL */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Google Sheets URL
                        </label>
                        <input
                            type="url"
                            value={sheetUrl}
                            onChange={(e) => setSheetUrl(e.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/your-sheet-id/..."
                            className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                        />
                        <p className="text-xs text-slate-400 mt-1">
                            Make sure the sheet is publicly accessible (set to "Anyone with the link can view").
                        </p>
                    </div>

                    {/* Sync Interval */}
                    <div>
                        <label className="block text-sm font-semibold text-slate-700 mb-2">
                            Sync Interval
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {INTERVAL_OPTIONS.map(opt => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setSyncIntervalMinutes(opt.value)}
                                    className={`p-3 rounded-lg text-sm font-semibold border-2 transition ${
                                        syncIntervalMinutes === opt.value
                                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Enable/Disable Toggle */}
                    <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div>
                            <p className="font-semibold text-slate-700">Enable Auto-Sync</p>
                            <p className="text-xs text-slate-500">
                                {syncEnabled
                                    ? `Sheet will be checked every ${syncIntervalMinutes} minutes`
                                    : 'Auto-sync is currently disabled'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setSyncEnabled(!syncEnabled)}
                            className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${
                                syncEnabled ? 'bg-blue-600' : 'bg-slate-300'
                            }`}
                        >
                            <span
                                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200 ${
                                    syncEnabled ? 'translate-x-7' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>

                    {/* Last Sync Status */}
                    {lastSyncAt && (
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                            <p className="text-sm font-semibold text-slate-700 mb-2">Last Sync</p>
                            <div className="flex items-center gap-3 flex-wrap">
                                {getStatusBadge()}
                                <span className="text-xs text-slate-500">
                                    {new Date(lastSyncAt).toLocaleString()}
                                </span>
                            </div>
                            {lastSyncError && lastSyncStatus !== 'success' && (
                                <p className="text-xs text-red-500 mt-2">
                                    <i className="fa-solid fa-circle-exclamation mr-1"></i>
                                    {lastSyncError}
                                </p>
                            )}
                        </div>
                    )}

                    {/* Save Button */}
                    <div className="pt-4 flex justify-end">
                        <button
                            type="submit"
                            disabled={saving}
                            className={`bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-md transition flex items-center gap-2 ${saving ? 'opacity-70 cursor-wait' : ''}`}
                        >
                            {saving ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</>
                            ) : (
                                <><i className="fa-solid fa-save"></i> Save Settings</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SheetSyncSettings;
