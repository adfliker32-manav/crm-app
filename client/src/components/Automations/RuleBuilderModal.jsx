import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const RuleBuilderModal = ({ isOpen, onClose, onSave, editingRule = null }) => {
    const { showNotification } = useNotification();
    const [loading, setLoading] = useState(false);
    
    // CRM Context Data for Dropdowns
    const [stages, setStages] = useState([]);
    const [users, setUsers] = useState([]);
    const [whatsappTemplates, setWhatsappTemplates] = useState([]);

    const defaultRule = {
        name: '',
        trigger: 'LEAD_CREATED',
        delayHours: 0,
        conditions: [],
        actions: [{ type: 'SEND_WHATSAPP', templateId: '' }]
    };

    const [rule, setRule] = useState(defaultRule);

    useEffect(() => {
        if (isOpen) {
            fetchContextData();
            if (editingRule) {
                setRule({
                    ...editingRule,
                    delayHours: (editingRule.delayMinutes || 0) / 60
                });
            } else {
                setRule(defaultRule);
            }
        }
    }, [isOpen, editingRule]);

    const fetchContextData = async () => {
        try {
            const [stageRes, userRes, waRes] = await Promise.all([
                api.get('/stages'),
                api.get('/team'),
                api.get('/whatsapp/templates')
            ]);
            setStages(stageRes.data);
            setUsers(userRes.data);
            if (waRes.data?.data) {
                setWhatsappTemplates(waRes.data.data.filter(t => t.status === 'APPROVED'));
            }
        } catch (error) {
            console.error('Failed to load context data', error);
        }
    };

    const handleSave = async () => {
        if (!rule.name) return showNotification('error', 'Rule name is required');
        if (rule.actions.length === 0) return showNotification('error', 'At least one action is required');
        
        // Validate actions
        for (const action of rule.actions) {
            if (action.type === 'SEND_WHATSAPP' && !action.templateId) return showNotification('error', 'Select a WhatsApp template');
            if (action.type === 'SEND_EMAIL' && (!action.subject || !action.body)) return showNotification('error', 'Email subject & body required');
            if (action.type === 'CHANGE_STAGE' && !action.stageName) return showNotification('error', 'Select a destination stage');
            if (action.type === 'ASSIGN_USER' && !action.userId) return showNotification('error', 'Select a user to assign');
        }

        setLoading(true);
        try {
            const payload = {
                ...rule,
                delayMinutes: Math.round(rule.delayHours * 60)
            };
            
            if (editingRule) {
                await api.put(`/automations/${editingRule._id}`, payload);
            } else {
                await api.post('/automations', payload);
            }
            showNotification('success', 'Automation Rule Saved!');
            onSave();
            onClose();
        } catch (error) {
            showNotification('error', error.response?.data?.message || 'Failed to save rule');
        } finally {
            setLoading(false);
        }
    };

    const addCondition = () => {
        setRule({ ...rule, conditions: [...rule.conditions, { field: 'source', operator: 'equals', value: '' }] });
    };

    const updateCondition = (index, key, val) => {
        const newConditions = [...rule.conditions];
        newConditions[index][key] = val;
        setRule({ ...rule, conditions: newConditions });
    };

    const removeCondition = (index) => {
        const newConditions = [...rule.conditions];
        newConditions.splice(index, 1);
        setRule({ ...rule, conditions: newConditions });
    };

    const updateAction = (index, key, val) => {
        const newActions = [...rule.actions];
        newActions[index][key] = val;
        // Reset sub-fields if type changes
        if (key === 'type') {
            newActions[index] = { type: val };
        }
        setRule({ ...rule, actions: newActions });
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-slate-200">
                
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h2 className="text-xl font-bold text-slate-800">
                        {editingRule ? 'Edit Automation Rule' : 'Build Automation Rule'} ⚡
                    </h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition">
                        <i className="fa-solid fa-xmark text-xl"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-8 bg-slate-50/50">
                    
                    {/* Basic Info */}
                    <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                        <label className="block text-sm font-semibold text-slate-700 mb-2">Rule Name</label>
                        <input 
                            type="text" 
                            value={rule.name}
                            onChange={(e) => setRule({...rule, name: e.target.value})}
                            className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                            placeholder="e.g. Welcome new Facebook leads..."
                        />
                    </div>

                    {/* Trigger Block */}
                    <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm relative">
                        <div className="absolute -left-3 -top-3 w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold border-4 border-white shadow-sm">1</div>
                        <h3 className="text-sm font-bold text-blue-900 mb-3 uppercase tracking-wide">When this happens... (Trigger)</h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-blue-700 mb-1">Event</label>
                                <select 
                                    className="w-full px-4 py-2 border border-blue-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
                                    value={rule.trigger}
                                    onChange={(e) => setRule({...rule, trigger: e.target.value})}
                                >
                                    <option value="LEAD_CREATED">Lead is Created</option>
                                    <option value="STAGE_CHANGED">Lead Stage Changes</option>
                                    <option value="TIME_IN_STAGE">Lead stays in Stage for Time</option>
                                </select>
                            </div>
                            
                            {rule.trigger === 'TIME_IN_STAGE' && (
                                <div>
                                    <label className="block text-xs text-blue-700 mb-1">Delay (Hours)</label>
                                    <input 
                                        type="number" 
                                        min="1"
                                        className="w-full px-4 py-2 border border-blue-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500"
                                        value={rule.delayHours}
                                        onChange={(e) => setRule({...rule, delayHours: Number(e.target.value)})}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Conditions Block */}
                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm relative">
                        <div className="absolute -left-3 -top-3 w-8 h-8 bg-slate-500 text-white rounded-full flex items-center justify-center font-bold border-4 border-white shadow-sm">2</div>
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">But only if... (Conditions)</h3>
                            <button onClick={addCondition} className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1.5 rounded-md font-medium transition">
                                + Add Condition
                            </button>
                        </div>
                        
                        {rule.conditions.length === 0 ? (
                            <p className="text-sm text-slate-400 italic">Rules fire for ALL leads by default. Add conditions to filter.</p>
                        ) : (
                            <div className="space-y-3">
                                {rule.conditions.map((cond, idx) => (
                                    <div key={idx} className="flex flex-col md:flex-row gap-3 items-center bg-white p-3 rounded-lg border border-slate-200">
                                        <select 
                                            className="w-full md:w-1/3 px-3 py-2 border border-slate-200 rounded-md text-sm"
                                            value={cond.field}
                                            onChange={(e) => updateCondition(idx, 'field', e.target.value)}
                                        >
                                            <option value="source">Lead Source</option>
                                            <option value="status">Lead Stage</option>
                                            <option value="dealValue">Deal Value</option>
                                            {/* Custom mapping support */}
                                            <option value="customData.Product">Custom: Product</option> 
                                        </select>

                                        <select 
                                            className="w-full md:w-1/3 px-3 py-2 border border-slate-200 rounded-md text-sm"
                                            value={cond.operator}
                                            onChange={(e) => updateCondition(idx, 'operator', e.target.value)}
                                        >
                                            <option value="equals">Equals</option>
                                            <option value="not_equals">Does Not Equal</option>
                                            <option value="contains">Contains</option>
                                            <option value="greater_than">Greater Than</option>
                                        </select>

                                        <input 
                                            type="text" 
                                            className="w-full md:w-1/3 px-3 py-2 border border-slate-200 rounded-md text-sm"
                                            placeholder="Value..."
                                            value={cond.value}
                                            onChange={(e) => updateCondition(idx, 'value', e.target.value)}
                                        />

                                        <button onClick={() => removeCondition(idx)} className="text-red-400 hover:text-red-600 transition">
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Actions Block */}
                    <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-100 shadow-sm relative">
                        <div className="absolute -left-3 -top-3 w-8 h-8 bg-emerald-500 text-white rounded-full flex items-center justify-center font-bold border-4 border-white shadow-sm">3</div>
                        <h3 className="text-sm font-bold text-emerald-900 mb-3 uppercase tracking-wide">Then do this... (Action)</h3>
                        
                        <div className="space-y-4">
                            {rule.actions.map((action, idx) => (
                                <div key={idx} className="bg-white border border-emerald-100 p-4 rounded-lg shadow-sm">
                                    <div className="mb-4">
                                        <label className="block text-xs font-semibold text-emerald-800 mb-1">Action Type</label>
                                        <select 
                                            className="w-full px-4 py-2 border border-emerald-200 rounded-lg bg-emerald-50 focus:ring-2 focus:ring-emerald-500 font-medium text-emerald-900"
                                            value={action.type}
                                            onChange={(e) => updateAction(idx, 'type', e.target.value)}
                                        >
                                            <option value="SEND_WHATSAPP">Send WhatsApp Template</option>
                                            <option value="SEND_EMAIL">Send Email</option>
                                            <option value="CHANGE_STAGE">Move to different Stage</option>
                                            <option value="ASSIGN_USER">Assign to Teammate</option>
                                        </select>
                                    </div>

                                    {/* Dynamic Fields based on Action Type */}
                                    <div className="bg-slate-50 p-4 border border-slate-100 rounded-lg">
                                        {action.type === 'SEND_WHATSAPP' && (
                                            <div>
                                                <label className="block text-xs text-slate-600 mb-1">WhatsApp Template</label>
                                                <select 
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                                                    value={action.templateId || ''}
                                                    onChange={(e) => updateAction(idx, 'templateId', e.target.value)}
                                                >
                                                    <option value="">-- Select Approved Template --</option>
                                                    {whatsappTemplates.map(t => (
                                                        <option key={t.id} value={t.name}>{t.name} (Meta ID: {t.id})</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {action.type === 'SEND_EMAIL' && (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs text-slate-600 mb-1">Subject</label>
                                                    <input 
                                                        type="text" 
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-md"
                                                        value={action.subject || ''}
                                                        onChange={(e) => updateAction(idx, 'subject', e.target.value)}
                                                        placeholder="Hello!"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs text-slate-600 mb-1">Body Text</label>
                                                    <textarea 
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-md"
                                                        value={action.body || ''}
                                                        onChange={(e) => updateAction(idx, 'body', e.target.value)}
                                                        rows="3"
                                                        placeholder="Thanks for reaching out..."
                                                    ></textarea>
                                                </div>
                                            </div>
                                        )}

                                        {action.type === 'CHANGE_STAGE' && (
                                            <div>
                                                <label className="block text-xs text-slate-600 mb-1">Target Stage</label>
                                                <select 
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                                                    value={action.stageName || ''}
                                                    onChange={(e) => updateAction(idx, 'stageName', e.target.value)}
                                                >
                                                    <option value="">-- Select Stage --</option>
                                                    {stages.map(s => (
                                                        <option key={s._id} value={s.name}>{s.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {action.type === 'ASSIGN_USER' && (
                                            <div>
                                                <label className="block text-xs text-slate-600 mb-1">Assign to Agent</label>
                                                <select 
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-md"
                                                    value={action.userId || ''}
                                                    onChange={(e) => updateAction(idx, 'userId', e.target.value)}
                                                >
                                                    <option value="">-- Select User --</option>
                                                    {users.map(u => (
                                                        <option key={u._id} value={u._id}>{u.name} ({u.role})</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-200 bg-white flex justify-end gap-3 rounded-b-2xl">
                    <button 
                        onClick={onClose}
                        className="px-5 py-2 text-slate-600 hover:bg-slate-100 font-medium rounded-lg transition"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={loading}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition flex items-center gap-2"
                    >
                        {loading && <i className="fa-solid fa-spinner fa-spin"></i>}
                        Save Automation
                    </button>
                </div>

            </div>
        </div>
    );
};

export default RuleBuilderModal;
