/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
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
    const [syncing, setSyncing] = useState(false);

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/whatsapp/templates');
            const templates = res.data.templates || res.data;
            setTemplates(templates);
            setFilteredTemplates(templates);
        } catch (error) {
            console.error("Error fetching templates", error);
            showError('Failed to load templates');
        } finally {
            setLoading(false);
        }
    };

    const handleSyncStatus = async () => {
        setSyncing(true);
        try {
            await fetchTemplates();
            showSuccess('Templates synced successfully!');
        } catch (error) {
            showError('Failed to sync templates');
        } finally {
            setSyncing(false);
        }
    };

    useEffect(() => { fetchTemplates(); }, []);

    useEffect(() => {
        let filtered = [...templates];
        if (searchQuery) {
            filtered = filtered.filter(t =>
                t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                t.components?.some(c => c.text?.toLowerCase().includes(searchQuery.toLowerCase()))
            );
        }
        if (statusFilter !== 'ALL') {
            filtered = filtered.filter(t => t.status === statusFilter);
        }
        if (categoryFilter !== 'ALL') {
            filtered = filtered.filter(t => t.category === categoryFilter);
        }
        setFilteredTemplates(filtered);
    }, [searchQuery, statusFilter, categoryFilter, templates]);

    const handleCreate = () => setEditingTemplateId('new');
    const handleEdit = (templateId) => setEditingTemplateId(templateId);
    const handleBack = () => { setEditingTemplateId(null); fetchTemplates(); };

    const handleDelete = async (template) => {
        const confirmed = await showDanger(
            `Template "${template.name}" will be permanently deleted.`,
            "Delete Template?"
        );
        if (!confirmed) return;
        try {
            await api.delete(`/whatsapp/templates/${template._id}`);
            showSuccess('Template deleted successfully!');
            fetchTemplates();
        } catch (error) {
            console.error('Error deleting template:', error);
            showError(error.response?.data?.message || 'Failed to delete template');
        }
    };

    const handleDuplicate = async (template) => {
        try {
            await api.post(`/whatsapp/templates/${template._id}/duplicate`);
            showSuccess('Template duplicated successfully!');
            fetchTemplates();
        } catch (error) {
            console.error('Error duplicating template:', error);
            showError(error.response?.data?.message || 'Failed to duplicate template');
        }
    };

    const getHeaderType = (template) => {
        const header = template.components?.find(c => c.type === 'HEADER');
        return header?.format || 'TEXT';
    };

    const statusTabs = [
        { key: 'ALL', label: 'All', icon: 'fa-circle' },
        { key: 'DRAFT', label: 'Draft', icon: 'fa-file-pen' },
        { key: 'PENDING', label: 'Pending', icon: 'fa-clock' },
        { key: 'APPROVED', label: 'Approved', icon: 'fa-check-circle' },
        { key: 'REJECTED', label: 'Rejected', icon: 'fa-times-circle' },
    ];

    const getStatusCount = (status) => {
        if (status === 'ALL') return templates.length;
        return templates.filter(t => t.status === status).length;
    };

    if (editingTemplateId) {
        return <TemplateBuilder templateId={editingTemplateId} onBack={handleBack} />;
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-4 border-green-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-green-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#f8f9fa]">
            {/* Top Bar */}
            <div className="bg-white border-b border-gray-200 px-6 py-5">
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Message Templates</h2>
                        <p className="text-xs text-gray-500 mt-0.5">Manage your Meta-approved WhatsApp templates</p>
                    </div>
                    <button
                        onClick={handleCreate}
                        className="bg-[#008069] hover:bg-[#006e5b] text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i>
                        New Template
                    </button>
                </div>

                {/* Search & Sync Row */}
                <div className="flex items-center gap-3 mb-5">
                    <div className="flex-1 max-w-md relative">
                        <input
                            type="text"
                            placeholder="Search templates (status, name etc.)"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-4 pr-10 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#008069] focus:ring-1 focus:ring-[#008069]/20 transition-colors"
                        />
                        <i className="fa-solid fa-magnifying-glass absolute right-3 top-1/2 -translate-y-1/2 text-[#008069] text-sm"></i>
                    </div>
                    {/* Category Filter */}
                    <select
                        value={categoryFilter}
                        onChange={(e) => setCategoryFilter(e.target.value)}
                        className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-700 focus:outline-none focus:border-[#008069] cursor-pointer"
                    >
                        <option value="ALL">All Categories</option>
                        <option value="UTILITY">Utility</option>
                        <option value="MARKETING">Marketing</option>
                        <option value="AUTHENTICATION">Authentication</option>
                    </select>
                    <button
                        onClick={handleSyncStatus}
                        disabled={syncing}
                        className="ml-auto bg-[#008069] hover:bg-[#006e5b] text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2 disabled:opacity-60"
                    >
                        <i className={`fa-solid fa-arrows-rotate ${syncing ? 'animate-spin' : ''}`}></i>
                        Sync Status
                    </button>
                </div>

                {/* Status Tabs */}
                <div className="flex items-center gap-1 border-b border-gray-200 -mb-5 -mx-6 px-6">
                    {statusTabs.map(tab => {
                        const count = getStatusCount(tab.key);
                        const isActive = statusFilter === tab.key;
                        return (
                            <button
                                key={tab.key}
                                onClick={() => setStatusFilter(tab.key)}
                                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                                    isActive
                                        ? 'border-[#008069] text-[#008069]'
                                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                                }`}
                            >
                                <i className={`fa-solid ${tab.icon} text-xs`}></i>
                                {tab.label}
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                    isActive ? 'bg-[#008069]/10 text-[#008069]' : 'bg-gray-100 text-gray-500'
                                }`}>{count}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
                {filteredTemplates.length === 0 ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
                        <i className="fa-brands fa-whatsapp text-4xl text-gray-300 mb-4 block"></i>
                        <h3 className="text-base font-semibold text-gray-700">No Templates Found</h3>
                        <p className="text-gray-400 text-sm mt-1">
                            {templates.length === 0 ? "Create your first template to get started." : "No templates match your filters."}
                        </p>
                        {templates.length === 0 && (
                            <button onClick={handleCreate} className="mt-4 text-[#008069] font-semibold text-sm hover:underline">
                                <i className="fa-solid fa-plus mr-1"></i> Create Template
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        {/* Table Header */}
                        <div className="grid grid-cols-[2fr_1.2fr_1fr_0.8fr_0.8fr_1.2fr_1fr] gap-4 px-5 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            <span>Name</span>
                            <span>Category</span>
                            <span>Status</span>
                            <span>Type</span>
                            <span>Health</span>
                            <span>Created At</span>
                            <span className="text-right">Action</span>
                        </div>

                        {/* Table Rows */}
                        {filteredTemplates.map((template, idx) => (
                            <div
                                key={template._id}
                                className={`grid grid-cols-[2fr_1.2fr_1fr_0.8fr_0.8fr_1.2fr_1fr] gap-4 px-5 py-4 items-center hover:bg-gray-50/80 transition-colors cursor-pointer ${
                                    idx !== filteredTemplates.length - 1 ? 'border-b border-gray-100' : ''
                                }`}
                                onClick={() => handleEdit(template._id)}
                            >
                                {/* Name */}
                                <span className="text-sm font-medium text-gray-800 truncate" title={template.name}>
                                    {template.name}
                                </span>

                                {/* Category */}
                                <span className="text-sm text-gray-600 uppercase tracking-wide font-medium">
                                    {template.category}
                                </span>

                                {/* Status */}
                                <span>
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${
                                        template.status === 'APPROVED' ? 'text-emerald-700 bg-emerald-50' :
                                        template.status === 'PENDING' ? 'text-amber-700 bg-amber-50' :
                                        template.status === 'REJECTED' ? 'text-rose-700 bg-rose-50' :
                                        template.status === 'DRAFT' ? 'text-slate-600 bg-slate-50' :
                                        'text-gray-600 bg-gray-50'
                                    }`}>
                                        <i className={`fa-solid ${
                                            template.status === 'APPROVED' ? 'fa-check-circle' :
                                            template.status === 'PENDING' ? 'fa-clock' :
                                            template.status === 'REJECTED' ? 'fa-times-circle' :
                                            'fa-file'
                                        } text-[10px]`}></i>
                                        {template.status}
                                    </span>
                                </span>

                                {/* Type */}
                                <span className="text-sm text-gray-600">
                                    {getHeaderType(template)}
                                </span>

                                {/* Health / Quality */}
                                <span>
                                    {template.quality && template.quality !== 'UNKNOWN' ? (
                                        <span className={`inline-block px-2.5 py-0.5 rounded text-xs font-bold text-white ${
                                            template.quality === 'HIGH' ? 'bg-emerald-500' :
                                            template.quality === 'MEDIUM' ? 'bg-amber-500' :
                                            'bg-rose-500'
                                        }`}>
                                            {template.quality === 'HIGH' ? 'High' : template.quality === 'MEDIUM' ? 'Medium' : 'Low'}
                                        </span>
                                    ) : (
                                        <span className="text-xs text-gray-400">—</span>
                                    )}
                                </span>

                                {/* Created At */}
                                <span className="text-sm text-gray-500">
                                    {template.createdAt ? new Date(template.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                                </span>

                                {/* Actions */}
                                <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => handleEdit(template._id)}
                                        className="p-2 text-gray-400 hover:text-[#008069] hover:bg-[#008069]/5 rounded-lg transition-colors"
                                        title="Edit"
                                    >
                                        <i className="fa-solid fa-pen-to-square text-sm"></i>
                                    </button>
                                    <button
                                        onClick={() => handleDuplicate(template)}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="Duplicate"
                                    >
                                        <i className="fa-regular fa-copy text-sm"></i>
                                    </button>
                                    <button
                                        onClick={() => handleDelete(template)}
                                        className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                        title="Delete"
                                    >
                                        <i className="fa-regular fa-trash-can text-sm"></i>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default WhatsAppTemplates;
