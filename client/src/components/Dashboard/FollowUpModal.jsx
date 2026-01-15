import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import FollowUpActionModal from './FollowUpActionModal';

const FollowUpModal = ({ isOpen, onClose, onSuccess }) => {
    const [activeTab, setActiveTab] = useState('today');
    const [todayLeads, setTodayLeads] = useState([]);
    const [doneLeads, setDoneLeads] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedLead, setSelectedLead] = useState(null);
    const [isActionModalOpen, setIsActionModalOpen] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchFollowUps();
        }
    }, [isOpen]);

    const fetchFollowUps = async () => {
        setLoading(true);
        try {
            const [todayRes, doneRes] = await Promise.all([
                api.get('/leads/follow-up-today'),
                api.get('/leads/follow-up-done')
            ]);

            setTodayLeads(todayRes.data);
            setDoneLeads(doneRes.data);
        } catch (err) {
            console.error("Error fetching follow ups", err);
        } finally {
            setLoading(false);
        }
    };

    const handleCompleteFollowUp = (lead) => {
        setSelectedLead(lead);
        setIsActionModalOpen(true);
    };

    const handleActionSuccess = () => {
        fetchFollowUps();
        if (onSuccess) onSuccess();
    };

    if (!isOpen) return null;

    const currentLeads = activeTab === 'today' ? todayLeads : doneLeads;

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
                <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-3xl max-h-[80vh] flex flex-col">
                    <div className="flex justify-between items-center mb-4 border-b pb-3 border-gray-100">
                        <h3 className="text-xl font-bold text-gray-800">📅 Follow-up Management</h3>
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
                            Due Today / Overdue ({todayLeads.length})
                        </button>
                        <button
                            className={`flex-1 py-2 text-sm font-medium transition ${activeTab === 'done'
                                    ? 'border-b-2 border-orange-500 text-gray-800'
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                            onClick={() => setActiveTab('done')}
                        >
                            <i className="fa-solid fa-check-circle mr-2"></i>
                            Completed ({doneLeads.length})
                        </button>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto">
                        {loading ? (
                            <div className="text-center py-8 text-gray-500">
                                <i className="fa-solid fa-spinner fa-spin text-2xl mb-2"></i>
                                <p>Loading follow-ups...</p>
                            </div>
                        ) : currentLeads.length === 0 ? (
                            <div className="text-center py-12 text-gray-400">
                                <i className="fa-regular fa-calendar-check text-5xl mb-3"></i>
                                <p className="text-lg font-medium">
                                    {activeTab === 'today'
                                        ? 'No follow-ups due today!'
                                        : 'No completed follow-ups yet'}
                                </p>
                                <p className="text-sm mt-1">
                                    {activeTab === 'today'
                                        ? 'Great job staying on top of your leads!'
                                        : 'Completed follow-ups will appear here'}
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {currentLeads.map(lead => (
                                    <FollowUpCard
                                        key={lead._id}
                                        lead={lead}
                                        isToday={activeTab === 'today'}
                                        onComplete={handleCompleteFollowUp}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Follow-up Action Modal */}
            <FollowUpActionModal
                isOpen={isActionModalOpen}
                onClose={() => setIsActionModalOpen(false)}
                lead={selectedLead}
                onSuccess={handleActionSuccess}
            />
        </>
    );
};

// Follow-up Card Component
const FollowUpCard = ({ lead, isToday, onComplete }) => {
    const isOverdue = lead.nextFollowUpDate && new Date(lead.nextFollowUpDate) < new Date();

    return (
        <div className={`p-4 rounded-lg border flex justify-between items-center ${isToday
                ? isOverdue
                    ? 'bg-red-50 border-red-200'
                    : 'bg-orange-50 border-orange-200'
                : 'bg-green-50 border-green-200'
            }`}>
            <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-bold text-gray-800">{lead.name}</h4>
                    {isOverdue && (
                        <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full font-bold">
                            OVERDUE
                        </span>
                    )}
                </div>
                <p className="text-xs text-gray-600 mb-1">
                    <i className="fa-solid fa-phone mr-1"></i> {lead.phone}
                    {lead.email && (
                        <>
                            <span className="mx-2">•</span>
                            <i className="fa-solid fa-envelope mr-1"></i> {lead.email}
                        </>
                    )}
                </p>
                {lead.nextFollowUpDate && (
                    <p className={`text-xs font-medium mt-1 ${isOverdue ? 'text-red-600' : 'text-orange-600'
                        }`}>
                        <i className="fa-solid fa-calendar mr-1"></i>
                        {isToday ? 'Due: ' : 'Completed: '}
                        {new Date(lead.nextFollowUpDate).toLocaleDateString()}
                    </p>
                )}
                {lead.lastFollowUpDate && (
                    <p className="text-xs text-gray-500 mt-1">
                        Last contact: {new Date(lead.lastFollowUpDate).toLocaleDateString()}
                    </p>
                )}
                {/* Show latest note from history */}
                {lead.followUpHistory && lead.followUpHistory.length > 0 && !isToday && (
                    <p className="text-xs text-gray-600 mt-2 italic border-l-2 border-green-400 pl-2">
                        "{lead.followUpHistory[lead.followUpHistory.length - 1].note}"
                    </p>
                )}
            </div>
            <div className="ml-4">
                {isToday ? (
                    <button
                        onClick={() => onComplete(lead)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-md flex items-center gap-2"
                    >
                        <i className="fa-solid fa-check"></i>
                        Complete
                    </button>
                ) : (
                    <span className="text-green-600 font-bold flex items-center gap-1">
                        <i className="fa-solid fa-circle-check"></i>
                        Done
                    </span>
                )}
            </div>
        </div>
    );
};

export default FollowUpModal;
