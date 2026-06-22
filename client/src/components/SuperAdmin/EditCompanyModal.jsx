import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { WORKSPACE_MODULES } from '../../constants/modules';

// Modules a tenant workspace can have — single source of truth (no API/White-Label;
// those are not manager-level offerings). `chatbot` is a sub-permission
// (planFeatures.aiChatbot) under WhatsApp, not a top-level module.
const AVAILABLE_MODULES = WORKSPACE_MODULES;

// Sub-permissions appear only when their parent module is active.
const SUB_PERMISSIONS = [
    { key: 'aiChatbot', label: 'AI Chatbot', parentModule: 'whatsapp', icon: 'fa-robot' },
    { key: 'whatsappAutomation', label: 'WhatsApp Automation', parentModule: 'whatsapp', icon: 'fa-bolt-lightning' },
    { key: 'emailAutomation', label: 'Email Automation', parentModule: 'email', icon: 'fa-envelopes-bulk' },
    { key: 'campaigns', label: 'Bulk Campaigns', parentModule: 'email', icon: 'fa-bullhorn' },
    { key: 'metaSync', label: 'Meta Lead Ads Sync', parentModule: 'leads', icon: 'fa-meta' },
    { key: 'advancedAnalytics', label: 'Advanced Analytics', parentModule: 'reports', icon: 'fa-chart-line' }
];

