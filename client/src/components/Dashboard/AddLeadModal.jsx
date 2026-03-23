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

    // Fetch custom fields when modal opens
    useEffect(() => {
        if (isOpen) {
            fetchCustomFields();
            // Reset duplicate warning on open
            setDuplicateWarning(null);
        }
    }, [isOpen]);

    const fetchCustomFields = async () => {
        try {
            const res = await api.get('/custom-fields');
            setCustomFields(res.data || []);
            // Initialize customData with empty values
            const initialCustomData = {};
            (res.data || []).forEach(field => {
                initialCustomData[field.key] = '';
            });
            setCustomData(initialCustomData);
        } catch (err) {
            console.error('Failed to fetch custom fields:', err);
        }
    };

    // 🔍 Live duplicate check on phone/email blur
    const checkForDuplicates = useCallback(async (phone, email) => {
        if (!phone && !email) {
            setDuplicateWarning(null);
            return;
        }
        setCheckingDuplicate(true);
        try {
            const res = await api.post('/leads/check-duplicates', { phone, email });
            if (res.data.hasDuplicates) {
                setDuplicateWarning(res.data.duplicates[0]);
            } else {
                setDuplicateWarning(null);
            }
        } catch (err) {
            // Silently ignore — don't block the form
            console.error('Duplicate check failed:', err);
        } finally {
            setCheckingDuplicate(false);
        }
    }, []);

    const handlePhoneBlur = () => {
        if (formData.phone.trim()) {
            checkForDuplicates(formData.phone, formData.email);
        }
    };

    const handleEmailBlur = () => {
        if (formData.email.trim()) {
            checkForDuplicates(formData.phone, formData.email);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        // Validate required custom fields
        for (const field of customFields) {
            if (field.required && !customData[field.key]) {
                setError(`${field.label} is required`);
                setLoading(false);
                return;
            }
        }

        try {
            const payload = {
                ...formData,
                customData: customData,
                tags: selectedTags
            };
            const res = await api.post('/leads', payload);
            if (res.status === 200 || res.status === 201) {
                onSuccess();
                onClose();
                setFormData({ name: '', phone: '', email: '', dealValue: '' });
                setCustomData({});
                setSelectedTags([]);
                setDuplicateWarning(null);
            }
        } catch (err) {
            // Handle duplicate response (409)
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

    // Force create (bypass duplicate check)
    const handleForceCreate = async () => {
        setLoading(true);
        setError(null);
        try {
            const payload = {
                ...formData,
                customData: customData,
                tags: selectedTags,
                force: true
            };
            const res = await api.post('/leads', payload);
            if (res.status === 200 || res.status === 201) {
                onSuccess();
                onClose();
                setFormData({ name: '', phone: '', email: '', dealValue: '' });
                setCustomData({});
                setSelectedTags([]);
                setDuplicateWarning(null);
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

    const renderCustomField = (field) => {
        const baseInputClass = "w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm";

        switch (field.type) {
            case 'dropdown':
                return (
                    <select
                        value={customData[field.key] || ''}
                        onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                        className={baseInputClass}
                        required={field.required}
                    >
                        <option value="">Select {field.label}</option>
                        {(field.options || []).map((opt, idx) => (
                            <option key={idx} value={opt}>{opt}</option>
                        ))}
                    </select>
                );
            case 'date':
                return (
                    <input
                        type="date"
                        value={customData[field.key] || ''}
                        onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                        className={baseInputClass}
                        required={field.required}
                    />
                );
            case 'number':
                return (
                    <input
                        type="number"
                        value={customData[field.key] || ''}
                        onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                        className={baseInputClass}
                        placeholder={`Enter ${field.label}`}
                        required={field.required}
                    />
                );
            case 'email':
                return (
                    <input
                        type="email"
                        value={customData[field.key] || ''}
                        onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                        className={baseInputClass}
                        placeholder={`Enter ${field.label}`}
                        required={field.required}
                    />
                );
            case 'phone':
                return (
                    <input
                        type="tel"
                        value={customData[field.key] || ''}
                        onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                        className={baseInputClass}
                        placeholder={`Enter ${field.label}`}
                        required={field.required}
                    />
                );
            default: // text
                return (
                    <input
                        type="text"
                        value={customData[field.key] || ''}
                        onChange={(e) => handleCustomFieldChange(field.key, e.target.value)}
                        className={baseInputClass}
                        placeholder={`Enter ${field.label}`}
                        required={field.required}
                    />
                );
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-96 max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-800">👤 Add New Lead</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {error && <div className="bg-red-100 text-red-700 p-2 rounded mb-3 text-sm">{error}</div>}

                {/* 🔍 Duplicate Warning Banner */}
                {duplicateWarning && (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-3 animate-fade-in-up">
                        <div className="flex items-start gap-2">
                            <i className="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5"></i>
                            <div className="flex-1">
                                <p className="text-amber-700 text-sm font-bold">Duplicate Detected!</p>
                                <p className="text-amber-600 text-xs mt-1">
                                    A lead with matching info already exists:
                                </p>
                                <div className="bg-white rounded-lg p-2 mt-2 border border-amber-200">
                                    <p className="text-sm font-bold text-slate-700">{duplicateWarning.name}</p>
                                    <p className="text-xs text-slate-500">
                                        📞 {duplicateWarning.phone}
                                        {duplicateWarning.email && ` • ✉️ ${duplicateWarning.email}`}
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-1">
                                        Status: {duplicateWarning.status} • Source: {duplicateWarning.source}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleForceCreate}
                                    disabled={loading}
                                    className="mt-2 w-full bg-amber-500 hover:bg-amber-600 text-white py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-50"
                                >
                                    {loading ? 'Saving...' : 'Save Anyway (Force Create)'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-3">
                    {/* Standard Fields */}
                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Name <span className="text-red-500">*</span></label>
                        <input
                            type="text"
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Enter Name"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Phone <span className="text-red-500">*</span></label>
                        <div className="relative">
                            <input
                                type="text"
                                required
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm pr-8"
                                placeholder="Enter Phone"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                                onBlur={handlePhoneBlur}
                            />
                            {checkingDuplicate && (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                    <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-500 rounded-full animate-spin"></div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Email</label>
                        <input
                            type="email"
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Enter Email (Optional)"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            onBlur={handleEmailBlur}
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2">
                            <i className="fa-solid fa-indian-rupee-sign text-green-500"></i>
                            Deal Value
                        </label>
                        <input
                            type="number"
                            min="0"
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Enter Deal Value (Optional)"
                            value={formData.dealValue}
                            onChange={(e) => setFormData({ ...formData, dealValue: e.target.value })}
                        />
                    </div>

                    {/* Tags */}
                    {userTags && userTags.length > 0 && (
                        <div>
                            <label className="text-xs font-bold text-gray-500 uppercase">Tags</label>
                            <div className="flex flex-wrap gap-2 p-3 border border-gray-300 rounded-lg bg-gray-50 max-h-32 overflow-y-auto mt-1">
                                {userTags.map(tag => (
                                    <label key={tag._id} className="flex items-center gap-2 cursor-pointer text-sm">
                                        <input
                                            type="checkbox"
                                            checked={selectedTags.includes(tag.name)}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedTags([...selectedTags, tag.name]);
                                                else setSelectedTags(selectedTags.filter(t => t !== tag.name));
                                            }}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="px-2 py-0.5 rounded border text-xs" style={{ backgroundColor: `${tag.color}20`, color: tag.color, borderColor: `${tag.color}40` }}>
                                            {tag.name}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Custom Fields */}
                    {customFields.length > 0 && (
                        <>
                            <div className="border-t border-gray-200 pt-3 mt-3">
                                <p className="text-xs text-gray-400 uppercase font-bold mb-2">Additional Information</p>
                            </div>
                            {customFields.map(field => (
                                <div key={field.key}>
                                    <label className="text-xs font-bold text-gray-500 uppercase">
                                        {field.label}
                                        {field.required && <span className="text-red-500"> *</span>}
                                    </label>
                                    {renderCustomField(field)}
                                </div>
                            ))}
                        </>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-bold shadow-md mt-4 transition disabled:opacity-70"
                    >
                        {loading ? 'Saving...' : 'Save Lead'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default AddLeadModal;
