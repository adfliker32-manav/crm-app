import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ManageAgencyLimitsModal = ({ isOpen, onClose, agency, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);

    const [limits, setLimits] = useState({
        maxClients: 5,
        whatsappMessagesPerMonth: 1000,
        emailsPerMonth: 5000,
        allowNewSignups: true
    });
    const [usage, setUsage] = useState({ whatsappSent: 0, emailsSent: 0, registeredClients: 0 });

    useEffect(() => {
        if (isOpen && agency?._id) {
            fetchCurrentLimits();
        }
    }, [isOpen, agency]);

    const fetchCurrentLimits = async () => {
        try {
            setFetching(true);
            const res = await api.get(`/superadmin/companies/${agency._id}/limits`);
            if (res.data?.success) {
                setLimits({
                    maxClients: res.data.limits.maxClients ?? 5,
                    whatsappMessagesPerMonth: res.data.limits.whatsappMessagesPerMonth ?? 1000,
                    emailsPerMonth: res.data.limits.emailsPerMonth ?? 5000,
                    allowNewSignups: res.data.limits.allowNewSignups ?? true
                });
                setUsage(res.data.usage || { whatsappSent: 0, emailsSent: 0, registeredClients: 0 });
            }
        } catch (err) {
            console.error('Fetch limits error:', err);
            showError('Failed to load current limits — showing defaults.');
        } finally {
            setFetching(false);
        }
    };

    const handleChange = (field, value) => {
        setLimits(prev => ({ ...prev, [field]: typeof value === 'boolean' ? value : Number(value) }));
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            await api.put(`/superadmin/companies/${agency._id}/limits`, limits);
            showSuccess('Agency limits updated successfully');
            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            console.error('Save limits error:', err);
            showError('Failed to update agency limits');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="bg-slate-900 p-6 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-black text-white flex items-center gap-2">
                            <i className="fa-solid fa-shield-halved text-emerald-400"></i>
                            Reseller Limits & Controls
                        </h3>
                        <p className="text-slate-400 text-sm mt-1">Configuring capacity for {agency?.companyName}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {fetching ? (
                        <div className="py-8 text-center text-slate-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i>
                            <p>Loading current limits...</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl mb-2">
                                <div>
                                    <h4 className="font-bold text-slate-800 text-sm">Allow New Registrations</h4>
                                    <p className="text-[10px] text-slate-500 mt-0.5">If disabled, agency cannot onboard new clients.</p>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer" 
                                        checked={limits.allowNewSignups}
                                        onChange={(e) => handleChange('allowNewSignups', e.target.checked)}
                                    />
                                    <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2 mt-4">Max Sub-Clients Allowed</label>
                                <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500/20 focus-within:border-emerald-500 shadow-sm">
                                    <span className="px-4 py-3 bg-slate-50 text-slate-500 border-r border-slate-200">
                                        <i className="fa-solid fa-users"></i>
                                    </span>
                                    <input
                                        type="number"
                                        min="1"
                                        value={limits.maxClients}
                                        onChange={(e) => handleChange('maxClients', e.target.value)}
                                        className="flex-1 px-4 py-3 outline-none text-slate-900 font-bold"
                                    />
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1">
                                    Currently registered: <span className="font-bold text-slate-600">{(usage.registeredClients || 0).toLocaleString()}</span>
                                    {limits.maxClients > 0 && (
                                        <> · {Math.round(((usage.registeredClients || 0) / limits.maxClients) * 100)}% of limit</>
                                    )}
                                </p>
                            </div>

                        </>
                    )}
                </div>

                <div className="bg-slate-50 p-4 border-t border-slate-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={loading || fetching}
                        className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl shadow-lg shadow-emerald-500/30 transition disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>}
                        {loading ? 'Saving...' : 'Lock Limits'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ManageAgencyLimitsModal;
