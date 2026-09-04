import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import CustomFieldInput from './CustomFieldInput';
import { initCustomData, validateCustomFields } from '../../utils/customFieldHelpers';

const EditLeadModal = ({ isOpen, onClose, lead, userTags = [], onSuccess }) => {
    const [formData, setFormData] = useState({ name: '', phone: '', email: '', dealValue: '', nextFollowUpDate: '' });
    const [customData, setCustomData]   = useState({});
    const [selectedTags, setSelectedTags] = useState([]);
    const [customFields, setCustomFields] = useState([]);
    const [loading, setLoading]  = useState(false);
    const [error, setError]      = useState(null);

    // Follow-up template scheduling
    const [sendTemplate, setSendTemplate]       = useState(false);
    const [templateType, setTemplateType]       = useState('whatsapp');
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [templates, setTemplates]             = useState([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);

    // ── Populate form when modal opens ──────────────────────────────────────
    useEffect(() => {
        if (isOpen && lead) {
            setFormData({
                name:             lead.name             || '',
                phone:            lead.phone            || '',
                email:            lead.email            || '',
                dealValue:        lead.dealValue        || '',
                nextFollowUpDate: lead.nextFollowUpDate
                    ? new Date(lead.nextFollowUpDate).toISOString().split('T')[0]
                    : ''
            });
            setSelectedTags(lead.tags || []);
            setSendTemplate(false);
            setTemplateType('whatsapp');
            setSelectedTemplate('');
            setTemplates([]);
            setError(null);
            fetchCustomFields(lead.customData || {});
        }
    }, [isOpen, lead]);

    // ── Fetch templates when follow-up scheduling is enabled ────────────────
    useEffect(() => {
        if (!sendTemplate || !formData.nextFollowUpDate) return;
        const fetchTemplates = async () => {
            setLoadingTemplates(true);
            setSelectedTemplate('');
            try {
                if (templateType === 'whatsapp') {
                    const res = await api.get('/whatsapp/templates?status=APPROVED');
                    const list = res.data?.templates || res.data?.data || [];
                    setTemplates(Array.isArray(list) ? list.filter(t => t.status === 'APPROVED') : []);
                } else {
                    const res = await api.get('/email-templates');
                    const list = Array.isArray(res.data) ? res.data : (res.data?.templates || []);
                    setTemplates(list);
                }
            } catch { setTemplates([]); }
            finally  { setLoadingTemplates(false); }
        };
        fetchTemplates();
    }, [sendTemplate, templateType]);

    const fetchCustomFields = async (existingData) => {
        try {
            const res = await api.get('/custom-fields');
            setCustomFields(res.data || []);
            // Reads a stored value into the shape its type expects — a multi-select
            // saved before the field was converted still loads as an array.
            setCustomData(initCustomData(res.data || [], existingData));
        } catch (err) { console.error('Failed to fetch custom fields:', err); }
    };

    const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
    const handleCustomFieldChange = (key, value) => setCustomData(prev => ({ ...prev, [key]: value }));

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        const customError = validateCustomFields(customFields, customData);
        if (customError) {
            setError(customError);
            setLoading(false);
            return;
        }
        try {
            const payload = {
                ...formData,
                customData,
                tags: selectedTags,
                followUpTemplateType: (sendTemplate && formData.nextFollowUpDate) ? templateType : null,
                followUpTemplateName: (sendTemplate && formData.nextFollowUpDate && selectedTemplate) ? selectedTemplate : null,
            };
            const res = await api.put(`/leads/${lead._id}`, payload);
            const updatedLead = res.data?.lead ?? { ...lead, ...payload };
            onSuccess(updatedLead);
            onClose();
        } catch (err) {
            if (err.response?.data?.error === 'validation_failed' && err.response?.data?.errors) {
                setError(err.response.data.errors.map(e => e.message).join(', '));
            } else {
                setError(err.response?.data?.message || 'Failed to update lead');
            }
        } finally { setLoading(false); }
    };

    // ── Shared input style ───────────────────────────────────────────────────
    const INPUT = "w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition";

    const renderCustomField = (field) => (
        <CustomFieldInput
            field={field}
            value={customData[field.key]}
            onChange={handleCustomFieldChange}
            className={INPUT}
        />
    );

    const SectionDivider = ({ label }) => (
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <span className="w-4 h-px bg-slate-300 inline-block"></span>
            {label}
            <span className="flex-1 h-px bg-slate-100 inline-block"></span>
        </p>
    );

    if (!isOpen || !lead) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">

                {/* ── Header ── */}
                <div className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 px-6 py-5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                            <i className="fa-solid fa-pen-to-square text-white text-lg"></i>
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Edit Lead</h2>
                            <p className="text-indigo-100 text-xs truncate max-w-[280px]">
                                Editing: <span className="font-semibold">{lead.name}</span>
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 text-white transition flex items-center justify-center">
                        <i className="fa-solid fa-xmark text-base"></i>
                    </button>
                </div>

                {/* ── Scrollable Body ── */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                    {/* Error banner */}
                    {error && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-sm">
                            <i className="fa-solid fa-circle-exclamation shrink-0"></i>
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} id="edit-lead-form" className="space-y-5">

                        {/* ── Contact Info ── */}
                        <div className="space-y-3">
                            <SectionDivider label="Contact Information" />

                            {/* Name + Phone */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                                        Full Name <span className="text-red-500">*</span>
                                    </label>
                                    <input type="text" name="name" required value={formData.name} onChange={handleChange} className={INPUT} placeholder="e.g. Rahul Sharma" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Phone</label>
                                    <input type="text" name="phone" value={formData.phone} onChange={handleChange} className={INPUT} placeholder="+91 98765 43210" />
                                </div>
                            </div>

                            {/* Email + Deal Value */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email</label>
                                    <input type="email" name="email" value={formData.email} onChange={handleChange} className={INPUT} placeholder="email@example.com" />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                                        <i className="fa-solid fa-indian-rupee-sign text-emerald-500 text-[10px]"></i> Deal Value
                                    </label>
                                    <input type="number" name="dealValue" min="0" value={formData.dealValue} onChange={handleChange} className={INPUT} placeholder="e.g. 50000" />
                                </div>
                            </div>
                        </div>

                        {/* ── Follow-up ── */}
                        <div className="space-y-3">
                            <SectionDivider label="Follow-up" />

                            <div>
                                <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                                    <i className="fa-regular fa-calendar-check mr-1 text-indigo-400"></i>
                                    Next Follow-up Date
                                </label>
                                <input type="date" name="nextFollowUpDate" value={formData.nextFollowUpDate} onChange={handleChange} className={INPUT} />
                            </div>

                            {/* Auto-send template on follow-up day */}
                            {formData.nextFollowUpDate && (
                                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                                    <label className="flex items-center gap-2.5 cursor-pointer">
                                        <input type="checkbox" checked={sendTemplate} onChange={e => setSendTemplate(e.target.checked)}
                                            className="w-4 h-4 text-indigo-600 rounded border-gray-300" />
                                        <span className="text-sm font-medium text-indigo-800">
                                            <i className="fa-solid fa-paper-plane mr-1 text-indigo-500"></i>
                                            Auto-send a message on this date
                                        </span>
                                    </label>

                                    {sendTemplate && (
                                        <div className="mt-3 space-y-3">
                                            {/* Channel toggle */}
                                            <div className="inline-flex bg-white border border-indigo-200 p-1 rounded-lg gap-1">
                                                <button type="button" onClick={() => setTemplateType('whatsapp')}
                                                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${templateType === 'whatsapp' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                                    <i className="fa-brands fa-whatsapp"></i> WhatsApp
                                                </button>
                                                <button type="button" onClick={() => setTemplateType('email')}
                                                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${templateType === 'email' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                                    <i className="fa-solid fa-envelope"></i> Email
                                                </button>
                                            </div>

                                            {loadingTemplates ? (
                                                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                                                    <i className="fa-solid fa-spinner fa-spin text-indigo-400"></i> Loading templates…
                                                </p>
                                            ) : templates.length === 0 ? (
                                                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg">
                                                    No {templateType === 'whatsapp' ? 'approved WhatsApp' : 'email'} templates found.
                                                </p>
                                            ) : (
                                                <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className={INPUT}>
                                                    <option value="">— Select template —</option>
                                                    {templates.map(t => (
                                                        <option key={t._id || t.name} value={templateType === 'whatsapp' ? t.name : t._id}>{t.name}</option>
                                                    ))}
                                                </select>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ── Tags ── */}
                        {userTags && userTags.length > 0 && (
                            <div className="space-y-3">
                                <SectionDivider label="Tags" />
                                <div className="flex flex-wrap gap-2 p-3 border border-slate-200 rounded-xl bg-slate-50/50 max-h-28 overflow-y-auto">
                                    {userTags.map(tag => (
                                        <label key={tag._id} className="flex items-center gap-1.5 cursor-pointer">
                                            <input type="checkbox"
                                                checked={selectedTags.includes(tag.name)}
                                                onChange={e => {
                                                    if (e.target.checked) setSelectedTags([...selectedTags, tag.name]);
                                                    else setSelectedTags(selectedTags.filter(t => t !== tag.name));
                                                }}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                                            />
                                            <span className="px-2 py-0.5 rounded-full border text-xs font-medium"
                                                style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}>
                                                {tag.name}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Custom Fields ── */}
                        {customFields.length > 0 && (
                            <div className="space-y-3">
                                <SectionDivider label="Additional Information" />
                                <div className="grid grid-cols-2 gap-3">
                                    {customFields.map(field => (
                                        <div key={field.key} className={field.type === 'textarea' ? 'col-span-2' : ''}>
                                            <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                                                {field.label}
                                                {field.required && <span className="text-red-500 ml-1">*</span>}
                                            </label>
                                            {renderCustomField(field)}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                    </form>
                </div>

                {/* ── Sticky Footer ── */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
                    <button type="button" onClick={onClose} disabled={loading}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-200/70 transition disabled:opacity-50">
                        Cancel
                    </button>
                    <button type="submit" form="edit-lead-form" disabled={loading}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-md hover:shadow-lg transition disabled:opacity-50">
                        {loading
                            ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving…</>
                            : <><i className="fa-solid fa-floppy-disk"></i> Save Changes</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EditLeadModal;
