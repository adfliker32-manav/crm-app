import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { WORKSPACE_MODULES } from '../../constants/modules';

// Modules a tenant workspace can have — single source of truth (no API/White-Label;
// those are not manager-level offerings). The WhatsApp chatbot / flow builder is FREE
// and rides on the WhatsApp module, so it is not a top-level toggle. The `aiChatbot`
// planFeature below gates ONLY the premium AI (LLM) layer, not the flow builder.
const AVAILABLE_MODULES = WORKSPACE_MODULES;

// Sub-permissions appear only when their parent module is active.
const SUB_PERMISSIONS = [
    { key: 'whatsappAutomation', label: 'WhatsApp Automation', parentModule: 'whatsapp', icon: 'fa-bolt-lightning' },
    { key: 'emailAutomation', label: 'Email Automation', parentModule: 'email', icon: 'fa-envelopes-bulk' },
    { key: 'campaigns', label: 'Bulk Campaigns', parentModule: 'email', icon: 'fa-bullhorn' },
    { key: 'metaSync', label: 'Meta Lead Ads Sync', parentModule: 'leads', icon: 'fa-meta' },
    { key: 'advancedAnalytics', label: 'Advanced Analytics', parentModule: 'reports', icon: 'fa-chart-line' }
];

const EditCompanyModal = ({ isOpen, onClose, company, onSuccess, isAgency = false }) => {
    const { showSuccess, showError } = useNotification();
    const [formData, setFormData] = useState({
        companyName: '',
        email: '',
        contactPerson: '',
        phone: '',
        activeModules: [],
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
                
                // If disabling whatsapp, also disable aiChatbot
                if (moduleId === 'whatsapp') {
                    newFeatures.aiChatbot = false;
                }
                
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
            // Add explicit AI configuration payload
            featurePayload.aiChatbot = !!formData.planFeatures.aiChatbot;
            featurePayload.aiModel   = formData.planFeatures.aiModel || 'chatmini';
            // External API access (planFeatures.webhooks gates the External API key feature)
            featurePayload.webhooks  = !!formData.planFeatures.webhooks;


            await api.put(`/superadmin/companies/${company._id}`, {
                companyName: formData.companyName,
                email: formData.email,
                contactPerson: formData.contactPerson,
                phone: formData.phone,
                activeModules: formData.activeModules,
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
                        </div>                        {/* Workspace sections — hidden for agencies (managed via Reseller Limits & Controls) */}
                        {!isAgency && (
                        <>
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

                        {/* AI Configuration */}
                        <div className="pt-4 border-t">
                            <label className="block text-sm font-bold text-slate-700 mb-1">AI Configuration</label>
                            <p className="text-xs text-slate-500 mb-3">Enable the AI Chatbot and specify the underlying intelligence model for this client.</p>
                            
                            <div className="flex flex-col md:flex-row gap-4">
                                {/* Chatbot Enable Toggle */}
                                <div className={`flex-1 flex items-center gap-3 p-4 rounded-xl border-2 transition ${
                                        formData.planFeatures.aiChatbot ? 'border-purple-600 bg-purple-50' : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                        formData.planFeatures.aiChatbot ? 'bg-purple-600 text-white shadow-md shadow-purple-500/30' : 'bg-slate-100 text-slate-400'
                                    }`}>
                                        <i className="fa-solid fa-robot"></i>
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-bold text-slate-800">AI Chatbot</div>
                                        <div className="text-xs font-medium text-slate-500">Allow client to use the AI</div>
                                    </div>
                                    <button 
                                        type="button" 
                                        onClick={() => handleFeatureToggle('aiChatbot')}
                                        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-purple-500 ${
                                            formData.planFeatures.aiChatbot ? 'bg-purple-600' : 'bg-slate-300'
                                        }`}
                                    >
                                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                                            formData.planFeatures.aiChatbot ? 'left-6' : 'left-0.5'
                                        }`} />
                                    </button>
                                </div>

                                {/* Model Dropdown */}
                                <div className={`flex-1 flex flex-col justify-center transition-opacity ${
                                    formData.planFeatures.aiChatbot ? 'opacity-100' : 'opacity-50 pointer-events-none'
                                }`}>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Select AI Model</label>
                                    <select
                                        value={formData.planFeatures.aiModel || 'chatmini'}
                                        onChange={(e) => setFormData(prev => ({
                                            ...prev, 
                                            planFeatures: { ...prev.planFeatures, aiModel: e.target.value }
                                        }))}
                                        className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none bg-white text-sm font-medium text-slate-800 transition-shadow hover:border-slate-400"
                                    >
                                        <option value="chatmini">Chatmini (Faster, cost-effective)</option>
                                        <option value="chativity">Chativity (Advanced, reasoning)</option>
                                    </select>
                                </div>
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

                        {/* External API Access — SuperAdmin override toggle */}
                        <div className="pt-4 border-t">
                            <label className="block text-sm font-bold text-slate-700 mb-1">Developer &amp; API Access</label>
                            <p className="text-xs text-slate-500 mb-3">
                                Override API access for this client. When ON, they can generate an API key to connect third-party systems.
                                When OFF, access is blocked even if their plan would normally allow it.
                            </p>
                            <div className={`flex items-center gap-3 p-4 rounded-xl border-2 transition ${
                                formData.planFeatures.webhooks ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}>
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                                    formData.planFeatures.webhooks ? 'bg-indigo-600 text-white shadow-md shadow-indigo-500/30' : 'bg-slate-100 text-slate-400'
                                }`}>
                                    <i className="fa-solid fa-plug" />
                                </div>
                                <div className="flex-1">
                                    <div className="text-sm font-bold text-slate-800">External API Access</div>
                                    <div className="text-xs font-medium text-slate-500">
                                        {formData.planFeatures.webhooks
                                            ? 'Enabled — client can generate & use API keys'
                                            : 'Disabled — client cannot use the External API'}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleFeatureToggle('webhooks')}
                                    className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 ${
                                        formData.planFeatures.webhooks ? 'bg-indigo-600' : 'bg-slate-300'
                                    }`}
                                >
                                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                                        formData.planFeatures.webhooks ? 'left-6' : 'left-0.5'
                                    }`} />
                                </button>
                            </div>
                        </div>
                        </> 
                        )} {/* end !isAgency */}

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
