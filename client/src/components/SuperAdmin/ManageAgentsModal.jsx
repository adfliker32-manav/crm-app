/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    return pw + '!';
};

const ManageAgentsModal = ({ isOpen, onClose, company, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [agentLimit, setAgentLimit] = useState(5);
    const [serverAgentLimit, setServerAgentLimit] = useState(5);

    // Inline create-agent form state
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newAgent, setNewAgent] = useState({ name: '', email: '', password: '' });

    useEffect(() => {
        if (isOpen && company) {
            fetchAgents();
            // Reset create form on open
            setShowCreate(false);
            setNewAgent({ name: '', email: '', password: '' });
        }
    }, [isOpen, company]);

    const fetchAgents = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/superadmin/companies/${company._id}/agents`);
            // Backend returns { success, agents, agentLimit, currentAgentsCount }.
            // The previous code did setAgents(res.data) which set the whole
            // envelope as the array — agents.length and .map were broken.
            setAgents(res.data?.agents || []);
            const limitFromServer = res.data?.agentLimit ?? company.agentLimit ?? 5;
            setAgentLimit(limitFromServer);
            setServerAgentLimit(limitFromServer);
        } catch (error) {
            console.error('Error fetching agents:', error);
            showError('Failed to load agents');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateAgentLimit = async () => {
        try {
            await api.put(`/superadmin/companies/${company._id}/agent-limit`, {
                agentLimit: parseInt(agentLimit)
            });
            setServerAgentLimit(parseInt(agentLimit));
            showSuccess('Agent limit updated');
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error updating agent limit:', error);
            showError(error.response?.data?.message || 'Failed to update agent limit');
        }
    };

    const handleCreateAgent = async (e) => {
        e?.preventDefault();
        if (!newAgent.name.trim() || !newAgent.email.trim() || !newAgent.password) {
            return showError('Name, email, and password are required.');
        }
        if (agents.length >= serverAgentLimit) {
            return showError(`Agent limit reached (${serverAgentLimit}). Increase the limit first.`);
        }
        setCreating(true);
        try {
            await api.post(`/superadmin/companies/${company._id}/agents`, newAgent);
            showSuccess(`Agent "${newAgent.name}" created.`);
            setNewAgent({ name: '', email: '', password: '' });
            setShowCreate(false);
            await fetchAgents();
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error creating agent:', error);
            showError(error.response?.data?.message || 'Failed to create agent.');
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteAgent = async (agent) => {
        const confirmed = await showDanger(
            `This will permanently delete "${agent.name}" and all their owned data. This cannot be undone.`,
            'Delete Agent?'
        );
        if (!confirmed) return;

        try {
            await api.delete(`/superadmin/agents/${agent._id}`);
            showSuccess('Agent deleted');
            fetchAgents();
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error deleting agent:', error);
            showError(error.response?.data?.message || 'Failed to delete agent');
        }
    };

    if (!isOpen || !company) return null;

    const limitDirty = parseInt(agentLimit) !== serverAgentLimit;
    const seatsRemaining = Math.max(0, serverAgentLimit - agents.length);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-200">
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Manage Agents</h3>
                            <p className="text-sm text-slate-500 mt-1">{company.companyName}</p>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition">
                            <i className="fa-solid fa-times text-xl"></i>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Agent Limit Setting */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                        <label className="block text-sm font-bold text-slate-700 mb-2">
                            Agent Seat Limit
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={agentLimit}
                                onChange={(e) => setAgentLimit(e.target.value)}
                                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                            />
                            <button
                                onClick={handleUpdateAgentLimit}
                                disabled={!limitDirty}
                                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <i className="fa-solid fa-save mr-2"></i>
                                Save Limit
                            </button>
                        </div>
                        <p className="text-xs text-slate-600 mt-2 font-medium">
                            <span className="font-bold">{agents.length}</span> of <span className="font-bold">{serverAgentLimit}</span> seats used
                            {seatsRemaining > 0 && <span className="text-emerald-600"> · {seatsRemaining} available</span>}
                            {seatsRemaining === 0 && <span className="text-red-600"> · seat limit reached</span>}
                        </p>
                    </div>

                    {/* Create Agent — collapsible form (was missing entirely) */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden">
                        {!showCreate ? (
                            <button
                                onClick={() => setShowCreate(true)}
                                disabled={seatsRemaining === 0}
                                className="w-full p-4 flex items-center justify-center gap-2 text-blue-600 hover:bg-blue-50 font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <i className="fa-solid fa-plus" />
                                Add New Agent
                            </button>
                        ) : (
                            <form onSubmit={handleCreateAgent} className="p-4 bg-blue-50/40 space-y-3">
                                <div className="flex justify-between items-center">
                                    <h4 className="font-black text-sm text-slate-800">New Agent</h4>
                                    <button type="button" onClick={() => setShowCreate(false)}
                                        className="text-slate-400 hover:text-slate-700">
                                        <i className="fa-solid fa-times" />
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <input type="text" placeholder="Agent Name *"
                                        value={newAgent.name}
                                        onChange={e => setNewAgent({ ...newAgent, name: e.target.value })}
                                        className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                                    <input type="email" placeholder="Email *"
                                        value={newAgent.email}
                                        onChange={e => setNewAgent({ ...newAgent, email: e.target.value })}
                                        className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" />
                                </div>
                                <div className="flex gap-2">
                                    <input type="text" placeholder="Password *"
                                        value={newAgent.password}
                                        onChange={e => setNewAgent({ ...newAgent, password: e.target.value })}
                                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm" />
                                    <button type="button"
                                        onClick={() => setNewAgent({ ...newAgent, password: generatePassword() })}
                                        className="px-3 bg-slate-200 hover:bg-slate-300 rounded-lg text-slate-700 text-sm font-bold transition"
                                        title="Generate password">
                                        <i className="fa-solid fa-wand-magic-sparkles" />
                                    </button>
                                </div>
                                <button type="submit" disabled={creating}
                                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition disabled:opacity-60 flex items-center justify-center gap-2">
                                    {creating ? <><i className="fa-solid fa-spinner fa-spin" />Creating...</> :
                                                <><i className="fa-solid fa-user-plus" />Create Agent</>}
                                </button>
                            </form>
                        )}
                    </div>

                    {/* Agents List */}
                    <div>
                        <h4 className="font-bold text-slate-700 mb-3">Agents ({agents.length})</h4>
                        {loading ? (
                            <div className="flex items-center justify-center h-32">
                                <i className="fa-solid fa-spinner fa-spin text-2xl text-slate-400"></i>
                            </div>
                        ) : agents.length > 0 ? (
                            <div className="space-y-2">
                                {agents.map((agent) => (
                                    <div
                                        key={agent._id}
                                        className="flex items-center justify-between p-4 bg-slate-50 rounded-lg hover:bg-slate-100 transition"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full flex items-center justify-center text-white font-bold">
                                                {agent.name?.charAt(0).toUpperCase() || 'A'}
                                            </div>
                                            <div>
                                                <p className="font-medium text-slate-800">{agent.name}</p>
                                                <p className="text-sm text-slate-500">{agent.email}</p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                                                {agent.role || 'Agent'}
                                            </span>
                                            <button
                                                onClick={() => handleDeleteAgent(agent)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                                                title="Delete Agent"
                                            >
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-center py-12 text-slate-400">
                                <i className="fa-regular fa-user text-5xl mb-3"></i>
                                <p>No agents yet. Use "Add New Agent" above to create one.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageAgentsModal;
