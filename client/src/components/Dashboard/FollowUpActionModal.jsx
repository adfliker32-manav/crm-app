import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const FollowUpActionModal = ({ isOpen, onClose, lead, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [note, setNote] = useState('');
    const [nextAction, setNextAction] = useState('nextDate'); // 'nextDate' or 'deadLead'
    const [nextFollowUpDate, setNextFollowUpDate] = useState('');
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});

    // Reset form when modal opens/closes or lead changes
    useEffect(() => {
        if (isOpen && lead) {
            setNote('');
            setNextAction('nextDate');
            setNextFollowUpDate('');
            setErrors({});
        }
    }, [isOpen, lead]);

    const validate = () => {
        const newErrors = {};

        if (!note.trim()) {
            newErrors.note = 'Follow-up note is required';
        }

        if (nextAction === 'nextDate' && !nextFollowUpDate) {
            newErrors.action = 'Please select next follow-up date or mark as dead lead';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!validate()) return;

        setLoading(true);

        try {
            const payload = {
                leadId: lead._id,
                note: note.trim(),
                nextFollowUpDate: nextAction === 'nextDate' ? nextFollowUpDate : null,
                markedAsDeadLead: nextAction === 'deadLead'
            };

            await api.post('/leads/complete-followup', payload);

            showSuccess('Follow-up completed successfully!');
            if (onSuccess) onSuccess();
            onClose();
        } catch (err) {
            console.error('Failed to complete follow-up:', err);
            showError(err.response?.data?.message || 'Failed to complete follow-up');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !lead) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-lg">
                <div className="flex justify-between items-center mb-4 border-b pb-3 border-gray-100">
                    <div>
                        <h3 className="text-xl font-bold text-gray-800">Complete Follow-up</h3>
                        <p className="text-sm text-gray-500">For: {lead.name}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Follow-up Note */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Follow-up Note <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="What happened in this follow-up?"
                            className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none h-24 text-sm ${errors.note ? 'border-red-500' : 'border-gray-300'
                                }`}
                            required
                        ></textarea>
                        {errors.note && (
                            <p className="text-red-500 text-xs mt-1">{errors.note}</p>
                        )}
                    </div>

                    {/* Next Action */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Next Action <span className="text-red-500">*</span>
                        </label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="nextAction"
                                    value="nextDate"
                                    checked={nextAction === 'nextDate'}
                                    onChange={(e) => setNextAction(e.target.value)}
                                    className="w-4 h-4 text-blue-600"
                                />
                                <span className="text-sm text-gray-700">Schedule Next Follow-up</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="nextAction"
                                    value="deadLead"
                                    checked={nextAction === 'deadLead'}
                                    onChange={(e) => setNextAction(e.target.value)}
                                    className="w-4 h-4 text-red-600"
                                />
                                <span className="text-sm text-gray-700">Mark as Dead Lead</span>
                            </label>
                        </div>
                    </div>

                    {/* Next Follow-up Date (conditional) */}
                    {nextAction === 'nextDate' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Next Follow-up Date
                            </label>
                            <input
                                type="date"
                                value={nextFollowUpDate}
                                onChange={(e) => setNextFollowUpDate(e.target.value)}
                                min={new Date().toISOString().split('T')[0]}
                                className={`w-full p-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm ${errors.action ? 'border-red-500' : 'border-gray-300'
                                    }`}
                            />
                            {errors.action && (
                                <p className="text-red-500 text-xs mt-1">{errors.action}</p>
                            )}
                        </div>
                    )}

                    {/* Follow-up History (if available) */}
                    {lead.followUpHistory && lead.followUpHistory.length > 0 && (
                        <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
                            <h4 className="text-xs font-bold text-gray-600 uppercase mb-2">Previous Follow-ups</h4>
                            <div className="space-y-2 max-h-32 overflow-y-auto">
                                {lead.followUpHistory.slice(-3).reverse().map((history, index) => (
                                    <div key={index} className="text-xs text-gray-600 border-l-2 border-blue-300 pl-2">
                                        <p className="font-medium">{history.note}</p>
                                        <p className="text-gray-400">
                                            {new Date(history.completedDate).toLocaleDateString()}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
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
                            className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i>
                                    Saving...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-check"></i>
                                    Complete Follow-up
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default FollowUpActionModal;
