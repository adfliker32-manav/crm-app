import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';

const BillingSettings = () => {
    const { showError } = useNotification();
    const { user } = useAuth();
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPlan, setCurrentPlan] = useState(null);

    useEffect(() => {
        fetchPlans();
        if (user) {
            setCurrentPlan({
                name: user.subscriptionPlan || 'free',
                status: user.subscriptionStatus || 'trial',
                expiryDate: user.planExpiryDate
            });
        }
    }, [user]);

    const fetchPlans = async () => {
        setLoading(true);
        try {
            const response = await api.get('/auth/plans');
            setPlans(response.data.plans || []);
        } catch (error) {
            console.error('Error fetching plans:', error);
            showError('Failed to load subscription plans');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400"></i>
            </div>
        );
    }

    const getStatusColor = (status) => {
        switch (status?.toLowerCase()) {
            case 'active': return 'bg-green-100 text-green-700';
            case 'trial': return 'bg-blue-100 text-blue-700';
            case 'expired': return 'bg-red-100 text-red-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    return (
        <div className="space-y-8">
            {/* Current Plan Section */}
            <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-6 border border-blue-200">
                <h3 className="text-lg font-bold text-slate-800 mb-4">Current Subscription</h3>
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-2xl font-extrabold text-slate-900 capitalize">{currentPlan?.name || 'Free'} Plan</p>
                        <p className="text-sm text-slate-600 mt-1">
                            {currentPlan?.expiryDate
                                ? `Expires on ${new Date(currentPlan.expiryDate).toLocaleDateString()}`
                                : 'No expiry date set'}
                        </p>
                    </div>
                    <span className={`px-4 py-2 rounded-full font-bold uppercase text-sm ${getStatusColor(currentPlan?.status)}`}>
                        {currentPlan?.status || 'Trial'}
                    </span>
                </div>
            </div>

            {/* Available Plans */}
            <div>
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">Available Plans</h3>
                        <p className="text-sm text-slate-500 mt-1">Choose a plan that fits your business needs</p>
                    </div>
                </div>

                {plans.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-xl">
                        <i className="fa-solid fa-inbox text-5xl text-slate-300 mb-3"></i>
                        <p className="text-slate-500">No plans available at this time</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {plans.filter(p => p.isActive).map((plan) => (
                            <div
                                key={plan._id}
                                className={`rounded-xl shadow-lg border-2 overflow-hidden transition-all duration-300 hover:shadow-2xl transform hover:-translate-y-2 ${plan.name.toLowerCase() === currentPlan?.name.toLowerCase()
                                    ? 'border-blue-600 bg-blue-50'
                                    : 'border-slate-200 bg-white'
                                    }`}
                            >
                                {/* Plan Header */}
                                <div className={`p-6 text-center ${plan.name.toLowerCase() === 'business'
                                    ? 'bg-gradient-to-br from-purple-600 to-blue-600 text-white'
                                    : plan.name.toLowerCase() === 'agency'
                                        ? 'bg-gradient-to-br from-orange-600 to-red-600 text-white'
                                        : 'bg-gradient-to-br from-slate-700 to-slate-800 text-white'
                                    }`}>
                                    <h4 className="text-2xl font-extrabold mb-2">{plan.name}</h4>
                                    <div className="flex items-baseline justify-center gap-2">
                                        <span className="text-5xl font-black">${plan.price}</span>
                                        <span className="text-lg opacity-80">/ {plan.duration || 'month'}</span>
                                    </div>
                                </div>

                                {/* Plan Body */}
                                <div className="p-6">
                                    {/* Features */}
                                    {plan.features && plan.features.length > 0 && (
                                        <ul className="space-y-3 mb-6">
                                            {plan.features.map((feature, idx) => (
                                                <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                                                    <i className="fa-solid fa-circle-check text-green-500 mt-0.5"></i>
                                                    <span>{feature}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}

                                    {/* Limits */}
                                    {plan.limits && (
                                        <div className="bg-slate-100 rounded-lg p-4 mb-4">
                                            <div className="grid grid-cols-2 gap-3 text-center">
                                                <div>
                                                    <p className="text-xs text-slate-500 uppercase font-medium">Agents</p>
                                                    <p className="text-2xl font-bold text-slate-800">{plan.limits.agents}</p>
                                                </div>
                                                <div>
                                                    <p className="text-xs text-slate-500 uppercase font-medium">Leads</p>
                                                    <p className="text-2xl font-bold text-slate-800">{plan.limits.leads >= 10000 ? '∞' : plan.limits.leads}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* CTA Button */}
                                    {plan.name.toLowerCase() === currentPlan?.name.toLowerCase() ? (
                                        <button
                                            disabled
                                            className="w-full bg-gray-300 text-gray-600 py-3 rounded-lg font-bold cursor-not-allowed"
                                        >
                                            Current Plan
                                        </button>
                                    ) : (
                                        <button
                                            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-bold transition shadow-md hover:shadow-lg"
                                        >
                                            {plan.price > 0 ? 'Upgrade Now' : 'Select Plan'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default BillingSettings;
