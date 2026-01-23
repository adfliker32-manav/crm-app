import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import api from '../services/api';
import MetaConfigSection from '../components/Settings/MetaConfigSection';
import CustomFieldsSettings from '../components/Settings/CustomFieldsSettings';
import BillingSettings from '../components/Settings/BillingSettings';

const Settings = () => {
    const { user, updateUser } = useAuth();
    const { showSuccess, showError } = useNotification();

    const [activeTab, setActiveTab] = useState('profile');
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (user) {
            setName(user.name || '');
        }
    }, [user]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        if (password && password !== confirmPassword) {
            showError("Passwords do not match");
            setLoading(false);
            return;
        }

        if (password && password.length < 6) {
            showError("Password must be at least 6 characters");
            setLoading(false);
            return;
        }

        try {
            const updateData = { name };
            if (password) updateData.password = password;

            await api.put('/auth/profile', updateData);

            // Update user data in AuthContext and localStorage
            updateUser({ name });

            showSuccess("Profile updated successfully");
            setPassword('');
            setConfirmPassword('');

            // Reload page to ensure all components reflect the new name
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (error) {
            console.error("Update failed", error);
            showError(error.response?.data?.message || "Failed to update profile");
        } finally {
            setLoading(false);
        }
    };

    const tabs = [
        { id: 'profile', label: 'Profile', icon: 'fa-user' },
        { id: 'customFields', label: 'Custom Fields', icon: 'fa-list-check' },
        { id: 'meta', label: 'Meta Lead Sync', icon: 'fa-brands fa-facebook' },
        { id: 'billing', label: 'Billing', icon: 'fa-credit-card' }
    ];

    return (
        <div className="max-w-4xl mx-auto animate-fade-in-up">
            <h1 className="text-2xl font-bold text-slate-800 mb-8">Settings</h1>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-5 py-2.5 rounded-lg font-semibold text-sm flex items-center gap-2 transition ${activeTab === tab.id
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                    >
                        <i className={`fa-solid ${tab.icon}`}></i>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                {activeTab === 'profile' && (
                    <>
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-700">Profile Settings</h2>
                            <p className="text-sm text-slate-500">Update your personal information and password.</p>
                        </div>

                        <div className="p-6">
                            <form onSubmit={handleSubmit} className="space-y-6">
                                {/* Email - Read Only */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Email Address</label>
                                    <input
                                        type="email"
                                        value={user?.email || ''}
                                        disabled
                                        className="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 cursor-not-allowed"
                                    />
                                    <p className="text-xs text-slate-400 mt-1">Email address cannot be changed.</p>
                                </div>

                                {/* Name */}
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Full Name</label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                                    />
                                </div>

                                <hr className="border-slate-100 my-6" />

                                <div>
                                    <h3 className="text-md font-bold text-slate-700 mb-4">Change Password</h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">New Password (Optional)</label>
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Min. 6 characters"
                                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Confirm New Password</label>
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="Re-enter new password"
                                                className="w-full p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className={`bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg font-bold shadow-md transition flex items-center gap-2 ${loading ? 'opacity-70 cursor-wait' : ''}`}
                                    >
                                        {loading ? (
                                            <>
                                                <i className="fa-solid fa-spinner fa-spin"></i> Saving...
                                            </>
                                        ) : (
                                            <>
                                                <i className="fa-solid fa-save"></i> Save Changes
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </>
                )}

                {activeTab === 'meta' && (
                    <>
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-700">Meta Lead Sync</h2>
                            <p className="text-sm text-slate-500">Connect Facebook to automatically sync your Lead Ads.</p>
                        </div>
                        <div className="p-6">
                            <MetaConfigSection />
                        </div>
                    </>
                )}

                {activeTab === 'customFields' && (
                    <div className="p-6">
                        <CustomFieldsSettings />
                    </div>
                )}

                {activeTab === 'billing' && (
                    <>
                        <div className="p-6 border-b border-slate-100">
                            <h2 className="text-lg font-bold text-slate-700">Billing & Subscription</h2>
                            <p className="text-sm text-slate-500">Manage your subscription plan and billing details.</p>
                        </div>
                        <div className="p-6">
                            <BillingSettings />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default Settings;
