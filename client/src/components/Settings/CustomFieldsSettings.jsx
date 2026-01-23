import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const fieldTypes = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'dropdown', label: 'Dropdown' }
];

const CustomFieldsSettings = () => {
    const [fields, setFields] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // New field form
    const [newField, setNewField] = useState({
        label: '',
        type: 'text',
        options: '',
        required: false
    });

    useEffect(() => {
        fetchFields();
    }, []);

    const fetchFields = async () => {
        try {
            const res = await api.get('/custom-fields');
            setFields(res.data || []);
        } catch (err) {
            setError('Failed to load custom fields');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAddField = async (e) => {
        e.preventDefault();
        if (!newField.label.trim()) {
            setError('Field label is required');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const payload = {
                label: newField.label.trim(),
                type: newField.type,
                required: newField.required,
                options: newField.type === 'dropdown'
                    ? newField.options.split(',').map(o => o.trim()).filter(o => o)
                    : []
            };

            const res = await api.post('/custom-fields', payload);
            setFields(res.data.fields || [...fields, res.data.field]);
            setNewField({ label: '', type: 'text', options: '', required: false });
            setSuccess('Field added successfully!');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to add field');
        } finally {
            setSaving(false);
        }
    };

    const handleDeleteField = async (key) => {
        if (!confirm(`Delete field "${key}"? This won't remove existing data.`)) return;

        try {
            await api.delete(`/custom-fields/${key}`);
            setFields(fields.filter(f => f.key !== key));
            setSuccess('Field deleted');
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to delete field');
        }
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 p-6">
                <div className="text-center text-slate-500">
                    <i className="fa-solid fa-spinner fa-spin text-2xl"></i>
                    <p className="mt-2">Loading custom fields...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white">
                <h2 className="text-xl font-bold flex items-center gap-3">
                    <i className="fa-solid fa-list-check"></i>
                    Custom Lead Fields
                </h2>
                <p className="text-indigo-100 text-sm mt-1">
                    Define additional fields for your leads
                </p>
            </div>

            {/* Notifications */}
            {error && (
                <div className="m-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm flex items-center gap-2">
                    <i className="fa-solid fa-exclamation-circle"></i> {error}
                    <button onClick={() => setError(null)} className="ml-auto"><i className="fa-solid fa-times"></i></button>
                </div>
            )}
            {success && (
                <div className="m-4 p-3 bg-green-100 text-green-700 rounded-lg text-sm flex items-center gap-2">
                    <i className="fa-solid fa-check-circle"></i> {success}
                </div>
            )}

            <div className="p-6">
                {/* Add New Field Form */}
                <form onSubmit={handleAddField} className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <h3 className="font-bold text-slate-700 mb-4">Add New Field</h3>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Label *</label>
                            <input
                                type="text"
                                value={newField.label}
                                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                                placeholder="e.g. Birthday"
                                className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                            <select
                                value={newField.type}
                                onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                                className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                            >
                                {fieldTypes.map(ft => (
                                    <option key={ft.value} value={ft.value}>{ft.label}</option>
                                ))}
                            </select>
                        </div>
                        {newField.type === 'dropdown' && (
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Options (comma-separated)</label>
                                <input
                                    type="text"
                                    value={newField.options}
                                    onChange={(e) => setNewField({ ...newField, options: e.target.value })}
                                    placeholder="Option1, Option2"
                                    className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                                />
                            </div>
                        )}
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={newField.required}
                                    onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                                    className="w-4 h-4 text-indigo-600"
                                />
                                Required
                            </label>
                            <button
                                type="submit"
                                disabled={saving}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
                            >
                                {saving ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-plus"></i>} Add
                            </button>
                        </div>
                    </div>
                </form>

                {/* Existing Fields List */}
                <h3 className="font-bold text-slate-700 mb-4">Existing Fields ({fields.length})</h3>
                {fields.length === 0 ? (
                    <div className="text-center text-slate-400 py-8">
                        <i className="fa-regular fa-rectangle-list text-4xl mb-3"></i>
                        <p>No custom fields defined yet</p>
                        <p className="text-xs mt-1">Add fields above to capture more data from leads</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {fields.map((field, index) => (
                            <div
                                key={field.key || index}
                                className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-indigo-300 transition"
                            >
                                <div className="flex items-center gap-4">
                                    <span className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold text-sm">
                                        {index + 1}
                                    </span>
                                    <div>
                                        <p className="font-medium text-slate-800">{field.label}</p>
                                        <p className="text-xs text-slate-500">
                                            Key: <code className="bg-slate-200 px-1 rounded">{field.key}</code>
                                            <span className="mx-2">•</span>
                                            Type: <span className="capitalize">{field.type}</span>
                                            {field.required && <span className="ml-2 text-red-500 font-medium">Required</span>}
                                            {field.type === 'dropdown' && field.options?.length > 0 && (
                                                <span className="ml-2">Options: {field.options.join(', ')}</span>
                                            )}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteField(field.key)}
                                    className="p-2 text-slate-400 hover:text-red-500 transition"
                                    title="Delete Field"
                                >
                                    <i className="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Mapping Info */}
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-800">
                    <p className="font-bold mb-2"><i className="fa-solid fa-info-circle mr-2"></i>Auto-Mapping</p>
                    <ul className="list-disc list-inside space-y-1 text-blue-700">
                        <li><strong>Google Sheets:</strong> If your sheet has a column header matching a field label, it will auto-fill.</li>
                        <li><strong>Meta Lead Ads:</strong> If your form question matches a field label or key, it will auto-fill.</li>
                        <li><strong>Manual Entry:</strong> These fields will appear in the "Add Lead" form.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default CustomFieldsSettings;
