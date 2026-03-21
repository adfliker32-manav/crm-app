import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const GoalTracker = ({ period }) => {
    const { user } = useAuth();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null); // agentId being edited
    const [form, setForm] = useState({ targetLeads: 0, targetWon: 0, targetRevenue: 0, targetTasks: 0 });
    const [saving, setSaving] = useState(false);

    const isManager = user?.role === 'manager' || user?.role === 'superadmin';

    // derive month from period (simplified: use current month)
    const month = new Date().toISOString().slice(0, 7);

    const fetchGoals = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/analytics/goals?month=${month}`);
            setData(res.data);
        } catch (err) {
            console.error('GoalTracker fetch error:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchGoals(); }, [month]);

    const openEdit = (agent) => {
        setEditing(agent.agentId);
        setForm({ ...agent.goals });
    };

    const saveGoal = async (agentId) => {
        setSaving(true);
        try {
            await api.post('/analytics/goals', { agentId, month, ...form });
            setEditing(null);
            await fetchGoals();
        } catch (err) {
            console.error('Save goal error:', err);
        } finally {
            setSaving(false);
        }
    };

    const pct = (actual, target) => target > 0 ? Math.min(100, ((actual / target) * 100)).toFixed(0) : 0;

    const ProgressBar = ({ value, target, color }) => {
        const p = pct(value, target);
        const colors = {
            blue: 'from-blue-500 to-cyan-400',
            green: 'from-green-500 to-emerald-400',
            violet: 'from-violet-500 to-purple-400',
            orange: 'from-orange-500 to-amber-400',
        };
        return (
            <div className="mt-1">
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                    <span>{value.toLocaleString()} / {target.toLocaleString()}</span>
                    <span className="font-bold">{p}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                        className={`h-2 rounded-full bg-gradient-to-r ${colors[color]} transition-all duration-700`}
                        style={{ width: `${p}%` }}
                    />
                </div>
            </div>
        );
    };

    if (loading) return <div className="text-center py-10 text-slate-400 text-sm">Loading goals...</div>;
    if (!data?.agents?.length) return (
        <div className="text-center py-10 text-slate-400 text-sm">
            <i className="fa-solid fa-bullseye text-4xl mb-3 block text-slate-300"></i>
            No agents found. Add agents under Team Management first.
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-bullseye text-orange-500"></i>
                        Monthly Goals — {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Track your team's progress towards their monthly targets.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.agents.map(agent => (
                    <div key={agent.agentId} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shadow">
                                    {agent.agentName?.charAt(0)?.toUpperCase()}
                                </div>
                                <div>
                                    <p className="font-bold text-slate-800 text-sm">{agent.agentName}</p>
                                    <p className="text-xs text-slate-400">{agent.agentEmail}</p>
                                </div>
                            </div>
                            {isManager && editing !== agent.agentId && (
                                <button onClick={() => openEdit(agent)} className="text-xs text-blue-600 hover:underline font-medium">
                                    <i className="fa-solid fa-pen-to-square mr-1"></i>Set Goals
                                </button>
                            )}
                        </div>

                        {editing === agent.agentId ? (
                            <div className="space-y-2">
                                {[
                                    { key: 'targetLeads', label: 'Lead Target', icon: 'fa-users' },
                                    { key: 'targetWon', label: 'Won Target', icon: 'fa-trophy' },
                                    { key: 'targetRevenue', label: 'Revenue Target (₹)', icon: 'fa-indian-rupee-sign' },
                                    { key: 'targetTasks', label: 'Tasks Target', icon: 'fa-list-check' },
                                ].map(({ key, label, icon }) => (
                                    <div key={key} className="flex items-center gap-2">
                                        <i className={`fa-solid ${icon} text-slate-400 w-4 text-center text-xs`}></i>
                                        <label className="text-xs text-slate-600 w-32">{label}</label>
                                        <input
                                            type="number" min="0"
                                            value={form[key]}
                                            onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
                                            className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        />
                                    </div>
                                ))}
                                <div className="flex gap-2 mt-3">
                                    <button onClick={() => saveGoal(agent.agentId)} disabled={saving}
                                        className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg transition">
                                        {saving ? 'Saving...' : 'Save Goals'}
                                    </button>
                                    <button onClick={() => setEditing(null)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50">
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div>
                                    <p className="text-xs font-semibold text-slate-600">Leads</p>
                                    <ProgressBar value={agent.actuals.leads} target={agent.goals.targetLeads} color="blue" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-600">Deals Won</p>
                                    <ProgressBar value={agent.actuals.won} target={agent.goals.targetWon} color="green" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-600">Revenue (₹)</p>
                                    <ProgressBar value={agent.actuals.revenue} target={agent.goals.targetRevenue} color="violet" />
                                </div>
                                <div>
                                    <p className="text-xs font-semibold text-slate-600">Tasks Completed</p>
                                    <ProgressBar value={agent.actuals.tasks} target={agent.goals.targetTasks} color="orange" />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default GoalTracker;
