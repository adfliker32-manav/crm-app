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
                setRule({ ...editingRule, delayHours: (editingRule.delayMinutes || 0) / 60 });
            } else {
                setRule(defaultRule);
            }
        }
    }, [isOpen, editingRule]);

    const fetchContextData = async () => {
        try {
            // Fetch stages (critical)
            try {
                const stageRes = await api.get('/stages');
                setStages(stageRes.data || []);
            } catch (err) { console.error('Failed to load stages', err); }

            // Fetch team users
            try {
                const userRes = await api.get('/team');
                setUsers(userRes.data || []);
            } catch (err) { console.error('Failed to load users', err); }

            // Fetch WA templates
            try {
                const waRes = await api.get('/whatsapp/templates');
                if (waRes.data?.templates) {
                    setWhatsappTemplates(waRes.data.templates.filter(t => t.status === 'APPROVED'));
                } else if (waRes.data?.data) {
                    setWhatsappTemplates(waRes.data.data.filter(t => t.status === 'APPROVED'));
                }
            } catch (err) { console.error('Failed to load WA templates', err); }
            
        } catch (error) {
            console.error('Core failure in context data', error);
        }
    };

    const handleSave = async () => {
        if (!rule.name) return showNotification('error', 'Rule name is required');
        if (rule.actions.length === 0) return showNotification('error', 'At least one action is required');

        for (const action of rule.actions) {
            if (action.type === 'SEND_WHATSAPP' && !action.templateId) return showNotification('error', 'Select a WhatsApp template');
            if (action.type === 'SEND_EMAIL' && (!action.subject || !action.body)) return showNotification('error', 'Email subject & body required');
            if (action.type === 'CHANGE_STAGE' && !action.stageName) return showNotification('error', 'Select a destination stage');
            if (action.type === 'ASSIGN_USER' && !action.userId) return showNotification('error', 'Select a user to assign');
            if (action.type === 'WAIT_FOR_REPLY' && !(action.waitForReplyHours > 0)) return showNotification('error', 'Set reply wait time (hours)');
        }

        setLoading(true);
        try {
            const payload = { ...rule, delayMinutes: Math.round(rule.delayHours * 60) };
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

    const addCondition = () => setRule({ ...rule, conditions: [...rule.conditions, { field: 'source', operator: 'equals', value: '' }] });
    
    const updateCondition = (index, key, val) => {
        const c = [...rule.conditions]; 
        c[index] = { ...c[index], [key]: val }; 
        setRule({ ...rule, conditions: c });
    };
    
    const removeCondition = (index) => {
        const c = [...rule.conditions]; 
        c.splice(index, 1); 
        setRule({ ...rule, conditions: c });
    };

    const addAction = () => setRule({ ...rule, actions: [...rule.actions, { type: 'SEND_WHATSAPP', templateId: '' }] });
    
    const removeAction = (index) => {
        const a = [...rule.actions]; 
        a.splice(index, 1); 
        setRule({ ...rule, actions: a });
    };
    
    const updateAction = (index, key, val) => {
        const a = [...rule.actions];
        if (key === 'type') {
            // Reset action when type changes, initialize nested objects if WAIT_FOR_REPLY
            const newAction = { type: val };
            if (val === 'WAIT_FOR_REPLY') {
                newAction.waitForReplyHours = 24;
                newAction.ifRepliedAction = { changeStage: '', sendTemplateId: '' };
                newAction.ifNoReplyAction = { changeStage: '', sendTemplateId: '' };
            }
            a[index] = newAction;
        } else {
            a[index] = { ...a[index], [key]: val };
        }
        setRule({ ...rule, actions: a });
    };
    
    const updateNestedAction = (index, section, key, val) => {
        const a = [...rule.actions];
        const sectionData = { ...(a[index][section] || {}) };
        sectionData[key] = val;
        a[index] = { ...a[index], [section]: sectionData };
        setRule({ ...rule, actions: a });
    };

    if (!isOpen) return null;

    // Badge colors for each action type
    const actionMeta = {
        SEND_WHATSAPP: { label: 'Send WhatsApp', color: 'bg-green-100 text-green-700', icon: 'fa-brands fa-whatsapp' },
        SEND_EMAIL: { label: 'Send Email', color: 'bg-blue-100 text-blue-700', icon: 'fa-solid fa-envelope' },
        CHANGE_STAGE: { label: 'Change Stage', color: 'bg-purple-100 text-purple-700', icon: 'fa-solid fa-right-left' },
        ASSIGN_USER: { label: 'Assign to Agent', color: 'bg-orange-100 text-orange-700', icon: 'fa-solid fa-user-tag' },
        WAIT_FOR_REPLY: { label: 'Wait for Reply', color: 'bg-amber-100 text-amber-800', icon: 'fa-solid fa-hourglass-half' },
    };

    return (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">

                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-blue-50">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center">
                            <i className="fa-solid fa-robot text-white text-sm"></i>
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">
                                {editingRule ? 'Edit Automation Rule' : 'Build Automation Rule'}
                            </h2>
                            <p className="text-xs text-slate-400">Triggers → Conditions → Actions</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6 bg-slate-50/50">

                    {/* Rule Name */}
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Rule Name</label>
                        <input
                            type="text"
                            value={rule.name}
                            onChange={(e) => setRule({ ...rule, name: e.target.value })}
                            className="w-full px-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition text-sm"
                            placeholder="e.g. Follow up Negotiation leads after 2 days..."
                        />
                    </div>

                    {/* Trigger Block */}
                    <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 shadow-sm relative">
                        <div className="absolute -left-3 -top-3 w-7 h-7 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold border-4 border-white shadow">1</div>
                        <h3 className="text-xs font-bold text-blue-800 mb-3 uppercase tracking-widest flex items-center gap-2">
                            <i className="fa-solid fa-bolt"></i> When this happens...
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-blue-600 mb-1">Trigger Event</label>
                                <select
                                    className="w-full px-4 py-2 border border-blue-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 text-sm"
                                    value={rule.trigger}
                                    onChange={(e) => setRule({ ...rule, trigger: e.target.value })}
                                >
                                    <option value="LEAD_CREATED">Lead is Created</option>
                                    <option value="STAGE_CHANGED">Lead Stage Changes</option>
                                    <option value="TIME_IN_STAGE">Lead stays in Stage for a time</option>
                                </select>
                            </div>
                            {(rule.trigger === 'TIME_IN_STAGE' || rule.trigger === 'LEAD_CREATED') && (
                                <div>
                                    <label className="block text-xs text-blue-600 mb-1">Wait Before Firing (Hours)</label>
                                    <input
                                        type="number" min="0"
                                        className="w-full px-4 py-2 border border-blue-200 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 text-sm"
                                        value={rule.delayHours}
                                        onChange={(e) => setRule({ ...rule, delayHours: Number(e.target.value) })}
                                    />
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Conditions Block */}
                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 shadow-sm relative">
                        <div className="absolute -left-3 -top-3 w-7 h-7 bg-slate-500 text-white rounded-full flex items-center justify-center text-xs font-bold border-4 border-white shadow">2</div>
                        <div className="flex justify-between items-center mb-3">
                            <h3 className="text-xs font-bold text-slate-600 uppercase tracking-widest flex items-center gap-2">
                                <i className="fa-solid fa-filter"></i> But only if... (Conditions)
                            </h3>
                            <button onClick={addCondition} className="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-600 px-3 py-1 rounded-md font-medium transition">
                                + Add Condition
                            </button>
                        </div>
                        {rule.conditions.length === 0 ? (
                            <p className="text-xs text-slate-400 italic">Fires for ALL leads by default. Add conditions to filter.</p>
                        ) : (
                            <div className="space-y-2">
                                {rule.conditions.map((cond, idx) => (
                                    <div key={idx} className="flex flex-col md:flex-row gap-2 items-center bg-white p-3 rounded-lg border border-slate-200">
                                        <select className="w-full md:w-1/3 px-3 py-2 border border-slate-200 rounded-md text-sm" value={cond.field} onChange={(e) => updateCondition(idx, 'field', e.target.value)}>
                                            <option value="source">Lead Source</option>
                                            <option value="status">Lead Stage</option>
                                            <option value="dealValue">Deal Value</option>
                                            <option value="customData.Product">Custom: Product</option>
                                        </select>
                                        <select className="w-full md:w-1/3 px-3 py-2 border border-slate-200 rounded-md text-sm" value={cond.operator} onChange={(e) => updateCondition(idx, 'operator', e.target.value)}>
                                            <option value="equals">Equals</option>
                                            <option value="not_equals">Does Not Equal</option>
                                            <option value="contains">Contains</option>
                                            <option value="greater_than">Greater Than</option>
                                        </select>
                                        {cond.field === 'status' ? (
                                            <select className="w-full md:w-1/3 px-3 py-2 border border-slate-200 rounded-md text-sm bg-white" value={cond.value} onChange={(e) => updateCondition(idx, 'value', e.target.value)}>
                                                <option value="">-- Select Stage --</option>
                                                {stages.map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
                                            </select>
                                        ) : (
                                            <input type="text" className="w-full md:w-1/3 px-3 py-2 border border-slate-200 rounded-md text-sm" placeholder="Value..." value={cond.value} onChange={(e) => updateCondition(idx, 'value', e.target.value)} />
                                        )}
                                        <button onClick={() => removeCondition(idx)} className="text-red-400 hover:text-red-600 transition shrink-0">
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Actions Block */}
                    <div className="bg-emerald-50 p-5 rounded-xl border border-emerald-100 shadow-sm relative">
                        <div className="absolute -left-3 -top-3 w-7 h-7 bg-emerald-500 text-white rounded-full flex items-center justify-center text-xs font-bold border-4 border-white shadow">3</div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xs font-bold text-emerald-800 uppercase tracking-widest flex items-center gap-2">
                                <i className="fa-solid fa-gears"></i> Then do this... (Actions)
                            </h3>
                            <button onClick={addAction} className="text-xs bg-white border border-emerald-200 hover:bg-emerald-50 text-emerald-700 px-3 py-1 rounded-md font-medium transition">
                                + Add Action
                            </button>
                        </div>

                        <div className="space-y-4">
                            {rule.actions.map((action, idx) => {
                                const meta = actionMeta[action.type] || actionMeta.SEND_WHATSAPP;
                                return (
                                    <div key={idx} className="bg-white border border-slate-100 rounded-xl shadow-sm overflow-hidden">

                                        {/* Action Header */}
                                        <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                                            <div className="flex items-center gap-2">
                                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${meta.color}`}>
                                                    <i className={meta.icon}></i> {meta.label}
                                                </span>
                                                {idx > 0 && <span className="text-xs text-slate-400">Step {idx + 1}</span>}
                                            </div>
                                            {rule.actions.length > 1 && (
                                                <button onClick={() => removeAction(idx)} className="text-slate-300 hover:text-red-500 transition">
                                                    <i className="fa-solid fa-trash-can text-xs"></i>
                                                </button>
                                            )}
                                        </div>

                                        {/* Action Body */}
                                        <div className="p-4 space-y-4">
                                            {/* Action Type Selector */}
                                            <div>
                                                <label className="block text-xs font-medium text-slate-500 mb-1">Action Type</label>
                                                <select
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                                    value={action.type}
                                                    onChange={(e) => updateAction(idx, 'type', e.target.value)}
                                                >
                                                    <option value="SEND_WHATSAPP">📱 Send WhatsApp Template</option>
                                                    <option value="SEND_EMAIL">📧 Send Email</option>
                                                    <option value="CHANGE_STAGE">🔄 Move to Stage</option>
                                                    <option value="ASSIGN_USER">👤 Assign to Teammate</option>
                                                    <option value="WAIT_FOR_REPLY">⏳ Wait for Reply (Conditional)</option>
                                                </select>
                                            </div>

                                            {/* === SEND_WHATSAPP === */}
                                            {action.type === 'SEND_WHATSAPP' && (
                                                <div>
                                                    <label className="block text-xs text-slate-500 mb-1">WhatsApp Template</label>
                                                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={action.templateId || ''} onChange={(e) => updateAction(idx, 'templateId', e.target.value)}>
                                                        <option value="">-- Select Approved Template --</option>
                                                        {whatsappTemplates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                                                    </select>
                                                </div>
                                            )}

                                            {/* === SEND_EMAIL === */}
                                            {action.type === 'SEND_EMAIL' && (
                                                <div className="space-y-3">
                                                    <div>
                                                        <label className="block text-xs text-slate-500 mb-1">Subject</label>
                                                        <input type="text" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={action.subject || ''} onChange={(e) => updateAction(idx, 'subject', e.target.value)} placeholder="Follow up on your inquiry..." />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs text-slate-500 mb-1">Body Text</label>
                                                        <textarea className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" rows="3" value={action.body || ''} onChange={(e) => updateAction(idx, 'body', e.target.value)} placeholder="Hi {{name}}, just checking in..." />
                                                    </div>
                                                </div>
                                            )}

                                            {/* === CHANGE_STAGE === */}
                                            {action.type === 'CHANGE_STAGE' && (
                                                <div>
                                                    <label className="block text-xs text-slate-500 mb-1">Move Lead to Stage</label>
                                                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={action.stageName || ''} onChange={(e) => updateAction(idx, 'stageName', e.target.value)}>
                                                        <option value="">-- Select Stage --</option>
                                                        {stages.map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
                                                    </select>
                                                </div>
                                            )}

                                            {/* === ASSIGN_USER === */}
                                            {action.type === 'ASSIGN_USER' && (
                                                <div>
                                                    <label className="block text-xs text-slate-500 mb-1">Assign to</label>
                                                    <select className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" value={action.userId || ''} onChange={(e) => updateAction(idx, 'userId', e.target.value)}>
                                                        <option value="">-- Select Team Member --</option>
                                                        {users.map(u => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
                                                    </select>
                                                </div>
                                            )}

                                            {/* === WAIT_FOR_REPLY (New!) === */}
                                            {action.type === 'WAIT_FOR_REPLY' && (
                                                <div className="space-y-4">
                                                    {/* Reply Window */}
                                                    <div>
                                                        <label className="block text-xs font-semibold text-amber-700 mb-1">⏱ Wait for reply (hours)</label>
                                                        <input
                                                            type="number" min="1"
                                                            className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400 bg-amber-50"
                                                            placeholder="24"
                                                            value={action.waitForReplyHours || ''}
                                                            onChange={(e) => updateAction(idx, 'waitForReplyHours', Number(e.target.value))}
                                                        />
                                                        <p className="text-xs text-slate-400 mt-1">How many hours to wait before treating as "no reply"</p>
                                                    </div>

                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        {/* IF REPLIED Branch */}
                                                        <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                                                            <div className="flex items-center gap-1.5 mb-3">
                                                                <span className="w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center text-xs font-bold">✓</span>
                                                                <h4 className="text-xs font-bold text-green-800 uppercase tracking-wide">If Lead Replies</h4>
                                                            </div>
                                                            <div className="space-y-3">
                                                                <div>
                                                                    <label className="block text-xs text-green-700 mb-1">Change Stage to</label>
                                                                    <select
                                                                        className="w-full px-2 py-2 border border-green-200 rounded-lg text-sm bg-white"
                                                                        value={action.ifRepliedAction?.changeStage || ''}
                                                                        onChange={(e) => updateNestedAction(idx, 'ifRepliedAction', 'changeStage', e.target.value)}
                                                                    >
                                                                        <option value="">-- Keep Stage Same --</option>
                                                                        {stages.map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs text-green-700 mb-1">Also Send Template (optional)</label>
                                                                    <select
                                                                        className="w-full px-2 py-2 border border-green-200 rounded-lg text-sm bg-white"
                                                                        value={action.ifRepliedAction?.sendTemplateId || ''}
                                                                        onChange={(e) => updateNestedAction(idx, 'ifRepliedAction', 'sendTemplateId', e.target.value)}
                                                                    >
                                                                        <option value="">-- No Follow-up --</option>
                                                                        {whatsappTemplates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* IF NO REPLY Branch */}
                                                        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                                                            <div className="flex items-center gap-1.5 mb-3">
                                                                <span className="w-5 h-5 rounded-full bg-red-400 text-white flex items-center justify-center text-xs font-bold">✗</span>
                                                                <h4 className="text-xs font-bold text-red-700 uppercase tracking-wide">If No Reply</h4>
                                                            </div>
                                                            <div className="space-y-3">
                                                                <div>
                                                                    <label className="block text-xs text-red-600 mb-1">Change Stage to</label>
                                                                    <select
                                                                        className="w-full px-2 py-2 border border-red-200 rounded-lg text-sm bg-white"
                                                                        value={action.ifNoReplyAction?.changeStage || ''}
                                                                        onChange={(e) => updateNestedAction(idx, 'ifNoReplyAction', 'changeStage', e.target.value)}
                                                                    >
                                                                        <option value="">-- Keep Stage Same --</option>
                                                                        {stages.map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className="block text-xs text-red-600 mb-1">Send Last-attempt Template (optional)</label>
                                                                    <select
                                                                        className="w-full px-2 py-2 border border-red-200 rounded-lg text-sm bg-white"
                                                                        value={action.ifNoReplyAction?.sendTemplateId || ''}
                                                                        onChange={(e) => updateNestedAction(idx, 'ifNoReplyAction', 'sendTemplateId', e.target.value)}
                                                                    >
                                                                        <option value="">-- No Follow-up --</option>
                                                                        {whatsappTemplates.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-between items-center rounded-b-2xl">
                    <p className="text-xs text-slate-400">
                        <i className="fa-solid fa-shield-halved mr-1"></i>
                        Only one automation fires per lead at a time.
                    </p>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-medium rounded-lg transition text-sm">Cancel</button>
                        <button onClick={handleSave} disabled={loading} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition flex items-center gap-2 text-sm">
                            {loading && <i className="fa-solid fa-spinner fa-spin"></i>}
                            Save Automation
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RuleBuilderModal;
