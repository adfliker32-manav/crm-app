import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const CreatePlanModal = ({ isOpen, onClose, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        price: '',
        features: [''],
        limits: {
            agents: '',
            leads: ''
        }
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name.startsWith('limits.')) {
            const limitKey = name.split('.')[1];
            setFormData(prev => ({
                ...prev,
                limits: { ...prev.limits, [limitKey]: value }
            }));
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleFeatureChange = (index, value) => {
        const newFeatures = [...formData.features];
        newFeatures[index] = value;
        setFormData(prev => ({ ...prev, features: newFeatures }));
    };

    const addFeature = () => {
        setFormData(prev => ({ ...prev, features: [...prev.features, ''] }));
    };

    const removeFeature = (index) => {
        setFormData(prev => ({ ...prev, features: prev.features.filter((_, i) => i !== index) }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            const payload = {
                name: formData.name,
                price: parseFloat(formData.price),
                features: formData.features.filter(f => f.trim() !== ''),
                limits: {
                    agents: parseInt(formData.limits.agents) || 5,
                    leads: parseInt(formData.limits.leads) || 1000
                }
            };

            await api.post('/superadmin/plans', payload);
            showSuccess('Plan created successfully');
            onSuccess();
            onClose();
            setFormData({
                name: '',
                price: '',
                features: [''],
                limits: { agents: '', leads: '' }
            });
        } catch (error) {
            console.error('Error creating plan:', error);
            showError(error.response?.data?.message || 'Failed to create plan');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 rounded-t-xl">
                    <h2 className="text-2xl font-bold">Create New Plan</h2>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Plan Name */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Plan Name *</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="e.g., Basic, Business, Agency"
                            required
                            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    {/* Price */}
                    <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Price ($/month) *</label>
                        <input
                            type="number"
                            name="price"
                            value={formData.price}
                            onChange={handleChange}
                            placeholder="e.g., 99.00"
                            step="0.01"
                            min="0"
                            required
                            className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    {/* Limits */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Agent Limit</label>
                            <input
                                type="number"
                                name="limits.agents"
                                value={formData.limits.agents}
                                onChange={handleChange}
                                placeholder="e.g., 10"
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-2">Lead Limit</label>
                            <input
                                type="number"
                                name="limits.leads"
                                value={formData.limits.leads}
                                onChange={handleChange}
                                placeholder="e.g., 5000"
                                className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>

                    {/* Features */}
                    <div>
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-bold text-slate-700">Features</label>
                            <button
                                type="button"
                                onClick={addFeature}
                                className="text-blue-600 hover:text-blue-700 text-sm font-medium flex items-center gap-1"
                            >
                                <i className="fa-solid fa-plus"></i> Add Feature
                            </button>
                        </div>
                        <div className="space-y-2">
                            {formData.features.map((feature, index) => (
                                <div key={index} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={feature}
                                        onChange={(e) => handleFeatureChange(index, e.target.value)}
                                        placeholder="e.g., Unlimited email templates"
                                        className="flex-1 p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                    {formData.features.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeFeature(index)}
                                            className="bg-red-100 hover:bg-red-200 text-red-600 px-3 rounded-lg transition"
                                        >
                                            <i className="fa-solid fa-trash"></i>
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 justify-end pt-4 border-t">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="px-6 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold shadow-md transition flex items-center gap-2 disabled:opacity-50"
                        >
                            {loading && <i className="fa-solid fa-spinner fa-spin"></i>}
                            Create Plan
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreatePlanModal;
