import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import EditBillingModal from './EditBillingModal';

const BillingView = () => {
    const { showError } = useNotification();
    const [stats, setStats] = useState({
        totalMonthlyRevenue: 0,
        currentMonthRevenue: 0,
        activeSubscriptions: 0,
        expiringSoon: 0
    });
    const [subscriptions, setSubscriptions] = useState([]);
    const [filteredSubscriptions, setFilteredSubscriptions] = useState([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [loading, setLoading] = useState(true);
    const [selectedCompany, setSelectedCompany] = useState(null);
    const [isEditBillingModalOpen, setIsEditBillingModalOpen] = useState(false);

    useEffect(() => {
        fetchBillingData();
    }, []);

    useEffect(() => {
        if (statusFilter === 'all') {
            setFilteredSubscriptions(subscriptions);
        } else {
            setFilteredSubscriptions(subscriptions.filter(sub => sub.billingStatus === statusFilter));
        }
    }, [statusFilter, subscriptions]);

    const fetchBillingData = async () => {
        setLoading(true);
        try {
            const [statsRes, subsRes] = await Promise.all([
                api.get('/superadmin/billing-stats'),
                api.get('/superadmin/subscriptions')
            ]);
            setStats(statsRes.data);
            setSubscriptions(subsRes.data);
            setFilteredSubscriptions(subsRes.data);
        } catch (error) {
            console.error('Error fetching billing data:', error);
            showError('Failed to load billing data');
        } finally {
            setLoading(false);
        }
    };

    const handleEditBilling = (company) => {
        setSelectedCompany(company);
        setIsEditBillingModalOpen(true);
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'Active':
                return 'bg-green-100 text-green-700';
            case 'Trial':
                return 'bg-blue-100 text-blue-700';
            case 'Expired':
                return 'bg-red-100 text-red-700';
            case 'Cancelled':
                return 'bg-gray-100 text-gray-700';
            default:
                return 'bg-gray-100 text-gray-700';
        }
    };

    const getPlanColor = (plan) => {
        switch (plan) {
            case 'Enterprise':
                return 'bg-purple-100 text-purple-700';
            case 'Premium':
                return 'bg-orange-100 text-orange-700';
            case 'Basic':
                return 'bg-blue-100 text-blue-700';
            case 'Free':
                return 'bg-gray-100 text-gray-700';
            default:
                return 'bg-gray-100 text-gray-700';
        }
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
                    <h1 className="text-3xl font-bold text-slate-800">Billing & Revenue</h1>
                    <p className="text-slate-500 mt-1">Manage subscriptions and track revenue</p>
                </div>
                <button
                    onClick={fetchBillingData}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition shadow-md flex items-center gap-2"
                >
                    <i className="fa-solid fa-rotate"></i>
                    Refresh
                </button>
            </div>

            {/* Revenue Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <RevenueCard
                    title="Total Monthly Revenue"
                    value={`$${stats.totalMonthlyRevenue?.toLocaleString() || 0}`}
                    icon="fa-dollar-sign"
                    gradient="bg-gradient-to-br from-green-500 to-green-600"
                />
                <RevenueCard
                    title="Current Month"
                    value={`$${stats.currentMonthRevenue?.toLocaleString() || 0}`}
                    icon="fa-calendar-check"
                    gradient="bg-gradient-to-br from-blue-500 to-blue-600"
                />
                <RevenueCard
                    title="Active Subscriptions"
                    value={stats.activeSubscriptions || 0}
                    icon="fa-check-circle"
                    gradient="bg-gradient-to-br from-purple-500 to-purple-600"
                />
                <RevenueCard
                    title="Expiring Soon"
                    value={stats.expiringSoon || 0}
                    icon="fa-exclamation-triangle"
                    gradient="bg-gradient-to-br from-orange-500 to-orange-600"
                />
            </div>

            {/* Filter Tabs */}
            <div className="bg-white rounded-xl shadow-lg p-4 border border-slate-200">
                <div className="flex gap-2 flex-wrap">
                    {['all', 'Active', 'Trial', 'Expired', 'Cancelled'].map((status) => (
                        <button
                            key={status}
                            onClick={() => setStatusFilter(status)}
                            className={`px-4 py-2 rounded-lg font-medium transition ${statusFilter === status
                                ? 'bg-blue-600 text-white shadow-md'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                        >
                            {status === 'all' ? 'All Subscriptions' : status}
                            {status !== 'all' && (
                                <span className="ml-2 text-xs">
                                    ({subscriptions.filter(s => s.billingStatus === status).length})
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            {/* Subscriptions Table */}
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Company
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Plan
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Revenue
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Dates
                                </th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {filteredSubscriptions.length > 0 ? (
                                filteredSubscriptions.map((sub) => (
                                    <tr key={sub._id} className="hover:bg-slate-50 transition">
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-slate-800">{sub.companyName}</p>
                                            <p className="text-sm text-slate-500">{sub.email}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${getPlanColor(sub.plan)}`}>
                                                {sub.plan || 'Free'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${getStatusColor(sub.billingStatus)}`}>
                                                {sub.billingStatus || 'Trial'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="font-bold text-green-600">
                                                ${sub.monthlyRevenue?.toLocaleString() || 0}/mo
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="text-sm">
                                                <p className="text-slate-600">
                                                    <span className="font-medium">Expires:</span>{' '}
                                                    {sub.expiryDate ? new Date(sub.expiryDate).toLocaleDateString() : '-'}
                                                </p>
                                                <p className="text-slate-500 text-xs">
                                                    Last Payment: {sub.lastPaymentDate ? new Date(sub.lastPaymentDate).toLocaleDateString() : '-'}
                                                </p>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleEditBilling(sub)}
                                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition shadow-md"
                                                >
                                                    <i className="fa-solid fa-edit mr-2"></i>
                                                    Edit Billing
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6" className="px-6 py-12 text-center">
                                        <i className="fa-regular fa-credit-card text-5xl text-slate-300 mb-3"></i>
                                        <p className="text-slate-400">No subscriptions found</p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Edit Billing Modal */}
            <EditBillingModal
                isOpen={isEditBillingModalOpen}
                onClose={() => setIsEditBillingModalOpen(false)}
                company={selectedCompany}
                onSuccess={fetchBillingData}
            />
        </div>
    );
};

// Revenue Card Component
const RevenueCard = ({ title, value, icon, gradient }) => {
    return (
        <div className={`${gradient} rounded-xl shadow-lg p-6 text-white transform hover:scale-105 transition-transform duration-200`}>
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-white/80 text-sm font-medium mb-1">{title}</p>
                    <h3 className="text-3xl font-bold">{value}</h3>
                </div>
                <div className="w-14 h-14 bg-white/20 rounded-lg flex items-center justify-center shadow-md">
                    <i className={`fa-solid ${icon} text-2xl`}></i>
                </div>
            </div>
        </div>
    );
};

export default BillingView;
