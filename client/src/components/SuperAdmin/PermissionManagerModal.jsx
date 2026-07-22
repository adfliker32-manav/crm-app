import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import PermissionTree from './PermissionTree';

// Per-client Module Permission Manager. Renders the server's feature-registry
// tree (via the shared <PermissionTree>) and lets a SuperAdmin toggle each
// module / sub-feature on/off. Saving maps every node back onto the client's
// real storage (activeModules / planFeatures / featureFlags) server-side.

const PermissionManagerModal = ({ isOpen, onClose, company, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [registry, setRegistry] = useState([]);
    const [values, setValues] = useState({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!company?._id) return;
        try {
            setLoading(true);
            const res = await api.get(`/superadmin/companies/${company._id}/permissions`);
            setRegistry(res.data.registry || []);
            setValues(res.data.values || {});
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to load permissions');
        } finally {
            setLoading(false);
        }
    }, [company, showError]);

    useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

    const handleSave = async () => {
        try {
            setSaving(true);
            
            // Encode dot keys to double underscores to prevent WAFs (like Cloudflare) 
            // from silently stripping NoSQL-like keys from the request body.
            const encodedValues = {};
            for (const [k, v] of Object.entries(values)) {
                encodedValues[k.replace(/\./g, '__')] = v;
            }

            await api.put(`/superadmin/companies/${company._id}/permissions`, { values: encodedValues });
            showSuccess('Permissions updated');
            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save permissions');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <i className="fa-solid fa-sitemap text-purple-600" /> Module Permissions
                        </h3>
                        <p className="text-sm text-slate-500 mt-0.5">{company?.companyName || company?.name || company?.email}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-20 text-slate-400">
                            <i className="fa-solid fa-spinner fa-spin text-2xl" />
                        </div>
                    ) : (
                        <PermissionTree registry={registry} values={values} onChange={setValues} />
                    )}
                </div>

                <div className="px-6 py-4 border-t bg-slate-50 flex items-center justify-between gap-3">
                    <p className="text-xs text-slate-400">
                        Turning a parent off disables everything under it.
                    </p>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition">
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || loading}
                            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center gap-2"
                        >
                            {saving ? <><i className="fa-solid fa-spinner fa-spin" />Saving…</> : <><i className="fa-solid fa-save" />Save Changes</>}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PermissionManagerModal;
