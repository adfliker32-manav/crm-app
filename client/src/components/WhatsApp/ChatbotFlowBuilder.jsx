import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    ReactFlow,
    Controls,
    Background,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge,
    Handle,
    Position,
    ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// --- Custom Node Implementation ---
const CompactFlowNode = ({ data, id, selected }) => {
    const type = data.blockType || 'message';
    const icon = {
        message: '💬', media: '🖼️', list: '📋', product: '🛍️', products: '🛒', template: '📄', handoff: '👤', start: '🚀'
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
            </div>

            {/* Output Handle */}
            {type !== 'handoff' && (!data.buttons || data.buttons.length === 0) && (
                <Handle type="source" position={Position.Right} className="w-4 h-4 bg-teal-500 border-2 border-white -mr-2" />
            )}
        </div>
    );
};

// --- Main Component ---
const FlowBuilder = ({ flowId, onBack }) => {
    const { showSuccess, showError } = useNotification();
    const [flow, setFlow] = useState({ name: 'New Flow', description: '', isActive: false });
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);

    const nodeTypes = useMemo(() => ({
        message: CompactFlowNode,
        media: CompactFlowNode,
        list: CompactFlowNode,
        product: CompactFlowNode,
        products: CompactFlowNode,
        template: CompactFlowNode,
        handoff: CompactFlowNode,
        start: CompactFlowNode // Fallback for old custom types
    }), []);

    const contentBlocks = [
        { type: 'message', icon: '💬', label: 'Text + Buttons', desc: 'Send text with button options' },
        { type: 'media', icon: '🖼️', label: 'Media', desc: 'Send image, video, or file' },
        { type: 'list', icon: '📋', label: 'List', desc: 'Interactive list menu' },
        { type: 'product', icon: '🛍️', label: 'Single Product', desc: 'Show one product' },
        { type: 'products', icon: '🛒', label: 'Multi Product', desc: 'Show product catalog' },
        { type: 'template', icon: '📄', label: 'Template', desc: 'Use message template' },
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
            const mappedNodes = dbNodes.map(n => ({
                ...n,
                // Ensure custom DB node types map to our registered types, passing the original type to data
                type: n.type,
                data: { ...n.data, blockType: n.type }
            }));
            
            setNodes(mappedNodes);
            setEdges(res.data.flow.edges || []);
        } catch (error) {
            showError('Failed to load flow');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!flow.name || !flow.name.trim()) {
            showError('Please enter a flow name');
            return;
        }

        setSaving(true);
        try {
            const payload = { ...flow, nodes, edges, startNodeId: nodes[0]?.id };

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
        setEdges((eds) => applyEdgeChanges(changes, eds));
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
            media: { text: 'Check out this!', mediaUrl: 'https://via.placeholder.com/300x200/e74c3c/ffffff?text=Product' },
            product: { text: 'Premium Backpack', price: '$89.99', image: 'https://via.placeholder.com/150/e74c3c/ffffff?text=Product' },
            list: { text: 'Choose a category:', items: ['Electronics', 'Fashion', 'Home'] },
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

    const deleteSelectedNode = () => {
        if (!selectedNode) return;
        setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
        setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
        setSelectedNode(null);
    };

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
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center gap-4">
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
                <div className="w-72 bg-slate-50 border-r border-slate-200 overflow-y-auto shadow-sm z-10 relative">
                    <div className="p-4">
                        <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-4">Content Blocks</h3>
                        <div className="space-y-3">
                            {contentBlocks.map(block => (
                                <button
                                    key={block.type}
                                    onClick={() => addNode(block.type)}
                                    className="w-full p-4 bg-white hover:bg-teal-50 rounded-xl text-left transition border border-slate-200 hover:border-teal-400 shadow-sm group"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="text-3xl group-hover:scale-110 transition-transform">{block.icon}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold text-sm text-slate-800">{block.label}</div>
                                            <div className="text-xs text-slate-500 line-clamp-2 leading-snug mt-1">{block.desc}</div>
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
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        onNodeClick={onNodeClick}
                        onPaneClick={onPaneClick}
                        fitView
                        className="bg-slate-100"
                        defaultEdgeOptions={{ type: 'smoothstep', animated: true, style: { stroke: '#0d9488', strokeWidth: 2.5 } }}
                    >
                        <Background color="#94a3b8" gap={20} size={1.5} />
                        <Controls className="bg-white shadow-lg border border-slate-200 rounded-lg overflow-hidden flex-col" />
                    </ReactFlow>
                </div>

                {/* Right Sidebar - Properties Editor */}
                {selectedNode && (
                    <div className="w-80 bg-white border-l border-slate-200 overflow-y-auto shadow-lg z-10">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold text-slate-800">Edit Node</h3>
                                <button onClick={deleteSelectedNode} className="text-red-500 hover:bg-red-50 p-2 rounded-lg transition" title="Delete Node">
                                    <i className="fa-solid fa-trash"></i>
                                </button>
                            </div>
                            
                            <div className="space-y-5">
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
                            </div>
                        </div>
                    </div>
                )}
            </div>
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
