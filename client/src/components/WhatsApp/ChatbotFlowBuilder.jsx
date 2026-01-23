import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ChatbotFlowBuilder = ({ flowId, onBack }) => {
    const { showSuccess, showError } = useNotification();
    const canvasRef = useRef(null);
    const [flow, setFlow] = useState(null);
    const [nodes, setNodes] = useState([]);
    const [edges, setEdges] = useState([]);
    const [selectedNode, setSelectedNode] = useState(null);
    const [draggingNode, setDraggingNode] = useState(null);
    const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
    const [connecting, setConnecting] = useState(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [zoom, setZoom] = useState(0.8);
    const [pan, setPan] = useState({ x: 50, y: 50 });

    // Content blocks matching reference image
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
            setFlow({
                name: 'Ecommerce',
                description: '',
                triggerType: 'keyword',
                triggerKeywords: ['shop', 'buy'],
                isActive: false
            });
            setNodes([{
                id: 'start-1',
                type: 'message',
                position: { x: 100, y: 100 },
                data: {
                    text: 'Welcome! 👋\n\nHow can I help you today?',
                    buttons: [
                        { text: 'Browse Products', id: 'browse' },
                        { text: 'Track Order', id: 'track' }
                    ]
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
            setNodes(res.data.flow.nodes || []);
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
            type,
            position: { x: 150 + (nodes.length * 40), y: 150 + (nodes.length * 40) },
            data: templates[type] || { text: `New ${type}` }
        };
        setNodes([...nodes, newNode]);
        setSelectedNode(newNode);
    };

    const handleNodeMouseDown = (e, node) => {
        e.stopPropagation();
        setSelectedNode(node);
        setDraggingNode(node);
        const rect = e.currentTarget.getBoundingClientRect();
        setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    };

    const handleMouseMove = (e) => {
        if (draggingNode && canvasRef.current) {
            const rect = canvasRef.current.getBoundingClientRect();
            const newX = (e.clientX - rect.left - dragOffset.x - pan.x) / zoom;
            const newY = (e.clientY - rect.top - dragOffset.y - pan.y) / zoom;

            setNodes(nodes.map(n =>
                n.id === draggingNode.id ? { ...n, position: { x: Math.max(0, newX), y: Math.max(0, newY) } } : n
            ));
        }
    };

    const handleMouseUp = () => setDraggingNode(null);

    const deleteNode = (nodeId) => {
        if (window.confirm('Delete this node?')) {
            setNodes(nodes.filter(n => n.id !== nodeId));
            setEdges(edges.filter(e => e.source !== nodeId && e.target !== nodeId));
            setSelectedNode(null);
        }
    };

    const updateNodeData = (nodeId, data) => {
        setNodes(nodes.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n));
    };

    const startConnection = (nodeId) => setConnecting(nodeId);

    const completeConnection = (targetNodeId) => {
        if (connecting && connecting !== targetNodeId) {
            setEdges([...edges, { id: `edge-${Date.now()}`, source: connecting, target: targetNodeId }]);
            setNodes(nodes.map(n => n.id === connecting ? { ...n, data: { ...n.data, nextNodeId: targetNodeId } } : n));
        }
        setConnecting(null);
    };

    const deleteEdge = (edgeId) => setEdges(edges.filter(e => e.id !== edgeId));

    // Phone mockup node renderer
    const PhoneMockup = ({ node, isSelected }) => {
        const { type, data } = node;

        return (
            <div className={`relative transition-all duration-200 ${isSelected ? 'scale-105' : ''}`}>
                {/* iPhone Frame */}
                <div className="w-64 h-[480px] bg-gradient-to-b from-slate-800 to-slate-900 rounded-[2.5rem] p-3 shadow-2xl border-8 border-slate-800">
                    {/* Notch */}
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-slate-900 rounded-b-2xl"></div>

                    {/* Screen */}
                    <div className="w-full h-full bg-gradient-to-b from-slate-100 to-white rounded-[1.8rem] overflow-hidden relative">
                        {/* WhatsApp Header */}
                        <div className="bg-[#075e54] text-white px-4 py-3 flex items-center gap-3">
                            <div className="w-8 h-8 bg-white/20 rounded-full"></div>
                            <div className="flex-1">
                                <div className="font-semibold text-sm">Customer</div>
                                <div className="text-xs opacity-75">online</div>
                            </div>
                        </div>

                        {/* Messages */}
                        <div className="p-3 space-y-2 h-[calc(100%-60px)] overflow-y-auto bg-[#ece5dd]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h100v100H0z\' fill=\'%23ece5dd\'/%3E%3Cpath d=\'M20 20h60v60H20z\' fill=\'%23fff\' opacity=\'.05\'/%3E%3C/svg%3E")' }}>
                            {/* Bot Message */}
                            <div className="flex justify-start">
                                <div className="bg-white rounded-lg rounded-tl-none p-3 max-w-[85%] shadow-sm">
                                    <p className="text-sm text-slate-800 whitespace-pre-wrap">{data.text}</p>

                                    {/* Media */}
                                    {type === 'media' && data.mediaUrl && (
                                        <img src={data.mediaUrl} alt="" className="mt-2 rounded-lg w-full" />
                                    )}

                                    {/* Product */}
                                    {type === 'product' && (
                                        <div className="mt-2 border-t pt-2">
                                            {data.image && <img src={data.image} alt="" className="rounded-lg mb-2" />}
                                            <div className="font-semibold text-sm">{data.text}</div>
                                            <div className="text-green-600 font-bold">{data.price}</div>
                                        </div>
                                    )}

                                    {/* Buttons */}
                                    {data.buttons && data.buttons.length > 0 && (
                                        <div className="mt-2 space-y-1">
                                            {data.buttons.map((btn, i) => (
                                                <button key={i} className="w-full bg-blue-50 hover:bg-blue-100 text-blue-600 py-2 px-3 rounded-lg text-sm font-medium transition">
                                                    {btn.text}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* List */}
                                    {type === 'list' && data.items && (
                                        <div className="mt-2 space-y-1">
                                            {data.items.map((item, i) => (
                                                <div key={i} className="bg-slate-50 p-2 rounded text-sm">{item}</div>
                                            ))}
                                        </div>
                                    )}

                                    <div className="text-[10px] text-slate-400 mt-1 text-right">12:00 PM</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Connection Handles */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <button
                        onClick={(e) => { e.stopPropagation(); completeConnection(node.id); }}
                        className="w-6 h-6 bg-blue-500 hover:bg-blue-600 rounded-full shadow-lg flex items-center justify-center text-white transition"
                    >
                        <i className="fa-solid fa-arrow-down text-xs"></i>
                    </button>
                </div>
                <div className="absolute -bottom-3 left-1/2 -translate-x-1/2">
                    <button
                        onClick={(e) => { e.stopPropagation(); startConnection(node.id); }}
                        className={`w-6 h-6 rounded-full shadow-lg flex items-center justify-center text-white transition ${connecting === node.id ? 'bg-yellow-500 animate-pulse' : 'bg-green-500 hover:bg-green-600'
                            }`}
                    >
                        <i className="fa-solid fa-arrow-down text-xs"></i>
                    </button>
                </div>

                {/* Delete Button */}
                <button
                    onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 rounded-full shadow-lg flex items-center justify-center text-white transition"
                >
                    <i className="fa-solid fa-times text-xs"></i>
                </button>

                {/* Node Type Badge */}
                <div className="absolute top-2 left-2 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-full text-xs font-semibold text-slate-700 shadow">
                    {contentBlocks.find(b => b.type === type)?.icon} {type}
                </div>
            </div>
        );
    };

    // Render bezier connections
    const renderEdges = () => {
        return edges.map(edge => {
            const sourceNode = nodes.find(n => n.id === edge.source);
            const targetNode = nodes.find(n => n.id === edge.target);
            if (!sourceNode || !targetNode) return null;

            const startX = sourceNode.position.x * zoom + pan.x + (128 * zoom);
            const startY = sourceNode.position.y * zoom + pan.y + (480 * zoom);
            const endX = targetNode.position.x * zoom + pan.x + (128 * zoom);
            const endY = targetNode.position.y * zoom + pan.y;

            const controlY1 = startY + Math.abs(endY - startY) * 0.5;
            const controlY2 = endY - Math.abs(endY - startY) * 0.5;

            return (
                <g key={edge.id}>
                    <path
                        d={`M ${startX} ${startY} C ${startX} ${controlY1}, ${endX} ${controlY2}, ${endX} ${endY}`}
                        stroke="#3b82f6"
                        strokeWidth={3}
                        fill="none"
                        markerEnd="url(#arrowhead)"
                        className="hover:stroke-blue-600 cursor-pointer transition"
                    />
                    <circle
                        cx={(startX + endX) / 2}
                        cy={(startY + endY) / 2}
                        r={8}
                        fill="white"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        className="cursor-pointer hover:fill-red-100"
                        onClick={() => deleteEdge(edge.id)}
                    />
                </g>
            );
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-white">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600 font-medium">Loading flow...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen flex flex-col bg-white">
            {/* Header */}
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition">
                        <i className="fa-solid fa-arrow-left text-slate-600"></i>
                    </button>
                    <input
                        type="text"
                        value={flow.name}
                        onChange={(e) => setFlow({ ...flow, name: e.target.value })}
                        className="text-xl font-bold text-slate-800 border-none focus:ring-2 focus:ring-teal-500 rounded px-2 py-1"
                    />
                    <button className="text-slate-400 hover:text-slate-600">
                        <i className="fa-solid fa-pen text-sm"></i>
                    </button>
                </div>
                <div className="flex items-center gap-3">
                    <button className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium hover:bg-slate-50">
                        Fallback & Intents
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-medium transition disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Left Sidebar - Content Blocks */}
                <div className="w-64 bg-slate-50 border-r border-slate-200 overflow-y-auto">
                    <div className="p-4">
                        <h3 className="text-sm font-bold text-slate-700 mb-4">Content Block</h3>
                        <div className="space-y-2">
                            {contentBlocks.map(block => (
                                <button
                                    key={block.type}
                                    onClick={() => addNode(block.type)}
                                    className="w-full p-3 bg-white hover:bg-slate-100 rounded-lg text-left transition border border-slate-200 hover:border-teal-300 group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="text-2xl">{block.icon}</div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm text-slate-800 truncate">{block.label}</div>
                                            <div className="text-xs text-slate-500 truncate">{block.desc}</div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Canvas */}
                <div className="flex-1 relative bg-white overflow-hidden">
                    {/* Zoom Controls */}
                    <div className="absolute top-4 right-4 z-20 bg-white rounded-lg shadow-lg border border-slate-200 flex flex-col">
                        <button onClick={() => setZoom(z => Math.min(z + 0.1, 1.5))} className="p-3 hover:bg-slate-50 border-b">
                            <i className="fa-solid fa-plus text-slate-600"></i>
                        </button>
                        <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.3))} className="p-3 hover:bg-slate-50 border-b">
                            <i className="fa-solid fa-minus text-slate-600"></i>
                        </button>
                        <button onClick={() => { setZoom(0.8); setPan({ x: 50, y: 50 }); }} className="p-3 hover:bg-slate-50 border-b">
                            <i className="fa-solid fa-expand text-slate-600"></i>
                        </button>
                        <button className="p-3 hover:bg-slate-50">
                            <i className="fa-solid fa-download text-slate-600"></i>
                        </button>
                    </div>

                    <div
                        ref={canvasRef}
                        className="w-full h-full overflow-auto"
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onClick={() => setSelectedNode(null)}
                    >
                        <svg className="absolute inset-0 pointer-events-none" style={{ width: '100%', height: '100%' }}>
                            <defs>
                                <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                                    <polygon points="0 0, 10 3, 0 6" fill="#3b82f6" />
                                </marker>
                            </defs>
                            <g className="pointer-events-auto">{renderEdges()}</g>
                        </svg>

                        <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }} className="relative">
                            {nodes.map(node => (
                                <div
                                    key={node.id}
                                    className="absolute cursor-move"
                                    style={{ left: node.position.x, top: node.position.y }}
                                    onMouseDown={(e) => handleNodeMouseDown(e, node)}
                                >
                                    <PhoneMockup node={node} isSelected={selectedNode?.id === node.id} />
                                </div>
                            ))}
                        </div>

                        {nodes.length === 0 && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="text-center">
                                    <div className="text-6xl mb-4">📱</div>
                                    <h3 className="text-xl font-bold text-slate-700 mb-2">Start Building Your Flow</h3>
                                    <p className="text-slate-500">Click content blocks from the left to add messages</p>
                                </div>
                            </div>
                        )}

                        {connecting && (
                            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-yellow-400 text-yellow-900 px-6 py-3 rounded-full shadow-lg font-medium animate-bounce z-30">
                                Click a node to connect
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Sidebar - Properties */}
                {selectedNode && (
                    <div className="w-80 bg-white border-l border-slate-200 overflow-y-auto p-6">
                        <h3 className="text-lg font-bold text-slate-800 mb-4">Edit Message</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Message Text</label>
                                <textarea
                                    value={selectedNode.data.text || ''}
                                    onChange={(e) => updateNodeData(selectedNode.id, { text: e.target.value })}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
                                    rows="4"
                                />
                            </div>

                            {selectedNode.type === 'message' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Buttons</label>
                                    {selectedNode.data.buttons?.map((btn, i) => (
                                        <input
                                            key={i}
                                            value={btn.text}
                                            onChange={(e) => {
                                                const newButtons = [...selectedNode.data.buttons];
                                                newButtons[i].text = e.target.value;
                                                updateNodeData(selectedNode.id, { buttons: newButtons });
                                            }}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-2"
                                        />
                                    ))}
                                    <button
                                        onClick={() => {
                                            const newButtons = [...(selectedNode.data.buttons || []), { text: 'New Button', id: `btn-${Date.now()}` }];
                                            updateNodeData(selectedNode.id, { buttons: newButtons });
                                        }}
                                        className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                                    >
                                        + Add Button
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ChatbotFlowBuilder;
