import React, { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import RuleBuilderModal from '../components/Automations/RuleBuilderModal';

const Automations = () => {
    const { user } = useAuth();
    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isBuilderOpen, setIsBuilderOpen] = useState(false);
    const [editingRule, setEditingRule] = useState(null);
    const { showNotification } = useNotification();

    if (!canManageTeam) return <Navigate to="/dashboard" replace />;

    const fetchRules = async () => {
        try {
            const res = await api.get('/automations');
            setRules(res.data);
        } catch (error) {
            console.error('Error fetching automations:', error);
            showNotification('error', 'Failed to load automations');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchRules();
    }, []);

    const toggleRuleStatus = async (id, currentStatus) => {
        try {
            await api.patch(`/automations/${id}/toggle`, { isActive: !currentStatus });
            setRules(rules.map(r => r._id === id ? { ...r, isActive: !currentStatus } : r));
            showNotification('success', `Automation ${!currentStatus ? 'Activated' : 'Paused'}`);
        } catch (error) {
            showNotification('error', 'Failed to toggle status');
        }
    };

    const deleteRule = async (id) => {
        if (!window.confirm('Are you sure you want to delete this automation?')) return;
        try {
            await api.delete(`/automations/${id}`);
            setRules(rules.filter(r => r._id !== id));
            showNotification('success', 'Automation deleted');
        } catch (error) {
            showNotification('error', 'Failed to delete automation');
        }
    };

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Visual Automation Engine 🤖</h1>
                    <p className="text-gray-500 mt-1 text-sm">Create zero-code workflows to put your CRM on autopilot.</p>
                </div>
                <button 
                    onClick={() => { setEditingRule(null); setIsBuilderOpen(true); }}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-medium transition shadow-sm flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i> New Automation
                </button>
            </div>

            {loading ? (
                <div className="flex justify-center p-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            ) : rules.length === 0 ? (
                <div className="text-center bg-white p-12 rounded-xl shadow-sm border border-gray-200">
                    <div className="text-gray-400 mb-4 text-5xl">
                        <i className="fa-solid fa-robot"></i>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mb-2">No Automations Found</h3>
                    <p className="text-gray-500 max-w-md mx-auto mb-6 text-sm">
                        You haven't created any workflow rules yet. Start by creating an automation to trigger emails, WhatsApps, or stage changes automatically.
                    </p>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 text-gray-500 text-xs uppercase cursor-default">
                                    <th className="px-6 py-4 font-semibold tracking-wide border-b">Rule Name</th>
                                    <th className="px-6 py-4 font-semibold tracking-wide border-b">Trigger</th>
                                    <th className="px-6 py-4 font-semibold tracking-wide border-b text-center">Status</th>
                                    <th className="px-6 py-4 font-semibold tracking-wide border-b text-center">Executions</th>
                                    <th className="px-6 py-4 font-semibold tracking-wide border-b text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {rules.map((rule) => (
                                    <tr key={rule._id} className="hover:bg-gray-50 transition">
                                        <td className="px-6 py-4">
                                            <div className="text-sm font-medium text-gray-900">{rule.name}</div>
                                            <div className="text-xs text-gray-500 mt-0.5">
                                                {rule.conditions.length} Conditions • {rule.actions.length} Actions
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700">
                                                <i className="fa-solid fa-bolt mr-1.5 opacity-70"></i>
                                                {rule.trigger.replace(/_/g, ' ')}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <button 
                                                onClick={() => toggleRuleStatus(rule._id, rule.isActive)}
                                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${rule.isActive ? 'bg-blue-600' : 'bg-gray-300'}`}
                                            >
                                                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${rule.isActive ? 'translate-x-5' : 'translate-x-1'}`} />
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 text-center text-sm text-gray-600 font-medium">
                                            {rule.executionCount}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            <div className="flex items-center justify-center gap-3">
                                                <button onClick={() => { setEditingRule(rule); setIsBuilderOpen(true); }} className="text-blue-500 hover:text-blue-700 transition p-1">
                                                    <i className="fa-solid fa-pen-to-square"></i>
                                                </button>
                                                <button onClick={() => deleteRule(rule._id)} className="text-gray-400 hover:text-red-600 transition p-1">
                                                    <i className="fa-solid fa-trash-can"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

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
