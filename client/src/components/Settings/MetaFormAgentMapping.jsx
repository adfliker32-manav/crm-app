import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

/**
 * MetaFormAgentMapping
 * Lets the user map specific Meta form IDs → specific agents.
 * Priority: form mapping > source-level default > unassigned.
 *
 * Props:
 *   teamUsers  — array of { _id, name, role } from parent
 *   onSaved    — optional callback after a successful save
 */
const MetaFormAgentMapping = ({ teamUsers = [], onSaved }) => {
    const { showSuccess, showError } = useNotification();
    const [rows, setRows]           = useState([]);   // current editable rows
    const [savedRows, setSavedRows] = useState([]);   // last-saved snapshot (for dirty detection)
    const [loading, setLoading]     = useState(true);
    const [saving, setSaving]       = useState(false);

    // ── Load existing mapping from backend ────────────────────────────────
    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/meta/form-agent-mapping');
            const data = res.data?.formAgentMapping || [];
            setRows(data);
            setSavedRows(data);
        } catch {
            showError('Failed to load form-agent mapping');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // ── Row helpers ───────────────────────────────────────────────────────
    const addRow = () =>
        setRows(r => [...r, { formId: '', formName: '', agentId: '' }]);

    const updateRow = (idx, field, val) =>
        setRows(r => r.map((row, i) => i === idx ? { ...row, [field]: val } : row));

    const removeRow = (idx) =>
        setRows(r => r.filter((_, i) => i !== idx));

    const isDirty = JSON.stringify(rows) !== JSON.stringify(savedRows);

    // ── Save ──────────────────────────────────────────────────────────────
    const handleSave = async () => {
        // Validate: every row must have a formId
        for (const row of rows) {
            if (!row.formId?.trim()) {
                showError('Each row must have a Form ID');
                return;
            }
        }
        setSaving(true);
        try {
            const res = await api.post('/meta/form-agent-mapping', {
                formAgentMapping: rows.map(r => ({
                    formId:   r.formId.trim(),
                    formName: r.formName?.trim() || '',
                    agentId:  r.agentId || null
                }))
            });
            const saved = res.data?.formAgentMapping || rows;
            setRows(saved);
            setSavedRows(saved);
            showSuccess('Form-agent mapping saved');
            if (onSaved) onSaved();
        } catch {
            showError('Failed to save form-agent mapping');
        } finally {
            setSaving(false);
        }
    };

    // ── Agent name lookup ─────────────────────────────────────────────────
    const agentName = (id) => {
        if (!id) return null;
        const u = teamUsers.find(u => u._id?.toString() === id?.toString());
        return u ? `${u.name} (${u.role})` : null;
    };

    // ─── Render ────────────────────────────────────────────────────────────
    return (
        <div className="mt-4 pt-4 border-t border-slate-100">
            {/* Sub-header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded-md bg-blue-100 flex items-center justify-center">
                        <i className="fa-brands fa-wpforms text-blue-600 text-[10px]"></i>
                    </div>
                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Per-Form Agent Routing</span>
                    {!loading && rows.length > 0 && (
                        <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            {rows.length} rule{rows.length !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <button
                    onClick={addRow}
                    className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1.5 rounded-lg transition"
                >
                    <i className="fa-solid fa-plus text-[10px]"></i>
                    Add Rule
                </button>
            </div>

            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                Map a specific <strong>Meta Form ID</strong> to an agent. Leads from that form will be assigned to this agent,
                overriding the source-level default. Form ID is visible in your Meta Ads Manager → Lead Center → Form Library.
            </p>

            {loading ? (
                <div className="flex items-center gap-2 py-4 text-sm text-slate-400">
                    <i className="fa-solid fa-spinner fa-spin text-indigo-300 text-xs"></i>
                    Loading…
                </div>
            ) : rows.length === 0 ? (
                <div
                    onClick={addRow}
                    className="cursor-pointer border-2 border-dashed border-slate-200 hover:border-indigo-300 rounded-xl px-4 py-5 text-center transition group"
                >
                    <i className="fa-solid fa-diagram-next text-slate-300 group-hover:text-indigo-300 text-lg mb-1.5 transition"></i>
                    <p className="text-xs text-slate-400 group-hover:text-indigo-500 font-medium transition">
                        No form rules yet — click to add one
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {/* Column headers */}
                    <div className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-2 px-2 pb-1">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Form ID</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Form Name (optional)</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assign Agent</span>
                        <span></span>
                    </div>

                    {rows.map((row, idx) => (
                        <div
                            key={idx}
                            className="grid grid-cols-[1fr_1fr_1.2fr_auto] gap-2 items-center bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 group hover:border-indigo-200 transition"
                        >
                            {/* Form ID */}
                            <input
                                type="text"
                                placeholder="e.g. 1234567890"
                                value={row.formId}
                                onChange={e => updateRow(idx, 'formId', e.target.value)}
                                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition font-mono"
                            />
                            {/* Form Name */}
                            <input
                                type="text"
                                placeholder="Friendly label"
                                value={row.formName}
                                onChange={e => updateRow(idx, 'formName', e.target.value)}
                                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition"
                            />
                            {/* Agent picker */}
                            <select
                                value={row.agentId || ''}
                                onChange={e => updateRow(idx, 'agentId', e.target.value)}
                                className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none transition"
                            >
                                <option value="">— Unassigned —</option>
                                {teamUsers.map(u => (
                                    <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                                ))}
                            </select>
                            {/* Remove */}
                            <button
                                onClick={() => removeRow(idx)}
                                title="Remove rule"
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
                            >
                                <i className="fa-solid fa-trash-can text-[10px]"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Priority note */}
            {rows.length > 0 && (
                <div className="flex items-start gap-2 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <i className="fa-solid fa-circle-info text-amber-500 text-xs mt-0.5 shrink-0"></i>
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                        <strong>Priority order:</strong> Form rule → Source default (Meta) → Unassigned.
                        If a lead's form ID doesn't match any rule, the Meta source-level default agent is used.
                    </p>
                </div>
            )}

            {/* Save button */}
            {(rows.length > 0 || isDirty) && (
                <div className="flex justify-end mt-3">
                    <button
                        onClick={handleSave}
                        disabled={saving || !isDirty}
                        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition ${
                            isDirty
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-500/20'
                                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-floppy-disk'}`}></i>
                        {saving ? 'Saving…' : 'Save Form Rules'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default MetaFormAgentMapping;
