/* eslint-disable react/prop-types */
import React from 'react';

const CATEGORY_META = {
    trigger:       { label: 'Triggers',          icon: 'fa-bolt',    color: '#3B82F6', bg: '#EFF6FF' },
    communication: { label: 'Communication',      icon: 'fa-paper-plane', color: '#22C55E', bg: '#F0FDF4' },
    crm:           { label: 'CRM Actions',        icon: 'fa-users',   color: '#8B5CF6', bg: '#F5F3FF' },
    logic:         { label: 'Logic & Flow',       icon: 'fa-code-branch', color: '#F59E0B', bg: '#FFFBEB' },
    ai:            { label: 'AI & Intelligence',  icon: 'fa-wand-magic-sparkles', color: '#A855F7', bg: '#FAF5FF' },
    external:      { label: 'External',           icon: 'fa-globe',   color: '#64748B', bg: '#F8FAFC' }
};

const DraggableNodeCard = ({ node }) => {
    const onDragStart = (e) => {
        e.dataTransfer.setData('application/workflow-node', JSON.stringify(node));
        e.dataTransfer.effectAllowed = 'move';
    };

    return (
        <div
            draggable
            onDragStart={onDragStart}
            title={node.description || node.name}
            style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                borderRadius: 8, background: '#fff', border: '1.5px solid #E2E8F0',
                cursor: 'grab', userSelect: 'none', transition: 'all 0.15s',
                marginBottom: 4
            }}
            onMouseEnter={e => {
                e.currentTarget.style.borderColor = node.color || '#94A3B8';
                e.currentTarget.style.background = '#F8FAFC';
                e.currentTarget.style.transform = 'translateX(2px)';
            }}
            onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#E2E8F0';
                e.currentTarget.style.background = '#fff';
                e.currentTarget.style.transform = 'translateX(0)';
            }}
        >
            <div style={{
                width: 28, height: 28, borderRadius: 6, flexShrink: 0,
                background: node.color || '#94A3B8',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
                <i className={`fa-solid ${node.icon || 'fa-gear'}`} style={{ color: '#fff', fontSize: 12 }} />
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', lineHeight: 1.2 }}>{node.name}</div>
                {node.description && (
                    <div style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: 160 }}>{node.description}</div>
                )}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// NodePanel — left sidebar, categorized list of all available node types.
// Nodes are dragged from here onto the canvas.
// ─────────────────────────────────────────────────────────────────────────────
export default function NodePanel({ nodeTypes }) {
    const [search, setSearch] = React.useState('');

    const grouped = {};
    (nodeTypes || []).forEach(nt => {
        const cat = nt.category || 'external';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(nt);
    });

    const filtered = search.trim()
        ? (nodeTypes || []).filter(nt => nt.name.toLowerCase().includes(search.toLowerCase()) || nt.description?.toLowerCase().includes(search.toLowerCase()))
        : null;

    return (
        <div style={{ width: 220, borderRight: '1.5px solid #E2E8F0', background: '#FAFAFA', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #E2E8F0', flexShrink: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Node Library</div>
                <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search nodes..." style={{
                        width: '100%', padding: '6px 10px', borderRadius: 8, border: '1.5px solid #E2E8F0',
                        fontSize: 12, outline: 'none', background: '#fff', color: '#1E293B',
                        boxSizing: 'border-box'
                    }}
                />
            </div>

            {/* Hint */}
            <div style={{ padding: '6px 12px', background: '#EFF6FF', borderBottom: '1px solid #BFDBFE' }}>
                <p style={{ fontSize: 10, color: '#3B82F6', margin: 0, fontWeight: 500 }}>
                    <i className="fa-solid fa-hand" style={{ marginRight: 4 }} />
                    Drag nodes onto the canvas
                </p>
            </div>

            {/* Filtered search results */}
            {filtered ? (
                <div style={{ padding: 10 }}>
                    {filtered.length === 0
                        ? <p style={{ fontSize: 12, color: '#94A3B8', textAlign: 'center', marginTop: 20 }}>No nodes found</p>
                        : filtered.map(nt => <DraggableNodeCard key={nt.type} node={nt} />)
                    }
                </div>
            ) : (
                /* Categorized list */
                <div style={{ padding: '8px 10px' }}>
                    {Object.entries(grouped).map(([cat, nodes]) => {
                        const catMeta = CATEGORY_META[cat] || { label: cat, icon: 'fa-circle', color: '#94A3B8', bg: '#F8FAFC' };
                        return (
                            <div key={cat} style={{ marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '4px 6px', borderRadius: 6, background: catMeta.bg }}>
                                    <i className={`fa-solid ${catMeta.icon}`} style={{ color: catMeta.color, fontSize: 11 }} />
                                    <span style={{ fontSize: 10, fontWeight: 700, color: catMeta.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{catMeta.label}</span>
                                </div>
                                {nodes.map(nt => <DraggableNodeCard key={nt.type} node={nt} />)}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
