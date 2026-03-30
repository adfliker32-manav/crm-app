import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ALL_MODULES = [
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

const EditSubClientModal = ({ isOpen, onClose, client, agencyModules = [], onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [formData, setFormData] = useState({
        companyName: '',
        name: '',
        email: '',
        phone: '',
        activeModules: [],
        leadLimit: 100,
        agentLimit: 2
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (client) {
            setFormData({
                companyName: client.companyName || '',
                name: client.name || '',
                email: client.email || '',
                phone: client.phone || '',
                activeModules: client.activeModules || [],
                leadLimit: client.planFeatures?.leadLimit || 100,
                agentLimit: client.agentLimit || 2
            });
        }
    }, [client]);

    const handleChange = (e) => {
        const value = e.target.type === 'number' ? parseInt(e.target.value) : e.target.value;
        setFormData({ ...formData, [e.target.name]: value });
    };

    const handleModuleToggle = (moduleId) => {
        // Double check inheritance (Agency cannot give what they don't have)
        if (!agencyModules.includes(moduleId)) return;

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
            await api.put(`/agency/clients/${client._id}`, formData);
            showSuccess('Client permissions updated successfully');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error updating sub-client:', error);
            showError(error.response?.data?.message || 'Failed to update client');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in duration-300">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200">
                {/* Header */}
                <div className="bg-slate-50 px-8 py-6 border-b border-slate-100 flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-black text-slate-800 tracking-tight">Access Control</h3>
                        <p className="text-sm text-slate-500 font-medium">Configure limits and modules for {formData.companyName}</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all">
                        <i className="fa-solid fa-times" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Company Name</label>
                            <input
                                type="text"
                                name="companyName"
                                value={formData.companyName}
                                onChange={handleChange}
                                required
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none font-bold text-slate-700"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Contact Email</label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                required
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none font-bold text-slate-700"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Lead Limit (Total)</label>
                            <input
                                type="number"
                                name="leadLimit"
                                value={formData.leadLimit}
                                onChange={handleChange}
                                min="0"
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none font-bold text-slate-700"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">Agent Seat Limit</label>
                            <input
                                type="number"
                                name="agentLimit"
                                value={formData.agentLimit}
                                onChange={handleChange}
                                min="1"
                                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none font-bold text-slate-700"
                            />
                        </div>
                    </div>

                    {/* Module Grid */}
                    <div className="pt-4 border-t border-slate-100">
                        <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-4 ml-1">Module Rights</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {ALL_MODULES.map(mod => {
                                const isOwnedByAgency = agencyModules.includes(mod.id);
                                const isEnabledForClient = formData.activeModules.includes(mod.id);

                                return (
                                    <div
                                        key={mod.id}
                                        onClick={() => isOwnedByAgency && handleModuleToggle(mod.id)}
                                        className={`group relative flex items-center gap-3 p-3 rounded-2xl border-2 transition-all select-none
                                            ${!isOwnedByAgency 
                                                ? 'bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed grayscale' 
                                                : isEnabledForClient
                                                    ? 'border-blue-600 bg-blue-50/50 shadow-md ring-2 ring-blue-500/20'
                                                    : 'border-slate-100 hover:border-slate-300 cursor-pointer'
                                            }`}
                                    >
                                        <div className={`w-6 h-6 rounded-lg flex-shrink-0 flex items-center justify-center transition-all
                                            ${isEnabledForClient ? 'bg-blue-600 text-white rotate-6' : 'bg-slate-200 text-transparent opacity-0'}`}>
                                            <i className="fa-solid fa-check text-[10px]" />
                                        </div>
                                        <div className="flex flex-col min-w-0">
                                            <div className="flex items-center gap-2">
                                                <i className={`fa-solid ${mod.icon} text-sm ${isEnabledForClient ? 'text-blue-600' : 'text-slate-400'}`} />
                                                <span className={`text-[11px] font-black truncate ${isEnabledForClient ? 'text-blue-900' : 'text-slate-500'}`}>
                                                    {mod.name.split(' ')[0]}
                                                </span>
                                            </div>
                                            {!isOwnedByAgency && (
                                                <span className="text-[9px] font-bold text-red-400 uppercase tracking-tighter">No Access</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="flex justify-end gap-3 pt-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-100 transition-all border border-transparent hover:border-slate-200"
                        >
                            Back
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-8 py-2.5 bg-slate-900 hover:bg-black text-white rounded-xl font-black transition-all shadow-xl shadow-slate-900/20 flex items-center gap-2 disabled:opacity-50"
                        >
                            {loading ? <i className="fa-solid fa-sync fa-spin" /> : <i className="fa-solid fa-shield-halved" />}
                            Sync Permissions
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditSubClientModal;
