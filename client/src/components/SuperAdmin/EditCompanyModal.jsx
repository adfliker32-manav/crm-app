import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const AVAILABLE_MODULES = [
    { id: 'whatsapp', name: 'WhatsApp Marketing', icon: 'fa-whatsapp' },
    { id: 'chatbot', name: 'AI Chatbot (WhatsApp)', icon: 'fa-robot' },
    { id: 'email', name: 'Email Marketing', icon: 'fa-envelope' },
    { id: 'automations', name: 'Workflow Automations', icon: 'fa-bolt' },
    { id: 'team', name: 'Team Management', icon: 'fa-users' },
    { id: 'reports', name: 'Advanced Reports', icon: 'fa-chart-pie' },
    { id: 'leads', name: 'Lead Management', icon: 'fa-address-book' },
    { id: 'api', name: 'API Access', icon: 'fa-code' },
    { id: 'whitelabel', name: 'White-Label Branding', icon: 'fa-palette' }
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
        agentLimit: 5
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
                agentLimit: company.agentLimit || 5
            });
        }
    }, [company]);

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleModuleToggle = (moduleId) => {
        setFormData(prev => ({
            ...prev,
            activeModules: prev.activeModules.includes(moduleId)
                ? prev.activeModules.filter(id => id !== moduleId)
                : [...prev.activeModules, moduleId]
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            await api.put(`/superadmin/companies/${company._id}`, formData);
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

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl">
                <div className="flex justify-between items-center mb-6 border-b pb-3">
                    <h3 className="text-xl font-bold text-slate-800">Edit Company Properties</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
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
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Contact Person
                            </label>
                            <input
                                type="text"
                                name="contactPerson"
                                value={formData.contactPerson}
                                onChange={handleChange}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Phone
                            </label>
                            <input
                                type="text"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Max Lead Capacity
                            </label>
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
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Agent Creation Limit
                            </label>
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
                    <div className="pt-4 border-t mt-4">
                        <label className="block text-sm font-bold text-slate-700 mb-3">
                            Manual Module Override
                            <span className="block text-xs text-slate-500 font-normal mt-1">Directly enable or disable specific features for this account. This overrides their standard subscription capabilities.</span>
                        </label>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                            {AVAILABLE_MODULES.map(mod => {
                                const isEnabled = formData.activeModules.includes(mod.id);
                                return (
                                    <div
                                        key={mod.id}
                                        onClick={() => handleModuleToggle(mod.id)}
                                        className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition select-none ${
                                            isEnabled 
                                                ? 'border-purple-600 bg-purple-50' 
                                                : 'border-slate-200 hover:border-slate-300'
                                        }`}
                                    >
                                        <div className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center transition ${
                                            isEnabled ? 'bg-purple-600 text-white' : 'bg-slate-200 text-transparent'
                                        }`}>
                                            <i className="fa-solid fa-check text-xs"></i>
                                        </div>
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <i className={`fa-solid ${mod.icon} flex-shrink-0 ${isEnabled ? 'text-purple-600' : 'text-slate-400'}`}></i>
                                            <span className={`text-sm font-medium truncate ${isEnabled ? 'text-purple-800' : 'text-slate-600'}`}>
                                                {mod.name}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t mt-6">
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
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                    Updating...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-save"></i>
                                    Save Changes
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditCompanyModal;
