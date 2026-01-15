import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const EditBillingModal = ({ isOpen, onClose, company, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [formData, setFormData] = useState({
        plan: 'Free',
        billingStatus: 'Trial',
        monthlyRevenue: 0,
        expiryDate: '',
        lastPaymentDate: ''
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (company) {
            setFormData({
                plan: company.plan || 'Free',
                billingStatus: company.billingStatus || 'Trial',
                monthlyRevenue: company.monthlyRevenue || 0,
                expiryDate: company.expiryDate ? new Date(company.expiryDate).toISOString().split('T')[0] : '',
                lastPaymentDate: company.lastPaymentDate ? new Date(company.lastPaymentDate).toISOString().split('T')[0] : ''
            });
        }
    }, [company]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        try {
            await api.put(`/superadmin/companies/${company._id}/billing`, formData);
            showSuccess('Billing details updated successfully');
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error updating billing:', error);
            showError(error.response?.data?.message || 'Failed to update billing');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !company) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
                <div className="flex justify-between items-center mb-6 border-b pb-3">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">Edit Billing</h3>
                        <p className="text-sm text-slate-500 mt-1">{company.companyName}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Subscription Plan
                        </label>
                        <select
                            name="plan"
                            value={formData.plan}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="Free">Free</option>
                            <option value="Basic">Basic</option>
                            <option value="Premium">Premium</option>
                            <option value="Enterprise">Enterprise</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Billing Status
                        </label>
                        <select
                            name="billingStatus"
                            value={formData.billingStatus}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        >
                            <option value="Trial">Trial</option>
                            <option value="Active">Active</option>
                            <option value="Expired">Expired</option>
                            <option value="Cancelled">Cancelled</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Monthly Revenue ($)
                        </label>
                        <input
                            type="number"
                            name="monthlyRevenue"
                            value={formData.monthlyRevenue}
                            onChange={handleChange}
                            min="0"
                            step="0.01"
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Expiry Date
                        </label>
                        <input
                            type="date"
                            name="expiryDate"
                            value={formData.expiryDate}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-2">
                            Last Payment Date
                        </label>
                        <input
                            type="date"
                            name="lastPaymentDate"
                            value={formData.lastPaymentDate}
                            onChange={handleChange}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t">
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
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                    Updating...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-save"></i>
                                    Update Billing
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditBillingModal;
