import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const TaskModal = ({ isOpen, onClose, onSuccess, onLeadClick }) => {
    const { showSuccess, showError } = useNotification();
    const [activeTab, setActiveTab] = useState('today');
    const [todayTasks, setTodayTasks] = useState([]);
    const [overdueTasks, setOverdueTasks] = useState([]);
    const [completedTasks, setCompletedTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [completingId, setCompletingId] = useState(null);

    useEffect(() => {
        if (isOpen) {
            fetchTasks();
        }
    }, [isOpen]);

    const fetchTasks = async () => {
        setLoading(true);
        try {
            // "Completed Today" = tasks with dueDate today and status Completed
            // (We don't store a completedAt field, so this is the closest meaningful query)
            const [todayRes, overdueRes, completedRes] = await Promise.all([
                api.get('/tasks?status=Pending&dateFilter=today'),
                api.get('/tasks?dateFilter=overdue'),
                api.get('/tasks?status=Completed&dateFilter=today')
            ]);
            setTodayTasks(todayRes.data || []);
            setOverdueTasks(overdueRes.data || []);
            setCompletedTasks(completedRes.data || []);
        } catch (err) {
            console.error("Error fetching tasks", err);
            showError("Failed to load tasks");
        } finally {
            setLoading(false);
        }
    };

    const handleComplete = async (task) => {
        setCompletingId(task._id);
        try {
            await api.put(`/tasks/${task._id}`, { status: 'Completed' });
            showSuccess('Task marked complete');
            await fetchTasks();
            if (onSuccess) onSuccess();
        } catch (err) {
            console.error('Failed to complete task', err);
            showError('Failed to complete task');
        } finally {
            setCompletingId(null);
        }
    };

    const handleOpenLead = (task) => {
        if (!task.leadId) return;
        if (onLeadClick) {
            onLeadClick(task.leadId);
            onClose();
        }
    };

    if (!isOpen) return null;

    const currentTasks = activeTab === 'today'
        ? todayTasks
        : activeTab === 'overdue'
            ? overdueTasks
            : completedTasks;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-3xl max-h-[85vh] flex flex-col">
                <div className="flex justify-between items-center mb-4 border-b pb-3 border-gray-100">
                    <h3 className="text-xl font-bold text-gray-800">
                        <i className="fa-solid fa-list-check text-orange-500 mr-2"></i>
                        Task Management
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 mb-4">
                    <button
                        className={`flex-1 py-2 text-sm font-medium transition ${activeTab === 'today'
                            ? 'border-b-2 border-orange-500 text-gray-800'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                        onClick={() => setActiveTab('today')}
                    >
                        <i className="fa-solid fa-clock mr-2"></i>
                        Due Today ({todayTasks.length})
                    </button>
                    <button
                        className={`flex-1 py-2 text-sm font-medium transition ${activeTab === 'overdue'
                            ? 'border-b-2 border-rose-500 text-gray-800'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                        onClick={() => setActiveTab('overdue')}
                    >
                        <i className="fa-solid fa-triangle-exclamation mr-2"></i>
                        Overdue ({overdueTasks.length})
                    </button>
                    <button
                        className={`flex-1 py-2 text-sm font-medium transition ${activeTab === 'completed'
                            ? 'border-b-2 border-emerald-500 text-gray-800'
                            : 'text-gray-500 hover:text-gray-700'
                            }`}
                        onClick={() => setActiveTab('completed')}
                    >
                        <i className="fa-solid fa-check-circle mr-2"></i>
                        Completed Today ({completedTasks.length})
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto">
                    {loading ? (
                        <div className="text-center py-8 text-gray-500">
                            <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                            <p>Loading tasks...</p>
                        </div>
                    ) : currentTasks.length === 0 ? (
                        <div className="text-center py-12 text-gray-400">
                            <i className="fa-regular fa-clipboard text-5xl mb-3"></i>
                            <p className="text-lg font-medium">
                                {activeTab === 'today' && 'No tasks due today!'}
                                {activeTab === 'overdue' && 'No overdue tasks. Great job!'}
                                {activeTab === 'completed' && 'No tasks completed yet today'}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {currentTasks.map(task => (
                                <TaskCard
                                    key={task._id}
                                    task={task}
                                    variant={activeTab}
                                    onComplete={handleComplete}
                                    onOpenLead={handleOpenLead}
                                    completing={completingId === task._id}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const TaskCard = ({ task, variant, onComplete, onOpenLead, completing }) => {
    const isCompleted = variant === 'completed';
    const isOverdue = variant === 'overdue';

    const bgCls = isCompleted
        ? 'bg-emerald-50 border-emerald-200'
        : isOverdue
            ? 'bg-rose-50 border-rose-200'
            : 'bg-orange-50 border-orange-200';

    const dueDate = task.dueDate ? new Date(task.dueDate) : null;

    return (
        <div className={`p-4 rounded-lg border ${bgCls}`}>
            <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="font-bold text-gray-800">{task.title}</h4>
                        {isOverdue && (
                            <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] rounded-full font-bold">
                                OVERDUE
                            </span>
                        )}
                    </div>
                    {task.description && (
                        <p className="text-xs text-gray-600 mb-2 line-clamp-2">{task.description}</p>
                    )}
                    {task.leadId && (
                        <button
                            type="button"
                            onClick={() => onOpenLead(task)}
                            className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline inline-flex items-center gap-1 mb-1"
                        >
                            <i className="fa-solid fa-user"></i>
                            {task.leadId.name || 'Lead'}
                            {task.leadId.phone && <span className="text-gray-500 font-normal ml-1">· {task.leadId.phone}</span>}
                        </button>
                    )}
                    {dueDate && (
                        <p className={`text-xs font-medium mt-1 ${isOverdue ? 'text-rose-600' : isCompleted ? 'text-emerald-600' : 'text-orange-600'}`}>
                            <i className="fa-solid fa-calendar mr-1"></i>
                            {isCompleted ? 'Completed: ' : 'Due: '}
                            {dueDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                        </p>
                    )}
                </div>
                <div className="shrink-0">
                    {isCompleted ? (
                        <span className="text-emerald-600 font-bold flex items-center gap-1 text-sm">
                            <i className="fa-solid fa-circle-check"></i>
                            Done
                        </span>
                    ) : (
                        <button
                            onClick={() => onComplete(task)}
                            disabled={completing}
                            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-md flex items-center gap-2"
                        >
                            {completing ? (
                                <i className="fa-solid fa-spinner fa-spin"></i>
                            ) : (
                                <i className="fa-solid fa-check"></i>
                            )}
                            Complete
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default TaskModal;
