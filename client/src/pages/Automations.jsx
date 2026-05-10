/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { useConfirm } from '../context/ConfirmContext';
import RuleBuilderModal from '../components/Automations/RuleBuilderModal';

const TRIGGER_META = {
    LEAD_CREATED:  { label: 'Lead Created',     icon: 'fa-user-plus',    color: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
    STAGE_CHANGED: { label: 'Stage Changed',    icon: 'fa-right-left',   color: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' },
    TIME_IN_STAGE: { label: 'Time in Stage',    icon: 'fa-clock',        color: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
};

const FEATURE_CARDS = [
    { icon: 'fa-brands fa-whatsapp', color: 'from-green-400 to-emerald-500', title: 'WhatsApp Sequences', desc: 'Send approved templates instantly or after a delay when a lead is created or changes stage.' },
    { icon: 'fa-envelope',           color: 'from-blue-400 to-indigo-500',   title: 'Email Follow-ups',  desc: 'Auto-send personalised emails triggered by any pipeline event — zero manual effort.' },
    { icon: 'fa-right-left',         color: 'from-violet-400 to-purple-500', title: 'Stage Routing',     desc: 'Move leads through your pipeline automatically based on conditions and reply behaviour.' },
    { icon: 'fa-hourglass-half',     color: 'from-amber-400 to-orange-500',  title: 'Wait for Reply',    desc: 'Branch your workflow: one path if the lead replies, another if they go silent.' },
];

const Automations = () => {
    const { user } = useAuth();
    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const [editingRule, setEditingRule] = useState(null);
    const { showNotification } = useNotification();
    const { showDanger } = useConfirm();

    const fetchRules = async () => {
        try {
            setError(null);
            const res = await api.get('/automations');
            setRules(res.data);
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Failed to load automations');
            showNotification('error', 'Failed to load automations');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRules(); }, []);

    const toggleRuleStatus = async (id, currentStatus) => {
        try {
            await api.patch(`/automations/${id}/toggle`, { isActive: !currentStatus });
            setRules(rules.map(r => r._id === id ? { ...r, isActive: !currentStatus } : r));
            showNotification('success', `Automation ${!currentStatus ? 'Activated' : 'Paused'}`);
        } catch {
            showNotification('error', 'Failed to toggle status');
        }
    };

    const deleteRule = async (id) => {
        const confirmed = await showDanger('Are you sure you want to delete this automation? This cannot be undone.', 'Delete Automation');
        if (!confirmed) return;
        try {
            await api.delete(`/automations/${id}`);
            setRules(rules.filter(r => r._id !== id));
            showNotification('success', 'Automation deleted');
        } catch {
            showNotification('error', 'Failed to delete automation');
        }
    };

    const duplicateRule = async (rule) => {
        try {
            const { _id, createdAt, updatedAt, executionCount, lastFiredAt, currentlyProcessingLeadId, lockAcquiredAt, __v, ...rest } = rule;
            const res = await api.post('/automations', { ...rest, name: `${rule.name} (Copy)`, isActive: false });
            setRules(prev => [res.data, ...prev]);
            showNotification('success', 'Automation duplicated (inactive)');
        } catch {
            showNotification('error', 'Failed to duplicate automation');
        }
    };

    const formatLastFired = (date) => {
        if (!date) return <span className="text-gray-400 text-xs italic">Never</span>;
        const diff = Date.now() - new Date(date).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 60) return <span className="text-xs font-medium text-gray-700">{mins}m ago</span>;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return <span className="text-xs font-medium text-gray-700">{hrs}h ago</span>;
        return <span className="text-xs font-medium text-gray-700">{Math.floor(hrs / 24)}d ago</span>;
    };

    const activeCount = rules.filter(r => r.isActive).length;
    const totalRuns   = rules.reduce((s, r) => s + (r.executionCount || 0), 0);

    if (!canManageTeam) return <Navigate to="/dashboard" replace />;

    if (error) return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/25">
                <i className="fa-solid fa-triangle-exclamation text-white text-xl"></i>
            </div>
            <p className="text-rose-600 font-semibold">{error}</p>
            <button onClick={() => { setLoading(true); fetchRules(); }}
                className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-violet-600 text-white rounded-xl font-medium text-sm shadow-md hover:shadow-lg transition-all flex items-center gap-2">
                <i className="fa-solid fa-arrows-rotate"></i> Try Again
            </button>
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40">
            <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

                {/* ── Header ─────────────────────────────────────────── */}
                <div className="relative bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 rounded-2xl p-6 overflow-hidden shadow-xl shadow-indigo-500/20">
                    {/* decorative blobs */}
                    <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
                    <div className="absolute -bottom-6 left-1/3 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none" />

                    <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 shadow-inner">
                                <i className="fa-solid fa-robot text-white text-2xl"></i>
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-white leading-tight">Automation Engine</h1>
                                <p className="text-blue-100 text-sm mt-0.5">Zero-code workflows that run your CRM on autopilot</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3 flex-wrap">
                            {/* stat pills */}
                            {rules.length > 0 && (
                                <>
                                    <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-4 py-2">
                                        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                        <span className="text-white text-sm font-semibold">{activeCount} Active</span>
                                    </div>
                                    <div className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-xl px-4 py-2">
                                        <i className="fa-solid fa-bolt text-yellow-300 text-xs"></i>
                                        <span className="text-white text-sm font-semibold">{totalRuns} Runs</span>
                                    </div>
                                </>
                            )}
                            <button
                                onClick={() => { setEditingRule(null); setIsBuilderOpen(true); }}
                                className="flex items-center gap-2 bg-white text-indigo-700 hover:bg-indigo-50 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all shadow-md hover:shadow-lg"
                            >
                                <i className="fa-solid fa-plus"></i> New Automation
                            </button>
                        </div>
                    </div>
                </div>

                {/* ── Loading ─────────────────────────────────────────── */}
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center">
                            <i className="fa-solid fa-robot text-indigo-500 text-xl animate-pulse"></i>
                        </div>
                        <p className="text-gray-400 text-sm">Loading automations…</p>
                    </div>

                /* ── Empty state ─────────────────────────────────────── */
                ) : rules.length === 0 ? (
                    <div className="space-y-6">
                        {/* hero card */}
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                            <div className="bg-gradient-to-r from-slate-50 to-indigo-50 border-b border-gray-100 px-8 py-10 flex flex-col items-center text-center gap-5">
                                <div className="relative">
                                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
                                        <i className="fa-solid fa-robot text-white text-3xl"></i>
                                    </div>
                                    <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-emerald-400 border-2 border-white flex items-center justify-center">
                                        <i className="fa-solid fa-plus text-white text-xs"></i>
                                    </span>
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-gray-900">Build Your First Automation</h2>
                                    <p className="text-gray-500 text-sm mt-1.5 max-w-md">
                                        Set up trigger-based workflows that send messages, move leads, and assign tasks — automatically, 24/7.
                                    </p>
                                </div>
                                <button
                                    onClick={() => { setEditingRule(null); setIsBuilderOpen(true); }}
                                    className="flex items-center gap-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white px-7 py-3 rounded-xl font-semibold text-sm shadow-lg shadow-indigo-500/25 hover:shadow-xl transition-all"
                                >
                                    <i className="fa-solid fa-wand-magic-sparkles"></i>
                                    Create Automation
                                </button>
                            </div>

                            {/* how it works strip */}
                            <div className="px-8 py-5 flex flex-col sm:flex-row items-center justify-center gap-2 text-xs text-gray-500">
                                <div className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-bolt text-xs"></i> Pick a Trigger
                                </div>
                                <i className="fa-solid fa-chevron-right text-gray-300 hidden sm:block"></i>
                                <div className="flex items-center gap-1.5 bg-slate-50 text-slate-600 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-filter text-xs"></i> Set Conditions
                                </div>
                                <i className="fa-solid fa-chevron-right text-gray-300 hidden sm:block"></i>
                                <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-gears text-xs"></i> Run Actions
                                </div>
                                <i className="fa-solid fa-chevron-right text-gray-300 hidden sm:block"></i>
                                <div className="flex items-center gap-1.5 bg-violet-50 text-violet-700 px-3 py-1.5 rounded-full font-medium">
                                    <i className="fa-solid fa-circle-check text-xs"></i> Works 24/7
                                </div>
                            </div>
                        </div>

                        {/* feature cards */}
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

                /* ── Rules table ─────────────────────────────────────── */
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                        {/* table header bar */}
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-800">{rules.length} Rule{rules.length !== 1 ? 's' : ''}</span>
                                <span className="text-gray-300">·</span>
                                <span className="text-xs text-gray-500">{activeCount} active</span>
                            </div>
                            <button
                                onClick={() => { setEditingRule(null); setIsBuilderOpen(true); }}
                                className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition"
                            >
                                <i className="fa-solid fa-plus"></i> Add Rule
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-gray-50/80 text-gray-400 text-xs uppercase tracking-wider">
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100">Rule</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100">Trigger</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Status</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Runs</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Last Fired</th>
                                        <th className="px-6 py-3.5 font-semibold border-b border-gray-100 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-50">
                                    {rules.map((rule) => {
                                        const tm = TRIGGER_META[rule.trigger] || TRIGGER_META.LEAD_CREATED;
                                        return (
                                            <tr key={rule._id} className="hover:bg-blue-50/30 transition-colors group">
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${rule.isActive ? 'bg-indigo-100' : 'bg-gray-100'}`}>
                                                            <i className={`fa-solid fa-bolt text-xs ${rule.isActive ? 'text-indigo-500' : 'text-gray-400'}`}></i>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-semibold text-gray-900">{rule.name}</div>
                                                            <div className="text-xs text-gray-400 mt-0.5">
                                                                {rule.conditions.length} condition{rule.conditions.length !== 1 ? 's' : ''} &nbsp;·&nbsp; {rule.actions.length} action{rule.actions.length !== 1 ? 's' : ''}
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
                                                    <button
                                                        onClick={() => toggleRuleStatus(rule._id, rule.isActive)}
                                                        title={rule.isActive ? 'Pause' : 'Activate'}
                                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${rule.isActive ? 'bg-indigo-500' : 'bg-gray-200'}`}
                                                    >
                                                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${rule.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                                                    </button>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-700">
                                                        <i className="fa-solid fa-bolt text-yellow-400 text-xs"></i>
                                                        {rule.executionCount || 0}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    {formatLastFired(rule.lastFiredAt)}
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <button
                                                            onClick={() => { setEditingRule(rule); setIsBuilderOpen(true); }}
                                                            title="Edit"
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition"
                                                        >
                                                            <i className="fa-solid fa-pen-to-square text-xs"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => duplicateRule(rule)}
                                                            title="Duplicate"
                                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition"
                                                        >
                                                            <i className="fa-solid fa-copy text-xs"></i>
                                                        </button>
                                                        <button
                                                            onClick={() => deleteRule(rule._id)}
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

                        {/* footer note */}
                        <div className="px-6 py-3 bg-gray-50/50 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-400">
                            <i className="fa-solid fa-shield-halved text-indigo-300"></i>
                            One automation fires per lead at a time — concurrent rules are queued safely.
                        </div>
                    </div>
                )}
            </div>

            <RuleBuilderModal
                isOpen={isBuilderOpen}
                onClose={() => { setIsBuilderOpen(false); setEditingRule(null); }}
                onSave={fetchRules}
                editingRule={editingRule}
            />
        </div>
    );
};

export default Automations;
