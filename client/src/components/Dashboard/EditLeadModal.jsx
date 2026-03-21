import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const EditLeadModal = ({ isOpen, onClose, lead, onSuccess }) => {
    const [formData, setFormData] = useState({ name: '', phone: '', email: '' });
    const [customData, setCustomData] = useState({});
    const [customFields, setCustomFields] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen && lead) {
            setFormData({
                name: lead.name || '',
                phone: lead.phone || '',
                email: lead.email || '',
                dealValue: lead.dealValue || '',
                nextFollowUpDate: lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toISOString().split('T')[0] : ''
            });

            // Populate the custom fields layout and prefill with existing lead data
            fetchCustomFields(lead.customData || {});
        }
    }, [isOpen, lead]);

    const fetchCustomFields = async (existingData) => {
        try {
            const res = await api.get('/custom-fields');
            setCustomFields(res.data || []);
            
            // Map the initial customData combining definitions and existing lead data
            const initialCustomData = {};
            (res.data || []).forEach(field => {
                initialCustomData[field.key] = existingData[field.key] || '';
            });
            setCustomData(initialCustomData);
        } catch (err) {
            console.error('Failed to fetch custom fields:', err);
        }
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleCustomFieldChange = (key, value) => {
        setCustomData(prev => ({ ...prev, [key]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        // Required fields validation
        for (const field of customFields) {
            if (field.required && !customData[field.key]) {
                setError(`${field.label} is required`);
                setLoading(false);
                return;
            }
        }

        try {
            const payload = { ...formData, customData };
            await api.put(`/leads/${lead._id}`, payload);
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to update lead');
        } finally {
            setLoading(false);
        }
    };

    const renderCustomField = (field) => {
        const baseInputClass = "w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none";

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

    if (!isOpen || !lead) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-800">Edit Lead</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                        <input
                            type="text"
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-2">
                            <i className="fa-solid fa-indian-rupee-sign text-green-500"></i>
                            Deal Value (Optional)
                        </label>
                        <input
                            type="number"
                            name="dealValue"
                            min="0"
                            value={formData.dealValue}
                            onChange={handleChange}
                            placeholder="Enter deal value"
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Next Follow-up Date</label>
                        <input
                            type="date"
                            name="nextFollowUpDate"
                            value={formData.nextFollowUpDate}
                            onChange={handleChange}
                            className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
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
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        {field.label}
                                        {field.required && <span className="text-red-500"> *</span>}
                                    </label>
                                    {renderCustomField(field)}
                                </div>
                            ))}
                        </>
                    )}

                    <div className="flex justify-end gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70"
                        >
                            {loading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditLeadModal;
