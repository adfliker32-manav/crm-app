import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const AddLeadModal = ({ isOpen, onClose, onSuccess }) => {
    const [formData, setFormData] = useState({ name: '', phone: '', email: '', dealValue: '' });
    const [customData, setCustomData] = useState({});
    const [customFields, setCustomFields] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Fetch custom fields when modal opens
    useEffect(() => {
        if (isOpen) {
            fetchCustomFields();
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
                customData: customData
            };
            const res = await api.post('/leads', payload);
            if (res.status === 200 || res.status === 201) {
                onSuccess();
                onClose();
                setFormData({ name: '', phone: '', email: '', dealValue: '' });
                setCustomData({});
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
                        <input
                            type="text"
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Enter Phone"
                            value={formData.phone}
                            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-500 uppercase">Email</label>
                        <input
                            type="email"
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                            placeholder="Enter Email (Optional)"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
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

