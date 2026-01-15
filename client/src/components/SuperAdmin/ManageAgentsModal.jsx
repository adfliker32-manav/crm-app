import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const ManageAgentsModal = ({ isOpen, onClose, company, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [agentLimit, setAgentLimit] = useState(5);

    useEffect(() => {
        if (isOpen && company) {
            fetchAgents();
            setAgentLimit(company.agentLimit || 5);
        }
    }, [isOpen, company]);

    const fetchAgents = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/superadmin/companies/${company._id}/agents`);
            setAgents(res.data);
        } catch (error) {
            console.error('Error fetching agents:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateAgentLimit = async () => {
        try {
            await api.put(`/superadmin/companies/${company._id}/agent-limit`, {
                agentLimit: parseInt(agentLimit)
            });
            showSuccess('Agent limit updated successfully');
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error updating agent limit:', error);
            showError(error.response?.data?.message || 'Failed to update agent limit');
        }
    };

    const handleDeleteAgent = async (agentId) => {
        const confirmed = await showDanger(
            'This will permanently delete the agent. This action cannot be undone.',
            'Delete Agent?'
        );

        if (!confirmed) return;

        try {
            await api.delete(`/superadmin/agents/${agentId}`);
            showSuccess('Agent deleted successfully');
            fetchAgents();
            if (onSuccess) onSuccess();
        } catch (error) {
            console.error('Error deleting agent:', error);
            showError(error.response?.data?.message || 'Failed to delete agent');
        }
    };

    if (!isOpen || !company) return null;

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
                    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                        <label className="block text-sm font-bold text-slate-700 mb-2">
                            Agent Limit
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={agentLimit}
                                onChange={(e) => setAgentLimit(e.target.value)}
                                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
                            />
                            <button
                                onClick={handleUpdateAgentLimit}
                                className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition shadow-md"
                            >
                                <i className="fa-solid fa-save mr-2"></i>
                                Update Limit
                            </button>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">
                            Current: {agents.length} / {agentLimit} agents
                        </p>
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
                                            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-600 rounded-full flex items-center justify-center text-white font-bold">
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
                                                onClick={() => handleDeleteAgent(agent._id)}
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
                                <p>No agents found for this company</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageAgentsModal;
