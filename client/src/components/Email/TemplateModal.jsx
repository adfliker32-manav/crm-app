import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const TemplateModal = ({ isOpen, onClose, onSuccess, template = null }) => {
    const [formData, setFormData] = useState({
        name: '',
        subject: '',
        body: '',
        isActive: true,
        isAutomated: false,
        triggerType: 'manual',
        stage: ''
    });
    const [stages, setStages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (template) {
            setFormData({
                name: template.name || '',
                subject: template.subject || '',
                body: template.body || '',
                isActive: template.isActive ?? true,
                isAutomated: template.isAutomated ?? false,
                triggerType: template.triggerType || 'manual',
                stage: template.stage || ''
            });
        } else {
            // Reset form for create mode
            setFormData({
                name: '',
                subject: '',
                body: '',
                isActive: true,
                isAutomated: false,
                triggerType: 'manual',
                stage: ''
            });
        }
    }, [template, isOpen]);

    useEffect(() => {
        const fetchStages = async () => {
            try {
                const res = await api.get('/stages');
                setStages(res.data);
            } catch (err) {
                console.error("Failed to load stages", err);
            }
        };
        if (isOpen) fetchStages();
    }, [isOpen]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const data = { ...formData };
            if (!data.isAutomated) {
                data.triggerType = 'manual';
                data.stage = null;
            } else if (data.triggerType !== 'on_stage_change') {
                data.stage = null;
            }

            if (template) {
                await api.put(`/email-templates/${template._id}`, data);
            } else {
                await api.post('/email-templates', data);
            }
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to save template');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-800">
                        {template ? 'Edit Template' : 'Create Template'}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="e.g. Welcome Email"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email Subject</label>
                            <input
                                type="text"
                                name="subject"
                                value={formData.subject}
                                onChange={handleChange}
                                required
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Subject line..."
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Body</label>
                        <textarea
                            name="body"
                            value={formData.body}
                            onChange={handleChange}
                            required
                            rows="8"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                            placeholder="Hello {{name}}, ..."
                        ></textarea>
                        <p className="text-xs text-gray-500 mt-1">Available variables: {'{{name}}'}, {'{{phone}}'}, {'{{email}}'}, {'{{companyName}}'}</p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
                        <h4 className="font-bold text-gray-700 text-sm">Settings</h4>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="isActive"
                                name="isActive"
                                checked={formData.isActive}
                                onChange={handleChange}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <label htmlFor="isActive" className="text-sm text-gray-700">Active Template</label>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="isAutomated"
                                name="isAutomated"
                                checked={formData.isAutomated}
                                onChange={handleChange}
                                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                            />
                            <label htmlFor="isAutomated" className="text-sm text-gray-700">Enable Automation</label>
                        </div>

                        {formData.isAutomated && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6 border-l-2 border-purple-200 mt-2">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Trigger Event</label>
                                    <select
                                        name="triggerType"
                                        value={formData.triggerType}
                                        onChange={handleChange}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"
                                    >
                                        <option value="manual">Manual (No Trigger)</option>
                                        <option value="on_lead_create">When Lead is Created</option>
                                        <option value="on_stage_change">When Stage Changes</option>
                                    </select>
                                </div>

                                {formData.triggerType === 'on_stage_change' && (
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Target Stage</label>
                                        <select
                                            name="stage"
                                            value={formData.stage}
                                            onChange={handleChange}
                                            required
                                            className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"
                                        >
                                            <option value="">Select Stage...</option>
                                            {stages.map(s => (
                                                <option key={s._id} value={s.name}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70"
                        >
                            {loading ? 'Saving...' : 'Save Template'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TemplateModal;
