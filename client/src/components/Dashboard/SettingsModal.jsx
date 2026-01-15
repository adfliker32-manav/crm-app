import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const SettingsModal = ({ isOpen, onClose, onSuccess }) => {
    const { showSuccess, showError, showInfo } = useNotification();
    const [sheetLink, setSheetLink] = useState('');
    const [autoSync, setAutoSync] = useState(false);
    const [syncInterval, setSyncInterval] = useState(30); // seconds
    const [loading, setLoading] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState(null);
    const syncIntervalRef = useRef(null);

    // Load saved settings
    useEffect(() => {
        const currentUser = JSON.parse(localStorage.getItem('user'));
        if (currentUser?.id) {
            const saved = localStorage.getItem(`sheetLink_${currentUser.id}`);
            const savedAutoSync = localStorage.getItem(`autoSync_${currentUser.id}`);
            const savedInterval = localStorage.getItem(`syncInterval_${currentUser.id}`);

            if (saved) setSheetLink(saved);
            if (savedAutoSync) setAutoSync(savedAutoSync === 'true');
            if (savedInterval) setSyncInterval(parseInt(savedInterval));
        }
    }, [isOpen]);

    // Auto-sync polling
    useEffect(() => {
        if (autoSync && sheetLink && !document.hidden) {
            startAutoSync();
        } else {
            stopAutoSync();
        }

        return () => stopAutoSync();
    }, [autoSync, sheetLink, syncInterval]);

    // Pause/resume on visibility change
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.hidden) {
                stopAutoSync();
            } else if (autoSync && sheetLink) {
                startAutoSync();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [autoSync, sheetLink]);

    const startAutoSync = () => {
        stopAutoSync(); // Clear any existing interval

        syncIntervalRef.current = setInterval(() => {
            performSync(true); // Silent sync
        }, syncInterval * 1000);
    };

    const stopAutoSync = () => {
        if (syncIntervalRef.current) {
            clearInterval(syncIntervalRef.current);
            syncIntervalRef.current = null;
        }
    };

    const performSync = async (silent = false) => {
        if (!sheetLink) {
            if (!silent) showError('Please enter a Google Sheet link');
            return;
        }

        setLoading(true);

        // Save settings
        const currentUser = JSON.parse(localStorage.getItem('user'));
        if (currentUser?.id) {
            localStorage.setItem(`sheetLink_${currentUser.id}`, sheetLink);
            localStorage.setItem(`autoSync_${currentUser.id}`, autoSync.toString());
            localStorage.setItem(`syncInterval_${currentUser.id}`, syncInterval.toString());
        }

        try {
            const res = await api.post('/leads/sync-sheet', { sheetUrl: sheetLink });

            if (res.data.success) {
                setLastSyncTime(new Date());

                if (!silent) {
                    showSuccess(res.data.message || 'Synced successfully!');
                    if (onSuccess) onSuccess();
                } else {
                    // Silent sync - only show if new leads were added
                    const message = res.data.message || '';
                    const newLeadsMatch = message.match(/(\d+)\s+New Leads/i);
                    if (newLeadsMatch && parseInt(newLeadsMatch[1]) > 0) {
                        showInfo(`Auto-sync: ${res.data.message}`);
                        if (onSuccess) onSuccess();
                    }
                }
            } else {
                if (!silent) showError(res.data.message || 'Sync failed');
            }
        } catch (error) {
            if (!silent) {
                showError(error.response?.data?.message || 'Sync failed');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleManualSync = () => {
        performSync(false);
    };

    const handleAutoSyncToggle = (enabled) => {
        setAutoSync(enabled);
        if (enabled && sheetLink) {
            showInfo(`Auto-sync enabled! Checking every ${syncInterval} seconds.`);
        } else {
            showInfo('Auto-sync disabled');
        }
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
                                <label className="block text-xs font-medium text-gray-600 mb-1">
                                    Sync Interval (seconds)
                                </label>
                                <input
                                    type="number"
                                    min="10"
                                    max="300"
                                    value={syncInterval}
                                    onChange={(e) => setSyncInterval(parseInt(e.target.value) || 30)}
                                    className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>
                        )}
                    </div>

                    {/* Last Sync Time */}
                    {lastSyncTime && (
                        <div className="text-xs text-gray-500 flex items-center gap-2">
                            <i className="fa-solid fa-clock"></i>
                            Last synced: {lastSyncTime.toLocaleTimeString()}
                        </div>
                    )}

                    {/* Sync Button */}
                    <button
                        onClick={handleManualSync}
                        disabled={loading || !sheetLink}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg transition font-medium shadow-md disabled:opacity-70 flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <>
                                <i className="fa-solid fa-spinner fa-spin"></i>
                                Syncing...
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-rotate"></i>
                                Sync Now
                            </>
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
                            <li>• Duplicate leads (by email) are skipped</li>
                            <li>• Auto-sync pauses when tab is hidden</li>
                            <li>• New leads are marked as "New" status</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
