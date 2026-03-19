import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const WhatsAppBroadcasts = () => {
    const { showSuccess, showError } = useNotification();
    const [broadcasts, setBroadcasts] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [stages, setStages] = useState([]);
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showNewModal, setShowNewModal] = useState(false);
    
    // New Broadcast Form State
    const [newBroadcast, setNewBroadcast] = useState({
        name: '',
        templateId: '',
        targetAudience: { selectionType: 'ALL', tags: [], stages: [] },
        scheduledFor: ''
    });

    useEffect(() => {
        fetchBroadcasts();
        fetchTemplates();
        fetchStagesAndLeads();
    }, []);

    const fetchStagesAndLeads = async () => {
        try {
            const [stagesRes, leadsRes] = await Promise.all([
                api.get('/stages'),
                api.get('/leads')
            ]);
            setStages(stagesRes.data || []);
            setLeads(leadsRes.data.leads || leadsRes.data || []);
        } catch (error) {
            console.error("Failed to fetch stages or leads", error);
        }
    };

    const fetchBroadcasts = async () => {
        try {
            setLoading(true);
            const res = await api.get('/whatsapp/broadcasts');
            setBroadcasts(res.data.broadcasts || []);
        } catch (error) {
            const errDetails = error.response ? `${error.response.status}: ${error.response.data?.message || 'Server Error'}` : error.message;
            showError(`Failed to load broadcasts (${errDetails})`);
        } finally {
            setLoading(false);
        }
    };

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/whatsapp/templates');
            const data = res.data.templates || res.data;
            // Only show approved templates for broadcasting
            setTemplates(data.filter(t => t.status === 'APPROVED'));
        } catch (error) {
            console.error("Failed to fetch templates", error);
        }
    };

    const handleCreateBroadcast = async (e) => {
        e.preventDefault();
        try {
            if (!newBroadcast.name || !newBroadcast.templateId) {
                showError('Name and Template are required');
                return;
            }
            
            await api.post('/whatsapp/broadcasts', newBroadcast);
            showSuccess('Broadcast created successfully');
            setShowNewModal(false);
            setNewBroadcast({ name: '', templateId: '', targetAudience: { selectionType: 'ALL', tags: [], stages: [] }, scheduledFor: '' });
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to create broadcast');
        }
    };

    const handleStartBroadcast = async (id) => {
        if (!window.confirm('Are you sure you want to start this broadcast? Messages will be sent immediately.')) return;
        try {
            await api.post(`/whatsapp/broadcasts/${id}/start`);
            showSuccess('Broadcast started!');
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to start broadcast');
        }
    };

    const handleCancelBroadcast = async (id) => {
        if (!window.confirm('Are you sure you want to cancel this broadcast?')) return;
        try {
            await api.post(`/whatsapp/broadcasts/${id}/cancel`);
            showSuccess('Broadcast cancelled');
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to cancel broadcast');
        }
    };

    const handleDeleteBroadcast = async (id) => {
        if (!window.confirm('Are you sure you want to delete this broadcast?')) return;
        try {
            await api.delete(`/whatsapp/broadcasts/${id}`);
            showSuccess('Broadcast deleted');
            fetchBroadcasts();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to delete broadcast');
        }
    };

    const getStatusBadge = (status) => {
        const config = {
            DRAFT: 'bg-slate-100 text-slate-700',
            SCHEDULED: 'bg-indigo-50 text-indigo-700',
            PROCESSING: 'bg-blue-50 text-blue-700 font-bold animate-pulse',
            COMPLETED: 'bg-emerald-50 text-emerald-700',
            FAILED: 'bg-red-50 text-red-700',
            CANCELLED: 'bg-amber-50 text-amber-700'
        };
        return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${config[status] || config.DRAFT}`}>{status}</span>;
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="w-10 h-10 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Broadcast Campaigns</h2>
                    <p className="text-slate-500 text-sm mt-1">Send bulk messages to your leads using approved templates.</p>
                </div>
                <button onClick={() => setShowNewModal(true)} className="px-5 py-2.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl text-sm font-semibold transition shadow-sm flex items-center gap-2">
                    <i className="fa-solid fa-bullhorn"></i> New Broadcast
                </button>
            </div>

            {/* Broadcasts List */}
            {broadcasts.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
                    <div className="w-16 h-16 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl">
                        <i className="fa-solid fa-paper-plane"></i>
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">No broadcasts yet</h3>
                    <p className="text-slate-500 text-sm mb-6 max-w-md mx-auto">Create a broadcast campaign to send announcements, offers, or updates to multiple leads at once.</p>
                    <button onClick={() => setShowNewModal(true)} className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition">
                        Create First Broadcast
                    </button>
                </div>
            ) : (
                <div className="grid gap-4">
                    {broadcasts.map(broadcast => (
                        <div key={broadcast._id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition">
                            <div className="flex items-start justify-between">
                                <div className="flex items-start gap-4">
                                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl shrink-0 ${
                                        broadcast.status === 'COMPLETED' ? 'bg-emerald-50 text-emerald-600' :
                                        broadcast.status === 'PROCESSING' ? 'bg-blue-50 text-blue-600' :
                                        'bg-slate-50 text-slate-500'
                                    }`}>
                                        <i className="fa-solid fa-bullhorn"></i>
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                                            {broadcast.name} {getStatusBadge(broadcast.status)}
                                        </h3>
                                        <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-500">
                                            <span className="flex items-center gap-1.5"><i className="fa-regular fa-file-lines text-slate-400"></i> {broadcast.templateId?.name || 'Unknown Template'}</span>
                                            <span className="flex items-center gap-1.5"><i className="fa-solid fa-users text-slate-400"></i> Audience: {broadcast.targetAudience.selectionType}</span>
                                            <span className="flex items-center gap-1.5"><i className="fa-regular fa-calendar text-slate-400"></i> {new Date(broadcast.createdAt).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {broadcast.status === 'DRAFT' && (
                                        <button onClick={() => handleStartBroadcast(broadcast._id)} className="px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition">
                                            <i className="fa-solid fa-play mr-2"></i> Start Now
                                        </button>
                                    )}
                                    {['SCHEDULED', 'PROCESSING'].includes(broadcast.status) && (
                                        <button onClick={() => handleCancelBroadcast(broadcast._id)} className="px-4 py-2 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-lg text-sm font-medium transition">
                                            <i className="fa-solid fa-stop mr-2"></i> Cancel
                                        </button>
                                    )}
                                    <button onClick={() => handleDeleteBroadcast(broadcast._id)} className="w-9 h-9 flex items-center justify-center text-slate-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition" title="Delete">
                                        <i className="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                            </div>

                            {/* Stats Bar */}
                            {(broadcast.status === 'COMPLETED' || broadcast.status === 'PROCESSING') && (
                                <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-4 gap-4">
                                    <div className="bg-slate-50 rounded-lg p-3">
                                        <div className="text-[11px] font-bold text-slate-500 uppercase mb-1">Total Targets</div>
                                        <div className="text-xl font-bold text-slate-800">{broadcast.stats?.totalTargets || 0}</div>
                                    </div>
                                    <div className="bg-blue-50 rounded-lg p-3">
                                        <div className="text-[11px] font-bold text-blue-600 uppercase mb-1">Sent</div>
                                        <div className="text-xl font-bold text-blue-700">{broadcast.stats?.sent || 0}</div>
                                    </div>
                                    <div className="bg-red-50 rounded-lg p-3">
                                        <div className="text-[11px] font-bold text-red-600 uppercase mb-1">Failed</div>
                                        <div className="text-xl font-bold text-red-700">{broadcast.stats?.failed || 0}</div>
                                    </div>
                                </div>
                            )}
                            
                            {broadcast.errorMessage && (
                                <div className="mt-3 text-sm text-red-600 bg-red-50 p-3 rounded-lg flex items-start gap-2">
                                    <i className="fa-solid fa-triangle-exclamation mt-0.5"></i> {broadcast.errorMessage}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Create Broadcast Modal */}
            {showNewModal && (
                <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-lg font-bold text-slate-800">New Broadcast</h3>
                            <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-600"><i className="fa-solid fa-times text-xl"></i></button>
                        </div>
                        <div className="p-6">
                            <form onSubmit={handleCreateBroadcast} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Campaign Name</label>
                                    <input type="text" value={newBroadcast.name} onChange={e => setNewBroadcast({...newBroadcast, name: e.target.value})} placeholder="e.g. Diwali Offer Blast" className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm" required />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp Template</label>
                                    <select value={newBroadcast.templateId} onChange={e => setNewBroadcast({...newBroadcast, templateId: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm bg-white" required>
                                        <option value="">Select an approved template</option>
                                        {templates.map(t => (
                                            <option key={t._id} value={t._id}>{t.name} ({t.category})</option>
                                        ))}
                                    </select>
                                    {templates.length === 0 && <p className="text-xs text-red-500 mt-1">No approved templates found. Create one first.</p>}
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Target Audience</label>
                                    <select value={newBroadcast.targetAudience.selectionType} onChange={e => setNewBroadcast({...newBroadcast, targetAudience: { selectionType: e.target.value, stages: [], tags: [] }})} className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 outline-none text-sm bg-white">
                                        <option value="ALL">All Leads ({leads.filter(l => l.phone).length} with phone)</option>
                                        <option value="STAGES">Specific Stages</option>
                                    </select>
                                </div>
                                {newBroadcast.targetAudience.selectionType === 'STAGES' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                                        <label className="block text-[11px] font-bold text-slate-500 uppercase mb-2">Select Target Stage</label>
                                        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                                            {stages.map(stage => {
                                                const leadsInStage = leads.filter(l => l.status === stage.name && l.phone).length;
                                                const isSelected = newBroadcast.targetAudience.stages.includes(stage.name);
                                                return (
                                                    <label key={stage._id} className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition ${isSelected ? 'border-[#00a884] bg-[#00a884]/5' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                                                        <div className="flex items-center gap-3">
                                                            <input 
                                                                type="checkbox" 
                                                                checked={isSelected}
                                                                onChange={(e) => {
                                                                    const currentStages = [...newBroadcast.targetAudience.stages];
                                                                    if (e.target.checked) currentStages.push(stage.name);
                                                                    else currentStages.splice(currentStages.indexOf(stage.name), 1);
                                                                    setNewBroadcast({
                                                                        ...newBroadcast, 
                                                                        targetAudience: { ...newBroadcast.targetAudience, stages: currentStages }
                                                                    });
                                                                }}
                                                                className="w-4 h-4 text-[#00a884] rounded border-slate-300 focus:ring-[#00a884]"
                                                            />
                                                            <span className="text-sm font-medium text-slate-700">{stage.name}</span>
                                                        </div>
                                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${leadsInStage > 0 ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                                                            {leadsInStage} {leadsInStage === 1 ? 'lead' : 'leads'}
                                                        </span>
                                                    </label>
                                                );
                                            })}
                                            {stages.length === 0 && <p className="text-xs text-amber-500">No stages found. Create stages in your Lead Pipeline first.</p>}
                                        </div>
                                    </div>
                                )}
                                <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100 mt-6">
                                    <button type="button" onClick={() => setShowNewModal(false)} className="px-5 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-sm font-medium transition">Cancel</button>
                                    <button type="submit" disabled={templates.length === 0} className="px-5 py-2.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-xl text-sm font-medium transition shadow-sm disabled:opacity-50">Create Campaign</button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WhatsAppBroadcasts;
