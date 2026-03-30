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

    const getStatusBadge = (status) => {
        const badges = {
            APPROVED: { bg: 'bg-emerald-100', text: 'text-emerald-800', icon: 'fa-check-circle', border: 'border-emerald-200' },
            PENDING: { bg: 'bg-amber-100', text: 'text-amber-800', icon: 'fa-clock', border: 'border-amber-200' },
            REJECTED: { bg: 'bg-rose-100', text: 'text-rose-800', icon: 'fa-times-circle', border: 'border-rose-200' },
            DRAFT: { bg: 'bg-slate-100', text: 'text-slate-800', icon: 'fa-file', border: 'border-slate-200' },
            PAUSED: { bg: 'bg-orange-100', text: 'text-orange-800', icon: 'fa-pause-circle', border: 'border-orange-200' },
            DISABLED: { bg: 'bg-gray-100', text: 'text-gray-600', icon: 'fa-ban', border: 'border-gray-200' }
        };
        const badge = badges[status] || badges.DRAFT;
        return (
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${badge.bg} ${badge.text} ${badge.border} flex items-center gap-1.5 shadow-sm`}>
                <i className={`fa-solid ${badge.icon}`}></i>
                {status}
            </span>
        );
    };

    const getQualityBadge = (quality) => {
        if (!quality || quality === 'UNKNOWN') return null;
        const badges = {
            HIGH: { bg: 'bg-emerald-500', text: 'text-white', icon: 'fa-star' },
            MEDIUM: { bg: 'bg-amber-500', text: 'text-white', icon: 'fa-star-half-stroke' },
            LOW: { bg: 'bg-rose-500', text: 'text-white', icon: 'fa-star' }
        };
        const badge = badges[quality];
        return (
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${badge.bg} ${badge.text} flex items-center gap-1 shadow-sm`}>
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
                <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-4 border-green-100 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-green-500 rounded-full border-t-transparent animate-spin"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#f0f2f5]">
            {/* Optimized Header & Filters */}
            <div className="bg-white border-b border-gray-200 px-8 py-6 shadow-sm z-10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div>
                        <h2 className="text-2xl font-black text-[#111b21] tracking-tight">Message Templates</h2>
                        <p className="text-sm text-gray-500 mt-1 font-medium">
                            Manage and deploy Meta-approved messaging assets
                        </p>
                    </div>
                    <button
                        onClick={handleCreate}
                        className="bg-[#008069] hover:bg-[#00a884] text-white px-6 py-3 rounded-2xl text-sm font-bold transition-all shadow-[0_4px_12px_rgba(0,128,105,0.3)] hover:shadow-[0_6px_20px_rgba(0,128,105,0.4)] hover:-translate-y-0.5 flex items-center justify-center gap-2 group"
                    >
                        <i className="fa-solid fa-plus group-hover:rotate-90 transition-transform duration-300"></i>
                        New Template
                    </button>
                </div>

                {/* Filters Row */}
                <div className="flex flex-wrap items-center gap-4">
                    {/* Search - Modern Style */}
                    <div className="flex-1 min-w-[280px]">
                        <div className="relative group">
                            <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-[#008069] transition-colors"></i>
                            <input
                                type="text"
                                placeholder="Search by name or content..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-12 pr-4 py-3 bg-gray-50 border-2 border-transparent focus:border-[#008069]/20 focus:bg-white rounded-2xl focus:ring-4 focus:ring-[#008069]/5 outline-none transition-all text-sm font-medium"
                            />
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Status Filter */}
                        <div className="relative font-bold text-xs text-gray-400 uppercase tracking-widest flex items-center gap-2">
                           <i className="fa-solid fa-filter text-[10px]"></i> Filters:
                        </div>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="pl-4 pr-10 py-3 bg-gray-50 border-2 border-transparent focus:border-[#008069]/20 rounded-2xl text-sm font-bold text-gray-700 outline-none transition-all cursor-pointer appearance-none"
                            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%236b7280\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1.25rem' }}
                        >
                            <option value="ALL">All Statuses</option>
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
                            className="pl-4 pr-10 py-3 bg-gray-50 border-2 border-transparent focus:border-[#008069]/20 rounded-2xl text-sm font-bold text-gray-700 outline-none transition-all cursor-pointer appearance-none"
                            style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%236b7280\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center', backgroundSize: '1.25rem' }}
                        >
                            <option value="ALL">All Categories</option>
                            <option value="UTILITY">Utility</option>
                            <option value="MARKETING">Marketing</option>
                            <option value="AUTHENTICATION">Authentication</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Templates Grid */}
            <div className="flex-1 overflow-y-auto p-8">
                {filteredTemplates.length === 0 ? (
                    <div className="text-center py-24 bg-white rounded-3xl border-2 border-dashed border-gray-200 shadow-sm">
                        <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                            <i className="fa-brands fa-whatsapp text-4xl text-gray-300"></i>
                        </div>
                        <h3 className="text-lg font-bold text-gray-800">No Templates Found</h3>
                        <p className="text-gray-400 text-sm mt-1 max-w-xs mx-auto">
                            {templates.length === 0 
                                ? "You haven't created any WhatsApp templates yet. Start by creating your first one!" 
                                : "No templates match your current filter criteria."}
                        </p>
                        {templates.length === 0 && (
                            <button
                                onClick={handleCreate}
                                className="mt-6 text-[#008069] font-bold text-sm hover:underline"
                            >
                                <i className="fa-solid fa-plus-circle mr-2"></i>
                                Create your first template
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {filteredTemplates.map(template => {
                            const bodyComponent = template.components?.find(c => c.type === 'BODY');
                            const headerComponent = template.components?.find(c => c.type === 'HEADER');
                            const buttonComponent = template.components?.find(c => c.type === 'BUTTONS');
                            const footerComponent = template.components?.find(c => c.type === 'FOOTER');

                            const categoryColors = {
                                MARKETING: 'from-purple-500 to-indigo-600',
                                UTILITY: 'from-blue-500 to-cyan-600',
                                AUTHENTICATION: 'from-amber-500 to-orange-600'
                            };
                            const catGradient = categoryColors[template.category] || 'from-gray-500 to-slate-600';

                            return (
                                <div key={template._id} className="group bg-white rounded-[2rem] shadow-sm hover:shadow-2xl transition-all duration-500 border border-gray-100 overflow-hidden flex flex-col hover:-translate-y-1">
                                    {/* Card Header with Dynamic Gradient */}
                                    <div className={`bg-gradient-to-br ${catGradient} p-5 relative overflow-hidden`}>
                                        <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                                        <div className="flex items-start justify-between relative z-10">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="px-2 py-0.5 bg-white/20 backdrop-blur-md rounded-md text-[9px] font-black text-white uppercase tracking-wider border border-white/20">
                                                        {template.category}
                                                    </span>
                                                </div>
                                                <h3 className="text-base font-black text-white truncate drop-shadow-sm">
                                                    {template.name}
                                                </h3>
                                            </div>
                                            <div className="bg-white/20 backdrop-blur-md p-2 rounded-xl border border-white/20">
                                                <i className={`fa-solid ${
                                                    template.category === 'MARKETING' ? 'fa-bullhorn' :
                                                    template.category === 'UTILITY' ? 'fa-wrench' : 'fa-shield-halved'
                                                } text-white text-sm`}></i>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 mt-4 relative z-10">
                                            {getStatusBadge(template.status)}
                                            {getQualityBadge(template.quality)}
                                        </div>
                                    </div>

                                    {/* Card Body - WhatsApp Bubble Style Preview */}
                                    <div className="p-6 flex-1 flex flex-col bg-gray-50/50">
                                        <div className="bg-white rounded-2xl p-4 mb-5 shadow-sm border border-gray-100 flex-1 relative overflow-hidden">
                                            {/* Decorative WA pattern */}
                                            <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                                                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h40v40H0z' fill='none'/%3E%3Cpath d='M20 20l10-10M10 30l10-10' stroke='%23000' stroke-width='1'/%3E%3C/svg%3E")` }}>
                                            </div>
                                            
                                            <div className="relative z-10">
                                                {headerComponent && (headerComponent.text || headerComponent.format !== 'TEXT') && (
                                                    <div className="font-bold text-[#111b21] mb-2 text-xs border-b border-gray-100 pb-2 flex items-center gap-2">
                                                        <i className={`fa-solid ${headerComponent.format === 'TEXT' ? 'fa-heading' : 'fa-image'} text-gray-400 text-[10px]`}></i>
                                                        {headerComponent.format === 'TEXT' ? headerComponent.text : `[${headerComponent.format} HEADER]`}
                                                    </div>
                                                )}
                                                <div className="text-xs text-[#3b4a54] whitespace-pre-wrap line-clamp-4 leading-relaxed italic">
                                                    {bodyComponent?.text || 'No content provided'}
                                                </div>
                                                {footerComponent?.text && (
                                                    <div className="mt-3 pt-2 border-t border-gray-50 text-[10px] text-gray-400 font-medium">
                                                        {footerComponent.text}
                                                    </div>
                                                )}
                                                {buttonComponent && buttonComponent.buttons && buttonComponent.buttons.length > 0 && (
                                                    <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 gap-1.5">
                                                        {buttonComponent.buttons.map((btn, idx) => (
                                                            <div key={idx} className="text-[10px] text-[#00a5f4] font-bold text-center py-1.5 bg-blue-50/50 rounded-lg border border-blue-100/50">
                                                                <i className={`fa-solid ${btn.type === 'URL' ? 'fa-external-link' : btn.type === 'PHONE_NUMBER' ? 'fa-phone' : 'fa-reply'} mr-1.5 text-[8px]`}></i>
                                                                {btn.text}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* Analytics Mini Dashboard */}
                                        {template.analytics && template.analytics.sent > 0 && (
                                            <div className="bg-white rounded-xl p-3 mb-6 border border-gray-100 grid grid-cols-4 gap-1 shadow-sm">
                                                <div className="text-center">
                                                    <div className="font-black text-gray-800 text-xs">{template.analytics.sent}</div>
                                                    <div className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Sent</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="font-black text-emerald-600 text-xs">{template.analytics.delivered}</div>
                                                    <div className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Deliv</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="font-black text-blue-600 text-xs">{template.analytics.read}</div>
                                                    <div className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Read</div>
                                                </div>
                                                <div className="text-center">
                                                    <div className="font-black text-rose-600 text-xs">{template.analytics.failed}</div>
                                                    <div className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Fail</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Actions Row */}
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
                                            <button
                                                onClick={() => handleEdit(template._id)}
                                                className="flex-[2] bg-[#f0f2f5] hover:bg-[#008069] text-gray-700 hover:text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm"
                                            >
                                                <i className="fa-solid fa-pen-to-square"></i>
                                                Configure
                                            </button>
                                            <button
                                                onClick={() => handleDuplicate(template)}
                                                className="flex-1 bg-white hover:bg-blue-50 text-blue-600 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border border-blue-100 flex items-center justify-center shadow-sm"
                                                title="Duplicate"
                                            >
                                                <i className="fa-solid fa-copy"></i>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(template)}
                                                className="flex-1 bg-white hover:bg-rose-50 text-rose-500 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border border-rose-100 flex items-center justify-center shadow-sm"
                                                title="Delete"
                                            >
                                                <i className="fa-solid fa-trash-can"></i>
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
