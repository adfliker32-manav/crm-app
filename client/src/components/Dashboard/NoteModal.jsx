import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const NoteModal = ({ isOpen, onClose, lead, onSuccess }) => {
    const [note, setNote] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Reset state when modal opens/closes or lead changes
    useEffect(() => {
        if (isOpen) {
            setNote('');
            setError(null);
        }
    }, [isOpen, lead]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!note.trim()) return;

        setLoading(true);
        setError(null);

        try {
            await api.post(`/leads/${lead._id}/notes`, { text: note });
            setNote('');
            if (onSuccess) onSuccess(); // Refresh dashboard data
            onClose();
        } catch (err) {
            console.error("Failed to add note", err);
            setError(err.response?.data?.message || 'Failed to add note');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !lead) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md flex flex-col max-h-[90vh]">
                <div className="flex justify-between items-center mb-4 border-b pb-3 border-gray-100">
                    <div>
                        <h3 className="text-xl font-bold text-gray-800">Lead Notes</h3>
                        <p className="text-sm text-gray-500">For: {lead.name}</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500 transition">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {/* Existing Notes List (Scrollable) */}
                <div className="flex-1 overflow-y-auto mb-4 space-y-3 pr-2 min-h-[150px]">
                    {lead.notes && lead.notes.length > 0 ? (
                        lead.notes.slice().reverse().map((noteItem, index) => (
                            <div key={index} className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                <p className="text-gray-700 text-sm whitespace-pre-wrap">{noteItem.text}</p>
                                <p className="text-xs text-gray-400 mt-2 text-right">
                                    {new Date(noteItem.date).toLocaleString()}
                                </p>
                            </div>
                        ))
                    ) : (
                        <div className="text-center text-gray-400 py-8 italic">
                            No notes yet. Start typing below!
                        </div>
                    )}
                </div>

                {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-3 text-sm">{error}</div>}

                {/* Add Note Form */}
                <form onSubmit={handleSubmit} className="mt-auto pt-4 border-t border-gray-100">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Add New Note</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Type your note here..."
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none h-24 text-sm"
                        required
                    ></textarea>

                    <div className="flex justify-end gap-3 mt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading || !note.trim()}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70 flex items-center gap-2"
                        >
                            {loading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-paper-plane"></i>}
                            {loading ? 'Saving...' : 'Add Note'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default NoteModal;
