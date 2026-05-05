/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    ReactFlow,
    Controls,
    MiniMap,
    Background,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge,
    Handle,
    Position,
    ReactFlowProvider,
    BaseEdge,
    EdgeLabelRenderer,
    getSmoothStepPath,
    reconnectEdge
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import SmartLeadSettingsModal from './SmartLeadSettingsModal';

// --- Custom Deletable + Reconnectable Edge ---
const DeletableEdge = ({
    id, sourceX, sourceY, targetX, targetY,
    sourcePosition, targetPosition, style = {}, markerEnd, data
}) => {
    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX, sourceY, sourcePosition,
        targetX, targetY, targetPosition
    });
    return (
        <>
            <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
            <EdgeLabelRenderer>
                <div
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        pointerEvents: 'all',
                        zIndex: 10
                    }}
                    className="nodrag nopan"
                >
                    <button
                        onClick={() => data?.onDelete(id)}
                        title="Break connection"
                        style={{
                            width: 20, height: 20,
                            borderRadius: '50%',
                            background: '#ef4444',
                            color: '#fff',
                            border: '2px solid #fff',
                            fontSize: 10,
                            lineHeight: 1,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 1px 4px rgba(0,0,0,0.25)'
                        }}
                    >✕</button>
                </div>
            </EdgeLabelRenderer>
        </>
    );
};

