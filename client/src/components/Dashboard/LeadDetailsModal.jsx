import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const LeadDetailsModal = ({ isOpen, onClose, lead, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [nextFollowUpDate, setNextFollowUpDate] = useState('');
    const [loading, setLoading] = useState(false);

    // Email section states
    const [showEmailSection, setShowEmailSection] = useState(false);
    const [emailTo, setEmailTo] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailMessage, setEmailMessage] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);

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

    if (!isOpen || !lead) return null;

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('en-US', {
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

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 animate-fade-in-up backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="bg-slate-900 p-6 text-white flex justify-between items-start sticky top-0 z-10">
                    <div>
                        <h2 className="text-2xl font-bold">{lead.name}</h2>
                        <p className="text-slate-400 text-sm mt-1">{lead.phone || 'No Phone'} • {lead.email || 'No Email'}</p>
                    </div>
                    <button onClick={onClose} className="text-white hover:text-red-400 text-2xl transition">
                        &times;
                    </button>
                </div>

                <div className="p-6 bg-slate-50 flex-1 overflow-y-auto space-y-6">
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

                    {/* Quick Info / History Preview (Optional) */}
                    <div>
                        <h4 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                            <i className="fa-solid fa-clock-rotate-left text-blue-500"></i> Recent History
                        </h4>
                        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                            {lead.followUpHistory && lead.followUpHistory.length > 0 ? (
                                <ul className="space-y-3">
                                    {lead.followUpHistory.slice(-3).reverse().map((history, index) => (
                                        <li key={index} className="text-sm border-l-2 border-blue-200 pl-3 py-1">
                                            <p className="text-slate-800">{history.note}</p>
                                            <p className="text-xs text-slate-400 mt-0.5">{formatDate(history.date)}</p>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className="text-sm text-slate-400 italic">No history available.</p>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default LeadDetailsModal;
