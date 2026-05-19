/* eslint-disable */
import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';

const STATUS_META = {
    active:    { label: 'Active',    color: 'bg-emerald-50 text-emerald-700 ring-emerald-200',   dot: 'bg-emerald-500 animate-pulse' },
    paused:    { label: 'Paused',    color: 'bg-amber-50 text-amber-700 ring-amber-200',         dot: 'bg-amber-500' },
    completed: { label: 'Completed', color: 'bg-blue-50 text-blue-700 ring-blue-200',            dot: 'bg-blue-500' },
    cancelled: { label: 'Cancelled', color: 'bg-slate-100 text-slate-600 ring-slate-200',        dot: 'bg-slate-400' },
};

const EnrollmentsModal = ({ isOpen, onClose, sequence }) => {
    const [enrollments, setEnrollments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        if (!isOpen || !sequence?._id) return;
        setLoading(true);
        api.get(`/sequences/enrollments?sequenceId=${sequence._id}`)
            .then(res => setEnrollments(Array.isArray(res.data) ? res.data : []))
            .catch(() => setEnrollments([]))
            .finally(() => setLoading(false));
    }, [isOpen, sequence?._id]);

    const counts = useMemo(() => {
        const base = { all: enrollments.length, active: 0, paused: 0, completed: 0, cancelled: 0 };
        enrollments.forEach(e => { if (base[e.status] !== undefined) base[e.status]++; });
        return base;
    }, [enrollments]);

    const filtered = useMemo(() => {
        if (filter === 'all') return enrollments;
        return enrollments.filter(e => e.status === filter);
    }, [enrollments, filter]);

    if (!isOpen) return null;

    const totalSteps = sequence?.steps?.length || 0;

    const formatDate = (d) => {
        if (!d) return '—';
        const t = new Date(d);
        return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">

                {/* Header */}
                <div className="bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0">
                            <i className="fa-solid fa-users text-white text-lg"></i>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-white truncate">{sequence?.name || 'Sequence'}</h2>
                            <p className="text-indigo-100 text-xs">Lead enrollments</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-lg bg-white/15 hover:bg-white/25 text-white transition flex items-center justify-center shrink-0">
                        <i className="fa-solid fa-xmark"></i>
                    </button>
                </div>

                {/* Filter tabs */}
                <div className="px-6 pt-4 pb-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2 overflow-x-auto shrink-0">
                    {[
                        { key: 'all',       label: 'All',       icon: 'fa-list' },
                        { key: 'active',    label: 'Active',    icon: 'fa-bolt' },
                        { key: 'paused',    label: 'Paused',    icon: 'fa-pause' },
                        { key: 'completed', label: 'Completed', icon: 'fa-flag-checkered' },
                        { key: 'cancelled', label: 'Cancelled', icon: 'fa-ban' },
                    ].map(f => (
                        <button
                            key={f.key}
                            onClick={() => setFilter(f.key)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
                                filter === f.key
                                    ? 'bg-indigo-600 text-white shadow-sm'
                                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                            }`}
                        >
                            <i className={`fa-solid ${f.icon} text-[10px]`}></i>
                            {f.label}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${filter === f.key ? 'bg-white/25' : 'bg-slate-100'}`}>
                                {counts[f.key] || 0}
                            </span>
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-4">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3">
                            <i className="fa-solid fa-spinner fa-spin text-2xl text-indigo-400"></i>
                            <p className="text-sm text-slate-400">Loading enrollments…</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
                                <i className="fa-solid fa-inbox text-slate-300 text-xl"></i>
                            </div>
                            <p className="text-sm text-slate-500 font-medium">No enrollments here yet</p>
                            <p className="text-xs text-slate-400 max-w-xs">
                                Leads matching this sequence's trigger will be enrolled automatically.
                            </p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-slate-100">
                            {filtered.map(e => {
                                const meta = STATUS_META[e.status] || STATUS_META.cancelled;
                                const stepIdx = e.currentStep ?? 0;
                                const progress = totalSteps > 0
                                    ? Math.min(100, Math.round(((e.status === 'completed' ? totalSteps : stepIdx) / totalSteps) * 100))
                                    : 0;
                                return (
                                    <li key={e._id} className="py-3 flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-indigo-600 flex items-center justify-center font-bold text-xs ring-2 ring-white shrink-0">
                                            {(e.leadId?.name || 'L').charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-semibold text-slate-800 truncate">
                                                    {e.leadId?.name || 'Unknown lead'}
                                                </span>
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ring-1 ${meta.color}`}>
                                                    <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`}></span>
                                                    {meta.label}
                                                </span>
                                            </div>
                                            <div className="text-[11px] text-slate-500 truncate">
                                                {e.leadId?.phone || e.leadId?.email || '—'} · enrolled {formatDate(e.enrolledAt)}
                                            </div>
                                            {totalSteps > 0 && (
                                                <div className="mt-1.5 flex items-center gap-2">
                                                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full rounded-full transition-all ${e.status === 'completed' ? 'bg-emerald-400' : 'bg-indigo-400'}`}
                                                            style={{ width: `${progress}%` }}
                                                        />
                                                    </div>
                                                    <span className="text-[10px] font-semibold text-slate-500 whitespace-nowrap">
                                                        Step {Math.min(stepIdx + 1, totalSteps)}/{totalSteps}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
                    <span className="text-xs text-slate-400">
                        Showing {filtered.length} of {enrollments.length} · max 200 per view
                    </span>
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-200/70 transition"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EnrollmentsModal;
