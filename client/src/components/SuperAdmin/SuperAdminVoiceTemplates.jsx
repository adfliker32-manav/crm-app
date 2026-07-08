import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const SuperAdminVoiceTemplates = () => {
    const { showSuccess, showError } = useNotification();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    
    // Form state
    const [formData, setFormData] = useState({
        name: '',
        category: 'General',
        basePrompt: '',
        executionMode: 'static',
        voiceProfile: 'default',
        language: 'en-US',
        suggestedTrigger: 'LEAD_CREATED'
    });
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const res = await api.get('/superadmin/voice-templates');
            if (res.data.success) {
                setTemplates(res.data.templates);
            }
        } catch (error) {
            console.error('Failed to fetch global voice templates:', error);
            showError('Failed to fetch templates');
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            const res = await api.post('/superadmin/voice-templates', formData);
            if (res.data.success) {
                showSuccess('Global template created successfully');
                setShowForm(false);
                setFormData({
                    name: '',
                    category: 'General',
                    basePrompt: '',
                    executionMode: 'static',
                    voiceProfile: 'default',
                    language: 'en-US',
                    suggestedTrigger: 'LEAD_CREATED'
                });
                fetchTemplates();
            }
        } catch (error) {
            console.error('Failed to create template:', error);
            showError(error.response?.data?.error || 'Failed to create template');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this global template? It will be removed from all users.')) return;
        
        try {
            const res = await api.delete(`/superadmin/voice-templates/${id}`);
            if (res.data.success) {
                showSuccess('Template deleted successfully');
                fetchTemplates();
            }
        } catch (error) {
            console.error('Failed to delete template:', error);
            showError('Failed to delete template');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                            <i className="fa-solid fa-microphone-lines text-xl"></i>
                        </div>
                        Global AI Voice Templates
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Manage global voice templates that are available to all CRM users.
                    </p>
                </div>
                {!showForm && (
                    <button
                        onClick={() => setShowForm(true)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition shadow-lg shadow-indigo-200"
                    >
                        <i className="fa-solid fa-plus"></i>
                        Create Template
                    </button>
                )}
            </div>

            {showForm && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold text-slate-800">Create New Global Template</h2>
                        <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
                            <i className="fa-solid fa-xmark text-xl"></i>
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Template Name <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    required
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                    placeholder="e.g., Real Estate Cold Calling"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Category</label>
                                <input
                                    type="text"
                                    name="category"
                                    value={formData.category}
                                    onChange={handleInputChange}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                    placeholder="e.g., General, Follow-up, Qualification"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Execution Mode</label>
                                <select
                                    name="executionMode"
                                    value={formData.executionMode}
                                    onChange={handleInputChange}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                                >
                                    <option value="static">Static</option>
                                    <option value="injected">Injected</option>
                                    <option value="smart">Smart</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Language</label>
                                <select
                                    name="language"
                                    value={formData.language}
                                    onChange={handleInputChange}
                                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
                                >
                                    <option value="en-US">English (US)</option>
                                    <option value="en-GB">English (UK)</option>
                                    <option value="es-ES">Spanish</option>
                                    <option value="fr-FR">French</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">Base Prompt <span className="text-red-500">*</span></label>
                            <textarea
                                name="basePrompt"
                                value={formData.basePrompt}
                                onChange={handleInputChange}
                                required
                                rows={6}
                                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                placeholder="Enter the AI instruction prompt for the voice agent here..."
                            ></textarea>
                            <p className="text-xs text-slate-500 mt-2">
                                Describe exactly how the AI should behave, what questions it should ask, and how it should handle objections.
                            </p>
                        </div>

                        <div className="flex justify-end pt-4 border-t border-slate-100">
                            <button
                                type="button"
                                onClick={() => setShowForm(false)}
                                className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 mr-4"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                disabled={submitting}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold text-sm transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {submitting ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-floppy-disk"></i>}
                                Save Global Template
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-20 bg-white rounded-2xl border border-slate-200">
                    <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-200"></i>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {templates.map(template => (
                        <div key={template._id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
                            <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-start">
                                <div>
                                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded uppercase tracking-wider mb-2 inline-block">{template.category}</span>
                                    <h3 className="font-bold text-slate-800">{template.name}</h3>
                                </div>
                                <div className="flex gap-2">
                                    <i className="fa-solid fa-globe text-indigo-500" title="Global Template"></i>
                                    <button 
                                        onClick={() => handleDelete(template._id)}
                                        className="text-red-400 hover:text-red-600 transition"
                                        title="Delete Template"
                                    >
                                        <i className="fa-solid fa-trash-can"></i>
                                    </button>
                                </div>
                            </div>
                            <div className="p-5">
                                <p className="text-xs text-slate-500 mb-4 line-clamp-3">{template.basePrompt}</p>
                                <div className="flex justify-between items-center text-[11px] font-semibold text-slate-400">
                                    <span className="flex items-center gap-1"><i className="fa-solid fa-microchip"></i> Mode: {template.executionMode}</span>
                                    <span className="flex items-center gap-1"><i className="fa-solid fa-language"></i> {template.language}</span>
                                </div>
                            </div>
                        </div>
                    ))}
                    
                    {templates.length === 0 && !showForm && (
                        <div className="col-span-full text-center text-slate-400 py-20 bg-white rounded-2xl border border-slate-200">
                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                                <i className="fa-solid fa-microphone-lines text-2xl"></i>
                            </div>
                            <p className="font-bold text-slate-600 mb-1">No global templates found</p>
                            <p className="text-sm">Create your first global template to make it available to all users.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SuperAdminVoiceTemplates;
