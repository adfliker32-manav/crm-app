import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const PRESETS = {
    VIEW_ONLY: {
        viewDashboard: true,
        viewLeads: true,
        viewAllLeads: false,
        createLeads: false,
        editLeads: false,
        deleteLeads: false,
        assignLeads: false,
        exportLeads: false,
        viewPipeline: true,
        moveLeads: false,
        viewEmails: false,
        sendEmails: false,
        sendBulkEmails: false,
        manageEmailTemplates: false,
        viewWhatsApp: false,
        sendWhatsApp: false,
        sendBulkWhatsApp: false,
        manageWhatsAppTemplates: false,
        viewNotes: true,
        createNotes: false,
        editNotes: false,
        deleteNotes: false,
        manageFollowUps: false,
        accessSettings: false,
        viewBilling: false,
        manageTeam: false
    },
    BASIC_AGENT: {
        viewDashboard: true,
        viewLeads: true,
        viewAllLeads: false,
        createLeads: false,
        editLeads: true,
        deleteLeads: false,
        assignLeads: false,
        exportLeads: false,
        viewPipeline: true,
        moveLeads: true,
        viewEmails: false,
        sendEmails: true,
        sendBulkEmails: false,
        manageEmailTemplates: false,
        viewWhatsApp: false,
        sendWhatsApp: true,
        sendBulkWhatsApp: false,
        manageWhatsAppTemplates: false,
        viewNotes: false,
        createNotes: true,
        editNotes: false,
        deleteNotes: false,
        manageFollowUps: true,
        accessSettings: false,
        viewBilling: false,
        manageTeam: false
    },
    SENIOR_AGENT: {
        viewDashboard: true,
        viewLeads: true,
        viewAllLeads: true,
        createLeads: true,
        editLeads: true,
        deleteLeads: false,
        assignLeads: true,
        exportLeads: true,
        viewPipeline: true,
        moveLeads: true,
        viewEmails: true,
        sendEmails: true,
        sendBulkEmails: true,
        manageEmailTemplates: true,
        viewWhatsApp: true,
        sendWhatsApp: true,
        sendBulkWhatsApp: true,
        manageWhatsAppTemplates: true,
        viewNotes: true,
        createNotes: true,
        editNotes: true,
        deleteNotes: false,
        manageFollowUps: true,
        accessSettings: false,
        viewBilling: false,
        manageTeam: false
    }
};

