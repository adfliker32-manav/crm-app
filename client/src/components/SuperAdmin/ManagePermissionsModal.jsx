import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ManagePermissionsModal = ({ isOpen, onClose, company, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    
    // permissions state will mirror what we want to update
    const [permissions, setPermissions] = useState({
        aiVoiceAccess: null
    });

    useEffect(() => {
        if (isOpen && company?._id) {
            // Ideally we'd fetch the user's current permissions, but they are included in the company object from the table.
            setPermissions({
                aiVoiceAccess: company.permissions?.aiVoiceAccess !== undefined ? company.permissions.aiVoiceAccess : null
            });
        }
    }, [isOpen, company]);

    const handleSave = async () => {
        try {
            setLoading(true);
            await api.put(`/superadmin/accounts/${company._id}/permissions`, { 
                aiVoiceAccess: permissions.aiVoiceAccess 
            });
            showSuccess('Permissions updated successfully');
            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            console.error('Save permissions error:', err);
            showError('Failed to update permissions');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !company) return null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="bg-slate-900 p-6 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-black text-white flex items-center gap-2">
                            <i className="fa-solid fa-lock text-purple-400"></i>
                            Access Controls
                        </h3>
                        <p className="text-slate-400 text-sm mt-1">Configuring overrides for {company?.companyName}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {fetching ? (
                        <div className="py-8 text-center text-slate-400">
                            <i className="fa-solid fa-circle-notch fa-spin text-2xl mb-2"></i>
                            <p>Loading current permissions...</p>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2 mt-2">AI Voice Engine Access</label>
                                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                    <select
                                        value={permissions.aiVoiceAccess === null ? 'null' : permissions.aiVoiceAccess.toString()}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setPermissions(prev => ({
                                                ...prev,
                                                aiVoiceAccess: val === 'null' ? null : val === 'true'
                                            }));
                                        }}
                                        className="w-full px-4 py-3 outline-none text-slate-900 font-bold bg-slate-50 appearance-none"
                                    >
                                        <option value="null">Inherit from Plan (Default)</option>
                                        <option value="true">Force Enable (Override)</option>
                                        <option value="false">Force Disable (Override)</option>
                                    </select>
                                </div>
                                <p className="text-[10px] text-slate-400 mt-2">
                                    By default, AI Voice is only available on the Enterprise plan. You can use this to explicitly grant or revoke access for this specific account.
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
                        className="px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-lg shadow-purple-500/30 transition disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>}
                        {loading ? 'Saving...' : 'Apply Overrides'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ManagePermissionsModal;
