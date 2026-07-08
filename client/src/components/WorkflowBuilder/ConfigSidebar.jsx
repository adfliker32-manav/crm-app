/* eslint-disable react/prop-types */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const TRIGGER_OPTIONS = [
    { value: 'LEAD_CREATED',       label: '🔆 Lead Created',         desc: 'Fires when a new lead is added to the CRM' },
    { value: 'STAGE_CHANGED',      label: '🔄 Stage Changed',        desc: 'Fires when a lead moves to a different stage' },
    { value: 'WHATSAPP_REPLY',     label: '💬 WhatsApp Reply',       desc: 'Fires when a lead replies on WhatsApp' },
    { value: 'VOICE_CALL_FINISHED',label: '📞 Voice Call Finished',  desc: 'Fires when an AI voice call completes' },
    { value: 'APPOINTMENT_BOOKED', label: '📅 Appointment Booked',   desc: 'Fires when a lead books an appointment' },
    { value: 'WEBHOOK_RECEIVED',   label: '🌐 Webhook Received',     desc: 'Fires when your webhook URL receives a POST request' },
    { value: 'MANUAL_TRIGGER',     label: '▶️ Manual Trigger',      desc: 'Only fires when manually triggered from the lead card' },
    { value: 'SCHEDULED_TRIGGER',  label: '⏰ Scheduled',            desc: 'Fires on a cron schedule' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Field renderers for each schema field type
// ─────────────────────────────────────────────────────────────────────────────
const FieldRenderer = ({ field, value, onChange, stages, users, waTemplates }) => {
    const v = value ?? field.defaultValue ?? '';

    const inputStyle = {
        width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
        border: '1.5px solid #E2E8F0', outline: 'none', background: '#fff',
        fontFamily: 'inherit', color: '#1E293B', boxSizing: 'border-box'
    };
    const labelStyle = {
        display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4
    };

    if (field.type === 'text') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <input style={inputStyle} type="text" value={v} placeholder={field.placeholder || ''} onChange={e => onChange(field.key, e.target.value)} />
            {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{field.description}</p>}
        </div>
    );

    if (field.type === 'number') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <input style={inputStyle} type="number" value={v} placeholder={field.placeholder || ''} onChange={e => onChange(field.key, Number(e.target.value))} />
            {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{field.description}</p>}
        </div>
    );

    if (field.type === 'textarea') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <textarea style={{ ...inputStyle, resize: 'vertical' }} rows={field.rows || 4} value={v} placeholder={field.placeholder || ''} onChange={e => onChange(field.key, e.target.value)} />
            {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{field.description}</p>}
        </div>
    );

    if (field.type === 'select') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={v} onChange={e => onChange(field.key, e.target.value)}>
                <option value="">-- Select --</option>
                {(field.options || []).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
            </select>
        </div>
    );

    if (field.type === 'stage_select') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={v} onChange={e => onChange(field.key, e.target.value)}>
                <option value="">-- Select Stage --</option>
                {(stages || []).map(s => <option key={s._id} value={s.name}>{s.name}</option>)}
            </select>
        </div>
    );

    if (field.type === 'user_select') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={v} onChange={e => onChange(field.key, e.target.value)}>
                <option value="">-- Select Team Member --</option>
                {(users || []).map(u => <option key={u._id} value={u._id}>{u.name} ({u.role})</option>)}
            </select>
        </div>
    );

    if (field.type === 'whatsapp_template_select') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={v} onChange={e => onChange(field.key, e.target.value)}>
                <option value="">-- Select Template --</option>
                {(waTemplates || []).map(t => <option key={t.id || t._id} value={t.name}>{t.name}</option>)}
            </select>
            {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{field.description}</p>}
        </div>
    );

    if (field.type === 'variable_select') return (
        <div>
            <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
            <input style={inputStyle} type="text" value={v} placeholder={field.placeholder || 'lead.source'} onChange={e => onChange(field.key, e.target.value)} list={`vars-${field.key}`} />
            <datalist id={`vars-${field.key}`}>
                {['lead.name','lead.phone','lead.email','lead.source','lead.status','lead.score','lead.dealValue','lead.tags'].map(v => <option key={v} value={v} />)}
            </datalist>
            {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{field.description}</p>}
        </div>
    );

    if (field.type === 'json_editor') return (
        <div>
            <label style={labelStyle}>{field.label}</label>
            <textarea style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
                rows={4} value={v} placeholder={field.placeholder || '{}'} onChange={e => onChange(field.key, e.target.value)} />
        </div>
    );

    if (field.type === 'tag_input') {
        const tags = Array.isArray(v) ? v : [];
        const [inputVal, setInputVal] = useState('');
        return (
            <div>
                <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {tags.map((t, i) => (
                        <span key={i} style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, padding: '2px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {t}
                            <button onClick={() => onChange(field.key, tags.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', padding: 0, fontSize: 12 }}>×</button>
                        </span>
                    ))}
                </div>
                <input style={inputStyle} type="text" value={inputVal} placeholder={field.placeholder || 'Type and press Enter'}
                    onChange={e => setInputVal(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && inputVal.trim()) { onChange(field.key, [...tags, inputVal.trim()]); setInputVal(''); e.preventDefault(); } }} />
                {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 4 }}>{field.description}</p>}
            </div>
        );
    }

    if (field.type === 'condition_builder') {
        const conditions = Array.isArray(v) ? v : [];
        const addCondition = () => onChange(field.key, [...conditions, { variable: '', operator: 'equals', value: '' }]);
        const updateCondition = (index, key, val) => {
            const newConds = [...conditions];
            newConds[index] = { ...newConds[index], [key]: val };
            onChange(field.key, newConds);
        };
        const removeCondition = (index) => onChange(field.key, conditions.filter((_, i) => i !== index));

        return (
            <div>
                <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
                {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8 }}>{field.description}</p>}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {conditions.map((cond, i) => (
                        <div key={i} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 10, position: 'relative' }}>
                            <button onClick={() => removeCondition(i)} style={{ position: 'absolute', top: 6, right: 6, background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}>×</button>
                            <input style={{...inputStyle, marginBottom: 6}} type="text" placeholder="Variable (e.g. lead.source)" value={cond.variable} onChange={e => updateCondition(i, 'variable', e.target.value)} />
                            <select style={{...inputStyle, marginBottom: 6}} value={cond.operator} onChange={e => updateCondition(i, 'operator', e.target.value)}>
                                <option value="equals">Equals</option>
                                <option value="not_equals">Does Not Equal</option>
                                <option value="contains">Contains</option>
                                <option value="not_contains">Does Not Contain</option>
                                <option value="starts_with">Starts With</option>
                                <option value="greater_than">Greater Than</option>
                                <option value="less_than">Less Than</option>
                                <option value="is_empty">Is Empty</option>
                                <option value="is_not_empty">Is Not Empty</option>
                            </select>
                            {!['is_empty', 'is_not_empty'].includes(cond.operator) && (
                                <input style={inputStyle} type="text" placeholder="Value" value={cond.value} onChange={e => updateCondition(i, 'value', e.target.value)} />
                            )}
                        </div>
                    ))}
                </div>
                <button onClick={addCondition} style={{ marginTop: 8, width: '100%', padding: '6px 0', background: '#F1F5F9', border: '1px dashed #CBD5E1', borderRadius: 6, color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    + Add Condition
                </button>
            </div>
        );
    }

    if (field.type === 'switch_builder') {
        const cases = Array.isArray(v) ? v : [];
        const addCase = () => onChange(field.key, [...cases, { portName: `case_${cases.length + 1}`, variable: '', operator: 'equals', value: '' }]);
        const updateCase = (index, key, val) => {
            const newCases = [...cases];
            newCases[index] = { ...newCases[index], [key]: val };
            onChange(field.key, newCases);
        };
        const removeCase = (index) => onChange(field.key, cases.filter((_, i) => i !== index));

        return (
            <div>
                <label style={labelStyle}>{field.label}{field.required && <span style={{ color: '#EF4444' }}> *</span>}</label>
                {field.description && <p style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8 }}>{field.description}</p>}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {cases.map((c, i) => (
                        <div key={i} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: 10, position: 'relative' }}>
                            <button onClick={() => removeCase(i)} style={{ position: 'absolute', top: 6, right: 6, background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}>×</button>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 }}>Port Name</div>
                            <input style={{...inputStyle, marginBottom: 8}} type="text" placeholder="Port Name (e.g. VIP)" value={c.portName} onChange={e => updateCase(i, 'portName', e.target.value)} />
                            
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', marginBottom: 4 }}>Rule</div>
                            <input style={{...inputStyle, marginBottom: 6}} type="text" placeholder="Variable (e.g. lead.score)" value={c.variable} onChange={e => updateCase(i, 'variable', e.target.value)} />
                            <select style={{...inputStyle, marginBottom: 6}} value={c.operator} onChange={e => updateCase(i, 'operator', e.target.value)}>
                                <option value="equals">Equals</option>
                                <option value="not_equals">Does Not Equal</option>
                                <option value="contains">Contains</option>
                                <option value="not_contains">Does Not Contain</option>
                                <option value="starts_with">Starts With</option>
                                <option value="greater_than">Greater Than</option>
                                <option value="less_than">Less Than</option>
                                <option value="is_empty">Is Empty</option>
                                <option value="is_not_empty">Is Not Empty</option>
                            </select>
                            {!['is_empty', 'is_not_empty'].includes(c.operator) && (
                                <input style={inputStyle} type="text" placeholder="Value" value={c.value} onChange={e => updateCase(i, 'value', e.target.value)} />
                            )}
                        </div>
                    ))}
                </div>
                <button onClick={addCase} style={{ marginTop: 8, width: '100%', padding: '6px 0', background: '#F1F5F9', border: '1px dashed #CBD5E1', borderRadius: 6, color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                    + Add Routing Case
                </button>
            </div>
        );
    }

    // Fallback
    return (
        <div>
            <label style={labelStyle}>{field.label}</label>
            <input style={inputStyle} type="text" value={v} onChange={e => onChange(field.key, e.target.value)} />
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// ConfigSidebar
// Renders the right-side configuration panel when a node is selected.
// ─────────────────────────────────────────────────────────────────────────────
export default function ConfigSidebar({ 
    selectedNode, 
    nodeTypes, 
    workflow, 
    onUpdateNode, 
    onDeleteNode,
    onUpdateTrigger, 
    onUpdateTriggerConfig,
    onClose 
}) {
    const [stages, setStages] = useState([]);
    const [users, setUsers] = useState([]);
    const [waTemplates, setWaTemplates] = useState([]);

    useEffect(() => {
        const load = async () => {
            try {
                const [s, u, w] = await Promise.all([
                    api.get('/stages').catch(() => ({ data: [] })),
                    api.get('/auth/my-team?includeManager=true').catch(() => ({ data: [] })),
                    api.get('/whatsapp/templates').catch(() => ({ data: {} }))
                ]);
                setStages(s.data || []);
                setUsers(u.data || []);
                const tmpl = w.data?.templates || w.data?.data || [];
                setWaTemplates(tmpl.filter(t => t.status === 'APPROVED'));
            } catch {}
        };
        load();
    }, []);

    if (!selectedNode) return null;

    // Trigger configuration panel
    if (selectedNode.type === 'trigger') {
        const webhookUrl = workflow?._id ? `${window.location.origin}/api/workflows/webhook/${workflow._id}` : 'Save workflow to get webhook URL';
        
        return (
            <div style={{ width: 300, borderLeft: '1.5px solid #E2E8F0', background: '#FAFAFA', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '16px 20px', borderBottom: '1.5px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trigger</div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B' }}>Workflow Start</div>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 18 }}>×</button>
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Select Trigger</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {TRIGGER_OPTIONS.map(opt => (
                                <button key={opt.value}
                                    onClick={() => onUpdateTrigger(opt.value)}
                                    style={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                                        padding: '10px 12px', borderRadius: 10, cursor: 'pointer', textAlign: 'left', width: '100%',
                                        border: `1.5px solid ${workflow?.trigger === opt.value ? '#3B82F6' : '#E2E8F0'}`,
                                        background: workflow?.trigger === opt.value ? '#EFF6FF' : '#fff',
                                        transition: 'all 0.15s'
                                    }}>
                                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B' }}>{opt.label}</div>
                                    <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{opt.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {workflow?.trigger === 'SCHEDULED_TRIGGER' && (
                        <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 16 }}>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Cron Expression</label>
                            <input 
                                type="text"
                                value={workflow?.triggerConfig?.cronExpression || ''}
                                onChange={e => onUpdateTriggerConfig({ cronExpression: e.target.value })}
                                placeholder="e.g. 0 9 * * *"
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13, border: '1.5px solid #E2E8F0', outline: 'none', background: '#fff', boxSizing: 'border-box' }}
                            />
                            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 6, lineHeight: 1.4 }}>
                                Uses standard cron syntax. E.g. <br/>
                                <code>0 9 * * *</code> for 9:00 AM daily <br/>
                                <code>0 * * * *</code> for every hour
                            </p>
                        </div>
                    )}
                    
                    {workflow?.trigger === 'WEBHOOK_RECEIVED' && (
                        <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 16 }}>
                            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Webhook URL (POST)</label>
                            <input 
                                type="text"
                                value={webhookUrl}
                                readOnly
                                style={{ width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 12, border: '1.5px solid #E2E8F0', outline: 'none', background: '#F8FAFC', boxSizing: 'border-box', color: '#64748B' }}
                            />
                            <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 6, lineHeight: 1.4 }}>
                                Send a POST request to this URL to trigger this workflow. Payload data will be available as variables.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Action/Logic/AI node configuration panel
    const nodeType = nodeTypes?.find(nt => nt.type === selectedNode.data?.nodeType);
    const schema = nodeType?.schema || { fields: [] };
    const nodeData = selectedNode.data?.config || {};

    const handleChange = (key, value) => {
        onUpdateNode(selectedNode.id, { ...nodeData, [key]: value });
    };

    return (
        <div style={{ width: 300, borderLeft: '1.5px solid #E2E8F0', background: '#FAFAFA', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1.5px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{nodeType?.category || 'Node'}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#1E293B' }}>{nodeType?.name || selectedNode.data?.label || 'Configure'}</div>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 18 }}>×</button>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Node Name */}
                <div>
                    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Node Label</label>
                    <input
                        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13, border: '1.5px solid #E2E8F0', outline: 'none', background: '#fff', fontFamily: 'inherit', color: '#1E293B', boxSizing: 'border-box' }}
                        type="text"
                        value={selectedNode.data?.label || ''}
                        placeholder="e.g. Send Welcome Message"
                        onChange={e => onUpdateNode(selectedNode.id, nodeData, e.target.value)}
                    />
                </div>

                <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {schema.fields.map(field => (
                        <FieldRenderer key={field.key} field={field} value={nodeData[field.key]}
                            onChange={handleChange} stages={stages} users={users} waTemplates={waTemplates} />
                    ))}
                </div>
            </div>

            <div style={{ marginTop: 'auto', padding: '20px', borderTop: '1px solid #E2E8F0' }}>
                <button 
                    onClick={() => onDeleteNode(selectedNode.id)}
                    style={{
                        width: '100%',
                        padding: '10px',
                        background: '#FEF2F2',
                        color: '#EF4444',
                        border: '1px solid #FECACA',
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 13,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        transition: 'all 0.2s'
                    }}
                    onMouseOver={e => { e.currentTarget.style.background = '#FEE2E2'; e.currentTarget.style.borderColor = '#FCA5A5'; }}
                    onMouseOut={e => { e.currentTarget.style.background = '#FEF2F2'; e.currentTarget.style.borderColor = '#FECACA'; }}
                >
                    <i className="fa-regular fa-trash-can" />
                    Delete Node
                </button>
            </div>
        </div>
    );
}