const EditAgentModal = ({ isOpen, onClose, onSuccess, agent }) => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        password: '',
        confirmPassword: ''
    });

    const [selectedPreset, setSelectedPreset] = useState('CUSTOM');
    const [permissions, setPermissions] = useState({});
    const [showPassword, setShowPassword] = useState(false);

    // Initialize form data when agent changes
    useEffect(() => {
        if (agent) {
            setFormData({
                name: agent.name || '',
                password: '',
                confirmPassword: ''
            });
            setPermissions(agent.permissions || {});
            setSelectedPreset('CUSTOM');
        }
    }, [agent]);

    const handlePresetChange = (preset) => {
        setSelectedPreset(preset);
        setPermissions(PRESETS[preset]);
    };

    const togglePermission = (key) => {
        setPermissions(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
        setSelectedPreset('CUSTOM');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Validate password match if password is being changed
        if (formData.password) {
            if (formData.password !== formData.confirmPassword) {
                showError('Passwords do not match');
                return;
            }
            if (formData.password.length < 6) {
                showError('Password must be at least 6 characters');
                return;
            }
        }

        setLoading(true);

        try {
            const updateData = {
                name: formData.name,
                permissions
            };

            // Only include password if it's being changed
            if (formData.password) {
                updateData.password = formData.password;
            }

            await api.put(`/auth/update-agent/${agent._id}`, updateData);

            showSuccess('Agent updated successfully!');
            setFormData({ name: '', password: '', confirmPassword: '' });
            onSuccess();
            onClose();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to update agent');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !agent) return null;

    const permissionGroups = [
        {
            title: '📊 Dashboard',
            permissions: [
                { key: 'viewDashboard', label: 'View Dashboard' }
            ]
        },
        {
            title: '👥 Leads',
            permissions: [
                { key: 'viewLeads', label: 'View Leads' },
                { key: 'viewAllLeads', label: 'View ALL Leads (not just assigned)', highlight: true },
                { key: 'createLeads', label: 'Create Leads' },
                { key: 'editLeads', label: 'Edit Leads' },
                { key: 'deleteLeads', label: 'Delete Leads' },
                { key: 'assignLeads', label: 'Assign Leads to Team' },
                { key: 'exportLeads', label: 'Export Leads' }
            ]
        },
        {
            title: '🔄 Pipeline',
            permissions: [
                { key: 'viewPipeline', label: 'View Pipeline' },
                { key: 'moveLeads', label: 'Move Leads Between Stages' }
            ]
        },
        {
            title: '📧 Email',
            permissions: [
                { key: 'viewEmails', label: 'View Emails' },
                { key: 'sendEmails', label: 'Send Individual Emails' },
                { key: 'sendBulkEmails', label: 'Send Bulk Emails' },
                { key: 'manageEmailTemplates', label: 'Manage Email Templates' }
            ]
        },
        {
            title: '💬 WhatsApp',
            permissions: [
                { key: 'viewWhatsApp', label: 'View WhatsApp Messages' },
                { key: 'sendWhatsApp', label: 'Send Individual Messages' },
                { key: 'sendBulkWhatsApp', label: 'Send Bulk Messages' },
                { key: 'manageWhatsAppTemplates', label: 'Manage Templates' }
            ]
        },
        {
            title: '📝 Notes & Follow-ups',
            permissions: [
                { key: 'viewNotes', label: 'View Notes' },
                { key: 'createNotes', label: 'Create Notes' },
                { key: 'editNotes', label: 'Edit Notes' },
                { key: 'deleteNotes', label: 'Delete Notes' },
                { key: 'manageFollowUps', label: 'Manage Follow-ups' }
            ]
        },
        {
            title: '⚙️ Settings & Admin',
            permissions: [
                { key: 'accessSettings', label: 'Access Settings' },
                { key: 'viewBilling', label: 'View Billing' },
                { key: 'manageTeam', label: 'Manage Team' }
            ]
        }
    ];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Edit Agent</h2>
                        <p className="text-sm text-slate-500 mt-1">
                            Update <span className="font-semibold text-blue-600">{agent.name}</span>'s details and permissions
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="p-6 space-y-6">
                        {/* Basic Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Full Name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="John Doe"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-2">
                                    Email <span className="text-slate-400 text-xs">(cannot be changed)</span>
                                </label>
                                <input
                                    type="email"
                                    disabled
                                    value={agent.email}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed"
                                />
                            </div>
                        </div>

                        {/* Password Section */}
                        <div className="bg-gradient-to-r from-orange-50 to-yellow-50 border border-orange-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-3">
                                <i className="fa-solid fa-key text-orange-500"></i>
                                <h3 className="font-semibold text-slate-700">Change Password</h3>
                                <span className="text-xs text-slate-500">(optional)</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative">
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        New Password
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            value={formData.password}
                                            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none pr-10"
                                            placeholder="Leave empty to keep current"
                                            minLength={formData.password ? 6 : 0}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        >
                                            <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">
                                        Confirm Password
                                    </label>
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={formData.confirmPassword}
                                        onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="Confirm new password"
                                    />
                                </div>
                            </div>
                            {formData.password && formData.confirmPassword && formData.password !== formData.confirmPassword && (
                                <p className="text-red-500 text-sm mt-2">
                                    <i className="fa-solid fa-exclamation-circle mr-1"></i>
                                    Passwords do not match
                                </p>
                            )}
                        </div>

                        <hr className="border-slate-200" />

                        {/* Permission Preset Selector */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-3">Permission Preset</label>
                            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                <button
                                    type="button"
                                    onClick={() => handlePresetChange('VIEW_ONLY')}
                                    className={`p-4 border-2 rounded-lg transition ${selectedPreset === 'VIEW_ONLY' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                                >
                                    <div className="font-semibold text-slate-800">👁️ View Only</div>
                                    <div className="text-xs text-slate-500 mt-1">Read-only access</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handlePresetChange('BASIC_AGENT')}
                                    className={`p-4 border-2 rounded-lg transition ${selectedPreset === 'BASIC_AGENT' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                                >
                                    <div className="font-semibold text-slate-800">🙂 Basic Agent</div>
                                    <div className="text-xs text-slate-500 mt-1">Standard permissions</div>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handlePresetChange('SENIOR_AGENT')}
                                    className={`p-4 border-2 rounded-lg transition ${selectedPreset === 'SENIOR_AGENT' ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                                >
                                    <div className="font-semibold text-slate-800">⭐ Senior Agent</div>
                                    <div className="text-xs text-slate-500 mt-1">Advanced access</div>
                                </button>
                                <div
                                    className={`p-4 border-2 rounded-lg ${selectedPreset === 'CUSTOM' ? 'border-purple-500 bg-purple-50' : 'border-slate-200'}`}
                                >
                                    <div className="font-semibold text-slate-800">🎨 Custom</div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        {selectedPreset === 'CUSTOM' ? 'Currently editing' : 'Edit below'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <hr className="border-slate-200" />

                        {/* Permission Checkboxes */}
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-3">Custom Permissions</label>
                            <div className="space-y-4">
                                {permissionGroups.map((group) => (
                                    <div key={group.title} className="border border-slate-200 rounded-lg p-4">
                                        <h4 className="font-semibold text-slate-700 mb-3">{group.title}</h4>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {group.permissions.map((perm) => (
                                                <label
                                                    key={perm.key}
                                                    className={`flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-2 rounded ${perm.highlight ? 'bg-yellow-50' : ''}`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={permissions[perm.key] || false}
                                                        onChange={() => togglePermission(perm.key)}
                                                        className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                                                    />
                                                    <span className="text-sm text-slate-700">{perm.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || (formData.password && formData.password !== formData.confirmPassword)}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <i className="fa-solid fa-circle-notch fa-spin"></i>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-save"></i>
                                    Save Changes
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditAgentModal;
