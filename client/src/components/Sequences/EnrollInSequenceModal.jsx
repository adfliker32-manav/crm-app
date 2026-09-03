import React, { useState, useEffect } from 'react';
import api from '../../services/api';

/**
 * EnrollInSequenceModal
 * Opens from a Lead row / detail. Shows all active sequences for this tenant.
 * User picks one and clicks Enroll — fires POST /api/sequences/:id/enroll { leadId }
 */
const EnrollInSequenceModal = ({ isOpen, onClose, lead, onSuccess }) => {
    const [sequences, setSequences] = useState([]);
    const [selected, setSelected] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [error, setError] = useState('');
    const [enrolled, setEnrolled] = useState(false);

    useEffect(() => {
        if (!isOpen) { setSelected(''); setError(''); setEnrolled(false); return; }
        setFetching(true);
        api.get('/sequences')
            .then(res => {
                const all = Array.isArray(res.data) ? res.data : [];
                setSequences(all.filter(s => s.isActive));
            })
            .catch(() => setSequences([]))
            .finally(() => setFetching(false));
    }, [isOpen]);

    const handleEnroll = async () => {
        if (!selected) { setError('Please select a sequence first'); return; }
        setError('');
        setLoading(true);
        try {
            await api.post(`/sequences/${selected}/enroll`, { leadId: lead._id });
            setEnrolled(true);
            onSuccess?.();
            // Auto-close after 1.5 s
            setTimeout(() => { onClose(); }, 1500);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to enroll lead');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const selectedSeq = sequences.find(s => s._id === selected);

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                            <i className="fa-solid fa-paper-plane text-white"></i>
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-white">Enroll in Sequence</h2>
                            <p className="text-violet-100 text-xs truncate max-w-[220px]">
                                {lead?.name || 'Lead'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg bg-white/15 hover:bg-white/25 text-white flex items-center justify-center transition">
                        <i className="fa-solid fa-xmark text-sm"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="px-6 py-5 space-y-4">

                    {enrolled ? (
                        /* Success state */
                        <div className="flex flex-col items-center gap-3 py-6">
                            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                                <i className="fa-solid fa-circle-check text-emerald-500 text-2xl"></i>
                            </div>
                            <div className="text-center">
                                <p className="font-semibold text-slate-800">Enrolled successfully!</p>
                                <p className="text-xs text-slate-500 mt-1">
                                    <span className="font-medium text-slate-700">{lead?.name}</span> is now enrolled in <span className="font-medium text-violet-600">{selectedSeq?.name}</span>
                                </p>
                            </div>
                        </div>
                    ) : fetching ? (
                        <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
                            <i className="fa-solid fa-spinner fa-spin"></i>
                            <span className="text-sm">Loading sequences…</span>
                        </div>
                    ) : sequences.length === 0 ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-4 text-sm text-amber-800 flex items-start gap-3">
                            <i className="fa-solid fa-triangle-exclamation mt-0.5 shrink-0"></i>
                            <div>
                                <p className="font-semibold">No active sequences</p>
                                <p className="text-xs mt-1 text-amber-700">Create and activate a sequence first in the <strong>Automation → Sequences</strong> section.</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Lead pill */}
                            <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs shrink-0">
                                    {(lead?.name || 'L').charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-800 truncate">{lead?.name}</div>
                                    <div className="text-xs text-slate-400 truncate">{lead?.phone || lead?.email || '—'}</div>
                                </div>
                                <i className="fa-solid fa-arrow-right text-slate-300 text-xs ml-auto shrink-0"></i>
                            </div>

                            {/* Sequence picker */}
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                    Select Sequence
                                </label>
                                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                    {sequences.map(seq => (
                                        <button
                                            key={seq._id}
                                            type="button"
                                            onClick={() => { setSelected(seq._id); setError(''); }}
                                            className={`w-full text-left px-4 py-3 rounded-xl border-2 transition-all ${
                                                selected === seq._id
                                                    ? 'border-violet-500 bg-violet-50/70 shadow-sm'
                                                    : 'border-slate-200 bg-white hover:border-slate-300'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                                    selected === seq._id ? 'bg-violet-100' : 'bg-slate-100'
                                                }`}>
                                                    <i className={`fa-solid fa-wand-magic-sparkles text-xs ${
                                                        selected === seq._id ? 'text-violet-600' : 'text-slate-400'
                                                    }`}></i>
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm font-semibold text-slate-800 truncate">{seq.name}</div>
                                                    <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                                                        <span>{seq.steps?.length || 0} step{(seq.steps?.length || 0) !== 1 ? 's' : ''}</span>
                                                        <span>·</span>
                                                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                                                            seq.trigger === 'MANUAL'
                                                                ? 'bg-slate-100 text-slate-600'
                                                                : seq.trigger === 'LEAD_CREATED'
                                                                ? 'bg-emerald-50 text-emerald-700'
                                                                : 'bg-violet-50 text-violet-700'
                                                        }`}>
                                                            {seq.trigger === 'LEAD_CREATED' ? 'Auto' : seq.trigger === 'STAGE_CHANGED' ? 'Stage' : 'Manual'}
                                                        </span>
                                                        {seq.enrollmentCount > 0 && (
                                                            <>
                                                                <span>·</span>
                                                                <span>{seq.enrollmentCount} enrolled</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                                {selected === seq._id && (
                                                    <i className="fa-solid fa-circle-check text-violet-500 text-sm shrink-0"></i>
                                                )}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                    <i className="fa-solid fa-circle-exclamation shrink-0"></i>
                                    {error}
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* Footer */}
                {!enrolled && sequences.length > 0 && !fetching && (
                    <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={loading}
                            className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-200/70 transition disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleEnroll}
                            disabled={loading || !selected}
                            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-md transition disabled:opacity-50"
                        >
                            {loading
                                ? <><i className="fa-solid fa-spinner fa-spin"></i> Enrolling…</>
                                : <><i className="fa-solid fa-paper-plane"></i> Enroll Lead</>
                            }
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EnrollInSequenceModal;
