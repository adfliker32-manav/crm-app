import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import ActivityTimeline from './ActivityTimeline';

const LeadDetailsModal = ({ isOpen, onClose, lead, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [nextFollowUpDate, setNextFollowUpDate] = useState('');
    const [loading, setLoading] = useState(false);
    const [customFields, setCustomFields] = useState([]);

    // Email section states
    const [showEmailSection, setShowEmailSection] = useState(false);
    const [emailTo, setEmailTo] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchCustomFields();
        }
    }, [isOpen]);

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
        if (!lead.customData) return '-';
        // Handle both Map and Object structures which might come from backend
        return lead.customData[key] || '-';
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
                            {lead.dealValue > 0 && (
                                <span className="flex items-center gap-1.5 bg-emerald-500/20 px-2 py-0.5 rounded-full">
                                    <i className="fa-solid fa-indian-rupee-sign text-emerald-400"></i>
                                    <span className="font-semibold text-emerald-300">₹{lead.dealValue.toLocaleString()}</span>
                                </span>
                            )}
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white hover:text-red-400 text-2xl transition">
                        &times;
                    </button>
                </div>

                <div className="p-6 bg-slate-50 flex-1 overflow-y-auto space-y-6">

                    {/* Additional Information (Custom Fields) */}
                    {customFields.length > 0 && (
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
                            </div>
                        </div>
                    )}

                    {/* Follow-up Reminder Section */}
                    <div>
                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <i className="fa-solid fa-calendar-check text-orange-500"></i> Follow-up Reminder
                        </h4>
                        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-sm">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Created Date</label>
                                    <p className="text-sm text-slate-800 font-medium">{formatDate(lead.createdAt || lead.date)}</p>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Last Follow-up</label>
                                    <p className="text-sm text-slate-800 font-medium">{formatDate(lead.lastFollowUpDate)}</p>
                                </div>
                            </div>

                            <hr className="border-slate-100" />

                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2">Next Follow-up Date</label>
                                <div className="flex gap-2">
                                    <input
                                        type="date"
                                        value={nextFollowUpDate}
                                        onChange={(e) => setNextFollowUpDate(e.target.value)}
                                        className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:outline-none text-sm transition"
                                    />
                                    <button
                                        onClick={handleUpdateFollowUp}
                                        disabled={loading}
                                        className="bg-orange-600 hover:bg-orange-700 text-white px-6 py-2 rounded-lg font-medium transition shadow-md text-sm disabled:opacity-70 flex items-center gap-2"
                                    >
                                        {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-save"></i>}
                                        Set
                                    </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    Setting a date will add this lead to the "Follow-up Today" list when due.
                                </p>
                            </div>
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
                    {(lead.history || []).length > 0 && (
                        <div>
                            <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                                <i className="fa-solid fa-list text-slate-500"></i> Legacy History
                            </h4>
                            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm max-h-64 overflow-y-auto">
                                {(() => {
                                    // Map history items
                                    const historyItems = (lead.history || []).map(h => {
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
