import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

// Separate from components/Dashboard/TaskModal.jsx, which belongs to the
// legacy per-lead follow-up reminder feature (src/models/Task.js) — this
// modal creates/edits the general, assignable TeamTask.

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = [
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' }
];

const emptyForm = (selfId) => ({
    title: '',
    description: '',
    assignedTo: selfId || '',
    dueDate: '',
    priority: 'medium',
    status: 'pending'
});

const TaskFormModal = ({ isOpen, task, onClose, onSaved }) => {
    const { user } = useAuth();
    const { showSuccess, showError } = useNotification();
    const isEdit = !!task;
    const selfId = user?.id || user?.userId || '';

    const canManageTeam = ['superadmin', 'agency', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const canAssign = canManageTeam || user?.permissions?.assignTasks === true;

    const [agents, setAgents] = useState([]);
    const [form, setForm] = useState(emptyForm(selfId));
    const [leadQuery, setLeadQuery] = useState('');
    const [leadResults, setLeadResults] = useState([]);
    const [selectedLead, setSelectedLead] = useState(null);
    const [saving, setSaving] = useState(false);
    const searchTimer = useRef(null);

    // Assignee options. /auth/my-team sits behind requireModule('team'), so a
    // workspace with Tasks but not Team gets a 403 here — fall back to just
    // yourself rather than rendering an empty dropdown that cannot be submitted.
    useEffect(() => {
        if (!isOpen) return;
        const selfOnly = [{ _id: selfId, name: user?.name || 'Me' }];
        api.get('/auth/my-team?includeManager=true')
            .then(res => {
                const list = Array.isArray(res.data) ? res.data : [];
                setAgents(list.length ? list : selfOnly);
            })
            .catch(() => setAgents(selfOnly));
    }, [isOpen, selfId, user?.name]);

    useEffect(() => {
        if (!isOpen) return;
        if (task) {
            setForm({
                title: task.title || '',
                description: task.description || '',
                assignedTo: task.assignedTo?.id || task.assignedTo || selfId,
                dueDate: task.dueDate ? String(task.dueDate).slice(0, 10) : '',
                priority: task.priority || 'medium',
                status: task.status || 'pending'
            });
            setSelectedLead(task.relatedLead || null);
            setLeadQuery(task.relatedLead?.name || '');
        } else {
            setForm(emptyForm(selfId));
            setSelectedLead(null);
            setLeadQuery('');
        }
        setLeadResults([]);
    }, [task, isOpen, selfId]);

    const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }));

    const handleLeadSearch = (e) => {
        const val = e.target.value;
        setLeadQuery(val);
        setSelectedLead(null);
        clearTimeout(searchTimer.current);
        if (!val || val.trim().length < 2) { setLeadResults([]); return; }
        searchTimer.current = setTimeout(async () => {
            try {
                const res = await api.get(`/leads?search=${encodeURIComponent(val.trim())}&limit=8`);
                setLeadResults(res.data?.leads || []);
            } catch {
                setLeadResults([]);
            }
        }, 300);
    };

    const pickLead = (lead) => {
        setSelectedLead({ id: lead._id, name: lead.name });
        setLeadQuery(lead.name);
        setLeadResults([]);
    };

    const clearLead = () => { setSelectedLead(null); setLeadQuery(''); };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.title.trim()) { showError('Title is required'); return; }

        setSaving(true);
        try {
            const payload = {
                title: form.title.trim(),
                description: form.description.trim() || null,
                assignedTo: form.assignedTo || selfId,
                relatedLead: selectedLead?.id || null,
                dueDate: form.dueDate || null,
                priority: form.priority
            };

            if (isEdit) {
                payload.status = form.status;
                await api.put(`/team-tasks/${task.id}`, payload);
                showSuccess('Task updated');
            } else {
                await api.post('/team-tasks', payload);
                showSuccess('Task created');
            }
            onSaved();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to save task');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
                <div className="p-6 border-b border-slate-200 flex justify-between items-center">
                    <h2 className="text-xl font-bold text-slate-800">{isEdit ? 'Edit Task' : 'New Task'}</h2>
                    <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                Title <span className="text-red-500">*</span>
                            </label>
                            <input type="text" required value={form.title} onChange={set('title')}
                                placeholder="e.g. Follow up on proposal"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                            <textarea value={form.description} onChange={set('description')} rows={3}
                                placeholder="Optional details..."
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm resize-none" />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Assign To</label>
                                {canAssign ? (
                                    <select value={form.assignedTo} onChange={set('assignedTo')}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                                        {agents.map(a => (
                                            <option key={a._id} value={a._id}>{a.name}{a._id === selfId ? ' (You)' : ''}</option>
                                        ))}
                                    </select>
                                ) : (
                                    <div className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-sm text-slate-500">
                                        Yourself
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Priority</label>
                                <select value={form.priority} onChange={set('priority')}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm capitalize">
                                    {PRIORITIES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Due Date</label>
                                <input type="date" value={form.dueDate} onChange={set('dueDate')}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                            </div>
                            {isEdit && (
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                                    <select value={form.status} onChange={set('status')}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm">
                                        {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div className="relative">
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                                Related Lead <span className="text-slate-400 font-normal">(optional)</span>
                            </label>
                            <div className="flex items-center gap-2">
                                <input type="text" value={leadQuery} onChange={handleLeadSearch}
                                    placeholder="Search by name or phone..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                                {selectedLead && (
                                    <button type="button" onClick={clearLead}
                                        className="shrink-0 text-slate-400 hover:text-red-500 text-xs px-2">
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                )}
                            </div>
                            {leadResults.length > 0 && (
                                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                    {leadResults.map(l => (
                                        <button type="button" key={l._id} onClick={() => pickLead(l)}
                                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex flex-col">
                                            <span className="font-medium text-slate-700">{l.name}</span>
                                            <span className="text-xs text-slate-400">{l.phone}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                        <button type="button" onClick={onClose}
                            className="px-6 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition">
                            Cancel
                        </button>
                        <button type="submit" disabled={saving}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                            {saving ? (
                                <><i className="fa-solid fa-circle-notch fa-spin"></i> Saving...</>
                            ) : (
                                isEdit ? 'Save Changes' : 'Create Task'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TaskFormModal;
