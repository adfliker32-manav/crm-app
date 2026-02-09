import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const EditPlanModal = ({ isOpen, onClose, plan, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        price: '',
        features: [''],
        limits: {
            agents: '',
            leads: ''
        },
        isActive: true
    })

        ;

    useEffect(() => {
        if (plan) {
            setFormData({
                name: plan.name || '',
                price: plan.price || '',
                features: plan.features && plan.features.length > 0 ? plan.features : [''],
                limits: {
                    agents: plan.limits?.agents || '',
                    leads: plan.limits?.leads || ''
                },
                isActive: plan.isActive !== undefined ? plan.isActive : true
            });
        }
    }, [plan]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        if (name.startsWith('limits.')) {
            const limitKey = name.split('.')[1];
            setFormData(prev => ({
                ...prev,
                limits: { ...prev.limits, [limitKey]: value }
            }));
        } else if (type === 'checkbox') {
            setFormData(prev => ({ ...prev, [name]: checked }));
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
                },
                isActive: formData.isActive
            };

            await api.put(`/superadmin/plans/${plan._id}`, payload);
            showSuccess('Plan updated successfully');
            onSuccess();
            onClose();
        } catch (error) {
            console.error('Error updating plan:', error);
            showError(error.response?.data?.message || 'Failed to update plan');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !plan) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 rounded-t-xl">
                    <h2 className="text-2xl font-bold">Edit Plan</h2>
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

                    {/* Active Status */}
                    <div className="flex items-center gap-3 bg-slate-50 p-4 rounded-lg">
                        <input
                            type="checkbox"
                            id="isActive"
                            name="isActive"
                            checked={formData.isActive}
                            onChange={handleChange}
                            className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                        />
                        <label htmlFor="isActive" className="text-sm font-medium text-slate-700 cursor-pointer">
                            Plan is Active
                        </label>
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
                            Update Plan
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditPlanModal;
