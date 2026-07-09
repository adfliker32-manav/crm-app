/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    ReactFlow, Controls, MiniMap, Background,
    applyNodeChanges, applyEdgeChanges, addEdge,
    ReactFlowProvider, BaseEdge, EdgeLabelRenderer, getSmoothStepPath,
    useUpdateNodeInternals
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';
import { TriggerNode, ActionNode, ConditionNode, WaitNode } from '../components/WorkflowBuilder/nodes/WorkflowNodes';
import ConfigSidebar from '../components/WorkflowBuilder/ConfigSidebar';
import NodePanel from '../components/WorkflowBuilder/NodePanel';

// ─────────────────────────────────────────────────────────────────────────────
// Deletable labeled edge
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style = {}, markerEnd, data }) => {
    const [edgePath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={{ strokeWidth: 2, stroke: '#94A3B8', ...style }} />
            <EdgeLabelRenderer>
                <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all', zIndex: 10 }} className="nodrag nopan">
                    {data?.label && (
                        <span style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 10, fontWeight: 700, color: '#64748B', padding: '2px 7px' }}>
                            {data.label}
                        </span>
                    )}
                    <button onClick={() => data?.onDelete(id)} title="Delete connection" style={{ width: 18, height: 18, borderRadius: '50%', background: '#EF4444', color: '#fff', border: '2px solid #fff', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: 4 }}>×</button>
                </div>
            </EdgeLabelRenderer>
        </>
    );
};

const NODE_TYPES = { trigger: TriggerNode, action: ActionNode, condition: ConditionNode, wait: WaitNode };
const EDGE_TYPES = { workflow: WorkflowEdge };

