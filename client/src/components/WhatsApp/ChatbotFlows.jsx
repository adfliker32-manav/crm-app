import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ChatbotFlows = ({ onEditFlow }) => {
    const { showSuccess, showError } = useNotification();
    const [flows, setFlows] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchFlows();
    }, []);

    const fetchFlows = async () => {
        try {
            const res = await api.get('/chatbot/flows');
            setFlows(res.data.flows || []);
        } catch (error) {
            console.error('Error fetching flows:', error);
            showError('Failed to load chatbot flows');
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (flowId) => {
        try {
            const res = await api.post(`/chatbot/flows/${flowId}/toggle`);
            setFlows(prev => prev.map(f => f._id === flowId ? res.data.flow : f));
            showSuccess('Flow status updated');
        } catch (error) {
            showError('Failed to update flow status');
        }
    };

    const handleDelete = async (flowId) => {
        if (!window.confirm('Are you sure you want to delete this flow?')) return;

        try {
            await api.delete(`/chatbot/flows/${flowId}`);
            setFlows(prev => prev.filter(f => f._id !== flowId));
            showSuccess('Flow deleted successfully');
        } catch (error) {
            showError('Failed to delete flow');
        }
    };

    const handleDuplicate = async (flowId) => {
        try {
            const res = await api.post(`/chatbot/flows/${flowId}/duplicate`);
            setFlows(prev => [res.data.flow, ...prev]);
            showSuccess('Flow duplicated successfully');
        } catch (error) {
            showError('Failed to duplicate flow');
        }
    };

    if (loading) {
        return (
            <div className="p-8 text-center">
                <i className="fa-solid fa-spinner fa-spin text-3xl text-green-500 mb-3"></i>
                <p className="text-slate-500">Loading flows...</p>
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Chatbot Flows</h2>
                    <p className="text-sm text-slate-500 mt-1">Create automated conversation flows</p>
                </div>
                <button
                    onClick={() => onEditFlow('new')}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i>
                    Create Flow
                </button>
            </div>

            {/* Flows Grid */}
            {flows.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i className="fa-solid fa-robot text-3xl text-green-600"></i>
                    </div>
                    <h3 className="text-xl font-semibold text-slate-800 mb-2">No Chatbot Flows Yet</h3>
                    <p className="text-slate-500 mb-4">Create your first automated conversation flow</p>
                    <button
                        onClick={() => onEditFlow('new')}
                        className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition"
                    >
                        Create Your First Flow
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {flows.map(flow => (
                        <div key={flow._id} className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-lg transition">
                            {/* Header */}
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-slate-800 mb-1">{flow.name}</h3>
                                    <p className="text-sm text-slate-500 line-clamp-2">{flow.description || 'No description'}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleToggle(flow._id)}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${flow.isActive ? 'bg-green-600' : 'bg-slate-300'
                                            }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${flow.isActive ? 'translate-x-6' : 'translate-x-1'
                                                }`}
                                        />
                                    </button>
                                </div>
                            </div>

                            {/* Trigger Info */}
                            <div className="mb-4">
                                <div className="flex items-center gap-2 text-sm">
                                    <i className="fa-solid fa-bolt text-amber-500"></i>
                                    <span className="text-slate-600">
                                        {flow.triggerType === 'keyword' && `Keywords: ${flow.triggerKeywords.join(', ')}`}
                                        {flow.triggerType === 'first_message' && 'First message from contact'}
                                        {flow.triggerType === 'stage_change' && `Stage: ${flow.triggerStage}`}
                                        {flow.triggerType === 'manual' && 'Manual trigger only'}
                                    </span>
                                </div>
                            </div>

                            {/* Stats */}
                            <div className="grid grid-cols-3 gap-2 mb-4 p-3 bg-slate-50 rounded-lg">
                                <div className="text-center">
                                    <p className="text-xs text-slate-500">Triggered</p>
                                    <p className="text-lg font-bold text-slate-800">{flow.analytics?.triggered || 0}</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-xs text-slate-500">Completed</p>
                                    <p className="text-lg font-bold text-green-600">{flow.analytics?.completed || 0}</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-xs text-slate-500">Rate</p>
                                    <p className="text-lg font-bold text-blue-600">
                                        {flow.analytics?.triggered > 0
                                            ? Math.round((flow.analytics.completed / flow.analytics.triggered) * 100)
                                            : 0}%
                                    </p>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => onEditFlow(flow._id)}
                                    className="flex-1 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg text-sm font-medium transition"
                                >
                                    <i className="fa-solid fa-edit mr-1"></i>
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDuplicate(flow._id)}
                                    className="px-3 py-2 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-sm transition"
                                    title="Duplicate"
                                >
                                    <i className="fa-solid fa-copy"></i>
                                </button>
                                <button
                                    onClick={() => handleDelete(flow._id)}
                                    className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-sm transition"
                                    title="Delete"
                                >
                                    <i className="fa-solid fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ChatbotFlows;
