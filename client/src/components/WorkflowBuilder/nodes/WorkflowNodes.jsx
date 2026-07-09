import React from 'react';
import { Handle, Position } from '@xyflow/react';

// ─────────────────────────────────────────────────────────────────────────────
// Node color map (matches backend node meta)
// ─────────────────────────────────────────────────────────────────────────────
export const NODE_COLORS = {
    // Triggers
    LEAD_CREATED:       { bg: '#EFF6FF', border: '#3B82F6', icon: '#3B82F6', text: '#1D4ED8' },
    STAGE_CHANGED:      { bg: '#F5F3FF', border: '#8B5CF6', icon: '#8B5CF6', text: '#6D28D9' },
    WHATSAPP_REPLY:     { bg: '#F0FDF4', border: '#22C55E', icon: '#22C55E', text: '#15803D' },
    MANUAL_TRIGGER:     { bg: '#FFF7ED', border: '#F97316', icon: '#F97316', text: '#C2410C' },
    WEBHOOK_RECEIVED:   { bg: '#F8FAFC', border: '#64748B', icon: '#64748B', text: '#334155' },

    // Communication
    send_whatsapp:         { bg: '#F0FDF4', border: '#22C55E', icon: '#22C55E', text: '#15803D' },
    send_email:            { bg: '#EFF6FF', border: '#3B82F6', icon: '#3B82F6', text: '#1D4ED8' },
    voice_call:            { bg: '#EDE9FE', border: '#7C3AED', icon: '#7C3AED', text: '#6D28D9' },
    internal_notification: { bg: '#FFFBEB', border: '#F59E0B', icon: '#F59E0B', text: '#92400E' },

    // CRM
    update_stage:         { bg: '#F5F3FF', border: '#8B5CF6', icon: '#8B5CF6', text: '#6D28D9' },
    assign_user:          { bg: '#FDF2F8', border: '#EC4899', icon: '#EC4899', text: '#BE185D' },
    add_tag:              { bg: '#F0FDF4', border: '#10B981', icon: '#10B981', text: '#065F46' },
    update_custom_field:  { bg: '#ECFDF5', border: '#06B6D4', icon: '#06B6D4', text: '#0E7490' },

    // Logic
    condition:  { bg: '#FFFBEB', border: '#F59E0B', icon: '#F59E0B', text: '#92400E' },
    switch:     { bg: '#FEF2F2', border: '#EF4444', icon: '#EF4444', text: '#991B1B' },
    wait:       { bg: '#FFF7ED', border: '#F97316', icon: '#F97316', text: '#C2410C' },

    // AI
    ai_classifier: { bg: '#FAF5FF', border: '#A855F7', icon: '#A855F7', text: '#7E22CE' },

    // External
    http_request: { bg: '#F8FAFC', border: '#64748B', icon: '#64748B', text: '#334155' },

    // Default
    default: { bg: '#F8FAFC', border: '#94A3B8', icon: '#64748B', text: '#475569' }
};

export const getNodeColor = (type) => NODE_COLORS[type] || NODE_COLORS.default;

