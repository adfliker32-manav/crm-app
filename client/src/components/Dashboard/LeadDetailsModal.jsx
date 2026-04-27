/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import ActivityTimeline from './ActivityTimeline';

const LeadDetailsModal = ({ isOpen, onClose, lead, onSuccess, userTags = [] }) => {
    const { showSuccess, showError } = useNotification();
    const [nextFollowUpDate, setNextFollowUpDate] = useState('');
    const [loading, setLoading] = useState(false);
    const [customFields, setCustomFields] = useState([]);
    
    // Lazy loaded full lead details
    const [fullLead, setFullLead] = useState(null);
    const [fullLeadLoading, setFullLeadLoading] = useState(false);

    // Tasks section states
    const [tasks, setTasks] = useState([]);
    const [taskTitle, setTaskTitle] = useState('');
    const [taskDate, setTaskDate] = useState('');
    const [tasksLoading, setTasksLoading] = useState(false);

    // Email section states
    const [showEmailSection, setShowEmailSection] = useState(false);
    const [emailTo, setEmailTo] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);

    useEffect(() => {
        if (isOpen && lead) {
            setFullLead(null); // Reset on new open
            fetchCustomFields();
            fetchTasks();
            fetchFullLead();
        }
    }, [isOpen, lead]);

    const fetchFullLead = async () => {
        setFullLeadLoading(true);
        try {
            const res = await api.get(`/leads/${lead._id}`);
            setFullLead(res.data);
        } catch (error) {
            console.error('Failed to fetch full lead details:', error);
        } finally {
            setFullLeadLoading(false);
        }
    };

    useEffect(() => {
        if (lead) {
            setNextFollowUpDate(lead.nextFollowUpDate ? new Date(lead.nextFollowUpDate).toISOString().split('T')[0] : '');
            // Auto-fill email if available
            setEmailTo(lead.email || '');
            setEmailSubject('');
            setEmailMessage('');
            setShowEmailSection(false);
        }
    }, [lead]);

    const fetchCustomFields = async () => {
        try {
            const res = await api.get('/custom-fields');
            setCustomFields(res.data || []);
        } catch (err) {
            console.error('Failed to fetch custom fields:', err);
        }
    };

    if (!isOpen || !lead) return null;

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const d = new Date(dateString);
        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const handleUpdateFollowUp = async () => {
        setLoading(true);
        try {
            await api.put(`/leads/${lead._id}`, {
                nextFollowUpDate: nextFollowUpDate || null // Send null if empty to clear
            });
            showSuccess('Follow-up date updated successfully');
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error("Error updating follow-up:", error);
            showError("Failed to update follow-up date");
        } finally {
            setLoading(false);
        }
    };

    const fetchTasks = async () => {
        if (!lead?._id) return;
        try {
            const res = await api.get(`/tasks/lead/${lead._id}`);
            setTasks(res.data || []);
        } catch (err) {
            console.error('Failed to fetch tasks:', err);
        }
    };

    const handleCreateTask = async () => {
        if (!taskTitle || !taskDate) return showError("Task title and Date are required");
        setTasksLoading(true);
        try {
            const res = await api.post('/tasks', {
                leadId: lead._id,
                title: taskTitle,
                dueDate: taskDate
            });
            setTasks([...tasks, res.data]);
            setTaskTitle('');
            setTaskDate('');
            showSuccess('Task created successfully');
            if (onSuccess) onSuccess(); // To refresh dashboard if necessary
        } catch(err) {
            showError("Failed to create task");
        } finally {
            setTasksLoading(false);
        }
    };

    const handleCompleteTask = async (taskId) => {
        try {
            await api.put(`/tasks/${taskId}`, { status: 'Completed' });
            setTasks(tasks.map(t => t._id === taskId ? { ...t, status: 'Completed' } : t));
            showSuccess('Task marked as completed');
            if (onSuccess) onSuccess(); // To refresh dashboard
        } catch(err) {
            showError("Failed to complete task");
        }
    };

    const handleSendEmail = async () => {
        if (!emailTo || !emailSubject || !emailMessage) {
            showError('Please fill in all email fields');
            return;
        }

        setEmailLoading(true);
        try {
            await api.post(`/leads/${lead._id}/send-email`, {
                to: emailTo,
                subject: emailSubject,
                message: emailMessage
            });
            showSuccess('Email sent successfully');
            // Clear email form
            setEmailSubject('');
            setEmailMessage('');
            setShowEmailSection(false);
        } catch (error) {
            console.error("Error sending email:", error);
            showError(error.response?.data?.message || "Failed to send email");
        } finally {
            setEmailLoading(false);
        }
    };

    // Helper to get custom field value safely
    const getCustomValue = (key) => {
        const dataSource = fullLead?.customData || lead.customData;
        if (!dataSource) return '-';
        return dataSource[key] || '-';
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 animate-fade-in-up backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-slate-900 p-6 text-white flex justify-between items-start sticky top-0 z-10">
                    <div>
                        <h2 className="text-2xl font-bold">{lead.name}</h2>
                        <div className="flex flex-wrap gap-4 text-slate-300 text-sm mt-2">
                            {lead.phone && (
                                <span className="flex items-center gap-1.5"><i className="fa-solid fa-phone text-blue-400"></i> {lead.phone}</span>
                            )}
                            {lead.email && (
                                <span className="flex items-center gap-1.5"><i className="fa-solid fa-envelope text-red-400"></i> {lead.email}</span>
                            )}
                            {lead.source && (
                                <span className="flex items-center gap-1.5"><i className="fa-solid fa-code-branch text-green-400"></i> {lead.source}</span>
                            )}
                            {lead.qualificationLevel && lead.qualificationLevel !== 'None' && (
                                <span className="flex items-center gap-1.5 bg-indigo-500/20 px-2 py-0.5 rounded-full border border-indigo-700/30">
                                    <i className="fa-solid fa-ranking-star text-indigo-400"></i>
                                    <span className="font-semibold text-indigo-300">{lead.qualificationLevel} Lead</span>
                                </span>
                            )}
                            {lead.dealValue > 0 && (
                                <span className="flex items-center gap-1.5 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                                    <i className="fa-solid fa-indian-rupee-sign text-emerald-400"></i>
                                    <span className="font-semibold text-emerald-300">₹{lead.dealValue.toLocaleString()}</span>
                                </span>
                            )}
                            {lead.tags && lead.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 items-center ml-2 border-l border-slate-700 pl-4">
                                    {lead.tags.map(tagName => {
                                        const tagObj = userTags?.find(t => t.name === tagName);
                                        return (
                                            <span key={tagName} className="text-xs px-2 py-0.5 rounded-full border font-bold shadow-sm" style={{ backgroundColor: tagObj ? `${tagObj.color}20` : '#f1f5f9', color: tagObj ? tagObj.color : '#64748b', borderColor: tagObj ? `${tagObj.color}40` : '#cbd5e1' }}>
                                                {tagName}
                                            </span>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white hover:text-red-400 text-2xl transition">
                        &times;
                    </button>
                </div>

                <div className="p-6 bg-slate-50 flex-1 overflow-y-auto space-y-6">

                    {/* Additional Information (Custom Fields + Chatbot Data) */}
                    {(customFields.length > 0 || (fullLead?.customData || lead.customData)) && (
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                            <h4 className="font-bold text-slate-700 mb-4 flex items-center gap-2 border-b border-slate-100 pb-2">
                                <i className="fa-solid fa-list-ul text-indigo-500"></i> Additional Information
                            </h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-y-4 gap-x-6">
                                {customFields.map(field => (
                                    <div key={field.key}>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                                            {field.label}
                                        </label>
                                        <p className="text-sm text-slate-800 font-medium truncate">
                                            {getCustomValue(field.key)}
                                        </p>
                                    </div>
                                ))}
                                {/* Render Any Extra Custom Data from Chatbots */}
                                {Object.keys(fullLead?.customData || lead.customData || {}).filter(k => !customFields.find(f => f.key === k)).map(key => (
                                    <div key={`extra-${key}`}>
                                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                                            {key.replace(/_/g, ' ')}
                                        </label>
                                        <p className="text-sm text-slate-800 font-medium truncate">
                                            {getCustomValue(key)}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tasks & Follow-ups Section */}
                    <div>
                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <i className="fa-solid fa-list-check text-orange-500"></i> Tasks & Reminders
                        </h4>
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                            
                            {/* Create Task Form */}
                            <div className="flex flex-col sm:flex-row gap-2 mb-5 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                <input 
                                    type="text" 
                                    placeholder="e.g., Call back regarding pricing..."
                                    value={taskTitle}
                                    onChange={e => setTaskTitle(e.target.value)}
                                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                                />
                                <div className="flex gap-2">
                                    <input 
                                        type="date" 
                                        value={taskDate}
                                        onChange={e => setTaskDate(e.target.value)}
                                        className="w-36 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                                    />
                                    <button 
                                        onClick={handleCreateTask}
                                        disabled={tasksLoading || !taskTitle || !taskDate}
                                        className="bg-orange-600 hover:bg-orange-700 text-white px-5 py-2 rounded-lg font-bold text-sm transition shadow-md disabled:opacity-50 disabled:shadow-none whitespace-nowrap"
                                    >
                                        {tasksLoading ? <i className="fa-solid fa-spinner fa-spin"></i> : "Add Task"}
                                    </button>
                                </div>
                            </div>

                            {/* Task List */}
                            {tasks.length > 0 ? (
                                <ul className="space-y-3">
                                    {tasks.filter(t => t.status === 'Pending').map(task => {
                                        const isDueToday = new Date(task.dueDate).toDateString() === new Date().toDateString();
                                        const isOverdue = new Date(task.dueDate) < new Date() && !isDueToday;
                                        
                                        return (
                                            <li key={task._id} className={`flex items-start justify-between p-4 rounded-xl border ${isOverdue ? 'border-red-200 bg-red-50/50' : isDueToday ? 'border-orange-200 bg-orange-50/50' : 'border-slate-200 bg-white'}`}>
                                                <div>
                                                    <p className={`font-bold text-sm ${isOverdue ? 'text-red-900' : 'text-slate-800'}`}>{task.title}</p>
                                                    <div className="flex items-center gap-3 mt-1">
                                                        <p className={`text-xs font-semibold ${isOverdue ? 'text-red-600' : isDueToday ? 'text-orange-600' : 'text-slate-500'}`}>
                                                            <i className="fa-regular fa-calendar mr-1"></i>
                                                            {isOverdue ? 'Overdue: ' : 'Due: '}
                                                            {new Date(task.dueDate).toLocaleDateString()}
                                                        </p>
                                                        <span className="text-[10px] uppercase font-bold text-slate-400">Created by {task.createdBy === lead.userId ? 'You' : 'Team'}</span>
                                                    </div>
                                                </div>
                                                <button 
                                                    onClick={() => handleCompleteTask(task._id)}
                                                    className="w-8 h-8 rounded-full bg-white border border-slate-300 text-slate-400 hover:border-green-500 hover:text-green-600 hover:bg-green-50 transition shadow-sm flex items-center justify-center shrink-0"
                                                    title="Mark Complete"
                                                >
                                                    <i className="fa-solid fa-check"></i>
                                                </button>
                                            </li>
                                        );
                                    })}
                                    {tasks.filter(t => t.status === 'Pending').length === 0 && (
                                        <p className="text-sm text-slate-400 text-center py-4 bg-slate-50 rounded-xl border border-dashed border-slate-200">No pending tasks for this lead! 🎉</p>
                                    )}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">No tasks created yet. Stay on top of this lead by adding a reminder above.</p>
                            )}
                        </div>
                    </div>

                    {/* Email Section */}
                    <div>
                        <h4
                            className="font-bold text-slate-700 mb-3 flex items-center justify-between cursor-pointer hover:text-red-600 transition"
                            onClick={() => setShowEmailSection(!showEmailSection)}
                        >
                            <span className="flex items-center gap-2">
                                <i className="fa-solid fa-envelope text-red-500"></i> Send Email
                            </span>
                            <i className={`fa-solid fa-chevron-${showEmailSection ? 'up' : 'down'} text-sm text-slate-400`}></i>
                        </h4>
                        {showEmailSection && (
                            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm animate-fade-in-up">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">To Email</label>
                                    <input
                                        type="email"
                                        value={emailTo}
                                        onChange={(e) => setEmailTo(e.target.value)}
                                        placeholder="recipient@example.com"
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:outline-none text-sm transition"
                                    />
                                    <p className="text-xs text-slate-400 mt-1">Lead email will be auto-filled if available</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Subject</label>
                                    <input
                                        type="text"
                                        value={emailSubject}
                                        onChange={(e) => setEmailSubject(e.target.value)}
                                        placeholder="Email subject"
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:outline-none text-sm transition"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Message</label>
                                    <textarea
                                        value={emailMessage}
                                        onChange={(e) => setEmailMessage(e.target.value)}
                                        rows="4"
                                        placeholder="Type your message here..."
                                        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:outline-none text-sm resize-none transition"
                                    ></textarea>
                                </div>
                                <button
                                    onClick={handleSendEmail}
                                    disabled={emailLoading || !emailTo || !emailSubject || !emailMessage}
                                    className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg font-medium transition shadow-md flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {emailLoading ? (
                                        <>
                                            <i className="fa-solid fa-spinner fa-spin"></i>
                                            Sending...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fa-solid fa-paper-plane"></i>
                                            Send Email
                                        </>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Activity Audit Log */}
                    <div>
                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <i className="fa-solid fa-clock-rotate-left text-blue-500"></i> Activity Audit Log
                        </h4>
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                            <ActivityTimeline leadId={lead._id} />
                        </div>
                    </div>

                    {/* Legacy History Timeline (Optional - Can be removed if audit log is sufficient) */}
                    {(fullLead?.history || lead.history || []).length > 0 && (
                        <div>
                            <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                                <i className="fa-solid fa-list text-slate-500"></i> Legacy History
                            </h4>
                            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm max-h-64 overflow-y-auto">
                                {(() => {
                                    // Map history items
                                    const historySource = fullLead?.history || lead.history || [];
                                    const historyItems = historySource.map(h => {
                                        let icon = 'fa-solid fa-circle-info';
                                        let color = 'text-gray-500';
                                        let bg = 'bg-gray-50';
                                        let border = 'border-gray-100';

                                        if (h.type === 'Email') {
                                            icon = h.subType === 'Auto' ? 'fa-solid fa-robot' : 'fa-solid fa-envelope';
                                            color = 'text-blue-500';
                                            bg = 'bg-blue-50';
                                            border = 'border-blue-100';
                                        } else if (h.type === 'WhatsApp') {
                                            icon = h.subType === 'Auto' ? 'fa-solid fa-robot' : 'fa-brands fa-whatsapp';
                                            color = 'text-green-500';
                                            bg = 'bg-green-50';
                                            border = 'border-green-100';
                                        } else if (h.type === 'Note') {
                                            icon = 'fa-regular fa-note-sticky';
                                            color = 'text-orange-500';
                                            bg = 'bg-orange-50';
                                            border = 'border-orange-100';
                                        }

                                        return { ...h, icon, color, bg, border };
                                    });

                                    const combinedHistory = historyItems.sort((a, b) => new Date(b.date) - new Date(a.date));

                                    return (
                                        <ul className="space-y-3">
                                            {combinedHistory.slice(0, 10).map((item, index) => (
                                                <li key={index} className={`p-2 rounded-lg border ${item.bg} ${item.border}`}>
                                                    <div className="flex justify-between items-start mb-1">
                                                        <span className={`text-xs font-bold uppercase ${item.color}`}>
                                                            <i className={item.icon}></i> {item.type}
                                                        </span>
                                                        <span className="text-xs text-slate-400">
                                                            {new Date(item.date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-slate-800 truncate">{item.content}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    );
                                })()}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default LeadDetailsModal;
