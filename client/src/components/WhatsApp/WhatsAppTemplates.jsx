import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import TemplateBuilder from './TemplateBuilder';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const WhatsAppTemplates = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [templates, setTemplates] = useState([]);
    const [filteredTemplates, setFilteredTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editingTemplateId, setEditingTemplateId] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('ALL');
    const [categoryFilter, setCategoryFilter] = useState('ALL');

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/api/whatsapp/templates');
            setTemplates(res.data);
            setFilteredTemplates(res.data);
        } catch (error) {
            console.error("Error fetching templates", error);
            showError('Failed to load templates');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    useEffect(() => {
        let filtered = [...templates];

        // Search filter
        if (searchQuery) {
            filtered = filtered.filter(t =>
                t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                t.components?.some(c => c.text?.toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }

        // Status filter
        if (statusFilter !== 'ALL') {
            filtered = filtered.filter(t => t.status === statusFilter);
        }

        // Category filter
        if (categoryFilter !== 'ALL') {
            filtered = filtered.filter(t => t.category === categoryFilter);
        }

        setFilteredTemplates(filtered);
    }, [searchQuery, statusFilter, categoryFilter, templates]);

    const handleCreate = () => {
        setEditingTemplateId('new');
    };

    const handleEdit = (templateId) => {
        setEditingTemplateId(templateId);
    };

    const handleBack = () => {
        setEditingTemplateId(null);
        fetchTemplates();
    };

    const handleDelete = async (template) => {
        const confirmed = await showDanger(
            `Template "${template.name}" will be permanently deleted.`,
            "Delete Template?"
        );
        if (!confirmed) return;

        try {
            await api.delete(`/api/whatsapp/templates/${template._id}`);
            showSuccess('Template deleted successfully!');
            fetchTemplates();
        } catch (error) {
            console.error('Error deleting template:', error);
            showError(error.response?.data?.message || 'Failed to delete template');
        }
    };

    const handleDuplicate = async (template) => {
        try {
            await api.post(`/api/whatsapp/templates/${template._id}/duplicate`);
            showSuccess('Template duplicated successfully!');
            fetchTemplates();
        } catch (error) {
            console.error('Error duplicating template:', error);
            showError(error.response?.data?.message || 'Failed to duplicate template');
        }
    };

    const getStatusBadge = (status) => {
        const badges = {
            APPROVED: { bg: 'bg-green-100', text: 'text-green-800', icon: 'fa-check-circle' },
            PENDING: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: 'fa-clock' },
            REJECTED: { bg: 'bg-red-100', text: 'text-red-800', icon: 'fa-times-circle' },
            DRAFT: { bg: 'bg-gray-100', text: 'text-gray-800', icon: 'fa-file' },
            PAUSED: { bg: 'bg-orange-100', text: 'text-orange-800', icon: 'fa-pause-circle' },
            DISABLED: { bg: 'bg-gray-100', text: 'text-gray-600', icon: 'fa-ban' }
        };
        const badge = badges[status] || badges.DRAFT;
        return (
            <span className={`px-2 py-1 rounded text-xs font-medium ${badge.bg} ${badge.text} flex items-center gap-1`}>
                <i className={`fa-solid ${badge.icon}`}></i>
                {status}
            </span>
        );
    };

    const getQualityBadge = (quality) => {
        if (!quality || quality === 'UNKNOWN') return null;
        const badges = {
            HIGH: { bg: 'bg-green-100', text: 'text-green-800', icon: 'fa-star' },
            MEDIUM: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: 'fa-star-half-stroke' },
            LOW: { bg: 'bg-red-100', text: 'text-red-800', icon: 'fa-star' }
        };
        const badge = badges[quality];
        return (
            <span className={`px-2 py-1 rounded text-xs font-medium ${badge.bg} ${badge.text} flex items-center gap-1`}>
                <i className={`fa-solid ${badge.icon}`}></i>
                {quality}
            </span>
        );
    };

    if (editingTemplateId) {
        return <TemplateBuilder templateId={editingTemplateId} onBack={handleBack} />;
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 p-4">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800">WhatsApp Templates</h2>
                        <p className="text-sm text-gray-600 mt-1">
                            Manage your Meta-approved message templates
                        </p>
                    </div>
                    <button
                        onClick={handleCreate}
                        className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i>
                        Create Template
                    </button>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-3">
                    {/* Search */}
                    <div className="flex-1 min-w-[200px]">
                        <div className="relative">
                            <i className="fa-solid fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                            <input
                                type="text"
                                placeholder="Search templates..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                            />
                        </div>
                    </div>

                    {/* Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                        <option value="ALL">All Status</option>
                        <option value="DRAFT">Draft</option>
                        <option value="PENDING">Pending</option>
                        <option value="APPROVED">Approved</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="PAUSED">Paused</option>
                        <option value="DISABLED">Disabled</option>
                    </select>

                    {/* Category Filter */}
                    <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    >
                        <option value="ALL">All Categories</option>
                        <option value="UTILITY">Utility</option>
                        <option value="MARKETING">Marketing</option>
                        <option value="AUTHENTICATION">Authentication</option>
                    </select>
                </div>
            </div>

            {/* Templates Grid */}
            <div className="flex-1 overflow-y-auto p-6">
                {filteredTemplates.length === 0 ? (
                    <div className="text-center py-16">
                        <i className="fa-brands fa-whatsapp text-7xl text-gray-300 mb-4"></i>
                        <p className="text-gray-400 text-lg mb-4">
                            {templates.length === 0 ? 'No WhatsApp templates yet' : 'No templates match your filters'}
                        </p>
                        {templates.length === 0 && (
                            <button
                                onClick={handleCreate}
                                className="text-green-600 hover:underline text-sm font-medium"
                            >
                                Create your first template
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {filteredTemplates.map(template => {
                            const bodyComponent = template.components?.find(c => c.type === 'BODY');
                            const headerComponent = template.components?.find(c => c.type === 'HEADER');
                            const buttonComponent = template.components?.find(c => c.type === 'BUTTONS');

                            return (
                                <div key={template._id} className="bg-white rounded-xl shadow-md hover:shadow-lg transition border border-gray-200 overflow-hidden">
                                    {/* Card Header */}
                                    <div className="bg-gradient-to-r from-green-50 to-green-100 p-4 border-b border-gray-200">
                                        <div className="flex items-start justify-between mb-2">
                                            <h3 className="text-lg font-bold text-gray-800 truncate flex-1">
                                                {template.name}
                                            </h3>
                                            <span className={`px-2 py-1 rounded text-xs font-medium ${template.category === 'MARKETING' ? 'bg-purple-100 text-purple-800' :
                                                    template.category === 'UTILITY' ? 'bg-blue-100 text-blue-800' :
                                                        'bg-orange-100 text-orange-800'
                                                }`}>
                                                {template.category}
                                            </span>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {getStatusBadge(template.status)}
                                            {getQualityBadge(template.quality)}
                                        </div>
                                    </div>

                                    {/* Card Body */}
                                    <div className="p-4">
                                        {/* Template Preview */}
                                        <div className="bg-gray-50 rounded-lg p-3 mb-3 border border-gray-200">
                                            {headerComponent && headerComponent.text && (
                                                <div className="font-semibold text-gray-800 mb-2 text-sm">
                                                    {headerComponent.text}
                                                </div>
                                            )}
                                            <div className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-3">
                                                {bodyComponent?.text || 'No content'}
                                            </div>
                                            {buttonComponent && buttonComponent.buttons && buttonComponent.buttons.length > 0 && (
                                                <div className="mt-2 pt-2 border-t border-gray-300">
                                                    <div className="flex flex-wrap gap-1">
                                                        {buttonComponent.buttons.map((btn, idx) => (
                                                            <span key={idx} className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                                                                <i className="fa-solid fa-hand-pointer mr-1"></i>
                                                                {btn.text}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* Analytics */}
                                        {template.analytics && template.analytics.sent > 0 && (
                                            <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
                                                <div className="text-center">
                                                    <div className="font-semibold text-gray-800">{template.analytics.sent}</div>
                                                    <div className="text-gray-500">Sent</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="font-semibold text-green-600">{template.analytics.delivered}</div>
                                                    <div className="text-gray-500">Delivered</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="font-semibold text-blue-600">{template.analytics.read}</div>
                                                    <div className="text-gray-500">Read</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="font-semibold text-red-600">{template.analytics.failed}</div>
                                                    <div className="text-gray-500">Failed</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Rejection Reason */}
                                        {template.status === 'REJECTED' && template.rejectionReason && (
                                            <div className="bg-red-50 border border-red-200 rounded p-2 mb-3">
                                                <div className="text-xs font-semibold text-red-800 mb-1">Rejection Reason:</div>
                                                <div className="text-xs text-red-700">{template.rejectionReason}</div>
                                            </div>
                                        )}

                                        {/* Actions */}
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleEdit(template._id)}
                                                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition"
                                            >
                                                <i className="fa-solid fa-edit mr-1"></i>
                                                Edit
                                            </button>
                                            <button
                                                onClick={() => handleDuplicate(template)}
                                                className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition"
                                                title="Duplicate"
                                            >
                                                <i className="fa-solid fa-copy"></i>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(template)}
                                                className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm font-medium transition"
                                                title="Delete"
                                            >
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WhatsAppTemplates;
