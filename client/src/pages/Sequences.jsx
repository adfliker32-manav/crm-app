/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import React, { useState, useEffect, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useConfirm } from '../context/ConfirmContext';
import api from '../services/api';
import SequenceBuilderModal from '../components/Sequences/SequenceBuilderModal';
import EnrollmentsModal from '../components/Sequences/EnrollmentsModal';

const TRIGGER_META = {
    LEAD_CREATED:  { label: 'Lead Created',  icon: 'fa-user-plus',    color: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    STAGE_CHANGED: { label: 'Stage Changed', icon: 'fa-right-left',   color: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
    MANUAL:        { label: 'Manual',        icon: 'fa-hand-pointer', color: 'bg-slate-50 text-slate-700 ring-1 ring-slate-200' },
};

const FEATURE_CARDS = [
    { icon: 'fa-stopwatch',         color: 'from-indigo-400 to-violet-500',  title: 'Time-based Drips',    desc: 'Schedule a step to fire minutes, hours, or days after the lead enters the sequence.' },
    { icon: 'fa-comments',          color: 'from-emerald-400 to-teal-500',   title: 'Pause on Reply',      desc: 'Automatically stop the sequence the moment a lead engages — never spam an active conversation.' },
    { icon: 'fa-layer-group',       color: 'from-amber-400 to-orange-500',   title: 'WhatsApp + Email',    desc: 'Mix channels in a single flow. Use approved WhatsApp templates and personalised emails together.' },
    { icon: 'fa-chart-line',        color: 'from-rose-400 to-pink-500',      title: 'Live Enrollment',     desc: 'See exactly which leads are at which step in real time. Drill down by status and progress.' },
];

const Sequences = () => {
    const { user } = useAuth();
    const { showNotification } = useNotification();
    const { showDanger } = useConfirm();

    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;

    const [sequences, setSequences] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const [editingSequence, setEditingSequence] = useState(null);

    const [enrollmentsFor, setEnrollmentsFor] = useState(null);

    const fetchSequences = async () => {
        try {
            setError(null);
            const res = await api.get('/sequences');
            setSequences(Array.isArray(res.data) ? res.data : []);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to load sequences');
            showNotification('error', 'Failed to load sequences');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchSequences(); }, []);

    const toggleActive = async (seq) => {
        try {
            await api.put(`/sequences/${seq._id}`, { isActive: !seq.isActive });
            setSequences(prev => prev.map(s => s._id === seq._id ? { ...s, isActive: !seq.isActive } : s));
            showNotification('success', `Sequence ${!seq.isActive ? 'activated' : 'paused'}`);
        } catch {
            showNotification('error', 'Failed to toggle status');
        }
    };

    const deleteSequence = async (seq) => {
        const confirmed = await showDanger(
            `Delete "${seq.name}"? This will cancel all active enrollments and cannot be undone.`,
            'Delete Sequence'
        );
        if (!confirmed) return;
        try {
            await api.delete(`/sequences/${seq._id}`);
            setSequences(prev => prev.filter(s => s._id !== seq._id));
            showNotification('success', 'Sequence deleted');
        } catch {
            showNotification('error', 'Failed to delete sequence');
        }
    };

    const duplicateSequence = async (seq) => {
        try {
            const { _id, createdAt, updatedAt, enrollmentCount, __v, createdBy, tenantId, agencyId, deletedAt, ...rest } = seq;
            const res = await api.post('/sequences', { ...rest, name: `${seq.name} (Copy)`, isActive: false });
            setSequences(prev => [res.data, ...prev]);
            showNotification('success', 'Sequence duplicated (inactive)');
        } catch {
            showNotification('error', 'Failed to duplicate sequence');
        }
    };

    const stats = useMemo(() => ({
        total: sequences.length,
        active: sequences.filter(s => s.isActive).length,
        enrollments: sequences.reduce((acc, s) => acc + (s.enrollmentCount || 0), 0)
    }), [sequences]);

    if (!canManageTeam) return <Navigate to="/dashboard" replace />;

    if (error) return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/25">
                <i className="fa-solid fa-triangle-exclamation text-white text-xl"></i>
            </div>
            <p className="text-rose-600 font-semibold">{error}</p>
            <button onClick={() => { setLoading(true); fetchSequences(); }}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl font-medium text-sm shadow-md hover:shadow-lg transition-all flex items-center gap-2">
                <i className="fa-solid fa-arrows-rotate"></i> Try Again
            </button>
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40">
            <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

                {/* Header */}
                <div className="relative bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-2xl p-6 overflow-hidden shadow-xl shadow-indigo-500/20">
                    <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
                    <div className="absolute -bottom-6 left-1/3 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />

                    <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 shadow-inner">
                                <i className="fa-solid fa-wand-magic-sparkles text-white text-2xl"></i>
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white leading-tight">Drip Sequences</h1>
                                <p className="text-blue-100 text-sm mt-0.5">Multi-step WhatsApp + Email follow-ups that run on autopilot</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                            {sequences.length > 0 && (
                                <>
                                    <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-4 py-2">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                        <span className="text-white text-sm font-semibold">{stats.active} Active</span>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-4 py-2">
                                        <i className="fa-solid fa-users text-yellow-200 text-xs"></i>
                                        <span className="text-white text-sm font-semibold">{stats.enrollments} Enrolled</span>
                                    </div>
                                </>
                            )}
                            <button
                                onClick={() => { setEditingSequence(null); setIsBuilderOpen(true); }}
                                className="flex items-center gap-2 bg-white text-indigo-700 hover:bg-indigo-50 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-md hover:shadow-lg"
                            >
                                <i className="fa-solid fa-plus"></i> New Sequence
                            </button>
                        </div>
                    </div>
                </div>

                {/* Loading */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center">
                            <i className="fa-solid fa-wand-magic-sparkles text-indigo-500 text-xl animate-pulse"></i>
                        </div>
                        <p className="text-gray-400 text-sm">Loading sequences…</p>
                    </div>

                ) : sequences.length === 0 ? (
                    /* Empty state */
                    <div className="space-y-6">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border-b border-gray-100 px-8 py-10 flex flex-col items-center text-center gap-5">
                                <div className="relative">
                                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
                                        <i className="fa-solid fa-wand-magic-sparkles text-white text-3xl"></i>
                                    </div>
                                    <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-400 border-2 border-white flex items-center justify-center">
                                        <i className="fa-solid fa-plus text-white text-xs"></i>
                                    </span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">Build Your First Drip</h2>
                                    <p className="text-gray-500 text-sm mt-1.5 max-w-md">
                                        Send a sequence of messages over hours or days — automatically pause when leads reply.
                                        Industry-grade workflows, set up in minutes.
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setEditingSequence(null); setIsBuilderOpen(true); }}
                                    className="flex items-center gap-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-7 py-3 rounded-xl font-semibold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl transition-all"
                                >
                                    <i className="fa-solid fa-wand-magic-sparkles"></i>
                                    Create Sequence
                                </button>
                            </div>

                            <div className="px-8 py-5 flex flex-col sm:flex-row items-center justify-center gap-2 text-xs text-gray-500">
                                <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-bolt text-xs"></i> Pick a Trigger
                                </div>
                                <i className="fa-solid fa-chevron-right text-gray-300 hidden sm:block"></i>
                                <div className="flex items-center gap-1.5 bg-slate-50 text-slate-600 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-list-ol text-xs"></i> Add Steps
                                </div>
                                <i className="fa-solid fa-chevron-right text-gray-300 hidden sm:block"></i>
                                <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-stopwatch text-xs"></i> Set Delays
                                </div>
                                <i className="fa-solid fa-chevron-right text-gray-300 hidden sm:block"></i>
                                <div className="flex items-center gap-1.5 bg-violet-50 text-violet-700 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-circle-check text-xs"></i> Run on Autopilot
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            {FEATURE_CARDS.map((f, i) => (
                                <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all group">
                                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-3 shadow-md group-hover:scale-105 transition-transform`}>
                                        <i className={`fa-solid ${f.icon} text-white text-base`}></i>
                                    </div>
                                    <h4 className="text-sm font-semibold text-gray-800 mb-1">{f.title}</h4>
                                    <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                ) : (
                    /* Table */
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-800">{stats.total} Sequence{stats.total !== 1 ? 's' : ''}</span>
                                <span className="text-gray-300">·</span>
                                <span className="text-xs text-gray-500">{stats.active} active</span>
                            </div>
                            <button
                                onClick={() => { setEditingSequence(null); setIsBuilderOpen(true); }}
                                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                            >
                                <i className="fa-solid fa-plus"></i> Add Sequence
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-gray-50/80 text-gray-400 text-xs uppercase tracking-wider">
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100">Sequence</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100">Trigger</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Steps</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Status</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Enrolled</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {sequences.map(seq => {
                                        const tm = TRIGGER_META[seq.trigger] || TRIGGER_META.MANUAL;
                                        return (
                                            <tr key={seq._id} className="hover:bg-blue-50/30 transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${seq.isActive ? 'bg-indigo-100' : 'bg-gray-100'}`}>
                                                            <i className={`fa-solid fa-wand-magic-sparkles text-xs ${seq.isActive ? 'text-indigo-500' : 'text-gray-400'}`}></i>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-semibold text-gray-900">{seq.name}</div>
                                                            <div className="text-xs text-gray-400 mt-0.5">
                                                                {seq.stopOnReply ? 'Pauses on reply' : 'Continues on reply'}
                                                                {seq.triggerStage && <> · Stage: <span className="font-medium text-gray-500">{seq.triggerStage}</span></>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${tm.color}`}>
                                                        <i className={`fa-solid ${tm.icon} text-xs`}></i>
                                                        {tm.label}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-700">
                                                        <i className="fa-solid fa-list-ol text-indigo-400 text-xs"></i>
                                                        {seq.steps?.length || 0}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button
                                                        onClick={() => toggleActive(seq)}
                                                        title={seq.isActive ? 'Pause' : 'Activate'}
                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${seq.isActive ? 'bg-indigo-500' : 'bg-gray-200'}`}
                                                    >
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${seq.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button
                                                        onClick={() => setEnrollmentsFor(seq)}
                                                        className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                                                        title="View enrollments"
                                                    >
                                                        <i className="fa-solid fa-users text-xs"></i>
                                                        {seq.enrollmentCount || 0}
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => { setEditingSequence(seq); setIsBuilderOpen(true); }}
                                                            title="Edit"
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                                                        >
                                                            <i className="fa-solid fa-pen-to-square text-xs"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => duplicateSequence(seq)}
                                                            title="Duplicate"
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                                                        >
                                                            <i className="fa-solid fa-copy text-xs"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => deleteSequence(seq)}
                                                            title="Delete"
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
                                                        >
                                                            <i className="fa-solid fa-trash-can text-xs"></i>
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <div className="px-6 py-3 bg-gray-50/50 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
                            <i className="fa-solid fa-shield-halved text-indigo-300"></i>
                            Sequences pause automatically when a lead replies — your contacts will never feel spammed.
                        </div>
                    </div>
                )}
            </div>

            <SequenceBuilderModal
                isOpen={isBuilderOpen}
                onClose={() => { setIsBuilderOpen(false); setEditingSequence(null); }}
                onSave={fetchSequences}
                editingSequence={editingSequence}
            />

            <EnrollmentsModal
                isOpen={!!enrollmentsFor}
                onClose={() => setEnrollmentsFor(null)}
                sequence={enrollmentsFor}
            />
        </div>
    );
};

export default Sequences;