const EditCompanyModal = ({ isOpen, onClose, company, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [formData, setFormData] = useState({
        companyName: '',
        email: '',
        contactPerson: '',
        phone: '',
        activeModules: [],
        leadLimit: 1000,
        agentLimit: 5,
        planFeatures: {}
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (company) {
            setFormData({
                companyName: company.companyName || '',
                email: company.email || '',
                contactPerson: company.contactPerson || '',
                phone: company.phone || '',
                activeModules: company.activeModules || [],
                leadLimit: company.planFeatures?.leadLimit || 1000,
                agentLimit: company.agentLimit || company.planFeatures?.agentLimit || 5,
                planFeatures: company.planFeatures || {}
            });
        }
    }, [company]);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleModuleToggle = (moduleId) => {
        setFormData(prev => {
            const has = prev.activeModules.includes(moduleId);
            const next = {
                ...prev,
                activeModules: has
                    ? prev.activeModules.filter(id => id !== moduleId)
                    : [...prev.activeModules, moduleId]
            };
            // When a parent module is unchecked, also clear its sub-permissions
            // so we don't leave orphan grants behind.
            if (has) {
                const newFeatures = { ...prev.planFeatures };
                SUB_PERMISSIONS
                    .filter(sp => sp.parentModule === moduleId)
                    .forEach(sp => { newFeatures[sp.key] = false; });
                next.planFeatures = newFeatures;
            }
            return next;
        });
    };

    const handleFeatureToggle = (key) => {
        setFormData(prev => ({
            ...prev,
            planFeatures: { ...prev.planFeatures, [key]: !prev.planFeatures[key] }
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            // Send only the planFeatures keys we control via the UI so we don't
            // accidentally wipe leadLimit/agentLimit (those go via dedicated fields).
            const featurePayload = {};
            for (const sp of SUB_PERMISSIONS) {
                featurePayload[sp.key] = !!formData.planFeatures[sp.key];
            }

            await api.put(`/superadmin/companies/${company._id}`, {
                companyName: formData.companyName,
                email: formData.email,
                contactPerson: formData.contactPerson,
                phone: formData.phone,
                activeModules: formData.activeModules,
                leadLimit: formData.leadLimit,
                agentLimit: formData.agentLimit,
                planFeatures: featurePayload
            });
            showSuccess('Company updated successfully');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error updating company:', error);
            showError(error.response?.data?.message || 'Failed to update company');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const visibleSubs = SUB_PERMISSIONS.filter(sp => formData.activeModules.includes(sp.parentModule));

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-slate-800">Edit Company Properties</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="p-6 space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Company Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    name="companyName"
                                    value={formData.companyName}
                                    onChange={handleChange}
                                    required
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Email <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    required
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Contact Person</label>
                                <input
                                    type="text"
                                    name="contactPerson"
                                    value={formData.contactPerson}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Phone</label>
                                <input
                                    type="text"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Monthly Lead Limit</label>
                                <input
                                    type="number"
                                    name="leadLimit"
                                    value={formData.leadLimit}
                                    onChange={handleChange}
                                    min="0"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Agent Seat Limit</label>
                                <input
                                    type="number"
                                    name="agentLimit"
                                    value={formData.agentLimit}
                                    onChange={handleChange}
                                    min="0"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                                />
                            </div>
                        </div>

                        {/* Module Access Control */}
                        <div className="pt-4 border-t">
                            <label className="block text-sm font-bold text-slate-700 mb-1">
                                Modules
                            </label>
                            <p className="text-xs text-slate-500 mb-3">Enable/disable workspace modules. Disabling a parent hides its sub-permissions.</p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                {AVAILABLE_MODULES.map(mod => {
                                    const isEnabled = formData.activeModules.includes(mod.id);
                                    return (
                                        <div
                                            key={mod.id}
                                            onClick={() => handleModuleToggle(mod.id)}
                                            className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition select-none ${isEnabled
                                                    ? 'border-purple-600 bg-purple-50'
                                                    : 'border-slate-200 hover:border-slate-300'
                                                }`}
                                        >
                                            <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition ${isEnabled ? 'bg-purple-600 text-white' : 'bg-slate-200 text-transparent'
                                                }`}>
                                                <i className="fa-solid fa-check text-xs"></i>
                                            </div>
                                            <div className="flex items-center gap-2 overflow-hidden">
                                                <i className={`${mod.isBrand ? 'fa-brands' : 'fa-solid'} ${mod.icon} flex-shrink-0 ${isEnabled ? 'text-purple-600' : 'text-slate-400'}`}></i>
                                                <span className={`text-sm font-medium truncate ${isEnabled ? 'text-purple-800' : 'text-slate-600'}`}>
                                                    {mod.name}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Sub-Permissions — only visible when parent module is enabled */}
                        {visibleSubs.length > 0 && (
                            <div className="pt-4 border-t">
                                <label className="block text-sm font-bold text-slate-700 mb-1">Sub-Permissions</label>
                                <p className="text-xs text-slate-500 mb-3">Granular features within the enabled modules.</p>
                                <div className="space-y-2">
                                    {visibleSubs.map(sp => {
                                        const enabled = !!formData.planFeatures[sp.key];
                                        return (
                                            <div key={sp.key}
                                                className={`flex items-center gap-3 p-3 rounded-lg border transition
                                                    ${enabled ? 'border-purple-300 bg-purple-50/50' : 'border-slate-200 bg-white'}`}>
                                                <i className={`fa-solid ${sp.icon} text-base ${enabled ? 'text-purple-600' : 'text-slate-400'}`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                        {sp.label}
                                                        <span className="text-[9px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded uppercase">{sp.parentModule}</span>
                                                    </div>
                                                </div>
                                                <button type="button" onClick={() => handleFeatureToggle(sp.key)}
                                                    className={`relative w-10 h-5 rounded-full transition flex-shrink-0 ${enabled ? 'bg-purple-600' : 'bg-slate-300'}`}>
                                                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${enabled ? 'left-5' : 'left-0.5'}`} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="px-6 py-4 border-t bg-slate-50 flex justify-end gap-3 sticky bottom-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center gap-2"
                        >
                            {loading ? (
                                <><i className="fa-solid fa-spinner fa-spin"></i>Updating...</>
                            ) : (
                                <><i className="fa-solid fa-save"></i>Save Changes</>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditCompanyModal;
