import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import TemplateModal from './TemplateModal';
import TemplateDetailsModal from './TemplateDetailsModal';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotification } from '../../context/NotificationContext';

const TRIGGER_META = {
    on_lead_create: { label: 'On Lead Create', icon: 'fa-user-plus', color: 'text-violet-600', bg: 'bg-violet-50' },
    on_stage_change: { label: 'Stage Change', icon: 'fa-arrows-rotate', color: 'text-amber-600', bg: 'bg-amber-50' },
    manual: { label: 'Manual', icon: 'fa-hand-pointer', color: 'text-slate-500', bg: 'bg-slate-100' }
};

const TemplateCard = ({ template, onView, onEdit, onDelete }) => {
    const trigger = TRIGGER_META[template.triggerType] || TRIGGER_META.manual;

    return (
        <div className="group bg-white rounded-2xl border border-slate-200 hover:border-indigo-200 hover:shadow-lg transition-all duration-200 flex flex-col overflow-hidden">
            {/* Card Header Strip */}
            <div className={`h-1.5 w-full ${template.isActive ? 'bg-gradient-to-r from-indigo-500 to-blue-400' : 'bg-slate-200'}`} />

            <div className="p-5 flex-1 flex flex-col gap-3">
                {/* Title + badges */}
                <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-bold text-slate-800 leading-snug line-clamp-2 flex-1">{template.name}</h3>
                    <span className={`flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${template.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                        {template.isActive ? 'Active' : 'Off'}
                    </span>
                </div>

                {/* Subject */}
                <p className="text-xs text-slate-500 line-clamp-1 font-medium">
                    <span className="text-slate-300 mr-1">Sub:</span>{template.subject || '(No subject)'}
                </p>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full ${trigger.bg} ${trigger.color}`}>
                        <i className={`fa-solid ${trigger.icon} text-[10px]`}></i>
                        {trigger.label}
                    </span>
                    {template.isAutomated && (
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600">
                            <i className="fa-solid fa-robot text-[10px]"></i>
                            Auto
                        </span>
                    )}
                    {template.attachments?.length > 0 && (
                        <span className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                            <i className="fa-solid fa-paperclip text-[10px]"></i>
                            {template.attachments.length}
                        </span>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="px-5 pb-4 flex gap-2">
                <button
                    onClick={() => onView(template)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-indigo-600 hover:text-white text-slate-600 transition-all duration-150"
                >
                    <i className="fa-solid fa-eye"></i> View
                </button>
                <button
                    onClick={() => onEdit(template)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-700 hover:text-white text-slate-600 transition-all duration-150"
                >
                    <i className="fa-solid fa-pen"></i> Edit
                </button>
                <button
                    onClick={() => onDelete(template._id)}
                    className="w-9 flex items-center justify-center py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-rose-500 hover:text-white text-slate-400 transition-all duration-150"
                >
                    <i className="fa-solid fa-trash"></i>
                </button>
            </div>
        </div>
    );
};

const EmailTemplates = () => {
    const { showDanger } = useConfirm();
    const { showError, showSuccess } = useNotification();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false);
    const [search, setSearch] = useState('');
    const [filterTab, setFilterTab] = useState('all');

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/email-templates');
            setTemplates(res.data);
        } catch (error) {
            console.error("Error fetching templates", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchTemplates(); }, []);

    const handleCreateClick = () => {
        setSelectedTemplate(null);
        setIsEditMode(false);
        setIsCreateModalOpen(true);
    };

    const handleViewClick = (template) => {
        setSelectedTemplate(template);
        setIsDetailsModalOpen(true);
    };

    const handleEditClick = (template) => {
        setSelectedTemplate(template);
        setIsDetailsModalOpen(false);
        setIsEditMode(true);
        setIsCreateModalOpen(true);
    };

    const handleDeleteClick = async (id) => {
        const confirmed = await showDanger("Are you sure you want to delete this template?", "Delete Template");
        if (!confirmed) return;
        try {
            await api.delete(`/email-templates/${id}`);
            setIsDetailsModalOpen(false);
            showSuccess("Template deleted successfully");
            fetchTemplates();
        } catch {
            showError("Failed to delete template");
        }
    };

    const filtered = templates.filter(t => {
        const matchSearch = !search ||
            t.name.toLowerCase().includes(search.toLowerCase()) ||
            t.subject?.toLowerCase().includes(search.toLowerCase());
        const matchTab =
            filterTab === 'all' ||
            (filterTab === 'active' && t.isActive) ||
            (filterTab === 'automated' && t.isAutomated) ||
            (filterTab === 'inactive' && !t.isActive);
        return matchSearch && matchTab;
    });

    const counts = {
        all: templates.length,
        active: templates.filter(t => t.isActive).length,
        automated: templates.filter(t => t.isAutomated).length,
        inactive: templates.filter(t => !t.isActive).length,
    };

    if (loading) return (
        <div className="flex flex-col items-center justify-center h-64 gap-3">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-slate-500 font-medium">Loading templates...</p>
        </div>
    );

    return (
        <div className="p-6 flex flex-col gap-5">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                {/* Search */}
                <div className="relative w-full sm:w-72">
                    <i className="fa-solid fa-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                    <input
                        type="text"
                        placeholder="Search templates..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-100 border-transparent focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 border rounded-xl text-sm transition outline-none"
                    />
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'active', label: 'Active' },
                        { id: 'automated', label: 'Automated' },
                        { id: 'inactive', label: 'Inactive' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setFilterTab(tab.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filterTab === tab.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            {tab.label}
                            <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full ${filterTab === tab.id ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-200 text-slate-500'}`}>
                                {counts[tab.id]}
                            </span>
                        </button>
                    ))}
                </div>

                {/* New Template */}
                <button
                    onClick={handleCreateClick}
                    className="flex-shrink-0 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-md shadow-indigo-200 hover:shadow-indigo-300"
                >
                    <i className="fa-solid fa-plus"></i> New Template
                </button>
            </div>

            {/* Grid */}
            {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="w-20 h-20 bg-slate-100 rounded-2xl flex items-center justify-center">
                        <i className="fa-solid fa-layer-group text-3xl text-slate-300"></i>
                    </div>
                    <div className="text-center">
                        <p className="text-slate-600 font-semibold text-base">
                            {search || filterTab !== 'all' ? 'No templates match your filter' : 'No templates yet'}
                        </p>
                        <p className="text-slate-400 text-sm mt-1">
                            {search || filterTab !== 'all' ? 'Try a different search or filter' : 'Create a reusable email template to get started'}
                        </p>
                    </div>
                    {!search && filterTab === 'all' && (
                        <button
                            onClick={handleCreateClick}
                            className="mt-2 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow-md"
                        >
                            <i className="fa-solid fa-plus"></i> Create First Template
                        </button>
                    )}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filtered.map(template => (
                        <TemplateCard
                            key={template._id}
                            template={template}
                            onView={handleViewClick}
                            onEdit={handleEditClick}
                            onDelete={handleDeleteClick}
                        />
                    ))}
                </div>
            )}

            <TemplateModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSuccess={fetchTemplates}
                template={isEditMode ? selectedTemplate : null}
            />
            <TemplateDetailsModal
                isOpen={isDetailsModalOpen}
                onClose={() => setIsDetailsModalOpen(false)}
                template={selectedTemplate}
                onEdit={handleEditClick}
                onDelete={handleDeleteClick}
                onRefresh={fetchTemplates}
            />
        </div>
    );
};

export default EmailTemplates;
