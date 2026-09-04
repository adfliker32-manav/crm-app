import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';

const fieldTypes = [
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'dropdown', label: 'Dropdown (pick one)' },
    { value: 'multiselect', label: 'Multi-select (pick many)' }
];

// The two types whose `options` list is meaningful. Kept in sync with
// OPTION_TYPES in src/utils/customFieldValidation.js on the server.
const OPTION_TYPES = ['dropdown', 'multiselect'];
const isOptionType = (type) => OPTION_TYPES.includes(type);

const typeLabel = (type) => fieldTypes.find(t => t.value === type)?.label || type;

const INPUT_CLS = "w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm";

/**
 * Chip editor for a dropdown / multi-select option list.
 * Type and press Enter (or comma) to add; click the × to remove; click a chip to
 * rename it in place. Renaming does NOT rewrite leads already holding the old
 * spelling — the server keeps those values readable and saveable.
 */
const OptionsEditor = ({ options, onChange, autoFocus = false }) => {
    const [draft, setDraft] = useState('');
    const [editingIndex, setEditingIndex] = useState(null);
    const [editingValue, setEditingValue] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    const commitDraft = (raw) => {
        const parts = String(raw)
            .split(',')
            .map(p => p.trim())
            .filter(Boolean);
        if (parts.length === 0) return;
        const next = [...options];
        for (const p of parts) {
            if (!next.some(o => o.toLowerCase() === p.toLowerCase())) next.push(p);
        }
        onChange(next);
        setDraft('');
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commitDraft(draft);
        } else if (e.key === 'Backspace' && !draft && options.length > 0) {
            onChange(options.slice(0, -1));
        }
    };

    const commitRename = () => {
        const value = editingValue.trim();
        if (!value) { setEditingIndex(null); return; }
        const clash = options.some((o, i) => i !== editingIndex && o.toLowerCase() === value.toLowerCase());
        if (!clash) {
            const next = [...options];
            next[editingIndex] = value;
            onChange(next);
        }
        setEditingIndex(null);
    };

    return (
        <div>
            <div className="flex flex-wrap gap-2 p-2 bg-white border border-slate-300 rounded-lg min-h-[42px]">
                {options.map((opt, idx) => (
                    editingIndex === idx ? (
                        <input
                            key={idx}
                            autoFocus
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                                if (e.key === 'Escape') setEditingIndex(null);
                            }}
                            className="px-2 py-1 text-xs border border-indigo-400 rounded-md outline-none"
                            style={{ width: `${Math.max(editingValue.length + 2, 6)}ch` }}
                        />
                    ) : (
                        <span
                            key={idx}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-xs font-medium"
                        >
                            <button
                                type="button"
                                onClick={() => { setEditingIndex(idx); setEditingValue(opt); }}
                                className="hover:underline"
                                title="Click to rename"
                            >
                                {opt}
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange(options.filter((_, i) => i !== idx))}
                                className="text-indigo-400 hover:text-red-500"
                                title="Remove option"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </span>
                    )
                ))}
                <input
                    ref={inputRef}
                    type="text"
                    value={draft}
                    onChange={(e) => {
                        // Pasting "A, B, C" should become three chips, not one.
                        if (e.target.value.includes(',')) commitDraft(e.target.value);
                        else setDraft(e.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={() => commitDraft(draft)}
                    placeholder={options.length === 0 ? 'Type an option, press Enter' : 'Add another…'}
                    className="flex-1 min-w-[140px] px-1 text-sm outline-none bg-transparent"
                />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
                Press <kbd className="px-1 bg-slate-100 rounded border border-slate-200">Enter</kbd> or type a comma to add. Click an option to rename it.
            </p>
        </div>
    );
};

const CustomFieldsSettings = () => {
    const [fields, setFields] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    // Inline edit state — holds a working copy of the field being edited
    const [editingKey, setEditingKey] = useState(null);
    const [editDraft, setEditDraft] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);

    // New field form
    const [newField, setNewField] = useState({
        label: '',
        type: 'text',
        options: [],
        required: false
    });

    useEffect(() => {
        fetchFields();
    }, []);

    const flashSuccess = (msg) => {
        setSuccess(msg);
        setTimeout(() => setSuccess(null), 4000);
    };

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
        if (isOptionType(newField.type) && newField.options.length === 0) {
            setError(`${typeLabel(newField.type)} needs at least one option`);
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const payload = {
                label: newField.label.trim(),
                type: newField.type,
                required: newField.required,
                options: isOptionType(newField.type) ? newField.options : []
            };

            const res = await api.post('/custom-fields', payload);
            setFields(res.data.fields || [...fields, res.data.field]);
            setNewField({ label: '', type: 'text', options: [], required: false });
            flashSuccess('Field added successfully!');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to add field');
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (field) => {
        setError(null);
        setEditingKey(field.key);
        setEditDraft({
            label: field.label,
            type: field.type,
            options: [...(field.options || [])],
            required: !!field.required
        });
    };

    const cancelEdit = () => {
        setEditingKey(null);
        setEditDraft(null);
    };

    const saveEdit = async () => {
        if (!editDraft.label.trim()) {
            setError('Field label is required');
            return;
        }
        if (isOptionType(editDraft.type) && editDraft.options.length === 0) {
            setError(`${typeLabel(editDraft.type)} needs at least one option`);
            return;
        }

        setSavingEdit(true);
        setError(null);
        try {
            const res = await api.put(`/custom-fields/${editingKey}`, {
                label: editDraft.label.trim(),
                type: editDraft.type,
                options: isOptionType(editDraft.type) ? editDraft.options : [],
                required: editDraft.required
            });
            setFields(res.data.fields || fields);
            cancelEdit();
            // The server tells us when an option that live leads still use was
            // dropped. Those leads keep their value — this is information, not a failure.
            flashSuccess(res.data.warning ? `Field updated. ${res.data.warning}` : 'Field updated');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to update field');
        } finally {
            setSavingEdit(false);
        }
    };

    const moveField = async (index, direction) => {
        const target = index + direction;
        if (target < 0 || target >= fields.length) return;

        const reordered = [...fields];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        setFields(reordered); // optimistic — order is cosmetic, a failed save just reloads

        try {
            await api.put('/custom-fields/reorder', { keys: reordered.map(f => f.key) });
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to save field order');
            fetchFields();
        }
    };

    const handleDeleteField = async (field) => {
        const warning = isOptionType(field.type)
            ? `Delete "${field.label}"? Agents will no longer see this dropdown. Existing lead data is NOT removed.`
            : `Delete field "${field.label}"? This won't remove existing data.`;
        if (!confirm(warning)) return;

        try {
            await api.delete(`/custom-fields/${field.key}`);
            setFields(fields.filter(f => f.key !== field.key));
            if (editingKey === field.key) cancelEdit();
            flashSuccess('Field deleted');
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
                    Define additional fields for your leads — including dropdowns your agents pick from
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
                <div className="m-4 p-3 bg-green-100 text-green-700 rounded-lg text-sm flex items-start gap-2">
                    <i className="fa-solid fa-check-circle mt-0.5"></i> <span>{success}</span>
                </div>
            )}

            <div className="p-6">
                {/* Add New Field Form */}
                <form onSubmit={handleAddField} className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <h3 className="font-bold text-slate-700 mb-4">Add New Field</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Label *</label>
                            <input
                                type="text"
                                value={newField.label}
                                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                                placeholder="e.g. Budget Range"
                                className={INPUT_CLS}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                            <select
                                value={newField.type}
                                onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                                className={INPUT_CLS}
                            >
                                {fieldTypes.map(ft => (
                                    <option key={ft.value} value={ft.value}>{ft.label}</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex items-end gap-4">
                            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer pb-2">
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
                                className="px-4 py-2 mb-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
                            >
                                {saving ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-plus"></i>} Add
                            </button>
                        </div>
                    </div>

                    {isOptionType(newField.type) && (
                        <div className="mt-4">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                Options * <span className="normal-case font-normal text-slate-400">— what the agent can choose</span>
                            </label>
                            <OptionsEditor
                                autoFocus
                                options={newField.options}
                                onChange={(options) => setNewField({ ...newField, options })}
                            />
                        </div>
                    )}
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
                                className="p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-indigo-300 transition"
                            >
                                {editingKey === field.key ? (
                                    /* ── Edit mode ─────────────────────────────── */
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Label</label>
                                                <input
                                                    type="text"
                                                    value={editDraft.label}
                                                    onChange={(e) => setEditDraft({ ...editDraft, label: e.target.value })}
                                                    className={INPUT_CLS}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                                                <select
                                                    value={editDraft.type}
                                                    onChange={(e) => setEditDraft({ ...editDraft, type: e.target.value })}
                                                    className={INPUT_CLS}
                                                >
                                                    {fieldTypes.map(ft => (
                                                        <option key={ft.value} value={ft.value}>{ft.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div className="flex items-end pb-2">
                                                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={editDraft.required}
                                                        onChange={(e) => setEditDraft({ ...editDraft, required: e.target.checked })}
                                                        className="w-4 h-4 text-indigo-600"
                                                    />
                                                    Required
                                                </label>
                                            </div>
                                        </div>

                                        {isOptionType(editDraft.type) && (
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Options</label>
                                                <OptionsEditor
                                                    options={editDraft.options}
                                                    onChange={(options) => setEditDraft({ ...editDraft, options })}
                                                />
                                            </div>
                                        )}

                                        <div className="flex items-center gap-2 pt-1">
                                            <button
                                                onClick={saveEdit}
                                                disabled={savingEdit}
                                                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm transition disabled:opacity-50"
                                            >
                                                {savingEdit ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-check"></i>} Save
                                            </button>
                                            <button
                                                onClick={cancelEdit}
                                                disabled={savingEdit}
                                                className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 hover:bg-slate-100 rounded-lg font-medium text-sm transition"
                                            >
                                                Cancel
                                            </button>
                                            <span className="text-xs text-slate-400 ml-2">
                                                Field key <code className="bg-slate-200 px-1 rounded">{field.key}</code> can't change — it's how existing lead data is stored.
                                            </span>
                                        </div>
                                    </div>
                                ) : (
                                    /* ── Read mode ─────────────────────────────── */
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-4 min-w-0">
                                            <div className="flex flex-col">
                                                <button
                                                    onClick={() => moveField(index, -1)}
                                                    disabled={index === 0}
                                                    className="text-slate-400 hover:text-indigo-600 disabled:opacity-20 disabled:hover:text-slate-400 text-xs leading-none p-0.5"
                                                    title="Move up"
                                                >
                                                    <i className="fa-solid fa-chevron-up"></i>
                                                </button>
                                                <button
                                                    onClick={() => moveField(index, 1)}
                                                    disabled={index === fields.length - 1}
                                                    className="text-slate-400 hover:text-indigo-600 disabled:opacity-20 disabled:hover:text-slate-400 text-xs leading-none p-0.5"
                                                    title="Move down"
                                                >
                                                    <i className="fa-solid fa-chevron-down"></i>
                                                </button>
                                            </div>
                                            <span className="w-8 h-8 shrink-0 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold text-sm">
                                                {index + 1}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="font-medium text-slate-800">
                                                    {field.label}
                                                    {field.required && <span className="ml-2 text-red-500 font-medium text-xs">Required</span>}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                    Key: <code className="bg-slate-200 px-1 rounded">{field.key}</code>
                                                    <span className="mx-2">•</span>
                                                    {typeLabel(field.type)}
                                                </p>
                                                {isOptionType(field.type) && (
                                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                                        {(field.options || []).map((opt, i) => (
                                                            <span key={i} className="px-2 py-0.5 bg-white border border-slate-200 text-slate-600 rounded text-[11px]">
                                                                {opt}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => startEdit(field)}
                                                className="p-2 text-slate-400 hover:text-indigo-600 transition"
                                                title="Edit Field"
                                            >
                                                <i className="fa-solid fa-pen"></i>
                                            </button>
                                            <button
                                                onClick={() => handleDeleteField(field)}
                                                className="p-2 text-slate-400 hover:text-red-500 transition"
                                                title="Delete Field"
                                            >
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {/* Mapping Info */}
                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200 text-sm text-blue-800">
                    <p className="font-bold mb-2"><i className="fa-solid fa-info-circle mr-2"></i>Where these fields show up</p>
                    <ul className="list-disc list-inside space-y-1 text-blue-700">
                        <li><strong>Add / Edit Lead:</strong> agents get a dropdown of exactly these options — no free typing.</li>
                        <li><strong>Lead filters:</strong> filter the leads list by any dropdown or multi-select value.</li>
                        <li><strong>Google Sheets:</strong> a column header matching a field label auto-fills. Values are matched to the closest option.</li>
                        <li><strong>Meta Lead Ads:</strong> a form question matching a field label or key auto-fills. An answer that matches no option is still saved and flagged on the lead.</li>
                        <li><strong>Automations &amp; Workflows:</strong> conditions and the "Update Field" action pick from these options.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default CustomFieldsSettings;