// ─────────────────────────────────────────────────────────────────────────────
// TriggerNode — root node, no input handle, single output handle
// ─────────────────────────────────────────────────────────────────────────────
export const TriggerNode = ({ data, selected }) => {
    const color = getNodeColor(data.trigger || 'LEAD_CREATED');
    return (
        <div style={{
            background:   color.bg,
            border:       `2px solid ${selected ? '#2563EB' : color.border}`,
            boxShadow:    selected ? `0 0 0 3px ${color.border}33` : '0 2px 8px rgba(0,0,0,0.08)',
            borderRadius: 14,
            padding:      '12px 16px',
            minWidth:     180,
            transition:   'box-shadow 0.2s'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: color.border, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                    <i className="fa-solid fa-bolt" style={{ color: '#fff', fontSize: 14 }} />
                </div>
                <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: color.text, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Trigger</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: color.text, lineHeight: 1.2 }}>{data.label || 'Trigger'}</div>
                </div>
            </div>
            <Handle type="source" position={Position.Bottom} id="output"
                style={{ background: color.border, width: 10, height: 10, border: '2px solid #fff' }} />
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// ActionNode — generic action node (WhatsApp, Email, Voice, CRM, External)
// ─────────────────────────────────────────────────────────────────────────────
export const ActionNode = ({ data, selected }) => {
    const color = getNodeColor(data.nodeType);
    const ports = data.ports || { outputs: [{ id: 'output', label: 'Next' }] };
    
    let dynamicOutputs = ports.outputs;
    if (data.nodeType === 'switch' && data.config?.cases) {
        dynamicOutputs = [...data.config.cases.map(c => ({ id: c.portName || 'case', label: c.portName || 'Case' })), { id: 'default', label: 'Default' }];
    } else if (data.nodeType === 'ai_classifier' && data.config?.categories) {
        dynamicOutputs = [...data.config.categories.map(c => ({ id: c, label: c })), { id: 'default', label: 'Default' }];
    }
    
    const multipleOutputs = dynamicOutputs.length > 1;

    return (
        <div style={{
            background:   color.bg,
            border:       `2px solid ${selected ? '#2563EB' : color.border}`,
            boxShadow:    selected ? `0 0 0 3px ${color.border}33` : '0 2px 8px rgba(0,0,0,0.08)',
            borderRadius: 14,
            padding:      '12px 16px',
            minWidth:     190,
            transition:   'box-shadow 0.2s'
        }}>
            <Handle type="target" position={Position.Top} id="input"
                style={{ background: color.border, width: 10, height: 10, border: '2px solid #fff' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: color.border, display: 'flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                    <i className={`fa-solid ${data.icon || 'fa-gear'}`} style={{ color: '#fff', fontSize: 14 }} />
                </div>
                <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: color.text, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>{data.category || 'Action'}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: color.text, lineHeight: 1.2 }}>{data.label || data.nodeType}</div>
                </div>
            </div>

            {data.summary && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#64748B', borderTop: `1px solid ${color.border}22`, paddingTop: 6 }}>
                    {data.summary}
                </div>
            )}

            {!multipleOutputs ? (
                <Handle type="source" position={Position.Bottom} id="output"
                    style={{ background: color.border, width: 10, height: 10, border: '2px solid #fff' }} />
            ) : (
                dynamicOutputs.map((port, i) => (
                    <Handle key={port.id} type="source" position={Position.Bottom} id={port.id}
                        style={{
                            background: color.border, width: 10, height: 10, border: '2px solid #fff',
                            left: `${((i + 1) / (dynamicOutputs.length + 1)) * 100}%`
                        }} />
                ))
            )}
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// ConditionNode — diamond shape, two output handles (true/false)
// ─────────────────────────────────────────────────────────────────────────────
export const ConditionNode = ({ data, selected }) => {
    const color = getNodeColor('condition');
    return (
        <div style={{
            background:   color.bg,
            border:       `2px solid ${selected ? '#2563EB' : color.border}`,
            boxShadow:    selected ? `0 0 0 3px ${color.border}33` : '0 2px 8px rgba(0,0,0,0.08)',
            borderRadius: 14,
            padding:      '12px 16px',
            minWidth:     190,
            transition:   'box-shadow 0.2s'
        }}>
            <Handle type="target" position={Position.Top} id="input"
                style={{ background: color.border, width: 10, height: 10, border: '2px solid #fff' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 8, background: color.border,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                    <i className="fa-solid fa-code-branch" style={{ color: '#fff', fontSize: 14 }} />
                </div>
                <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: color.text, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Condition</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: color.text, lineHeight: 1.2 }}>{data.label || 'If / Else'}</div>
                </div>
            </div>

            {data.summary && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#64748B', borderTop: `1px solid ${color.border}22`, paddingTop: 6 }}>
                    {data.summary}
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                <span style={{ fontSize: 10, color: '#22C55E', fontWeight: 700 }}>✓ True</span>
                <span style={{ fontSize: 10, color: '#EF4444', fontWeight: 700 }}>✗ False</span>
            </div>

            <Handle type="source" position={Position.Bottom} id="true"
                style={{ background: '#22C55E', width: 10, height: 10, border: '2px solid #fff', left: '25%' }} />
            <Handle type="source" position={Position.Bottom} id="false"
                style={{ background: '#EF4444', width: 10, height: 10, border: '2px solid #fff', left: '75%' }} />
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// WaitNode — hourglass icon, 'resumed' + 'timeout' outputs
// ─────────────────────────────────────────────────────────────────────────────
export const WaitNode = ({ data, selected }) => {
    const color = getNodeColor('wait');
    return (
        <div style={{
            background:   color.bg,
            border:       `2px solid ${selected ? '#2563EB' : color.border}`,
            boxShadow:    selected ? `0 0 0 3px ${color.border}33` : '0 2px 8px rgba(0,0,0,0.08)',
            borderRadius: 14,
            padding:      '12px 16px',
            minWidth:     190,
            transition:   'box-shadow 0.2s'
        }}>
            <Handle type="target" position={Position.Top} id="input"
                style={{ background: color.border, width: 10, height: 10, border: '2px solid #fff' }} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                    width: 32, height: 32, borderRadius: 8, background: color.border,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                }}>
                    <i className="fa-solid fa-hourglass-half" style={{ color: '#fff', fontSize: 14 }} />
                </div>
                <div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: color.text, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7 }}>Wait</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: color.text, lineHeight: 1.2 }}>{data.label || 'Wait'}</div>
                </div>
            </div>

            {data.summary && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#64748B', borderTop: `1px solid ${color.border}22`, paddingTop: 6 }}>
                    {data.summary}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8, textAlign: 'center' }}>
                <span style={{ fontSize: 9, color: '#22C55E', fontWeight: 700 }}>↩ Resume</span>
                <span style={{ fontSize: 9, color: '#16A34A', fontWeight: 700 }}>💬 Reply</span>
                <span style={{ fontSize: 9, color: '#94A3B8', fontWeight: 700 }}>⏰ Timeout</span>
                <span style={{ fontSize: 9, color: '#F97316', fontWeight: 700 }}>Ø Chat</span>
            </div>

            <Handle type="source" position={Position.Bottom} id="output"
                style={{ background: '#22C55E', width: 10, height: 10, border: '2px solid #fff', left: '20%' }} />
            <Handle type="source" position={Position.Bottom} id="replied"
                style={{ background: '#16A34A', width: 10, height: 10, border: '2px solid #fff', left: '40%' }} />
            <Handle type="source" position={Position.Bottom} id="timeout"
                style={{ background: '#94A3B8', width: 10, height: 10, border: '2px solid #fff', left: '60%' }} />
            <Handle type="source" position={Position.Bottom} id="no_conversation"
                style={{ background: '#F97316', width: 10, height: 10, border: '2px solid #fff', left: '80%' }} />
        </div>
    );
};
