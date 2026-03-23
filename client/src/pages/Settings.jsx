import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import api from '../services/api';
import MetaConfigSection from '../components/Settings/MetaConfigSection';
import CustomFieldsSettings from '../components/Settings/CustomFieldsSettings';
import BillingSettings from '../components/Settings/BillingSettings';
import SheetSyncSettings from '../components/Settings/SheetSyncSettings';
import TagsSettings from '../components/Settings/TagsSettings';

const Settings = () => {
    const { user, updateUser } = useAuth();
    const { showSuccess, showError } = useNotification();

    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const canAccessSettings = canManageTeam || user?.permissions?.accessSettings === true;

    if (!canAccessSettings) return <Navigate to="/dashboard" replace />;

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
        { id: 'tags', label: 'Lead Tags', icon: 'fa-tags' },
        { id: 'customFields', label: 'Custom Fields', icon: 'fa-list-check' },
        { id: 'sheetSync', label: 'Sheet Sync', icon: 'fa-table' },
        { id: 'meta', label: 'Meta Lead Sync', icon: 'fa-brands fa-facebook' }
        // HIDING BILLING FOR NOW: { id: 'billing', label: 'Billing', icon: 'fa-credit-card' }
    ];

    return (
        <div className="max-w-5xl mx-auto p-4 md:p-8 animate-fade-in-up">
            <h1 className="text-3xl font-extrabold text-slate-900 mb-8 tracking-tight">Organization Settings</h1>

            {/* Tabs - Segmented Control Style */}
            <div className="flex flex-wrap gap-2 mb-8 bg-slate-100/70 p-1.5 rounded-2xl border border-slate-200/60 w-fit">
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={`px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-all duration-200 ${
                            activeTab === tab.id
                            ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/50'
                            : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                        }`}
                    >
                        <i className={`fa-solid ${tab.icon} ${activeTab === tab.id ? 'text-blue-500' : 'text-slate-400'}`}></i>
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content - Elevated Card Style */}
            <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-slate-100 overflow-hidden min-h-[600px]">
                {activeTab === 'profile' && (
                    <div className="animate-in fade-in duration-300">
                        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
                            <h2 className="text-xl font-bold text-slate-800">Profile Configuration</h2>
                            <p className="text-sm text-slate-500 mt-1">Update your personal information and account security.</p>
                        </div>

                        <div className="p-8">
                            <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
                                {/* Email - Read Only */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
                                    <input
                                        type="email"
                                        value={user?.email || ''}
                                        disabled
                                        className="w-full p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed shadow-sm"
                                    />
                                    <p className="text-xs text-slate-400 mt-2"><i className="fa-solid fa-lock mr-1"></i> Email address is permanent and cannot be modified.</p>
                                </div>

                                {/* Name */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
                                    <input
                                        type="text"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        required
                                        className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition shadow-sm"
                                    />
                                </div>

                                <hr className="border-slate-100 my-8" />

                                <div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-5 flex items-center gap-2">
                                        <i className="fa-solid fa-shield-halved text-blue-500"></i> Change Password
                                    </h3>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">New Password (Optional)</label>
                                            <input
                                                type="password"
                                                value={password}
                                                onChange={(e) => setPassword(e.target.value)}
                                                placeholder="Min. 6 characters"
                                                className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition shadow-sm"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Confirm New Password</label>
                                            <input
                                                type="password"
                                                value={confirmPassword}
                                                onChange={(e) => setConfirmPassword(e.target.value)}
                                                placeholder="Re-enter new password"
                                                className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition shadow-sm"
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-6 flex justify-end border-t border-slate-100 mt-8">
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className={`bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 ${loading ? 'opacity-70 cursor-wait' : 'hover:-translate-y-0.5'}`}
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
                    </div>
                )}

                {activeTab === 'meta' && (
                    <div className="animate-in fade-in duration-300">
                        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
                            <h2 className="text-xl font-bold text-slate-800">Meta Lead Sync</h2>
                            <p className="text-sm text-slate-500 mt-1">Connect your Facebook pages to automatically sync incoming Lead Ads.</p>
                        </div>
                        <div className="p-8">
                            <MetaConfigSection />
                        </div>
                    </div>
                )}

                {activeTab === 'customFields' && (
                    <div className="animate-in fade-in duration-300">
                        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
                            <h2 className="text-xl font-bold text-slate-800">Custom Fields</h2>
                            <p className="text-sm text-slate-500 mt-1">Define additional data fields to capture for your leads.</p>
                        </div>
                        <div className="p-8 bg-slate-50 min-h-[500px]">
                            <CustomFieldsSettings />
                        </div>
                    </div>
                )}

                {activeTab === 'tags' && (
                    <div className="animate-in fade-in duration-300">
                        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
                            <h2 className="text-xl font-bold text-slate-800">Lead Tags</h2>
                            <p className="text-sm text-slate-500 mt-1">Create and manage color-coded tags for organizing leads.</p>
                        </div>
                        <div className="p-8 bg-slate-50 min-h-[500px]">
                            <TagsSettings />
                        </div>
                    </div>
                )}

                {activeTab === 'sheetSync' && (
                    <div className="animate-in fade-in duration-300">
                        <SheetSyncSettings />
                    </div>
                )}

                {activeTab === 'billing' && (
                    <div className="animate-in fade-in duration-300">
                        <div className="p-8 border-b border-slate-100 bg-slate-50/50">
                            <h2 className="text-xl font-bold text-slate-800">Billing & Subscription</h2>
                            <p className="text-sm text-slate-500 mt-1">Manage your subscription plan and billing details.</p>
                        </div>
                        <div className="p-8">
                            <BillingSettings />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Settings;
