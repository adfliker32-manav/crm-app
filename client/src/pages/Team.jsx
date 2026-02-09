import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useConfirm } from '../context/ConfirmContext';
import { useNotification } from '../context/NotificationContext';
import CreateAgentModal from '../components/Team/CreateAgentModal';
import EditAgentModal from '../components/Team/EditAgentModal';

const Team = () => {
    const { showDanger } = useConfirm();
    const { showSuccess, showError } = useNotification();
    const [team, setTeam] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedAgent, setSelectedAgent] = useState(null);

    const fetchTeam = async () => {
        try {
            const res = await api.get('/auth/my-team');
            setTeam(res.data);
        } catch (err) {
            console.error("Failed to load team", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTeam();
    }, []);

    const handleDelete = async (agentId, agentName) => {
        const confirmed = await showDanger(
            `Are you sure you want to delete agent "${agentName}"? This action cannot be undone.`,
            "Delete Agent"
        );
        if (!confirmed) return;

        try {
            await api.delete(`/auth/remove-agent/${agentId}`);
            showSuccess(`Agent "${agentName}" deleted successfully`);
            fetchTeam();
        } catch (err) {
            console.error("Failed to delete agent", err);
            showError(err.response?.data?.message || "Failed to delete agent");
        }
    };

    if (loading) return <div className="p-10 text-center text-slate-500">Loading Team...</div>;

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Header with Add Button */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Team Management</h1>
                    <p className="text-sm text-slate-500 mt-1">Manage your team members and their permissions</p>
                </div>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-bold shadow-md transition flex items-center gap-2"
                >
                    <i className="fa-solid fa-user-plus"></i>
                    Add Agent
                </button>
            </div>

            {/* Team List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold tracking-wider">
                        <tr>
                            <th className="px-6 py-4">Name</th>
                            <th className="px-6 py-4">Email</th>
                            <th className="px-6 py-4">Role</th>
                            <th className="px-6 py-4">Permissions</th>
                            <th className="px-6 py-4">Created</th>
                            <th className="px-6 py-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {team.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="px-6 py-8 text-center text-slate-400">
                                    No agents found. Add one above!
                                </td>
                            </tr>
                        ) : (
                            team.map(agent => {
                                const permissionCount = agent.permissions
                                    ? Object.values(agent.permissions).filter(Boolean).length
                                    : 0;

                                return (
                                    <tr key={agent._id} className="hover:bg-slate-50 transition">
                                        <td className="px-6 py-4 font-bold text-slate-700">{agent.name}</td>
                                        <td className="px-6 py-4 text-slate-600">{agent.email}</td>
                                        <td className="px-6 py-4">
                                            <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold uppercase">
                                                {agent.role}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="text-sm text-slate-600">
                                                {permissionCount > 0 ? (
                                                    <>{permissionCount} permissions</>
                                                ) : (
                                                    <span className="text-slate-400">No permissions</span>
                                                )}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-slate-500 text-sm">
                                            {new Date(agent.createdAt).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 text-right space-x-2">
                                            <button
                                                onClick={() => {
                                                    setSelectedAgent(agent);
                                                    setIsEditModalOpen(true);
                                                }}
                                                className="text-slate-400 hover:text-blue-600 transition p-2 rounded-full hover:bg-blue-50"
                                                title="Edit Agent"
                                            >
                                                <i className="fa-solid fa-pen-to-square"></i>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(agent._id, agent.name)}
                                                className="text-slate-400 hover:text-red-600 transition p-2 rounded-full hover:bg-red-50"
                                                title="Delete Agent"
                                            >
                                                <i className="fa-solid fa-trash-can"></i>
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Create Agent Modal */}
            <CreateAgentModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                onSuccess={fetchTeam}
            />

            {/* Edit Agent Modal */}
            <EditAgentModal
                isOpen={isEditModalOpen}
                onClose={() => {
                    setIsEditModalOpen(false);
                    setSelectedAgent(null);
                }}
                onSuccess={fetchTeam}
                agent={selectedAgent}
            />
        </div>
    );
};

export default Team;
