import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

const AddLeadModal = ({ isOpen, onClose, onSuccess, userTags = [] }) => {
    const [formData, setFormData] = useState({ name: '', phone: '', email: '', dealValue: '' });
    const [customData, setCustomData] = useState({});
    const [selectedTags, setSelectedTags] = useState([]);
    const [customFields, setCustomFields] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Duplicate detection state
    const [duplicateWarning, setDuplicateWarning] = useState(null);
    const [checkingDuplicate, setCheckingDuplicate] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchCustomFields();
            setDuplicateWarning(null);
            setError(null);
        } else {
            // Reset on close
            setFormData({ name: '', phone: '', email: '', dealValue: '' });
            setCustomData({});
            setSelectedTags([]);
            setDuplicateWarning(null);
            setError(null);
        }
    }, [isOpen]);

    const fetchCustomFields = async () => {
        try {
            const res = await api.get('/custom-fields');
            setCustomFields(res.data || []);
            const initialCustomData = {};
            (res.data || []).forEach(field => { initialCustomData[field.key] = ''; });
            setCustomData(initialCustomData);
        } catch (err) {
            console.error('Failed to fetch custom fields:', err);
        }
    };

    const checkForDuplicates = useCallback(async (phone, email) => {
        if (!phone && !email) { setDuplicateWarning(null); return; }
        setCheckingDuplicate(true);
        try {
            const res = await api.post('/leads/check-duplicates', { phone, email });
            if (res.data.hasDuplicates) setDuplicateWarning(res.data.duplicates[0]);
            else setDuplicateWarning(null);
        } catch (err) {
            console.error('Duplicate check failed:', err);
        } finally {
            setCheckingDuplicate(false);
        }
    }, []);

    const handlePhoneBlur = () => { if (formData.phone.trim()) checkForDuplicates(formData.phone, formData.email); };
    const handleEmailBlur = () => { if (formData.email.trim()) checkForDuplicates(formData.phone, formData.email); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        for (const field of customFields) {
            if (field.required && !customData[field.key]) {
                setError(`${field.label} is required`);
                setLoading(false);
                return;
            }
        }
        try {
            const payload = { ...formData, customData, tags: selectedTags };
            const res = await api.post('/leads', payload);
            if (res.status === 200 || res.status === 201) {
                onSuccess(res.data);
                onClose();
            }
        } catch (err) {
            if (err.response?.status === 409 && err.response?.data?.duplicate) {
                setDuplicateWarning(err.response.data.existingLead);
                setError(err.response.data.message);
            } else {
                setError(err.response?.data?.message || 'Failed to add lead');
            }
        } finally {
            setLoading(false);
        }
    };

    const handleForceCreate = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.post('/leads', { ...formData, customData, tags: selectedTags, force: true });
            if (res.status === 200 || res.status === 201) {
                onSuccess(res.data);
                onClose();
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to add lead');
        } finally {
            setLoading(false);
        }
    };

    const handleCustomFieldChange = (key, value) => {
        setCustomData(prev => ({ ...prev, [key]: value }));
    };

    const INPUT = "w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition";

    const renderCustomField = (field) => {
        switch (field.type) {
            case 'dropdown':
                return (
                    <select value={customData[field.key] || ''} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} className={INPUT} required={field.required}>
                        <option value="">Select {field.label}</option>
                        {(field.options || []).map((opt, idx) => <option key={idx} value={opt}>{opt}</option>)}
                    </select>
                );
            case 'date':
                return <input type="date" value={customData[field.key] || ''} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} className={INPUT} required={field.required} />;
            case 'number':
                return <input type="number" value={customData[field.key] || ''} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} className={INPUT} placeholder={`Enter ${field.label}`} required={field.required} />;
            case 'email':
                return <input type="email" value={customData[field.key] || ''} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} className={INPUT} placeholder={`Enter ${field.label}`} required={field.required} />;
            case 'phone':
                return <input type="tel" value={customData[field.key] || ''} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} className={INPUT} placeholder={`Enter ${field.label}`} required={field.required} />;
            default:
                return <input type="text" value={customData[field.key] || ''} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} className={INPUT} placeholder={`Enter ${field.label}`} required={field.required} />;
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">

                {/* ── Header ── */}
                <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-6 py-5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center">
                            <i className="fa-solid fa-user-plus text-white text-lg"></i>
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-white">Add New Lead</h2>
                            <p className="text-blue-100 text-xs">Fill in the details below to create a new lead</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 text-white transition flex items-center justify-center">
                        <i className="fa-solid fa-xmark text-base"></i>
                    </button>
                </div>

                {/* ── Body ── */}
                <div className="flex-1 overflow-y-auto px-6 py-5">

                    {/* Error */}
                    {error && (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 px-4 py-2.5 rounded-xl text-sm mb-4">
                            <i className="fa-solid fa-circle-exclamation shrink-0"></i>
                            {error}
                        </div>
                    )}

                    {/* Duplicate Warning */}
                    {duplicateWarning && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                            <div className="flex items-start gap-3">
                                <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
                                    <i className="fa-solid fa-triangle-exclamation text-amber-500"></i>
                                </div>
                                <div className="flex-1">
                                    <p className="text-amber-800 text-sm font-bold">Duplicate Detected!</p>
                                    <p className="text-amber-600 text-xs mt-0.5">A lead with matching info already exists:</p>
                                    <div className="bg-white rounded-lg p-3 mt-2 border border-amber-200">
                                        <p className="text-sm font-bold text-slate-700">{duplicateWarning.name}</p>
                                        <p className="text-xs text-slate-500 mt-0.5">
                                            📞 {duplicateWarning.phone}
                                            {duplicateWarning.email && ` · ✉️ ${duplicateWarning.email}`}
                                        </p>
                                        <p className="text-[10px] text-slate-400 mt-1">
                                            Status: {duplicateWarning.status} · Source: {duplicateWarning.source}
                                        </p>
                                    </div>
                                    <button type="button" onClick={handleForceCreate} disabled={loading}
                                        className="mt-3 w-full bg-amber-500 hover:bg-amber-600 text-white py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50">
                                        {loading ? 'Saving...' : '⚡ Save Anyway (Force Create)'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4" id="add-lead-form">

                        {/* ── Core Info Section ── */}
                        <div>
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <span className="w-4 h-px bg-slate-300 inline-block"></span>
                                Contact Information
                                <span className="flex-1 h-px bg-slate-100 inline-block"></span>
                            </p>

                            {/* Name + Phone — 2 columns */}
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                                        Full Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="text" required
                                        className={INPUT}
                                        placeholder="e.g. Rahul Sharma"
                                        value={formData.name}
                                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                                        Phone <span className="text-red-500">*</span>
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text" required
                                            className={INPUT}
                                            placeholder="e.g. +91 98765 43210"
                                            value={formData.phone}
                                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                            onBlur={handlePhoneBlur}
                                        />
                                        {checkingDuplicate && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <div className="w-4 h-4 border-2 border-indigo-200 border-t-indigo-500 rounded-full animate-spin"></div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Email + Deal Value — 2 columns */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Email</label>
                                    <input
                                        type="email"
                                        className={INPUT}
                                        placeholder="email@example.com"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        onBlur={handleEmailBlur}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
                                        <i className="fa-solid fa-indian-rupee-sign text-emerald-500 text-[10px]"></i>
                                        Deal Value
                                    </label>
                                    <input
                                        type="number" min="0"
                                        className={INPUT}
                                        placeholder="e.g. 50000"
                                        value={formData.dealValue}
                                        onChange={(e) => setFormData({ ...formData, dealValue: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* ── Tags ── */}
                        {userTags && userTags.length > 0 && (
                            <div>
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <span className="w-4 h-px bg-slate-300 inline-block"></span>
                                    Tags
                                    <span className="flex-1 h-px bg-slate-100 inline-block"></span>
                                </p>
                                <div className="flex flex-wrap gap-2 p-3 border border-slate-200 rounded-xl bg-slate-50/50 max-h-28 overflow-y-auto">
                                    {userTags.map(tag => (
                                        <label key={tag._id} className="flex items-center gap-1.5 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={selectedTags.includes(tag.name)}
                                                onChange={(e) => {
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
                            <div>
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <span className="w-4 h-px bg-slate-300 inline-block"></span>
                                    Additional Information
                                    <span className="flex-1 h-px bg-slate-100 inline-block"></span>
                                </p>
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

                {/* ── Footer ── */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2 shrink-0">
                    <button type="button" onClick={onClose} disabled={loading}
                        className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-200/70 transition disabled:opacity-50">
                        Cancel
                    </button>
                    <button type="submit" form="add-lead-form" disabled={loading}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg transition disabled:opacity-50">
                        {loading
                            ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving…</>
                            : <><i className="fa-solid fa-user-plus"></i> Save Lead</>
                        }
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddLeadModal;