// ─────────────────────────────────────────────────────────────────────────────
// Execution Debugger — live panel during test mode
// ─────────────────────────────────────────────────────────────────────────────
const ExecutionDebugger = ({ executionId }) => {
    const [execution, setExecution] = useState(null);

    useEffect(() => {
        if (!executionId) return;
        const poll = async () => {
            try {
                const res = await api.get(`/workflows/executions/${executionId}`);
                setExecution(res.data.execution);
            } catch {}
        };
        poll();
        const interval = setInterval(() => {
            if (execution?.status === 'completed' || execution?.status === 'failed') return;
            poll();
        }, 2000);
        return () => clearInterval(interval);
    }, [executionId, execution?.status]);

    if (!execution) return null;

    const STATUS_COLOR = { running: '#3B82F6', waiting: '#F59E0B', completed: '#22C55E', failed: '#EF4444', cancelled: '#94A3B8' };

    return (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#0F172A', color: '#E2E8F0', borderTop: '1.5px solid #1E293B', height: 200, overflowY: 'auto', zIndex: 50, fontFamily: 'monospace' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid #1E293B' }}>
                <i className="fa-solid fa-bug" style={{ color: '#94A3B8', fontSize: 12 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Execution Debugger</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: STATUS_COLOR[execution.status] + '22', color: STATUS_COLOR[execution.status], fontWeight: 700, marginLeft: 8 }}>{execution.status.toUpperCase()}</span>
            </div>
            <div style={{ padding: '8px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {(execution.history || []).map((h, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span style={{ color: STATUS_COLOR[h.status] || '#94A3B8' }}>
                            {h.status === 'completed' ? '✓' : h.status === 'failed' ? '✗' : h.status === 'running' ? '⟳' : '○'}
                        </span>
                        <span style={{ color: '#CBD5E1' }}>{h.nodeName || h.nodeType}</span>
                        {h.durationMs > 0 && <span style={{ color: '#475569', fontSize: 11 }}>{h.durationMs}ms</span>}
                        {h.error && <span style={{ color: '#EF4444', fontSize: 11 }}>Error: {h.error}</span>}
                    </div>
                ))}
                {execution.history?.length === 0 && <span style={{ color: '#475569', fontSize: 12 }}>Waiting for execution to start...</span>}
            </div>
        </div>
    );
};

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowBuilder
// ─────────────────────────────────────────────────────────────────────────────
function WorkflowBuilderInner() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { showNotification } = useNotification();
    const reactFlowWrapper = useRef(null);
    const updateNodeInternals = useUpdateNodeInternals();

    const [workflow, setWorkflow] = useState(null);
    const [nodeTypes, setNodeTypes] = useState([]);
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
    const [selectedNodeId, setSelectedNodeId] = useState(null);
    const selectedNode = nodes.find(n => n.id === selectedNodeId) || null;
    const [saving, setSaving] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [testMode, setTestMode] = useState(false);
    const [testExecutionId, setTestExecutionId] = useState(null);
    const [showTestModal, setShowTestModal] = useState(false);
    const [testLeadId, setTestLeadId] = useState('');
    const [isDraggingNode, setIsDraggingNode] = useState(false);

    // Load node types + workflow data on mount
    useEffect(() => {
        const loadData = async () => {
            try {
                const [ntRes, wfRes] = await Promise.all([
                    api.get('/workflows/node-types'),
                    id !== 'new' ? api.get(`/workflows/${id}`) : Promise.resolve(null)
                ]);
                setNodeTypes(ntRes.data.nodeTypes || []);

                if (wfRes) {
                    const { workflow: wf, layout } = wfRes.data;
                    setWorkflow(wf);

                    // Build React Flow nodes from workflow.nodes + layout.nodePositions
                    const positions = layout?.nodePositions || {};
                    const rfNodes = [
                        // Trigger node (always first)
                        {
                            id: 'trigger',
                            type: 'trigger',
                            position: positions['trigger'] || { x: 350, y: 80 },
                            data: { trigger: wf.trigger, label: getTriggerLabel(wf.trigger) }
                        },
                        // Action/Logic nodes
                        ...(wf.nodes || []).map(n => ({
                            id: n.id,
                            type: getReactFlowType(n.type),
                            position: positions[n.id] || { x: 350, y: 250 },
                            data: {
                                nodeType: n.type, label: n.name || n.type,
                                config: n.data || {},
                                icon: ntRes.data.nodeTypes?.find(nt => nt.type === n.type)?.icon,
                                category: ntRes.data.nodeTypes?.find(nt => nt.type === n.type)?.category,
                                ports: ntRes.data.nodeTypes?.find(nt => nt.type === n.type)?.ports
                            }
                        }))
                    ];
                    setNodes(rfNodes);

                    // Build React Flow edges from workflow.connections
                    const rfEdges = (wf.connections || []).map(c => ({
                        id: c.id,
                        source: c.sourceNodeId,
                        sourceHandle: c.sourcePort || 'output',
                        target: c.targetNodeId,
                        targetHandle: c.targetPort || 'input',
                        type: 'workflow',
                        data: { label: c.label || '', onDelete: removeEdge }
                    }));
                    setEdges(rfEdges);

                    if (layout?.viewport) setViewport(layout.viewport);
                } else {
                    // New workflow
                    setWorkflow({ name: 'Untitled Workflow', trigger: 'LEAD_CREATED', status: 'draft', nodes: [], connections: [] });
                    setNodes([{
                        id: 'trigger',
                        type: 'trigger',
                        position: { x: 350, y: 80 },
                        data: { trigger: 'LEAD_CREATED', label: 'Lead Created' }
                    }]);
                }
            } catch (err) {
                showNotification('error', 'Failed to load workflow');
            }
        };
        loadData();
    }, [id]);

    const getTriggerLabel = (trigger) => {
        const labels = {
            LEAD_CREATED: 'Lead Created', STAGE_CHANGED: 'Stage Changed',
            WHATSAPP_REPLY: 'WhatsApp Reply', VOICE_CALL_FINISHED: 'Voice Call Finished',
            APPOINTMENT_BOOKED: 'Appointment Booked', WEBHOOK_RECEIVED: 'Webhook Received',
            MANUAL_TRIGGER: 'Manual Trigger', SCHEDULED_TRIGGER: 'Scheduled'
        };
        return labels[trigger] || trigger;
    };

    const getReactFlowType = (nodeType) => {
        if (nodeType === 'condition') return 'condition';
        if (nodeType === 'wait') return 'wait';
        return 'action';
    };

    // ── Graph event handlers ────────────────────────────────────────────────
    const onNodesChange = useCallback(changes => setNodes(ns => applyNodeChanges(changes, ns)), []);
    const onEdgesChange = useCallback(changes => setEdges(es => applyEdgeChanges(changes, es)), []);

    const onConnect = useCallback(params => {
        setEdges(es => addEdge({
            ...params,
            type: 'workflow',
            data: { label: '', onDelete: removeEdge }
        }, es));
    }, []);

    const removeEdge = useCallback((edgeId) => {
        setEdges(es => es.filter(e => e.id !== edgeId));
    }, []);

    const onNodeClick = useCallback((_, node) => {
        setSelectedNodeId(node.id);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNodeId(null);
    }, []);

    // ── Drag-and-drop node from NodePanel ───────────────────────────────────
    const onDragOver = useCallback((e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    }, []);

    const onDrop = useCallback((e) => {
        e.preventDefault();
        const nodeTypeStr = e.dataTransfer.getData('application/workflow-node');
        if (!nodeTypeStr) return;
        const nodeTypeMeta = JSON.parse(nodeTypeStr);

        const bounds = reactFlowWrapper.current.getBoundingClientRect();
        const position = {
            x: (e.clientX - bounds.left - viewport.x) / viewport.zoom - 95,
            y: (e.clientY - bounds.top  - viewport.y) / viewport.zoom - 30
        };

        const newNode = {
            id:   `node-${Date.now()}`,
            type: getReactFlowType(nodeTypeMeta.type),
            position,
            data: {
                nodeType: nodeTypeMeta.type,
                label:    nodeTypeMeta.name,
                config:   {},
                icon:     nodeTypeMeta.icon,
                category: nodeTypeMeta.category,
                ports:    nodeTypeMeta.ports
            }
        };
        setNodes(ns => [...ns, newNode]);
    }, [viewport]);

    // ── Update node config from ConfigSidebar ───────────────────────────────
    const handleUpdateNode = useCallback((nodeId, config, label) => {
        setNodes(ns => ns.map(n => {
            if (n.id !== nodeId) return n;
            const newData = { ...n.data, config };
            if (label !== undefined) newData.label = label;
            return { ...n, data: newData };
        }));
        setTimeout(() => updateNodeInternals(nodeId), 0);
    }, [updateNodeInternals]);

    const handleDeleteNode = useCallback((nodeId) => {
        if (nodeId === 'trigger') return; // Cannot delete trigger node
        setNodes(ns => ns.filter(n => n.id !== nodeId));
        setEdges(es => es.filter(e => e.source !== nodeId && e.target !== nodeId));
        setSelectedNodeId(null);
    }, []);

    const handleUpdateTrigger = useCallback((trigger) => {
        setWorkflow(wf => ({ ...wf, trigger }));
        setNodes(ns => ns.map(n => n.id === 'trigger' ? { ...n, data: { ...n.data, trigger, label: getTriggerLabel(trigger) } } : n));
    }, []);

    const handleUpdateTriggerConfig = useCallback((config) => {
        setWorkflow(wf => ({ ...wf, triggerConfig: { ...wf.triggerConfig, ...config } }));
    }, []);

    // ── Serialize React Flow state back to API format ───────────────────────
    const serializeWorkflow = () => {
        const nonTriggerNodes = nodes.filter(n => n.id !== 'trigger');
        const wfNodes = nonTriggerNodes.map(n => ({
            id:   n.id,
            type: n.data.nodeType,
            name: n.data.label || n.data.nodeType,
            data: n.data.config || {}
        }));
        const wfConnections = edges.map(e => ({
            id:           e.id,
            sourceNodeId: e.source,
            sourcePort:   e.sourceHandle || 'output',
            targetNodeId: e.target,
            targetPort:   e.targetHandle || 'input',
            label:        e.data?.label || ''
        }));
        const positions = {};
        nodes.forEach(n => { positions[n.id] = n.position; });
        return { wfNodes, wfConnections, positions };
    };

    // ── Save ───────────────────────────────────────────────────────────────
    const handleSave = async () => {
        setSaving(true);
        try {
            const { wfNodes, wfConnections, positions } = serializeWorkflow();
            const payload = {
                name:        workflow.name,
                trigger:     workflow.trigger,
                triggerConfig: workflow.triggerConfig || {},
                nodes:       wfNodes,
                connections: wfConnections
            };
            let savedWorkflow;
            if (!workflow._id) {
                const res = await api.post('/workflows', { ...payload, layout: { nodePositions: positions, viewport } });
                savedWorkflow = res.data.workflow;
                navigate(`/workflows/${savedWorkflow._id}/builder`, { replace: true });
            } else {
                const res = await api.put(`/workflows/${workflow._id}`, payload);
                await api.put(`/workflows/${workflow._id}/layout`, { nodePositions: positions, viewport });
                savedWorkflow = res.data.workflow || { ...workflow, ...payload };
            }
            setWorkflow(w => ({ ...w, ...savedWorkflow }));
            showNotification('success', 'Workflow saved');
            return savedWorkflow;
        } catch (err) {
            showNotification('error', err.response?.data?.message || 'Failed to save workflow');
            throw err;
        } finally {
            setSaving(false);
        }
    };

    // ── Publish ─────────────────────────────────────────────────────────────
    const handlePublish = async () => {
        setPublishing(true);
        try {
            const savedWorkflow = await handleSave();
            const workflowId = savedWorkflow?._id || workflow?._id;
            if (!workflowId) throw new Error('Save workflow before publishing');
            const res = await api.post(`/workflows/${workflowId}/publish`);
            setWorkflow(w => ({ ...w, ...(res.data.workflow || savedWorkflow), status: 'published' }));
            showNotification('success', 'Workflow published! It will now execute automatically.');
        } catch (err) {
            showNotification('error', err.response?.data?.message || err.message || 'Publish failed');
        } finally {
            setPublishing(false);
        }
    };

    // ── Test Run ────────────────────────────────────────────────────────────
    const handleTestRun = async () => {
        if (!testLeadId.trim()) return showNotification('error', 'Enter a Lead ID to test with');
        try {
            const savedWorkflow = workflow?.status === 'published' ? workflow : await handleSave();
            const workflowId = savedWorkflow?._id || workflow?._id;
            if (!workflowId) throw new Error('Save workflow before testing');
            const res = await api.post(`/workflows/${workflowId}/test`, { leadId: testLeadId });
            setTestExecutionId(res.data.executionId);
            setTestMode(true);
            setShowTestModal(false);
            showNotification('success', 'Test run started — watch the debugger below');
        } catch (err) {
            showNotification('error', err.response?.data?.message || err.message || 'Test run failed');
        }
    };

    const statusColors = { draft: '#F59E0B', published: '#22C55E', archived: '#94A3B8', disabled: '#EF4444' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#F8FAFC', fontFamily: "'Inter', sans-serif" }}>
            {/* ── Toolbar ── */}
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0 20px', height: 56, background: '#fff', borderBottom: '1.5px solid #E2E8F0',
                flexShrink: 0, zIndex: 10
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button onClick={() => navigate('/workflows')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', fontSize: 18, padding: '4px 8px', borderRadius: 6 }}>
                        <i className="fa-solid fa-arrow-left" />
                    </button>
                    <input
                        value={workflow?.name || ''}
                        onChange={e => setWorkflow(w => ({ ...w, name: e.target.value }))}
                        style={{ fontSize: 16, fontWeight: 700, color: '#1E293B', border: 'none', outline: 'none', background: 'transparent', minWidth: 200 }}
                        placeholder="Workflow Name"
                    />
                    {workflow?.status && (
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: statusColors[workflow.status] + '22', color: statusColors[workflow.status] }}>
                            {workflow.status.toUpperCase()}
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button onClick={() => setShowTestModal(true)} style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: '#64748B', fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <i className="fa-solid fa-play" style={{ fontSize: 10 }} /> Test Run
                    </button>
                    <button onClick={handleSave} disabled={saving || workflow?.status === 'published'} style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', color: workflow?.status === 'published' ? '#94A3B8' : '#1E293B', fontSize: 13, fontWeight: 600, cursor: workflow?.status === 'published' ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {saving ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-floppy-disk" />} Save
                    </button>
                    <button onClick={handlePublish} disabled={publishing || workflow?.status === 'published'} style={{
                        padding: '7px 16px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        background: workflow?.status === 'published' ? '#F0FDF4' : 'linear-gradient(135deg,#3B82F6,#6366F1)',
                        color: workflow?.status === 'published' ? '#22C55E' : '#fff',
                        display: 'flex', alignItems: 'center', gap: 6, opacity: publishing ? 0.7 : 1
                    }}>
                        {publishing ? <i className="fa-solid fa-spinner fa-spin" /> : <i className={workflow?.status === 'published' ? 'fa-solid fa-check' : 'fa-solid fa-rocket'} />}
                        {workflow?.status === 'published' ? 'Published' : 'Publish'}
                    </button>
                </div>
            </div>

            {/* ── Main area: NodePanel + Canvas + ConfigSidebar ── */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative' }}>
                {workflow?.status === 'published' && (
                    <div style={{ background: '#FEF3C7', color: '#92400E', padding: '8px 20px', fontSize: 13, fontWeight: 600, textAlign: 'center', borderBottom: '1px solid #FCD34D' }}>
                        <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: 6 }} />
                        This workflow is published. You must unpublish to edit nodes.
                    </div>
                )}
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
                {/* Left: Node Panel */}
                <NodePanel nodeTypes={nodeTypes} />

                {/* Center: React Flow Canvas */}
                <div ref={reactFlowWrapper} style={{ flex: 1, position: 'relative' }} onDragOver={onDragOver} onDrop={onDrop}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onPaneClick={onPaneClick}
                        onMove={(_, vp) => setViewport(vp)}
                        nodeTypes={NODE_TYPES}
                        edgeTypes={EDGE_TYPES}
                        defaultViewport={viewport}
                        fitView={!workflow?._id}
                        deleteKeyCode="Delete"
                        style={{ background: '#F1F5F9' }}
                    >
                        <Background color="#CBD5E1" gap={20} size={1} />
                        <Controls style={{ bottom: testMode ? 210 : 20 }} />
                        <MiniMap
                            nodeColor={(n) => n.type === 'trigger' ? '#3B82F6' : n.type === 'condition' ? '#F59E0B' : n.type === 'wait' ? '#F97316' : '#8B5CF6'}
                            style={{ bottom: testMode ? 220 : 30 }}
                        />
                    </ReactFlow>

                    {/* Empty state */}
                    {nodes.length <= 1 && (
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', pointerEvents: 'none' }}>
                            <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.3 }}>🔧</div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: '#94A3B8' }}>Drag nodes from the left panel to build your workflow</div>
                            <div style={{ fontSize: 13, color: '#CBD5E1', marginTop: 4 }}>Connect them to define the execution flow</div>
                        </div>
                    )}

                    {/* Execution Debugger */}
                    {testMode && <ExecutionDebugger executionId={testExecutionId} />}
                </div>

                {/* Right: Config Sidebar */}
                {selectedNode && (
                    <ConfigSidebar
                        selectedNode={selectedNode}
                        nodeTypes={nodeTypes}
                        workflow={workflow}
                        onUpdateNode={handleUpdateNode}
                        onDeleteNode={handleDeleteNode}
                        onUpdateTrigger={handleUpdateTrigger}
                        onUpdateTriggerConfig={handleUpdateTriggerConfig}
                        onClose={() => setSelectedNodeId(null)}
                    />
                )}
                </div>
            </div>

            {/* ── Test Modal ── */}
            {showTestModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                        <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#1E293B' }}>🧪 Test Run</h3>
                        <p style={{ fontSize: 13, color: '#64748B', margin: '0 0 20px' }}>Select a lead to run this workflow against. The workflow will execute in test mode.</p>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#64748B', marginBottom: 6 }}>Lead ID</label>
                        <input
                            type="text"
                            value={testLeadId}
                            onChange={e => setTestLeadId(e.target.value)}
                            placeholder="Paste a Lead ID from the CRM..."
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1.5px solid #E2E8F0', fontSize: 13, outline: 'none', boxSizing: 'border-box', marginBottom: 16 }}
                        />
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => setShowTestModal(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1.5px solid #E2E8F0', background: '#fff', cursor: 'pointer', fontWeight: 600, color: '#64748B' }}>Cancel</button>
                            <button onClick={handleTestRun} style={{ flex: 1, padding: '10px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#3B82F6,#6366F1)', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>
                                <i className="fa-solid fa-play" style={{ marginRight: 6 }} /> Start Test
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default function WorkflowBuilder() {
    return (
        <ReactFlowProvider>
            <WorkflowBuilderInner />
        </ReactFlowProvider>
    );
}