// --- Custom Node Implementation ---
const CompactFlowNode = ({ data, id, selected }) => {
    const type = data.blockType || 'message';
    const icon = {
        message: '💬', media: '🖼️', request_media: '📸', list: '📋', product: '🛍️', products: '🛒', template: '📄', handoff: '👤', start: '🚀', question: '❓', action: '⚙️', delay: '⏱️', condition: '🔀'
    }[type] || '💬';

    return (
        <div className={`w-64 bg-white rounded-xl shadow-sm border-2 transition-all ${selected ? 'border-teal-500 shadow-md ring-2 ring-teal-500/20' : 'border-slate-200 hover:border-teal-300'}`}>
            {/* Input Handle */}
            {type !== 'start' && (
                <Handle type="target" position={Position.Left} className="w-4 h-4 bg-slate-300 border-2 border-white -ml-2" />
            )}
            
            {/* Node Header */}
            <div className="bg-slate-50 border-b border-slate-100 px-3 py-2 rounded-t-xl flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-sm">{icon}</span>
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">{type}</span>
                </div>
            </div>

            {/* Node Body */}
            <div className="p-3">
                {/* Special visual for delay nodes */}
                {type === 'delay' ? (
                    <div className="flex flex-col items-center justify-center py-3 gap-1">
                        <span className="text-3xl">⏱️</span>
                        <span className="text-sm font-bold text-amber-600">
                            {data.delayDuration || 1} {data.delayUnit || 'hours'}
                        </span>
                        <span className="text-[10px] text-slate-400">Flow pauses here, then continues</span>
                    </div>
                ) : type === 'condition' ? (
                    <div className="space-y-1.5">
                        {(data.conditions || []).map((cond, i) => (
                            <div key={cond.id || i} className="relative flex items-center bg-violet-50 border border-violet-200 rounded-md py-1.5 px-2.5 text-[11px] font-semibold text-violet-700 pr-6">
                                <span className="text-violet-400 mr-1.5">IF</span>
                                <span className="truncate">{cond.variable || '?'} {cond.operator?.replace('_', ' ')} {cond.value || ''}</span>
                                <Handle
                                    type="source"
                                    position={Position.Right}
                                    id={cond.id}
                                    style={{ right: -8, top: '50%', transform: 'translateY(-50%)', width: '12px', height: '12px' }}
                                    className="bg-violet-500 border-2 border-white absolute cursor-crosshair"
                                />
                            </div>
                        ))}
                        <div className="relative flex items-center bg-slate-100 border border-slate-300 rounded-md py-1.5 px-2.5 text-[11px] font-semibold text-slate-500 pr-6">
                            <span className="text-slate-400 mr-1.5">ELSE</span>
                            <span>Default path</span>
                            <Handle
                                type="source"
                                position={Position.Right}
                                id="else"
                                style={{ right: -8, top: '50%', transform: 'translateY(-50%)', width: '12px', height: '12px' }}
                                className="bg-slate-400 border-2 border-white absolute cursor-crosshair"
                            />
                        </div>
                    </div>
                ) : (
                    <>
                        <p className="text-sm text-slate-600 mb-2 line-clamp-3 whitespace-pre-wrap leading-snug">
                            {data.text || `Configure ${type} block...`}
                        </p>

                        {/* Content Previews */}
                        {type === 'media' && data.mediaUrl && (
                            <div className="h-24 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center overflow-hidden mb-2">
                                <img src={data.mediaUrl} alt="media" className="object-cover w-full h-full opacity-80" />
                            </div>
                        )}

                        {data.buttons && data.buttons.length > 0 && (
                            <div className="mt-2 space-y-1.5 flex flex-col">
                                {data.buttons.map((btn, i) => (
                                    <div key={i} className="relative w-full bg-blue-50/50 border border-blue-100 text-blue-700 py-1.5 px-3 rounded-md text-[11px] font-semibold text-center truncate">
                                        {btn.text}
                                        <Handle 
                                            type="source" 
                                            position={Position.Right} 
                                            id={btn.id}
                                            style={{ right: -8, top: '50%', transform: 'translateY(-50%)', width: '12px', height: '12px' }}
                                            className="bg-blue-500 border-2 border-white absolute cursor-crosshair"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Output Handle — not shown for handoff, button nodes, condition nodes (use their own handles) */}
            {type !== 'handoff' && type !== 'condition' && (!data.buttons || data.buttons.length === 0) && (
                <Handle type="source" position={Position.Right} className="w-4 h-4 bg-teal-500 border-2 border-white -mr-2" />
            )}
        </div>
    );
};

// --- Main Component ---
const FlowBuilder = ({ flowId, onBack }) => {
    const { showSuccess, showError } = useNotification();
    const [flow, setFlow] = useState({ name: 'New Flow', description: '', isActive: false, triggerType: 'keyword', triggerKeywords: [] });
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [approvedTemplates, setApprovedTemplates] = useState([]);
    const [reactFlowReady, setReactFlowReady] = useState(false);
    const reactFlowRef = useRef(null);
    const didInitialFitViewRef = useRef(false);
    const flowVariables = useMemo(() => nodes
        .filter((node) => (node.type === 'question' || node.type === 'request_media') && node.data?.variableName)
        .map((node) => node.data.variableName)
        .filter(Boolean), [nodes]);

    // Fetch approved WhatsApp templates for Template node selector
    useEffect(() => {
        api.get('/whatsapp/templates?status=APPROVED')
            .then(res => setApprovedTemplates(res.data.templates || []))
            .catch(err => console.error('Failed to fetch approved templates:', err));
    }, []);

    const nodeTypes = useMemo(() => ({
        message: CompactFlowNode,
        media: CompactFlowNode,
        request_media: CompactFlowNode,
        list: CompactFlowNode,
        product: CompactFlowNode,
        products: CompactFlowNode,
        template: CompactFlowNode,
        handoff: CompactFlowNode,
        question: CompactFlowNode,
        action: CompactFlowNode,
        delay: CompactFlowNode,
        condition: CompactFlowNode,
        start: CompactFlowNode // Fallback for old custom types
    }), []);

    const deleteEdge = useCallback((edgeId) => {
        setEdges((eds) => {
            const edgeToRemove = eds.find(e => e.id === edgeId);
            if (edgeToRemove) {
                // Clear nextNodeId on the source node data when an edge is deleted
                setNodes((nds) => nds.map(n => {
                    if (n.id !== edgeToRemove.source) return n;
                    if (edgeToRemove.sourceHandle && n.data.buttons) {
                        const newButtons = n.data.buttons.map(btn =>
                            btn.id === edgeToRemove.sourceHandle ? { ...btn, nextNodeId: undefined } : btn
                        );
                        return { ...n, data: { ...n.data, buttons: newButtons } };
                    }
                    return { ...n, data: { ...n.data, nextNodeId: undefined } };
                }));
            }
            return eds.filter(e => e.id !== edgeId);
        });
    }, []);

    const edgeTypes = useMemo(() => ({ deletable: DeletableEdge }), []);

    // Build edges with the custom type + delete callback injected into data
    const enrichedEdges = useMemo(() =>
        edges.map(e => ({
            ...e,
            type: 'deletable',
            data: { ...e.data, onDelete: deleteEdge },
            style: { stroke: '#0d9488', strokeWidth: 2.5 },
            animated: true
        })),
    [edges, deleteEdge]);

    const contentBlocks = [
        { type: 'message', icon: '💬', label: 'Text + Buttons', desc: 'Send text with button options' },
        { type: 'question', icon: '❓', label: 'Ask Question', desc: 'Ask user and save answer as variable' },
        { type: 'delay', icon: '⏱️', label: 'Time Delay', desc: 'Wait before sending next message' },
        { type: 'condition', icon: '🔀', label: 'IF / ELSE', desc: 'Route flow based on a condition' },
        { type: 'media', icon: '🖼️', label: 'Send Media', desc: 'Send image, video, or file' },
        { type: 'request_media', icon: '📸', label: 'Request Media', desc: 'Ask user to upload a file' },
        { type: 'list', icon: '📋', label: 'List', desc: 'Interactive list menu' },
        { type: 'product', icon: '🛍️', label: 'Single Product', desc: 'Show one product' },
        { type: 'products', icon: '🛒', label: 'Multi Product', desc: 'Show product catalog' },
        { type: 'template', icon: '📄', label: 'Template', desc: 'Use message template' },
        { type: 'action', icon: '⚙️', label: 'Lead Action', desc: 'Create lead or update CRM fields' },
        { type: 'handoff', icon: '👤', label: 'Request Intervention', desc: 'Transfer to agent' }
    ];

    useEffect(() => {
        if (flowId && flowId !== 'new') {
            fetchFlow();
        } else {
            // New Flow defaults
            setNodes([{
                id: 'start-1',
                type: 'message',
                position: { x: 250, y: 100 },
                data: {
                    blockType: 'message',
                    text: 'Welcome! 👋\n\nHow can I help you today?',
                    buttons: [{ text: 'Browse Products', id: 'browse' }, { text: 'Track Order', id: 'track' }]
                }
            }]);
            setEdges([]);
            setLoading(false);
        }
    }, [flowId]);

    const fetchFlow = async () => {
        try {
            const res = await api.get(`/chatbot/flows/${flowId}`);
            setFlow(res.data.flow);
            
            // Map existing DB nodes to React Flow format safely
            const dbNodes = res.data.flow.nodes || [];

            const safeNumber = (value, fallback = 0) => {
                const numberValue = typeof value === 'number' ? value : Number(value);
                return Number.isFinite(numberValue) ? numberValue : fallback;
            };

            const mappedNodes = dbNodes.map((n, index) => {
                const safePosition = {
                    x: safeNumber(n?.position?.x, 250 + (index * 50)),
                    y: safeNumber(n?.position?.y, 100 + (index * 50))
                };

                return ({
                    ...n,
                    // Ensure DB node types map to our registered types, passing the original type to data
                    type: n.type,
                    position: safePosition,
                    data: { ...n.data, blockType: n.type }
                });
            });
            
            setNodes(mappedNodes);

            const dbEdges = res.data.flow.edges || [];
            const mappedEdges = dbEdges
                .map((e, index) => {
                    const source = e?.source;
                    const target = e?.target;
                    if (!source || !target) return null;

                    const safeId = e?.id || `e-${source}-${e?.sourceHandle || 'd'}-${target}-${e?.targetHandle || 'd'}-${index}`;

                    return {
                        ...e,
                        id: String(safeId),
                        source: String(source),
                        target: String(target)
                    };
                })
                .filter(Boolean);

            setEdges(mappedEdges);
            didInitialFitViewRef.current = false;
        } catch (error) {
            showError('Failed to load flow');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Guard against the "blank canvas" scenario when a bad viewport or invalid positions sneak in.
        if (!reactFlowRef.current) return;
        if (didInitialFitViewRef.current) return;
        if (!nodes || nodes.length === 0) return;

        // Defer until nodes are measured.
        const id = setTimeout(() => {
            try {
                reactFlowRef.current?.fitView?.({ padding: 0.25, includeHiddenNodes: true });
                didInitialFitViewRef.current = true;
            } catch (e) {
                // no-op: fitView can throw if instance is not ready yet
            }
        }, 0);

        return () => clearTimeout(id);
    }, [nodes, reactFlowReady]);

    const handleSave = async () => {
        if (!flow.name || !flow.name.trim()) {
            showError('Please enter a flow name');
            return;
        }

        setSaving(true);
        try {
            // Sync visual edges back onto the node data the backend reads.
            // The chatbot engine navigates via button.nextNodeId for buttons and
            // node.data.nextNodeId for non-branching nodes — onConnect tries to
            // keep these in sync as edges are drawn, but resaving the flow with
            // a fresh derivation from `edges` removes any drift introduced by
            // edge deletions, button renames, or out-of-order updates.
            // Use `null` (not `undefined`) for cleared values — JSON.stringify drops
            // undefined keys, so undefined-to-clear leaves the previous value intact
            // on the Mongoose-side merge, leading to dangling references.
            const syncedNodes = nodes.map(n => {
                let nextData = { ...n.data };

                if (Array.isArray(nextData.buttons) && nextData.buttons.length > 0) {
                    nextData.buttons = nextData.buttons.map(btn => {
                        const edge = edges.find(e => e.source === n.id && e.sourceHandle === btn.id);
                        return edge ? { ...btn, nextNodeId: edge.target } : { ...btn, nextNodeId: null };
                    });
                }

                // Condition node: sync each IF branch nextNodeId from edges (sourceHandle = cond.id),
                // and the ELSE path nextNodeId from the edge with sourceHandle = 'else'
                if (Array.isArray(nextData.conditions) && nextData.conditions.length > 0) {
                    nextData.conditions = nextData.conditions.map(cond => {
                        const edge = edges.find(e => e.source === n.id && e.sourceHandle === cond.id);
                        return edge ? { ...cond, nextNodeId: edge.target } : { ...cond, nextNodeId: null };
                    });
                    // ELSE path
                    const elseEdge = edges.find(e => e.source === n.id && e.sourceHandle === 'else');
                    nextData.nextNodeId = elseEdge ? elseEdge.target : null;
                }

                // Default outgoing edge (non-button, non-condition source) → node.data.nextNodeId
                // IMPORTANT: condition nodes already set nextNodeId above (ELSE path) — skip this block for them
                if (nextData.blockType !== 'condition') {
                    const defaultEdge = edges.find(e => e.source === n.id && !e.sourceHandle);
                    if (defaultEdge) {
                        nextData.nextNodeId = defaultEdge.target;
                    } else if (!Array.isArray(nextData.buttons) || nextData.buttons.length === 0) {
                        nextData.nextNodeId = null;
                    }
                }

                return { ...n, data: nextData };
            });

            const payload = { ...flow, nodes: syncedNodes, edges, startNodeId: syncedNodes[0]?.id };

            if (flowId && flowId !== 'new') {
                await api.put(`/chatbot/flows/${flowId}`, payload);
                showSuccess('Flow updated successfully');
            } else {
                await api.post('/chatbot/flows', payload);
                showSuccess('Flow created successfully');
            }
            onBack();
        } catch (error) {
            showError('Failed to save flow');
        } finally {
            setSaving(false);
        }
    };

    const onNodesChange = useCallback((changes) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
    }, []);

    const onEdgesChange = useCallback((changes) => {
        const removedEdges = changes.filter(c => c.type === 'remove');
        if (removedEdges.length > 0) {
            setEdges((eds) => {
                const edgesToRemove = removedEdges.map(r => eds.find(e => e.id === r.id)).filter(Boolean);
                if (edgesToRemove.length > 0) {
                    setNodes((nds) => nds.map(n => {
                        const affectedEdge = edgesToRemove.find(e => e.source === n.id);
                        if (!affectedEdge) return n;
                        if (affectedEdge.sourceHandle && n.data.buttons) {
                            const newButtons = n.data.buttons.map(btn =>
                                btn.id === affectedEdge.sourceHandle ? { ...btn, nextNodeId: undefined } : btn
                            );
                            return { ...n, data: { ...n.data, buttons: newButtons } };
                        } else {
                            return { ...n, data: { ...n.data, nextNodeId: undefined } };
                        }
                    }));
                }
                return applyEdgeChanges(changes, eds);
            });
        } else {
            setEdges((eds) => applyEdgeChanges(changes, eds));
        }
    }, []);

    const onConnect = useCallback((connection) => {
        setEdges((eds) => addEdge(connection, eds));
        
        // Map standard DB requirement -> `nextNodeId` on source node data OR specific button
        setNodes((nds) => nds.map(n => {
            if (n.id === connection.source) {
                if (connection.sourceHandle && n.data.buttons) {
                    // Edge originated from a specific button handle
                    const newButtons = n.data.buttons.map(btn => 
                        btn.id === connection.sourceHandle ? { ...btn, nextNodeId: connection.target } : btn
                    );
                    return { ...n, data: { ...n.data, buttons: newButtons } };
                } else {
                    // Edge originated from the general node handle
                    return { ...n, data: { ...n.data, nextNodeId: connection.target } };
                }
            }
            return n;
        }));
    }, []);

    const onNodeClick = useCallback((_, node) => {
        setSelectedNode(node);
    }, []);

    const onPaneClick = useCallback(() => {
        setSelectedNode(null);
    }, []);

    const addNode = (type) => {
        const templates = {
            message: { text: 'Hello! How can I help?', buttons: [{ text: 'Continue', id: 'next' }] },
            question: { text: 'What is your email address?', variableName: 'email', expectedType: 'email' },
            delay: { text: 'Time Delay', delayDuration: 2, delayUnit: 'hours', delaySeconds: 7200 },
            condition: { text: 'IF / ELSE Condition', conditions: [{ id: `cond-${Date.now()}`, variable: '', operator: 'equals', value: '', nextNodeId: null }] },
            media: { text: 'Check out this!', mediaType: 'image', mediaUrl: '' },
            request_media: { text: 'Please upload your document or photo to continue.', variableName: 'media', acceptedMediaTypes: ['image', 'video', 'document'], attachToLead: false },
            product: { text: 'Premium Backpack', price: '$89.99', image: '' },
            products: { text: 'Browse our catalog:', productList: [{ name: 'Product 1', price: '$0.00', image: '' }] },
            list: { text: 'Choose a category:', buttonText: 'View Options', items: [{ id: 'item_0', title: 'Electronics', description: '' }, { id: 'item_1', title: 'Fashion', description: '' }, { id: 'item_2', title: 'Home & Living', description: '' }] },
            template: { text: 'Send approved template', templateName: '', templateLanguage: 'en' },
            action: { text: 'Action: Create Lead', actionType: 'create_lead', actionData: { source: 'WhatsApp Chatbot', status: 'New' } },
            handoff: { text: 'Connecting you to an agent...' }
        };

        const newNode = {
            id: `${type}-${Date.now()}`,
            type: type,
            position: { x: 250 + (nodes.length * 50), y: 150 + (nodes.length * 50) },
            data: { ...templates[type], blockType: type }
        };
        
        setNodes((nds) => [...nds, newNode]);
        setSelectedNode(newNode);
    };

    const updateSelectedNodeData = (updates) => {
        if (!selectedNode) return;
        setNodes((nds) => nds.map(n => {
            if (n.id === selectedNode.id) {
                const updatedNode = { ...n, data: { ...n.data, ...updates } };
                setSelectedNode(updatedNode);
                return updatedNode;
            }
            return n;
        }));
    };

    const updateSelectedActionData = (updates) => {
        if (!selectedNode) return;
        updateSelectedNodeData({
            actionData: {
                ...(selectedNode.data.actionData || {}),
                ...updates
            }
        });
    };

    const deleteSelectedNode = () => {
        if (!selectedNode) return;
        setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
        setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
        setSelectedNode(null);
    };

    const duplicateSelectedNode = () => {
        if (!selectedNode) return;
        const newId = `${selectedNode.type}-${Date.now()}`;
        const duplicated = {
            ...selectedNode,
            id: newId,
            position: {
                x: selectedNode.position.x + 280,
                y: selectedNode.position.y + 40
            },
            selected: false,
            data: {
                ...selectedNode.data,
                // Deep-clone buttons array with fresh IDs so handles are unique
                buttons: selectedNode.data.buttons
                    ? selectedNode.data.buttons.map(btn => ({
                        ...btn,
                        id: `${btn.id}-copy-${Date.now()}`,
                        nextNodeId: null
                    }))
                    : undefined
            }
        };
        setNodes((nds) => [...nds, duplicated]);
        setSelectedNode(duplicated);
    };

    const onReconnect = useCallback((oldEdge, newConnection) => {
        setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
        // Update node data for the reconnected edge
        setNodes((nds) => nds.map(n => {
            if (n.id === newConnection.source) {
                if (newConnection.sourceHandle && n.data.buttons) {
                    const newButtons = n.data.buttons.map(btn =>
                        btn.id === newConnection.sourceHandle ? { ...btn, nextNodeId: newConnection.target } : btn
                    );
                    return { ...n, data: { ...n.data, buttons: newButtons } };
                }
                return { ...n, data: { ...n.data, nextNodeId: newConnection.target } };
            }
            return n;
        }));
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-slate-50">
                <div className="w-16 h-16 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header Toolbar */}
            <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition">
                        <i className="fa-solid fa-arrow-left text-slate-600"></i>
                    </button>
                    <input
                        type="text"
                        value={flow.name}
                        onChange={(e) => setFlow({ ...flow, name: e.target.value })}
                        className="text-xl font-bold text-slate-800 border-none focus:ring-2 focus:ring-teal-500 rounded px-2 py-1 w-64"
                        placeholder="Flow Name"
                    />
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowSettingsModal(true)}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition shadow-sm border border-slate-200"
                    >
                        <i className="fa-solid fa-gear mr-2"></i> Smart Settings
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition disabled:opacity-50 shadow-sm"
                    >
                        {saving ? 'Saving...' : 'Save Flow'}
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Left Sidebar - Blocks Array */}
                <div className="w-56 bg-slate-50 border-r border-slate-200 overflow-y-auto shadow-sm z-10 relative">
                    <div className="p-3">
                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-3">Add Content</h3>
                        <div className="space-y-2">
                            {contentBlocks.map(block => (
                                <button
                                    key={block.type}
                                    onClick={() => addNode(block.type)}
                                    className="w-full p-2.5 bg-white hover:bg-teal-50 rounded-lg text-left transition border border-slate-200 hover:border-teal-400 shadow-sm group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="text-xl group-hover:scale-110 transition-transform">{block.icon}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-xs text-slate-800">{block.label}</div>
                                            <div className="text-[10px] text-slate-500 truncate leading-snug mt-0.5">{block.desc}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Main React Flow Canvas */}
                <div className="flex-1 relative bg-slate-50">
                    <ReactFlow
                        nodes={nodes}
                        edges={enrichedEdges}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onReconnect={onReconnect}
                        onReconnectStart={() => {}}
                        onReconnectEnd={() => {}}
                        onNodeClick={onNodeClick}
                        onPaneClick={onPaneClick}
                        reconnectRadius={20}
                        fitView
                        className="bg-slate-100"
                        defaultEdgeOptions={{ type: 'deletable', animated: true, style: { stroke: '#0d9488', strokeWidth: 2.5 } }}
                        onInit={(instance) => {
                            reactFlowRef.current = instance;
                            setReactFlowReady(true);
                        }}
                    >
                        <Background color="#94a3b8" gap={20} size={1.5} />
                        <Controls className="bg-white shadow-lg border border-slate-200 rounded-lg overflow-hidden flex-col" />
                        <MiniMap
                            position="top-right"
                            pannable
                            zoomable
                            maskColor="rgba(15, 23, 42, 0.08)"
                            className="!m-3 !w-[160px] !h-[120px] !rounded-lg !border !border-slate-200 !shadow-lg !bg-white"
                        />
                    </ReactFlow>
                </div>

                {/* Right Sidebar - Properties Editor */}
                {selectedNode ? (
                    <div className="w-72 bg-white border-l border-slate-200 overflow-y-auto shadow-lg z-10">
                        <div className="p-4">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-base font-bold text-slate-800">Edit Node</h3>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={duplicateSelectedNode}
                                        title="Duplicate Node"
                                        className="text-teal-600 hover:bg-teal-50 p-2 rounded-lg transition"
                                    >
                                        <i className="fa-regular fa-copy"></i>
                                    </button>
                                    <button onClick={deleteSelectedNode} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition" title="Delete Node">
                                        <i className="fa-solid fa-trash"></i>
                                    </button>
                                </div>
                            </div>
                            
                            <div className="space-y-5">
                                {selectedNode.data.blockType !== 'delay' && (
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Message Text</label>
                                    <textarea
                                        value={selectedNode.data.text || ''}
                                        onChange={(e) => updateSelectedNodeData({ text: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 shadow-sm bg-slate-50"
                                        rows="4"
                                        placeholder="Type your message here..."
                                    />
                                </div>
                                )}

                                {selectedNode.data.blockType === 'message' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                        <label className="block text-sm font-semibold text-slate-700 mb-3">Interactive Buttons</label>
                                        {selectedNode.data.buttons?.map((btn, i) => (
                                            <div key={i} className="flex gap-2 mb-2">
                                                <input
                                                    value={btn.text}
                                                    onChange={(e) => {
                                                        const newButtons = [...selectedNode.data.buttons];
                                                        newButtons[i].text = e.target.value;
                                                        updateSelectedNodeData({ buttons: newButtons });
                                                    }}
                                                    className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                    placeholder="Button Label"
                                                />
                                                <button 
                                                    onClick={() => {
                                                        const newButtons = selectedNode.data.buttons.filter((_, idx) => idx !== i);
                                                        updateSelectedNodeData({ buttons: newButtons });
                                                    }}
                                                    className="w-10 h-10 flex items-center justify-center bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition"
                                                >
                                                    <i className="fa-solid fa-times"></i>
                                                </button>
                                            </div>
                                        ))}
                                        {(!selectedNode.data.buttons || selectedNode.data.buttons.length < 3) && (
                                            <button
                                                onClick={() => {
                                                    const newButtons = [...(selectedNode.data.buttons || []), { text: 'New Button', id: `btn-${Date.now()}` }];
                                                    updateSelectedNodeData({ buttons: newButtons });
                                                }}
                                                className="w-full mt-2 py-2 border-2 border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 hover:border-teal-400 rounded-lg font-medium text-sm transition flex items-center justify-center gap-2"
                                            >
                                                <i className="fa-solid fa-plus"></i> Add Button
                                            </button>
                                        )}
                                        <p className="text-xs text-slate-400 mt-2 text-center">Max 3 buttons allowed by WhatsApp</p>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'question' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4">
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Save Answer As Variable</label>
                                        <input
                                            value={selectedNode.data.variableName || ''}
                                            onChange={(e) => updateSelectedNodeData({ variableName: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3 shadow-sm focus:ring-2 focus:ring-teal-500"
                                            placeholder="e.g., email, company_name, phone"
                                        />
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Expected Input Type</label>
                                        <select
                                            value={selectedNode.data.expectedType || 'any'}
                                            onChange={(e) => updateSelectedNodeData({ expectedType: e.target.value })}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                        >
                                            <option value="any">Any text</option>
                                            <option value="text">Letters only</option>
                                            <option value="number">Number</option>
                                            <option value="email">Email address</option>
                                            <option value="phone">Phone number</option>
                                        </select>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'media' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4 space-y-3">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Media Type</label>
                                            <select
                                                value={selectedNode.data.mediaType || 'image'}
                                                onChange={(e) => updateSelectedNodeData({ mediaType: e.target.value })}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                            >
                                                <option value="image">Image</option>
                                                <option value="video">Video</option>
                                                <option value="document">Document</option>
                                                <option value="audio">Audio</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Media URL (HTTPS)</label>
                                            <input
                                                value={selectedNode.data.mediaUrl || ''}
                                                onChange={(e) => updateSelectedNodeData({ mediaUrl: e.target.value, mediaId: '' })}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                                placeholder="https://example.com/photo.jpg"
                                            />
                                            <p className="text-[11px] text-slate-500 mt-1">Must be a publicly accessible HTTPS URL.</p>
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">— or — Meta Media ID</label>
                                            <input
                                                value={selectedNode.data.mediaId || ''}
                                                onChange={(e) => updateSelectedNodeData({ mediaId: e.target.value, mediaUrl: '' })}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                                placeholder="e.g., 1234567890"
                                            />
                                            <p className="text-[11px] text-slate-500 mt-1">Use either a public URL or a Meta-uploaded media ID, not both.</p>
                                        </div>
                                        <p className="text-[11px] text-slate-500">Caption: use the &ldquo;Message Text&rdquo; field above.</p>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'request_media' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4 space-y-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Save Upload As Variable</label>
                                            <input
                                                value={selectedNode.data.variableName || ''}
                                                onChange={(e) => updateSelectedNodeData({ variableName: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                                placeholder="e.g., id_proof, invoice_photo"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Accepted File Types</label>
                                            <div className="space-y-1.5">
                                                {['image', 'video', 'document', 'audio'].map(t => {
                                                    const accepted = selectedNode.data.acceptedMediaTypes || ['image', 'video', 'document'];
                                                    const checked = accepted.includes(t);
                                                    return (
                                                        <label key={t} className="flex items-center gap-2 text-sm capitalize">
                                                            <input
                                                                type="checkbox"
                                                                checked={checked}
                                                                onChange={(e) => {
                                                                    const next = e.target.checked
                                                                        ? [...accepted, t]
                                                                        : accepted.filter(x => x !== t);
                                                                    updateSelectedNodeData({ acceptedMediaTypes: next });
                                                                }}
                                                                className="w-4 h-4"
                                                            />
                                                            {t}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                        <label className="flex items-center gap-2 text-sm">
                                            <input
                                                type="checkbox"
                                                checked={!!selectedNode.data.attachToLead}
                                                onChange={(e) => updateSelectedNodeData({ attachToLead: e.target.checked })}
                                                className="w-4 h-4"
                                            />
                                            <span className="font-medium text-slate-700">Attach upload to lead record</span>
                                        </label>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'action' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 mt-4 space-y-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Action Type</label>
                                            <select
                                                value={selectedNode.data.actionType || 'create_lead'}
                                                onChange={(e) => {
                                                    const nextType = e.target.value;
                                                    const nextTextMap = {
                                                        create_lead: 'Action: Create Lead',
                                                        update_field: 'Action: Update Lead Field',
                                                        assign_tag: 'Action: Assign Tag',
                                                        change_stage: 'Action: Change Stage',
                                                        notify_agent: 'Action: Notify Agent',
                                                        send_email: 'Action: Send Email'
                                                    };

                                                    updateSelectedNodeData({
                                                        actionType: nextType,
                                                        text: nextTextMap[nextType] || 'Action Node',
                                                        actionData: {}
                                                    });
                                                }}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                            >
                                                <option value="create_lead">Create Lead</option>
                                                <option value="update_field">Update Lead Field</option>
                                                <option value="assign_tag">Assign Tag</option>
                                                <option value="change_stage">Change Lead Stage</option>
                                                <option value="notify_agent">Notify Agent</option>
                                                <option value="send_email">Send Email</option>
                                            </select>
                                        </div>

                                        {selectedNode.data.actionType === 'create_lead' && (
                                            <div className="space-y-3">
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs font-bold text-slate-600 mb-1">Lead Source</label>
                                                        <input
                                                            value={selectedNode.data.actionData?.source || 'WhatsApp Chatbot'}
                                                            onChange={(e) => updateSelectedActionData({ source: e.target.value })}
                                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                            placeholder="WhatsApp Chatbot"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-slate-600 mb-1">Lead Stage</label>
                                                        <select
                                                            value={selectedNode.data.actionData?.status || 'New'}
                                                            onChange={(e) => updateSelectedActionData({ status: e.target.value })}
                                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                                        >
                                                            <option value="New">New</option>
                                                            <option value="Contacted">Contacted</option>
                                                            <option value="Interested">Interested</option>
                                                            <option value="Qualified">Qualified</option>
                                                            <option value="Proposal Sent">Proposal Sent</option>
                                                            <option value="Negotiation">Negotiation</option>
                                                            <option value="Won">Won</option>
                                                            <option value="Lost">Lost</option>
                                                            <option value="On Hold">On Hold</option>
                                                        </select>
                                                    </div>
                                                </div>
                                                {/* Upsert behaviour info */}
                                                <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
                                                    <i className="fa-solid fa-circle-info text-blue-500 mt-0.5 text-xs shrink-0"></i>
                                                    <p className="text-[11px] text-blue-700">
                                                        <strong>Smart Upsert:</strong> If this customer is already a lead, their stage will be updated to <em>{selectedNode.data.actionData?.status || 'New'}</em>. If not, a new lead is created in that stage.
                                                    </p>
                                                </div>
                                            </div>
                                        )}


                                        {selectedNode.data.actionType === 'update_field' && (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Lead Field Key</label>
                                                    <input
                                                        value={selectedNode.data.actionData?.fieldName || ''}
                                                        onChange={(e) => updateSelectedActionData({ fieldName: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                        placeholder="budget, city, company_size"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Use Variable</label>
                                                    <select
                                                        value={selectedNode.data.actionData?.fromVariable || ''}
                                                        onChange={(e) => updateSelectedActionData({ fromVariable: e.target.value })}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                    >
                                                        <option value="">Select a saved answer</option>
                                                        {flowVariables.map((variable) => (
                                                            <option key={variable} value={variable}>{variable}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Fallback Static Value</label>
                                                    <input
                                                        value={selectedNode.data.actionData?.fieldValue || ''}
                                                        onChange={(e) => updateSelectedActionData({ fieldValue: e.target.value })}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                        placeholder="Used when no variable is selected"
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {selectedNode.data.actionType === 'assign_tag' && (
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 mb-1">Tag Name</label>
                                                <input
                                                    value={selectedNode.data.actionData?.tag || ''}
                                                    onChange={(e) => updateSelectedActionData({ tag: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                    placeholder="hot-lead"
                                                />
                                            </div>
                                        )}

                                        {selectedNode.data.actionType === 'change_stage' && (
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 mb-1">Lead Stage</label>
                                                <input
                                                    value={selectedNode.data.actionData?.stage || ''}
                                                    onChange={(e) => updateSelectedActionData({ stage: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                    placeholder="Qualified"
                                                />
                                            </div>
                                        )}

                                        {selectedNode.data.actionType === 'notify_agent' && (
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 mb-1">Notification Message</label>
                                                <textarea
                                                    value={selectedNode.data.actionData?.message || ''}
                                                    onChange={(e) => updateSelectedActionData({ message: e.target.value })}
                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                    rows="3"
                                                    placeholder="Chatbot needs agent attention for this conversation."
                                                />
                                            </div>
                                        )}

                                        {selectedNode.data.actionType === 'send_email' && (
                                            <div className="space-y-3">
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Send To</label>
                                                    <input
                                                        value={selectedNode.data.actionData?.to || ''}
                                                        onChange={(e) => updateSelectedActionData({ to: e.target.value })}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                        placeholder="{{email}} or fallback@example.com"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Email Subject</label>
                                                    <input
                                                        value={selectedNode.data.actionData?.subject || ''}
                                                        onChange={(e) => updateSelectedActionData({ subject: e.target.value })}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                        placeholder="Thanks for chatting with us"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Email Body</label>
                                                    <textarea
                                                        value={selectedNode.data.actionData?.body || ''}
                                                        onChange={(e) => updateSelectedActionData({ body: e.target.value })}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                        rows="4"
                                                        placeholder="Use variables like {{name}} or {{email}}"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'list' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Button Label <span className="text-slate-400 font-normal text-xs">(opens the list)</span></label>
                                            <input
                                                value={selectedNode.data.buttonText || 'View Options'}
                                                onChange={(e) => updateSelectedNodeData({ buttonText: e.target.value.slice(0, 20) })}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                                placeholder="View Options"
                                                maxLength={20}
                                            />
                                            <p className="text-xs text-slate-400 mt-1">Max 20 characters (WhatsApp limit)</p>
                                        </div>
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <label className="text-sm font-semibold text-slate-700">List Items</label>
                                                <span className="text-xs text-slate-400">{(selectedNode.data.items || []).length}/10</span>
                                            </div>
                                            {(selectedNode.data.items || []).map((item, i) => {
                                                const itemObj = typeof item === 'string' ? { id: `item_${i}`, title: item, description: '' } : item;
                                                return (
                                                    <div key={itemObj.id || i} className="mb-3 bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                                                        <div className="flex gap-2 items-center">
                                                            <span className="text-xs font-bold text-slate-400 w-5 shrink-0">#{i + 1}</span>
                                                            <input
                                                                value={itemObj.title || ''}
                                                                onChange={(e) => {
                                                                    const newItems = (selectedNode.data.items || []).map((it, idx) => {
                                                                        if (idx !== i) return it;
                                                                        const obj = typeof it === 'string' ? { id: `item_${idx}`, title: it, description: '' } : { ...it };
                                                                        obj.title = e.target.value.slice(0, 24);
                                                                        return obj;
                                                                    });
                                                                    updateSelectedNodeData({ items: newItems });
                                                                }}
                                                                className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm shadow-sm focus:ring-1 focus:ring-teal-500"
                                                                placeholder="Item title (max 24)"
                                                                maxLength={24}
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const newItems = (selectedNode.data.items || []).filter((_, idx) => idx !== i);
                                                                    updateSelectedNodeData({ items: newItems });
                                                                }}
                                                                className="w-7 h-7 flex items-center justify-center bg-red-100 text-red-500 rounded hover:bg-red-200 transition shrink-0"
                                                            >
                                                                <i className="fa-solid fa-times text-xs"></i>
                                                            </button>
                                                        </div>
                                                        <input
                                                            value={itemObj.description || ''}
                                                            onChange={(e) => {
                                                                const newItems = (selectedNode.data.items || []).map((it, idx) => {
                                                                    if (idx !== i) return it;
                                                                    const obj = typeof it === 'string' ? { id: `item_${idx}`, title: it, description: '' } : { ...it };
                                                                    obj.description = e.target.value.slice(0, 72);
                                                                    return obj;
                                                                });
                                                                updateSelectedNodeData({ items: newItems });
                                                            }}
                                                            className="w-full px-2 py-1.5 border border-slate-200 rounded text-xs text-slate-500 shadow-sm focus:ring-1 focus:ring-teal-400 bg-slate-50 ml-7"
                                                            placeholder="Optional description (max 72)"
                                                            maxLength={72}
                                                        />
                                                    </div>
                                                );
                                            })}
                                            {(selectedNode.data.items || []).length < 10 && (
                                                <button
                                                    onClick={() => {
                                                        const newItem = { id: `item_${Date.now()}`, title: '', description: '' };
                                                        updateSelectedNodeData({ items: [...(selectedNode.data.items || []), newItem] });
                                                    }}
                                                    className="w-full mt-1 py-2 border-2 border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 hover:border-teal-400 rounded-lg font-medium text-sm transition flex items-center justify-center gap-2"
                                                >
                                                    <i className="fa-solid fa-plus"></i> Add Item
                                                </button>
                                            )}
                                            <p className="text-xs text-slate-400 mt-2 text-center">Max 10 items · Each title max 24 chars</p>
                                        </div>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'product' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Product Details</p>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Price</label>
                                            <input
                                                value={selectedNode.data.price || ''}
                                                onChange={(e) => updateSelectedNodeData({ price: e.target.value })}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                                placeholder="e.g. $89.99"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Image URL</label>
                                            <input
                                                value={selectedNode.data.image || ''}
                                                onChange={(e) => updateSelectedNodeData({ image: e.target.value })}
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                                placeholder="https://example.com/product.jpg"
                                            />
                                            {selectedNode.data.image && (
                                                <img
                                                    src={selectedNode.data.image}
                                                    alt="preview"
                                                    className="mt-2 w-full rounded-lg border border-slate-200 max-h-32 object-cover"
                                                    onError={(e) => { e.target.style.display = 'none'; }}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'products' && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <p className="text-sm font-semibold text-slate-700">Product Catalog</p>
                                            <span className="text-xs text-slate-400">{(selectedNode.data.productList || []).length} item(s)</span>
                                        </div>
                                        {(selectedNode.data.productList || []).map((prod, i) => (
                                            <div key={i} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2">
                                                <div className="flex gap-2 items-center">
                                                    <span className="text-xs font-bold text-slate-400 w-5 shrink-0">#{i + 1}</span>
                                                    <input
                                                        value={prod.name || ''}
                                                        onChange={(e) => {
                                                            const list = [...(selectedNode.data.productList || [])];
                                                            list[i] = { ...list[i], name: e.target.value };
                                                            updateSelectedNodeData({ productList: list });
                                                        }}
                                                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded text-sm shadow-sm focus:ring-1 focus:ring-teal-500"
                                                        placeholder="Product name"
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            const list = (selectedNode.data.productList || []).filter((_, idx) => idx !== i);
                                                            updateSelectedNodeData({ productList: list });
                                                        }}
                                                        className="w-7 h-7 flex items-center justify-center bg-red-100 text-red-500 rounded hover:bg-red-200 transition shrink-0"
                                                    >
                                                        <i className="fa-solid fa-times text-xs"></i>
                                                    </button>
                                                </div>
                                                <div className="flex gap-2 ml-7">
                                                    <input
                                                        value={prod.price || ''}
                                                        onChange={(e) => {
                                                            const list = [...(selectedNode.data.productList || [])];
                                                            list[i] = { ...list[i], price: e.target.value };
                                                            updateSelectedNodeData({ productList: list });
                                                        }}
                                                        className="w-24 px-2 py-1.5 border border-slate-200 rounded text-xs shadow-sm focus:ring-1 focus:ring-teal-400 bg-slate-50"
                                                        placeholder="Price"
                                                    />
                                                    <input
                                                        value={prod.image || ''}
                                                        onChange={(e) => {
                                                            const list = [...(selectedNode.data.productList || [])];
                                                            list[i] = { ...list[i], image: e.target.value };
                                                            updateSelectedNodeData({ productList: list });
                                                        }}
                                                        className="flex-1 px-2 py-1.5 border border-slate-200 rounded text-xs shadow-sm focus:ring-1 focus:ring-teal-400 bg-slate-50"
                                                        placeholder="Image URL"
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => {
                                                const list = [...(selectedNode.data.productList || []), { name: '', price: '', image: '' }];
                                                updateSelectedNodeData({ productList: list });
                                            }}
                                            className="w-full py-2 border-2 border-dashed border-teal-300 text-teal-600 hover:bg-teal-50 hover:border-teal-400 rounded-lg font-medium text-sm transition flex items-center justify-center gap-2"
                                        >
                                            <i className="fa-solid fa-plus"></i> Add Product
                                        </button>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'handoff' && (
                                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-200 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <span className="text-lg">👤</span>
                                            <span className="text-sm font-bold text-blue-700">Human Handoff</span>
                                        </div>
                                        <p className="text-xs text-blue-600">The message above is sent to the user, then the chatbot pauses for 24 hours so a live agent can take over.</p>
                                        <p className="text-xs text-blue-500">The assigned agent receives a real-time notification to join the conversation.</p>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'delay' && (
                                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-200 mt-4 space-y-4">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className="text-xl">⏱️</span>
                                            <span className="text-sm font-bold text-amber-700">Time Delay</span>
                                        </div>
                                        <p className="text-xs text-amber-600">
                                            Flow pauses here for the configured time, then automatically continues to the next node.
                                        </p>
                                        <div className="flex gap-3 items-end">
                                            <div className="flex-1">
                                                <label className="block text-sm font-semibold text-slate-700 mb-2">Wait Duration</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="999"
                                                    value={selectedNode.data.delayDuration || 2}
                                                    onChange={(e) => {
                                                        const duration = Math.max(1, parseInt(e.target.value) || 1);
                                                        const unit = selectedNode.data.delayUnit || 'hours';
                                                        const secs = { minutes: 60, hours: 3600, days: 86400 };
                                                        updateSelectedNodeData({ delayDuration: duration, delaySeconds: duration * (secs[unit] || 3600), text: `Wait ${duration} ${unit}` });
                                                    }}
                                                    className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-amber-400 bg-white font-bold text-center text-lg"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <label className="block text-sm font-semibold text-slate-700 mb-2">Unit</label>
                                                <select
                                                    value={selectedNode.data.delayUnit || 'hours'}
                                                    onChange={(e) => {
                                                        const unit = e.target.value;
                                                        const duration = selectedNode.data.delayDuration || 2;
                                                        const secs = { minutes: 60, hours: 3600, days: 86400 };
                                                        updateSelectedNodeData({ delayUnit: unit, delaySeconds: duration * (secs[unit] || 3600), text: `Wait ${duration} ${unit}` });
                                                    }}
                                                    className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-amber-400 bg-white"
                                                >
                                                    <option value="minutes">Minutes</option>
                                                    <option value="hours">Hours</option>
                                                    <option value="days">Days</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 text-center">
                                            <span className="text-sm font-bold text-amber-800">
                                                ⏳ Pauses for {selectedNode.data.delayDuration || 2} {selectedNode.data.delayUnit || 'hours'}
                                            </span>
                                            <p className="text-[11px] text-amber-600 mt-0.5">= {selectedNode.data.delaySeconds || 7200} seconds</p>
                                        </div>
                                        <div className="bg-white border border-amber-200 rounded-lg p-3">
                                            <p className="text-xs text-slate-500 font-semibold mb-1">💡 Example use cases:</p>
                                            <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
                                                <li>Wait 2 hours → "Did you read the PDF?"</li>
                                                <li>Wait 1 day → Send a follow-up offer</li>
                                                <li>Wait 30 minutes → Check if user needs help</li>
                                            </ul>
                                        </div>
                                        {/* ── Cancel-if-replied toggle ─────────────────────── */}
                                        <div className="bg-white border border-amber-200 rounded-lg p-3 space-y-2">
                                            <label className="flex items-start gap-3 cursor-pointer group">
                                                <div className="relative mt-0.5 shrink-0">
                                                    <input
                                                        type="checkbox"
                                                        className="sr-only peer"
                                                        checked={selectedNode.data.cancelIfReplied !== false}
                                                        onChange={(e) => updateSelectedNodeData({ cancelIfReplied: e.target.checked })}
                                                    />
                                                    <div className="w-9 h-5 rounded-full bg-slate-200 peer-checked:bg-teal-500 transition-colors duration-200"></div>
                                                    <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow peer-checked:translate-x-4 transition-transform duration-200"></div>
                                                </div>
                                                <div>
                                                    <p className="text-xs font-bold text-slate-700 group-hover:text-teal-700 transition-colors">Cancel if customer replies</p>
                                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                                        If the customer sends any message during this wait window, the scheduled message will be skipped. The flow still continues from the next node.
                                                    </p>
                                                </div>
                                            </label>
                                            {selectedNode.data.cancelIfReplied !== false ? (
                                                <div className="flex items-center gap-1.5 text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-2 py-1.5">
                                                    <i className="fa-solid fa-shield-check text-teal-500"></i>
                                                    <span><strong>Smart mode ON</strong> - bot stays quiet if the customer is already engaged.</span>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-1.5 text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded-md px-2 py-1.5">
                                                    <i className="fa-solid fa-clock text-orange-500"></i>
                                                    <span><strong>Always send</strong> - message fires after the timer regardless of customer replies.</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'condition' && (
                                    <div className="bg-violet-50 p-4 rounded-xl border border-violet-200 mt-4 space-y-4">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xl">🔀</span>
                                            <span className="text-sm font-bold text-violet-700">IF / ELSE Conditions</span>
                                        </div>
                                        <p className="text-xs text-violet-600">
                                            Each <strong>IF branch</strong> checks a captured variable. Draw an edge from its right-side handle to the target node. The <strong>ELSE</strong> handle catches everything else.
                                        </p>

                                        {/* Condition rows */}
                                        <div className="space-y-3">
                                            {(selectedNode.data.conditions || []).map((cond, i) => (
                                                <div key={cond.id} className="bg-white border border-violet-200 rounded-lg p-3 space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-bold text-violet-500 uppercase tracking-wider">IF Branch {i + 1}</span>
                                                        {(selectedNode.data.conditions || []).length > 1 && (
                                                            <button
                                                                onClick={() => {
                                                                    const newConds = selectedNode.data.conditions.filter((_, idx) => idx !== i);
                                                                    updateSelectedNodeData({ conditions: newConds });
                                                                }}
                                                                className="text-red-400 hover:text-red-600 text-xs font-bold transition"
                                                                title="Remove this branch"
                                                            >✕ Remove</button>
                                                        )}
                                                    </div>
                                                    {/* Variable */}
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Variable (captured answer)</label>
                                                        <select
                                                            value={cond.variable || ''}
                                                            onChange={(e) => {
                                                                const newConds = [...selectedNode.data.conditions];
                                                                newConds[i] = { ...newConds[i], variable: e.target.value };
                                                                updateSelectedNodeData({ conditions: newConds });
                                                            }}
                                                            className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs shadow-sm focus:ring-2 focus:ring-violet-400 bg-white"
                                                        >
                                                            <option value="">-- select variable --</option>
                                                            {flowVariables.map(v => (
                                                                <option key={v} value={v}>{v}</option>
                                                            ))}
                                                            {/* Common meta-variables */}
                                                            {['lead_status', 'lead_source', 'lead_tags'].map(v => (
                                                                <option key={v} value={v}>📌 {v}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    {/* Operator */}
                                                    <div>
                                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Condition</label>
                                                        <select
                                                            value={cond.operator || 'equals'}
                                                            onChange={(e) => {
                                                                const newConds = [...selectedNode.data.conditions];
                                                                newConds[i] = { ...newConds[i], operator: e.target.value };
                                                                updateSelectedNodeData({ conditions: newConds });
                                                            }}
                                                            className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs shadow-sm focus:ring-2 focus:ring-violet-400 bg-white"
                                                        >
                                                            <option value="equals">= equals</option>
                                                            <option value="not_equals">≠ not equals</option>
                                                            <option value="contains">contains</option>
                                                            <option value="not_contains">does not contain</option>
                                                            <option value="starts_with">starts with</option>
                                                            <option value="ends_with">ends with</option>
                                                            <option value="greater_than">&gt; greater than</option>
                                                            <option value="less_than">&lt; less than</option>
                                                            <option value="is_set">is set (any value)</option>
                                                            <option value="is_empty">is empty / not answered</option>
                                                        </select>
                                                    </div>
                                                    {/* Value (hidden for is_set / is_empty) */}
                                                    {!['is_set', 'is_empty'].includes(cond.operator) && (
                                                        <div>
                                                            <label className="block text-xs font-semibold text-slate-600 mb-1">Value to compare</label>
                                                            <input
                                                                type="text"
                                                                value={cond.value || ''}
                                                                onChange={(e) => {
                                                                    const newConds = [...selectedNode.data.conditions];
                                                                    newConds[i] = { ...newConds[i], value: e.target.value };
                                                                    updateSelectedNodeData({ conditions: newConds });
                                                                }}
                                                                className="w-full px-2 py-1.5 border border-slate-300 rounded-md text-xs shadow-sm focus:ring-2 focus:ring-violet-400"
                                                                placeholder="e.g. Qualified, yes, 10000"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>

                                        {/* Add condition button — max 5 branches */}
                                        {(selectedNode.data.conditions || []).length < 5 && (
                                            <button
                                                onClick={() => {
                                                    const newCond = { id: `cond-${Date.now()}`, variable: '', operator: 'equals', value: '', nextNodeId: null };
                                                    updateSelectedNodeData({ conditions: [...(selectedNode.data.conditions || []), newCond] });
                                                }}
                                                className="w-full py-2 border-2 border-dashed border-violet-300 text-violet-600 hover:bg-violet-50 hover:border-violet-400 rounded-lg font-medium text-xs transition flex items-center justify-center gap-2"
                                            >
                                                <i className="fa-solid fa-plus"></i> Add IF Branch
                                            </button>
                                        )}

                                        <div className="bg-white border border-violet-100 rounded-lg p-3">
                                            <p className="text-xs text-slate-500 font-semibold mb-1">🔌 How to connect:</p>
                                            <ul className="text-xs text-slate-400 space-y-1 list-disc pl-4">
                                                <li>Draw from a <span className="text-violet-500 font-bold">purple IF handle</span> → next node</li>
                                                <li>Draw from the <span className="text-slate-500 font-bold">grey ELSE handle</span> → fallback node</li>
                                            </ul>
                                        </div>
                                    </div>
                                )}

                                {selectedNode.data.blockType === 'template' && (
                                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-200">
                                        <div className="flex items-center gap-2 mb-3">
                                            <i className="fa-solid fa-lock text-amber-500 text-xs"></i>
                                            <label className="block text-sm font-bold text-amber-700">Approved Template</label>
                                        </div>
                                        <p className="text-xs text-amber-600 mb-3">Only Meta-approved templates can be sent to users outside the 24-hour window.</p>
                                        <select
                                            value={selectedNode.data.templateName || ''}
                                            onChange={(e) => {
                                                const selected = approvedTemplates.find(t => t.name === e.target.value);
                                                updateSelectedNodeData({
                                                    templateName: e.target.value,
                                                    templateLanguage: selected?.language || selectedNode.data.templateLanguage || 'en',
                                                    text: selected ? `📄 Template: ${selected.name}` : 'Send approved template'
                                                });
                                            }}
                                            className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-amber-400 focus:border-amber-400 bg-white mb-3"
                                        >
                                            <option value="">— Select an approved template —</option>
                                            {approvedTemplates.map(t => (
                                                <option key={t._id} value={t.name}>{t.name} ({t.language || 'en'})</option>
                                            ))}
                                        </select>
                                        {approvedTemplates.length === 0 && (
                                            <p className="text-[11px] text-red-500 mb-2">
                                                <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                                                No approved templates found. Create and submit templates for Meta approval first.
                                            </p>
                                        )}
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Language</label>
                                        <select
                                            value={selectedNode.data.templateLanguage || 'en'}
                                            onChange={(e) => updateSelectedNodeData({ templateLanguage: e.target.value })}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500"
                                        >
                                            <option value="en">English</option>
                                            <option value="en_US">English (US)</option>
                                            <option value="hi">Hindi</option>
                                            <option value="ar">Arabic</option>
                                        </select>
                                        {selectedNode.data.templateName && (
                                            <div className="mt-3 p-2 bg-green-50 border border-green-200 rounded-lg">
                                                <p className="text-xs text-green-700 font-semibold">
                                                    <i className="fa-solid fa-check-circle mr-1"></i>
                                                    Selected: {selectedNode.data.templateName}
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="w-72 bg-white border-l border-slate-200 overflow-y-auto shadow-lg z-10">
                        <div className="p-4">
                            <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-100">
                                <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-500 flex items-center justify-center shadow-sm">
                                    <i className="fa-solid fa-bolt text-sm"></i>
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-slate-800">Flow Trigger</h3>
                                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">Configure start event</p>
                                </div>
                            </div>
                            
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Trigger Type</label>
                                    <select
                                        value={flow.triggerType || 'keyword'}
                                        onChange={(e) => setFlow({ ...flow, triggerType: e.target.value })}
                                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-teal-500 outline-none transition shadow-sm"
                                    >
                                        <option value="keyword">Specific Keywords</option>
                                        <option value="template_reply">Template Button Reply</option>
                                        <option value="first_message">First Message Ever (New Contacts)</option>
                                        <option value="existing_contact_message">Any Message (Existing Contacts Only)</option>
                                        <option value="any_message">Any Message (All Contacts)</option>
                                        <option value="meta_ad">Meta Ad (Click-to-WhatsApp)</option>
                                        <option value="manual">Manual / API Trigger</option>
                                    </select>
                                </div>

                                {(!flow.triggerType || flow.triggerType === 'keyword') && (
                                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                        <label className="block text-sm font-semibold text-slate-700 mb-2">Activation Keywords</label>
                                        <p className="text-xs text-slate-500 mb-3">Press Enter to add keywords</p>
                                        
                                        <div className="flex flex-wrap gap-2 mb-3">
                                            {(flow.triggerKeywords || []).map((kw, i) => (
                                                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-100 text-teal-700 text-xs font-semibold">
                                                    {kw}
                                                    <button
                                                        onClick={() => {
                                                            const newKws = flow.triggerKeywords.filter((_, idx) => idx !== i);
                                                            setFlow({ ...flow, triggerKeywords: newKws });
                                                        }}
                                                        className="hover:text-red-500 leading-none"
                                                    >&times;</button>
                                                </span>
                                            ))}
                                        </div>
                                        
                                        <input
                                            type="text"
                                            placeholder="Type keyword and press Enter..."
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm focus:ring-2 focus:ring-teal-500 outline-none"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    const val = e.target.value.trim().toLowerCase();
                                                    if (val && !(flow.triggerKeywords || []).includes(val)) {
                                                        setFlow({
                                                            ...flow, 
                                                            triggerKeywords: [...(flow.triggerKeywords || []), val]
                                                        });
                                                        e.target.value = '';
                                                    }
                                                }
                                            }}
                                            onBlur={(e) => {
                                                const val = e.target.value.trim().toLowerCase();
                                                if (val && !(flow.triggerKeywords || []).includes(val)) {
                                                    setFlow({
                                                        ...flow, 
                                                        triggerKeywords: [...(flow.triggerKeywords || []), val]
                                                    });
                                                    e.target.value = '';
                                                }
                                            }}
                                        />
                                    </div>
                                )}
                                
                                {flow.triggerType === 'first_message' && (
                                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-blue-700 text-sm">
                                        <i className="fa-solid fa-circle-info mr-2"></i>
                                        This flow will execute automatically when a completely new prospect messages this WhatsApp number for the very first time.
                                    </div>
                                )}

                                {flow.triggerType === 'existing_contact_message' && (
                                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 text-emerald-700 text-sm">
                                        <i className="fa-solid fa-circle-info mr-2"></i>
                                        This flow will execute whenever an existing customer/contact sends a new message today (assuming they aren't already in another active chatbot session).
                                    </div>
                                )}

                                {flow.triggerType === 'meta_ad' && (
                                    <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-200">
                                        <label className="block text-sm font-semibold text-indigo-900 mb-2">Meta Ad Headline</label>
                                        <p className="text-xs text-indigo-700 mb-3">
                                            Type the exact headline of your Facebook or Instagram Ad. This flow will trigger when a user clicks that specific ad.
                                        </p>
                                        <input
                                            type="text"
                                            placeholder="e.g. Summer Sale 2026 Offer"
                                            value={flow.triggerAdHeadline || ''}
                                            onChange={(e) => setFlow({ ...flow, triggerAdHeadline: e.target.value })}
                                            className="w-full px-3 py-2 border border-indigo-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                                        />
                                    </div>
                                )}

                                {flow.triggerType === 'template_reply' && (
                                    <div className="space-y-3">
                                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                                            <label className="block text-sm font-semibold text-slate-700 mb-2">Linked Template</label>
                                            <p className="text-xs text-slate-500 mb-3">Select the template whose button reply will start this flow</p>
                                            <select
                                                value={flow.triggerTemplateName || ''}
                                                onChange={(e) => {
                                                    const newTemplateName = e.target.value;
                                                    setFlow({ ...flow, triggerTemplateName: newTemplateName });
                                                    
                                                    if (newTemplateName) {
                                                        const tpl = approvedTemplates.find(t => t.name === newTemplateName);
                                                        if (tpl) {
                                                            let buttons = [];
                                                            tpl.components.forEach(comp => {
                                                                if (comp.type === 'BUTTONS') {
                                                                    comp.buttons.forEach((b, idx) => {
                                                                        if (b.type === 'QUICK_REPLY') {
                                                                            buttons.push({ id: `btn_${idx}`, text: b.text });
                                                                        }
                                                                    });
                                                                }
                                                            });
                                                            
                                                            setNodes(prev => {
                                                                const startNodeId = flow.startNodeId || 'start-1';
                                                                let newNodes = [...prev];
                                                                const startNodeIndex = newNodes.findIndex(n => n.id === startNodeId);
                                                                const templateNodeData = {
                                                                    blockType: 'template',
                                                                    templateName: newTemplateName,
                                                                    text: `Trigger: ${newTemplateName}`,
                                                                    buttons: buttons
                                                                };
                                                                
                                                                if (startNodeIndex >= 0) {
                                                                    newNodes[startNodeIndex] = { ...newNodes[startNodeIndex], type: 'template', data: templateNodeData };
                                                                } else {
                                                                    newNodes.push({ id: startNodeId, type: 'template', position: { x: 250, y: 100 }, data: templateNodeData });
                                                                }
                                                                return newNodes;
                                                            });
                                                        }
                                                    }
                                                }}
                                                className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500 outline-none transition shadow-sm"
                                            >
                                                <option value="">— Select an approved template —</option>
                                                {approvedTemplates.map(t => (
                                                    <option key={t._id} value={t.name}>{t.name} ({t.language || 'en'})</option>
                                                ))}
                                            </select>
                                            {approvedTemplates.length === 0 && (
                                                <p className="text-[11px] text-red-500 mt-2">
                                                    <i className="fa-solid fa-triangle-exclamation mr-1"></i>
                                                    No approved templates found. Create and submit templates for Meta approval first.
                                                </p>
                                            )}
                                        </div>
                                        <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 text-orange-700 text-sm">
                                            <i className="fa-solid fa-circle-info mr-2"></i>
                                            When this template is sent (via automation, broadcast, or manually) and the recipient taps any Quick Reply button, this chatbot flow will be triggered automatically.
                                        </div>
                                    </div>
                                )}

                                {flow.triggerType === 'any_message' && (
                                    <div className="bg-purple-50 p-4 rounded-xl border border-purple-100 text-purple-700 text-sm">
                                        <i className="fa-solid fa-circle-info mr-2"></i>
                                        This acts as a universal fallback flow. It will trigger for EVERY inbound message unless the user is already talking to an active menu or chatbot.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
            {showSettingsModal && (
                <SmartLeadSettingsModal 
                    settings={flow.smartLeadSettings}
                    flowNodes={nodes}
                    onSave={(newSettings) => {
                        setFlow({ ...flow, smartLeadSettings: newSettings });
                        setShowSettingsModal(false);
                    }}
                    onClose={() => setShowSettingsModal(false)}
                />
            )}
        </div>
    );
};

export default function ChatbotFlowBuilderWrapper(props) {
    return (
        <ReactFlowProvider>
            <FlowBuilder {...props} />
        </ReactFlowProvider>
    );
}


