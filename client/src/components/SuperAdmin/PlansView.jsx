import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import CreatePlanModal from './CreatePlanModal';
import EditPlanModal from './EditPlanModal';

const PlansView = () => {
    const { showSuccess, showError } = useNotification();
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedPlan, setSelectedPlan] = useState(null);

    useEffect(() => {
        fetchPlans();
    }, []);

    const fetchPlans = async () => {
        setLoading(true);
        try {
            const response = await api.get('/superadmin/plans');
            setPlans(response.data.plans || []);
        } catch (error) {
            console.error('Error fetching plans:', error);
            showError('Failed to load subscription plans');
        } finally {
            setLoading(false);
        }
    };

    const handleDeletePlan = async (planId) => {
        if (!window.confirm('Are you sure you want to delete this plan?')) return;

        try {
            await api.delete(`/superadmin/plans/${planId}`);
            showSuccess('Plan deleted successfully');
            fetchPlans();
        } catch (error) {
            console.error('Error deleting plan:', error);
            showError(error.response?.data?.message || 'Failed to delete plan');
        }
    };

    const handleEditPlan = (plan) => {
        setSelectedPlan(plan);
        setIsEditModalOpen(true);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400"></i>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Subscription Plans</h1>
                    <p className="text-slate-500 mt-1">Manage subscription packages and pricing</p>
                </div>
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-6 py-3 rounded-lg font-bold shadow-lg flex items-center gap-2 transition transform hover:scale-105"
                >
                    <i className="fa-solid fa-plus"></i>
                    Create New Plan
                </button>
            </div>

            {/* Plans Grid */}
            {plans.length === 0 ? (
                <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-12 text-center">
                    <i className="fa-solid fa-box-open text-6xl text-slate-300 mb-4"></i>
                    <h3 className="text-xl font-bold text-slate-700 mb-2">No Plans Created</h3>
                    <p className="text-slate-500 mb-6">Get started by creating your first subscription plan</p>
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition"
                    >
                        Create First Plan
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {plans.map((plan) => (
                        <div
                            key={plan._id}
                            className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1"
                        >
                            {/* Plan Header */}
                            <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-6 text-white">
                                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                                <div className="flex items-baseline gap-2">
                                    <span className="text-4xl font-extrabold">${plan.price}</span>
                                    <span className="text-blue-100">/ {plan.duration || 'month'}</span>
                                </div>
                            </div>

                            {/* Plan Body */}
                            <div className="p-6">
                                {/* Features */}
                                {plan.features && plan.features.length > 0 && (
                                    <div className="mb-4">
                                        <h4 className="text-sm font-bold text-slate-600 uppercase mb-3">Features</h4>
                                        <ul className="space-y-2">
                                            {plan.features.map((feature, idx) => (
                                                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                                                    <i className="fa-solid fa-check text-green-500 mt-1"></i>
                                                    <span>{feature}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Limits */}
                                {plan.limits && (
                                    <div className="bg-slate-50 rounded-lg p-4 mb-4">
                                        <h4 className="text-sm font-bold text-slate-600 uppercase mb-2">Limits</h4>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <p className="text-xs text-slate-500">Agents</p>
                                                <p className="text-lg font-bold text-slate-700">{plan.limits.agents || 'N/A'}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs text-slate-500">Leads</p>
                                                <p className="text-lg font-bold text-slate-700">{plan.limits.leads || 'Unlimited'}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Status Badge */}
                                <div className="mb-4">
                                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${plan.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                        {plan.isActive ? 'Active' : 'Inactive'}
                                    </span>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => handleEditPlan(plan)}
                                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition flex items-center justify-center gap-2"
                                    >
                                        <i className="fa-solid fa-edit"></i>
                                        Edit
                                    </button>
                                    <button
                                        onClick={() => handleDeletePlan(plan._id)}
                                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-medium transition"
                                    >
                                        <i className="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Modals */}
            <CreatePlanModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSuccess={fetchPlans}
            />
            <EditPlanModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                plan={selectedPlan}
                onSuccess={fetchPlans}
            />
        </div>
    );
};

export default PlansView;
