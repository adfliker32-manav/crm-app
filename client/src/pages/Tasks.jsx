import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import TaskFormModal from '../components/Tasks/TaskFormModal';

const PRIORITY_COLORS = {
    low:    'bg-slate-100 text-slate-600',
    medium: 'bg-blue-100 text-blue-700',
    high:   'bg-orange-100 text-orange-700',
    urgent: 'bg-red-100 text-red-700'
};

const STATUS_COLORS = {
    pending:     'bg-amber-100 text-amber-700',
    in_progress: 'bg-blue-100 text-blue-700',
    completed:   'bg-green-100 text-green-700',
    cancelled:   'bg-slate-100 text-slate-500'
};

const STATUS_LABELS = {
    pending: 'Pending', in_progress: 'In Progress', completed: 'Completed', cancelled: 'Cancelled'
};

function formatDate(d) {
    if (!d) return null;
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function isOverdue(task) {
    if (!task.dueDate || task.status === 'completed' || task.status === 'cancelled') return false;
    return new Date(task.dueDate) < new Date(new Date().toDateString());
}

export default function Tasks() {
    const { user } = useAuth();
    const { showSuccess, showError } = useNotification();

    const canManageTeam = ['superadmin', 'agency', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const canCreate = canManageTeam || user?.permissions?.createTasks !== false;
    const canDelete = canManageTeam || user?.permissions?.deleteTasks === true;

    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [priorityFilter, setPriorityFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [showForm, setShowForm] = useState(false);
    const [editingTask, setEditingTask] = useState(null);
    const [loadError, setLoadError] = useState(null);

    const fetchTasks = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (priorityFilter !== 'all') params.set('priority', priorityFilter);
            if (search) params.set('q', search);
            const res = await api.get(`/team-tasks?${params.toString()}`);
            setTasks(res.data?.tasks || []);
            setLoadError(null);
        } catch (err) {
            // Surface the REAL reason. A bare "Failed to load tasks" hides the two
            // causes that actually happen: the workspace not having the Tasks
            // module switched on (403 module_locked), and the agent lacking the
            // viewTasks permission (403). Both are fixable by the user, but only
            // if we say which one it is.
            const data = err.response?.data;
            const message = data?.error === 'module_locked'
                ? 'The Tasks module is not enabled for this workspace. A Super Admin can switch it on under Module Permissions.'
                : (data?.message || 'Failed to load tasks');
            setLoadError(message);
            showError(message);
        } finally {
            setLoading(false);
        }
    }, [statusFilter, priorityFilter, search]);

    useEffect(() => { fetchTasks(); }, [fetchTasks]);

    const openCreate = () => { setEditingTask(null); setShowForm(true); };
    const openEdit = (task) => { setEditingTask(task); setShowForm(true); };
    const handleSaved = () => { setShowForm(false); fetchTasks(); };

    const quickComplete = async (taskId) => {
        try {
            await api.patch(`/team-tasks/${taskId}/status`, { status: 'completed' });
            showSuccess('Task marked complete');
            fetchTasks();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to update task');
        }
    };

    const deleteTask = async (taskId) => {
        if (!window.confirm('Delete this task?')) return;
        try {
            await api.delete(`/team-tasks/${taskId}`);
            showSuccess('Task deleted');
            fetchTasks();
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to delete task');
        }
    };

    return (
        <div className="p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h1 className="text-xl font-bold text-slate-800">Tasks</h1>
                    <p className="text-sm text-slate-500 mt-0.5">Assign and track work across your team.</p>
                </div>
                {canCreate && (
                    <button onClick={openCreate}
                        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors flex items-center gap-2">
                        <i className="fa-solid fa-plus"></i> New Task
                    </button>
                )}
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
                <input type="text" placeholder="Search tasks..." value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 flex-1 min-w-40" />
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="all">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
                <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="all">All Priority</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                </select>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
            ) : loadError ? (
                // Never show "No tasks found" for a request that FAILED — that
                // reads as "all good, nothing here" and hides a real problem.
                <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 px-6">
                    <span className="text-5xl">⚠️</span>
                    <p className="font-semibold text-slate-700">Couldn’t load tasks</p>
                    <p className="text-sm text-slate-500 max-w-md">{loadError}</p>
                    <button
                        onClick={fetchTasks}
                        className="mt-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                    >
                        <i className="fa-solid fa-rotate-right mr-1.5"></i> Try again
                    </button>
                </div>
            ) : tasks.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
                    <span className="text-5xl">✅</span>
                    <p className="font-medium">No tasks found</p>
                    {canCreate && <p className="text-sm">Create a task and assign it to a teammate.</p>}
                </div>
            ) : (
                <div className="space-y-2 overflow-y-auto flex-1 pr-1">
                    {tasks.map(task => (
                        <div key={task.id} onClick={() => openEdit(task)}
                            className="bg-white border border-slate-200 rounded-xl p-4 cursor-pointer transition-all hover:border-blue-300 hover:shadow-sm">
                            <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-semibold text-slate-800 text-sm">{task.title}</p>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full capitalize ${PRIORITY_COLORS[task.priority] || ''}`}>
                                            {task.priority}
                                        </span>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLORS[task.status] || ''}`}>
                                            {STATUS_LABELS[task.status] || task.status}
                                        </span>
                                        {isOverdue(task) && (
                                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">Overdue</span>
                                        )}
                                    </div>
                                    {task.description && (
                                        <p className="text-slate-500 text-xs mt-1 line-clamp-2">{task.description}</p>
                                    )}
                                    <p className="text-slate-400 text-xs mt-1.5 flex items-center flex-wrap gap-x-3">
                                        <span><i className="fa-solid fa-user text-[10px] mr-1"></i>{task.assignedTo?.name || 'Unassigned'}</span>
                                        {task.dueDate && <span><i className="fa-solid fa-calendar text-[10px] mr-1"></i>{formatDate(task.dueDate)}</span>}
                                        {task.relatedLead && <span><i className="fa-solid fa-link text-[10px] mr-1"></i>{task.relatedLead.name}</span>}
                                    </p>
                                </div>
                                <div className="flex gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                                    {task.status !== 'completed' && task.status !== 'cancelled' && (
                                        <button onClick={() => quickComplete(task.id)}
                                            className="text-[10px] bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded-lg font-semibold">
                                            Complete
                                        </button>
                                    )}
                                    {canDelete && (
                                        <button onClick={() => deleteTask(task.id)}
                                            className="text-[10px] text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg transition-colors">
                                            <i className="fa-solid fa-trash"></i>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <TaskFormModal
                isOpen={showForm}
                task={editingTask}
                onClose={() => setShowForm(false)}
                onSaved={handleSaved}
            />
        </div>
    );
}
