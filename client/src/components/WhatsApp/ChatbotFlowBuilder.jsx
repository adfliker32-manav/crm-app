/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
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
import SmartLeadSettingsModal from './SmartLeadSettingsModal';

// --- Custom Node Implementation ---
const CompactFlowNode = ({ data, id, selected }) => {
    const type = data.blockType || 'message';
    const icon = {
        message: '💬', media: '🖼️', list: '📋', product: '🛍️', products: '🛒', template: '📄', handoff: '👤', start: '🚀', question: '❓', action: '⚙️'
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
    const [flow, setFlow] = useState({ name: 'New Flow', description: '', isActive: false, triggerType: 'keyword', triggerKeywords: [] });
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [selectedNode, setSelectedNode] = useState(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [approvedTemplates, setApprovedTemplates] = useState([]);
    const flowVariables = useMemo(() => nodes
        .filter((node) => node.type === 'question' && node.data?.variableName)
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
        list: CompactFlowNode,
        product: CompactFlowNode,
        products: CompactFlowNode,
        template: CompactFlowNode,
        handoff: CompactFlowNode,
        question: CompactFlowNode,
        action: CompactFlowNode,
        start: CompactFlowNode // Fallback for old custom types
    }), []);

    const contentBlocks = [
        { type: 'message', icon: '💬', label: 'Text + Buttons', desc: 'Send text with button options' },
        { type: 'question', icon: '❓', label: 'Ask Question', desc: 'Ask user and save answer as variable' },
        { type: 'media', icon: '🖼️', label: 'Media', desc: 'Send image, video, or file' },
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
            question: { text: 'What is your email address?', variableName: 'email', expectedType: 'email' },
            media: { text: 'Check out this!', mediaUrl: 'https://via.placeholder.com/300x200/e74c3c/ffffff?text=Product' },
            product: { text: 'Premium Backpack', price: '$89.99', image: 'https://via.placeholder.com/150/e74c3c/ffffff?text=Product' },
            list: { text: 'Choose a category:', items: ['Electronics', 'Fashion', 'Home'] },
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
                {selectedNode ? (
                    <div className="w-72 bg-white border-l border-slate-200 overflow-y-auto shadow-lg z-10">
                        <div className="p-4">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-base font-bold text-slate-800">Edit Node</h3>
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
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Initial Status</label>
                                                    <input
                                                        value={selectedNode.data.actionData?.status || 'New'}
                                                        onChange={(e) => updateSelectedActionData({ status: e.target.value })}
                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm shadow-sm"
                                                        placeholder="New"
                                                    />
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
                                        <option value="first_message">First Message Ever (New Contacts)</option>
                                        <option value="existing_contact_message">Any Message (Existing Contacts Only)</option>
                                        <option value="any_message">Any Message (All Contacts)</option>
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
