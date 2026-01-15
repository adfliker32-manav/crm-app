import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useConfirm } from '../context/ConfirmContext';

const Team = () => {
    const { showDanger } = useConfirm();
    const [team, setTeam] = useState([]);
    const [loading, setLoading] = useState(true);
    const [formData, setFormData] = useState({ name: '', email: '', password: '' });
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

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

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);

        try {
            await api.post('/auth/add-agent', formData);
            setSuccess("Agent added successfully! 🎉");
            setFormData({ name: '', email: '', password: '' });
            fetchTeam();
        } catch (err) {
            setError(err.response?.data?.message || "Failed to add agent");
        }
    };

    const handleDelete = async (agentId, agentName) => {
        const confirmed = await showDanger(
            `Are you sure you want to delete agent "${agentName}"? This action cannot be undone.`,
            "Delete Agent"
        );
        if (!confirmed) return;

        try {
            await api.delete(`/auth/remove-agent/${agentId}`);
            setSuccess(`Agent "${agentName}" deleted successfully`);
            fetchTeam();
        } catch (err) {
            console.error("Failed to delete agent", err);
            setError(err.response?.data?.message || "Failed to delete agent");
        }
    };

    if (loading) return <div className="p-10 text-center text-slate-500">Loading Team...</div>;

    return (
        <div className="space-y-8 animate-fade-in-up">
            <h1 className="text-2xl font-bold text-slate-800">Team Management</h1>

            {/* Add Agent Form */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-bold text-slate-700 mb-4">Add New Agent</h2>
                {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}
                {success && <div className="bg-green-100 text-green-700 p-3 rounded-lg mb-4 text-sm">{success}</div>}

                <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4">
                    <input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        placeholder="Agent Name"
                        required
                        className="flex-1 p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <input
                        type="email"
                        name="email"
                        value={formData.email}
                        onChange={handleChange}
                        placeholder="Agent Email"
                        required
                        className="flex-1 p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <input
                        type="text"
                        name="password"
                        value={formData.password}
                        onChange={handleChange}
                        placeholder="Password"
                        required
                        className="flex-1 p-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                    <button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-bold shadow-md transition whitespace-nowrap"
                    >
                        <i className="fa-solid fa-user-plus mr-2"></i> Add Agent
                    </button>
                </form>
            </div>

            {/* Team List */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold tracking-wider">
                        <tr>
                            <th className="px-6 py-4">Name</th>
                            <th className="px-6 py-4">Email</th>
                            <th className="px-6 py-4">Role</th>
                            <th className="px-6 py-4">Created Date</th>
                            <th className="px-6 py-4">Status</th>
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
                            team.map(agent => (
                                <tr key={agent._id} className="hover:bg-slate-50 transition">
                                    <td className="px-6 py-4 font-bold text-slate-700">{agent.name}</td>
                                    <td className="px-6 py-4 text-slate-600">{agent.email}</td>
                                    <td className="px-6 py-4">
                                        <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-bold uppercase">
                                            {agent.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-500">
                                        {new Date(agent.createdAt).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-green-600 font-bold text-sm">Active</span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => handleDelete(agent._id, agent.name)}
                                            className="text-slate-400 hover:text-red-600 transition p-2 rounded-full hover:bg-red-50"
                                            title="Delete Agent"
                                        >
                                            <i className="fa-solid fa-trash-can"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default Team;
