import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const AssignLeadDropdown = ({ leadId, currentAssignee, onAssign }) => {
    const { showSuccess, showError } = useNotification();
    const [agents, setAgents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [assigning, setAssigning] = useState(false);

    useEffect(() => {
        fetchAgents();
    }, []);

    const fetchAgents = async () => {
        try {
            const res = await api.get('/auth/my-team');
            setAgents(res.data);
        } catch (err) {
            console.error('Failed to fetch agents:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleAssign = async (agentId) => {
        if (assigning) return;

        setAssigning(true);
        try {
            await api.put(`/leads/${leadId}/assign`, {
                agentId: agentId || null
            });

            showSuccess(agentId ? 'Lead assigned successfully' : 'Lead unassigned');

            if (onAssign) {
                onAssign();
            }
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to assign lead');
        } finally {
            setAssigning(false);
        }
    };

    if (loading) {
        return <span className="text-xs text-slate-400">Loading...</span>;
    }

    return (
        <select
            value={currentAssignee || ''}
            onChange={(e) => handleAssign(e.target.value)}
            disabled={assigning}
            className="text-xs px-2 py-1 border border-slate-300 rounded focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 disabled:cursor-not-allowed"
        >
            <option value="">Unassigned</option>
            {agents.map(agent => (
                <option key={agent._id} value={agent._id}>
                    {agent.name}
                </option>
            ))}
        </select>
    );
};

export default AssignLeadDropdown;
