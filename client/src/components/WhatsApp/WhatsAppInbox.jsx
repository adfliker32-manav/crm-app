/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import useSocket from '../../hooks/useSocket';

const WhatsAppInbox = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [selectedImage, setSelectedImage] = useState(null); // 🖼️ State for Lightbox
    const [newMessage, setNewMessage] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showContactPanel, setShowContactPanel] = useState(false);
    const [showAttachMenu, setShowAttachMenu] = useState(false);
    const [showNewChatModal, setShowNewChatModal] = useState(false);
    const [newChatPhone, setNewChatPhone] = useState('');
    const [newChatTemplate, setNewChatTemplate] = useState('');
    const [templates, setTemplates] = useState([]);
    const [startingChat, setStartingChat] = useState(false);
    const [showTemplatePicker, setShowTemplatePicker] = useState(false);
    const [filter, setFilter] = useState('all'); // all, unread, archived
    const [mediaPreview, setMediaPreview] = useState(null); // { file, previewUrl, type }
    const [uploading, setUploading] = useState(false);
    const [templateQuery, setTemplateQuery] = useState('');
    const [showInlineTemplatePicker, setShowInlineTemplatePicker] = useState(false);
    const scrollRef = useRef(null);
    const fileInputRef = useRef(null);
    const attachRef = useRef(null);
    const templatePickerRef = useRef(null);
    const inputRef = useRef(null);
    const selectedChatRef = useRef(null); // Track selectedChat in socket callbacks
    const shouldScrollToBottomRef = useRef(true); // 🛡️ Flag for pagination vs new messages
    const { socket, isConnected } = useSocket();

    const fetchConversations = useCallback(async () => {
        try {
            const status = filter === 'archived' ? 'archived' : 'active';
            const res = await api.get('/whatsapp/conversations', {
                params: { status, search: searchTerm }
            });
            setConversations(res.data.conversations || []);
        } catch (error) {
            console.error('Error fetching conversations:', error);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, filter]);

    const fetchMessages = useCallback(async (conversationId, pageNum = 1, isInitial = false) => {
        if (!isInitial && (!hasMore || loadingMore)) return;
        
        if (isInitial) {
            setLoading(true);
            setPage(1);
            setHasMore(true);
            shouldScrollToBottomRef.current = true; // ✨ Initial load: go to bottom
        } else {
            setLoadingMore(true);
            shouldScrollToBottomRef.current = false; // 🛑 Pagination: stay put
        }

        try {
            const limit = 10; // User requested 10 for "lightweight"
            const res = await api.get(`/whatsapp/conversations/${conversationId}?page=${pageNum}&limit=${limit}`);
            const newMessages = res.data.messages || [];
            
            // Deduplicate to avoid overlaps
            if (isInitial) {
                setMessages(newMessages);
                setSelectedChat(res.data.conversation); // Keep in sync
            } else {
                setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m._id));
                    const uniqueNew = newMessages.filter(m => !existingIds.has(m._id));
                    return [...uniqueNew, ...prev];
                });
                setPage(pageNum);
            }
            
            setHasMore(res.data.pagination?.page < res.data.pagination?.pages);
            
            if (isInitial) {
                await api.put(`/whatsapp/conversations/${conversationId}/read`);
                setConversations(prev => prev.map(c =>
                    c._id === conversationId ? { ...c, unreadCount: 0 } : c
                ));
            }
        } catch (error) {
            console.error('Error fetching messages:', error);
            showError('Failed to load messages');
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, [showError, hasMore, loadingMore]);

    useEffect(() => { fetchConversations(); fetchTemplates(); }, [fetchConversations]);

    // Keep selectedChatRef in sync for socket callbacks
    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/whatsapp/templates');
            const data = res.data.templates || res.data;
            setTemplates(data.filter(t => t.status === 'APPROVED'));
        } catch (err) { console.error('Failed to load templates', err); }
    };

    // Check if the 24-hour messaging window is still open
    const isWindowOpen = (chat) => {
        if (!chat) return false;
        
        // Correct 24-hour logic: window is calculated from the LAST INBOUND message from the customer
        if (chat.lastInboundMessageAt) {
            const lastInbound = new Date(chat.lastInboundMessageAt);
            const now = new Date();
            return (now - lastInbound) < (24 * 60 * 60 * 1000);
        }
        
        // Fallback for older chats before the DB update
        if (chat.lastMessageDirection === 'inbound') {
            const lastMsg = new Date(chat.lastMessageAt);
            const now = new Date();
            return (now - lastMsg) < (24 * 60 * 60 * 1000);
        }
        
        return false;
    };

    // Check if the chatbot is manually paused (human handoff)
    const isChatbotPaused = (chat) => {
        if (!chat || !chat.chatbotPausedUntil) return false;
        return new Date() < new Date(chat.chatbotPausedUntil);
    };

    // ============================================================
    // 🔌 SOCKET.IO — Real-time event listeners (replaces 5s polling)
    // ============================================================
    useEffect(() => {
        if (!socket) return;

        // --- New message arrives (inbound from customer, outbound from bot/agent) ---
        const handleNewMessage = ({ conversationId, message }) => {
            const currentChat = selectedChatRef.current;
            // Normalize to string — socket may send ObjectId or string
            const convId = typeof conversationId === 'string' ? conversationId : String(conversationId);

            // If this message is for the currently open conversation, append it
            if (currentChat && currentChat._id === convId) {
                // If it's the current chat, we WANT to scroll down for the new message
                shouldScrollToBottomRef.current = true; 
                setMessages(prev => {
                    // 🛡️ DEDUPLICATION: Prevent duplicate rendering (API Response + Socket Event)
                    // We check both internal MongoDB _id and the WhatsApp waMessageId
                    const exists = prev.some(m => 
                        (m._id && m._id === message._id) || 
                        (m.waMessageId && m.waMessageId === message.waMessageId)
                    );
                    if (exists) return prev;
                    return [...prev, message];
                });
            }

            // Update conversation list sidebar
            setConversations(prev => {
                const exists = prev.some(c => c._id === convId);
                if (exists) {
                    return prev.map(c => {
                        if (c._id !== convId) return c;
                        return {
                            ...c,
                            lastMessage: message.content?.text?.substring(0, 100) || 'Message',
                            lastMessageAt: message.timestamp,
                            lastMessageDirection: message.direction,
                            // Increment unread only for inbound messages not from currently viewed chat
                            unreadCount: (message.direction === 'inbound' && (!currentChat || currentChat._id !== convId))
                                ? (c.unreadCount || 0) + 1
                                : c.unreadCount
                        };
                    });
                } else {
                    // New conversation — refresh the list
                    fetchConversations();
                    return prev;
                }
            });
        };

        // --- Conversation metadata update (lastMessage, unread, etc.) ---
        const handleConversationUpdate = ({ conversationId, updates }) => {
            const convId = typeof conversationId === 'string' ? conversationId : String(conversationId);
            setConversations(prev =>
                prev.map(c => c._id === convId ? { ...c, ...updates } : c)
            );
            // Also update selectedChat if it matches
            const currentChat = selectedChatRef.current;
            if (currentChat && currentChat._id === convId) {
                setSelectedChat(prev => prev ? { ...prev, ...updates } : prev);
            }
        };

        const handleStatusUpdate = ({ waMessageId, status, conversationId }) => {
            const currentChat = selectedChatRef.current;
            if (currentChat && currentChat._id === conversationId) {
                setMessages(prev =>
                    prev.map(m =>
                        m.waMessageId === waMessageId ? { ...m, status } : m
                    )
                );
            }
        };

        const handleConversationCleared = ({ conversationId, updates }) => {
            setConversations(prev =>
                prev.map(c => c._id === conversationId ? { ...c, ...updates } : c)
            );

            const currentChat = selectedChatRef.current;
            if (currentChat && currentChat._id === conversationId) {
                setMessages([]);
                setPage(1);
                setHasMore(false);
                setSelectedChat(prev => prev ? { ...prev, ...updates } : prev);
            }
        };

        socket.on('whatsapp:newMessage', handleNewMessage);
        socket.on('whatsapp:conversationUpdate', handleConversationUpdate);
        socket.on('whatsapp:statusUpdate', handleStatusUpdate);
        socket.on('whatsapp:conversationCleared', handleConversationCleared);

        return () => {
            socket.off('whatsapp:newMessage', handleNewMessage);
            socket.off('whatsapp:conversationUpdate', handleConversationUpdate);
            socket.off('whatsapp:statusUpdate', handleStatusUpdate);
            socket.off('whatsapp:conversationCleared', handleConversationCleared);
        };
    }, [socket, fetchConversations]);

    // Watch/unwatch conversation room for targeted events
    useEffect(() => {
        if (!socket || !selectedChat) return;
        socket.emit('watch:conversation', selectedChat._id);
        return () => {
            socket.emit('unwatch:conversation', selectedChat._id);
        };
    }, [socket, selectedChat?._id]);

    // ⏰ Safety-net fallback poll (60s instead of 5s = 92% less DB load)
    useEffect(() => {
        const interval = setInterval(() => {
            fetchConversations();
            if (selectedChatRef.current) fetchMessages(selectedChatRef.current._id);
        }, 60000); // 60 seconds
        return () => clearInterval(interval);
    }, [fetchConversations, fetchMessages]);

    useEffect(() => {
        if (scrollRef.current && shouldScrollToBottomRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // Handle Scroll for Pagination (Scroll to Top)
    const handleChatScroll = (e) => {
        if (!hasMore || loadingMore || !selectedChat) return;
        
        const { scrollTop, scrollHeight } = e.currentTarget;
        if (scrollTop < 50) { // Trigger early before reaching exact 0
            const oldHeight = scrollHeight;
            const targetChatId = selectedChat._id;
            
            fetchMessages(targetChatId, page + 1).then(() => {
                // Scroll Anchoring: Maintain position relative to current view
                setTimeout(() => {
                    if (scrollRef.current) {
                        const newHeight = scrollRef.current.scrollHeight;
                        scrollRef.current.scrollTop = newHeight - oldHeight;
                    }
                }, 0);
            });
        }
    };

    // Close attach menu and template picker on outside click
    useEffect(() => {
        const handler = (e) => {
            if (attachRef.current && !attachRef.current.contains(e.target)) setShowAttachMenu(false);
            if (templatePickerRef.current && !templatePickerRef.current.contains(e.target) && e.target !== inputRef.current) {
                setShowInlineTemplatePicker(false);
                setTemplateQuery('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedChat) return;
        setSending(true);
        shouldScrollToBottomRef.current = true; // 💪 User sent message: scroll down
        try {
            const res = await api.post(`/whatsapp/conversations/${selectedChat._id}/send`, { text: newMessage.trim() });
            setMessages(prev => {
                const exists = prev.some(m => 
                    (m._id && m._id === res.data.message._id) || 
                    (m.waMessageId && m.waMessageId === res.data.message.waMessageId)
                );
                return exists ? prev : [...prev, res.data.message];
            });
            setNewMessage('');
            setConversations(prev => prev.map(c =>
                c._id === selectedChat._id
                    ? { ...c, lastMessage: newMessage.trim(), lastMessageAt: new Date(), lastMessageDirection: 'outbound' }
                    : c
            ));
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to send message');
        } finally {
            setSending(false);
        }
    };

    // ── File Upload Handler ──
    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        e.target.value = '';

        const MB = 1024 * 1024;
        if (file.type.startsWith('image/') && file.size > 5 * MB) { showError('Image must be under 5 MB'); return; }
        if (file.type.startsWith('video/') && file.size > 16 * MB) { showError('Video must be under 16 MB'); return; }
        if (file.size > 100 * MB) { showError('File must be under 100 MB'); return; }

        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
        const type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'document';
        setMediaPreview({ file, previewUrl, type });
    };

    const handleSendMedia = async () => {
        if (!mediaPreview || !selectedChat) return;
        setUploading(true);
        shouldScrollToBottomRef.current = true; // 💪 User sent media: scroll down
        try {
            const formData = new FormData();
            formData.append('file', mediaPreview.file);
            if (newMessage.trim()) formData.append('caption', newMessage.trim());

            const res = await api.post(`/whatsapp/conversations/${selectedChat._id}/send-media`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setMessages(prev => {
                const exists = prev.some(m => 
                    (m._id && m._id === res.data.message._id) || 
                    (m.waMessageId && m.waMessageId === res.data.message.waMessageId)
                );
                return exists ? prev : [...prev, res.data.message];
            });
            setMediaPreview(null);
            setNewMessage('');
            showSuccess('Media sent!');
            fetchConversations();
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to send media');
        } finally {
            setUploading(false);
        }
    };

    const handleCancelMedia = () => {
        if (mediaPreview?.previewUrl) URL.revokeObjectURL(mediaPreview.previewUrl);
        setMediaPreview(null);
    };

    // ── Inline Template Picker (@trigger) ──
    const handleInputChange = (e) => {
        const value = e.target.value;
        setNewMessage(value);

        // Detect @ trigger
        const atIdx = value.lastIndexOf('@');
        if (atIdx !== -1 && (atIdx === 0 || value[atIdx - 1] === ' ')) {
            const query = value.substring(atIdx + 1);
            setTemplateQuery(query);
            setShowInlineTemplatePicker(true);
        } else {
            setShowInlineTemplatePicker(false);
            setTemplateQuery('');
        }
    };

    const handleInputKeyDown = (e) => {
        if (e.key === 'Escape' && showInlineTemplatePicker) {
            setShowInlineTemplatePicker(false);
            setTemplateQuery('');
        }
    };

    const handleSelectInlineTemplate = (template) => {
        setShowInlineTemplatePicker(false);
        setTemplateQuery('');
        setNewMessage('');
        handleSendTemplate(template.name);
    };

    const filteredInlineTemplates = templates.filter(t =>
        !templateQuery || t.name.toLowerCase().includes(templateQuery.toLowerCase())
    );

    const handleStartNewChat = async () => {
        if (!newChatPhone.trim() || !newChatTemplate) return;
        setStartingChat(true);
        try {
            const res = await api.post('/whatsapp/conversations/new', {
                phone: newChatPhone.trim(),
                templateName: newChatTemplate
            });
            setShowNewChatModal(false);
            setNewChatPhone('');
            setNewChatTemplate('');
            await fetchConversations();
            if (res.data.conversation) {
                setSelectedChat(res.data.conversation);
                fetchMessages(res.data.conversation._id);
            }
            showSuccess('Template message sent!');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to start conversation');
        } finally {
            setStartingChat(false);
        }
    };

    const handleSendTemplate = async (templateNameToSend) => {
        if (!selectedChat || !templateNameToSend) return;
        setSending(true);
        shouldScrollToBottomRef.current = true; // 💪 User sent template: scroll down
        try {
            const res = await api.post('/whatsapp/conversations/new', {
                phone: selectedChat.phone,
                templateName: templateNameToSend
            });
            if (res.data.message) {
                setMessages(prev => {
                    const exists = prev.some(m => 
                        (m._id && m._id === res.data.message._id) || 
                        (m.waMessageId && m.waMessageId === res.data.message.waMessageId)
                    );
                    return exists ? prev : [...prev, res.data.message];
                });
            }
            fetchConversations();
            setShowTemplatePicker(false);
            showSuccess('Template sent! Conversation window re-opened.');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to send template');
        } finally {
            setSending(false);
        }
    };

    const handleArchive = async (chatId, newStatus) => {
        try {
            await api.put(`/whatsapp/conversations/${chatId}/status`, { status: newStatus });
            if (selectedChat?._id === chatId) setSelectedChat(null);
            fetchConversations();
            showSuccess(newStatus === 'archived' ? 'Chat archived' : 'Chat unarchived');
        } catch { showError('Failed to update'); }
    };

    const handleResumeChatbot = async (chatId) => {
        try {
            const res = await api.put(`/whatsapp/conversations/${chatId}/resume-chatbot`);
            if (res.data.success) {
                showSuccess('Chatbot resumed! It will now respond to new messages.');
                // Update local state
                if (selectedChat?._id === chatId) {
                    setSelectedChat(prev => ({ ...prev, chatbotPausedUntil: res.data.conversation.chatbotPausedUntil }));
                }
                setConversations(prev => prev.map(c => 
                    c._id === chatId ? { ...c, chatbotPausedUntil: res.data.conversation.chatbotPausedUntil } : c
                ));
            }
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to resume chatbot');
        }
    };

    const handleClearChat = async (chatId) => {
        const confirmed = await showDanger(
            'This will remove all saved messages from this inbox conversation. The contact and linked lead will stay intact.',
            'Clear Chat History'
        );

        if (!confirmed) return;

        try {
            const res = await api.delete(`/whatsapp/conversations/${chatId}/messages`);
            const updates = res.data.updates || {};

            setConversations(prev =>
                prev.map(c => c._id === chatId ? { ...c, ...updates } : c)
            );

            if (selectedChat?._id === chatId) {
                setMessages([]);
                setPage(1);
                setHasMore(false);
                setSelectedChat(prev => prev ? { ...prev, ...updates } : prev);
            }

            showSuccess('Chat history cleared');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to clear chat');
        }
    };

    const handleSelectChat = (chat) => {
        setSelectedChat(chat);
        fetchMessages(chat._id, 1, true); // initial load
        setShowContactPanel(false);
    };

    const formatTime = (date) => {
        const d = new Date(date);
        const now = new Date();
        const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    const getStatusIcon = (status, direction) => {
        if (direction !== 'outbound') return null;
        switch (status) {
            case 'read': return <i className="fa-solid fa-check-double text-[#53bdeb]"></i>;
            case 'delivered': return <i className="fa-solid fa-check-double text-[#8696a0]"></i>;
            case 'sent': return <i className="fa-solid fa-check text-[#8696a0]"></i>;
            case 'failed': return <i className="fa-solid fa-exclamation-circle text-red-500"></i>;
            default: return <i className="fa-regular fa-clock text-[#8696a0]"></i>;
        }
    };

    const renderMediaContent = (msg) => {
        const token = localStorage.getItem('token');
        // Robust token sanitization: Remove Bearer prefix and extra whitespace
        const rawToken = token ? token.replace(/^Bearer\s+/i, '').trim() : '';
        
        // Encode the token for safe URL transport
        const mediaProxy = msg.content?.mediaId ? `/whatsapp/media/${msg.content.mediaId}?token=${encodeURIComponent(rawToken)}` : null;
        
        // Build robust full URL with slash protection
        const base = api.defaults.baseURL || '';
        const sanitizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
        const fullMediaUrl = mediaProxy ? sanitizedBase + mediaProxy : msg.content?.mediaUrl;

        switch (msg.type) {
            case 'image':
                return (
                    <div className="mb-1 group relative">
                        {fullMediaUrl ? (
                            <div className="relative overflow-hidden rounded-lg bg-slate-100 min-h-[100px] min-w-[150px]">
                                <img 
                                    src={fullMediaUrl} 
                                    alt="Shared" 
                                    className="rounded-lg max-w-[280px] max-h-[300px] object-cover cursor-pointer hover:brightness-95 transition-all duration-300" 
                                    loading="lazy"
                                    onClick={() => setSelectedImage(fullMediaUrl)}
                                    onError={(e) => {
                                        console.error('WhatsApp Image Load Failed:', e.target.src);
                                        e.target.onerror = null;
                                        e.target.src = 'https://placehold.co/400x300?text=Auth+Error+or+Expired';
                                    }}
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors pointer-events-none"></div>
                            </div>
                        ) : (
                            <div className="bg-slate-50 text-[#8696a0] rounded-lg p-6 flex flex-col items-center justify-center gap-2 border border-dashed border-slate-200">
                                <i className="fa-solid fa-image-slash text-2xl"></i>
                                <span className="text-[10px] font-medium uppercase tracking-wider">Image Unavailable</span>
                            </div>
                        )}
                        {msg.content?.caption && <p className="text-[14px] text-[#111b21] mt-1.5 px-0.5">{msg.content.caption}</p>}
                    </div>
                );
            case 'video':
                return (
                    <div className="mb-1 relative group cursor-pointer" onClick={() => mediaUrl && window.open(mediaUrl, '_blank')}>
                        <div className="bg-[#111b21]/10 rounded-lg p-10 flex flex-col items-center justify-center gap-3 max-w-[280px] border border-slate-200 relative overflow-hidden">
                            <i className="fa-solid fa-circle-play text-5xl text-[#00a884]"></i>
                            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-widest leading-none">Play Video</span>
                            <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/20 rounded text-[9px] text-white">MP4</div>
                        </div>
                        {msg.content?.caption && <p className="text-[14px] text-[#111b21] mt-1.5 px-0.5">{msg.content.caption}</p>}
                    </div>
                );
            case 'document':
                return (
                    <div className="bg-white/80 rounded-xl p-3.5 flex items-center gap-3.5 max-w-[280px] border border-slate-200/80 mb-1 shadow-sm hover:shadow-md transition-all cursor-pointer group">
                        <div className="w-11 h-11 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20 group-hover:scale-105 transition-transform">
                            <i className="fa-solid fa-file-pdf text-white text-lg"></i>
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-bold text-slate-800 truncate leading-tight mb-0.5">{msg.content?.fileName || 'Document'}</p>
                            <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tight">{(msg.content?.fileSize / 1024).toFixed(0) || '0'} KB • Document</p>
                        </div>
                        {mediaUrl && (
                            <a href={mediaUrl} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:text-[#00a884] hover:bg-slate-200 transition-colors">
                                <i className="fa-solid fa-arrow-down-to-bracket"></i>
                            </a>
                        )}
                    </div>
                );
            case 'audio':
                return (
                    <div className="flex items-center gap-3 bg-slate-50/50 rounded-full px-4 py-2 max-w-[280px] mb-1">
                        <button className="w-8 h-8 bg-[#00a884] rounded-full flex items-center justify-center text-white flex-shrink-0">
                            <i className="fa-solid fa-play text-xs ml-0.5"></i>
                        </button>
                        <div className="flex-1 h-1 bg-slate-300 rounded-full"><div className="h-1 bg-[#00a884] rounded-full w-1/3"></div></div>
                        <span className="text-[10px] text-slate-500">0:00</span>
                    </div>
                );
            case 'sticker':
                return <div className="text-4xl mb-1">🎨</div>;
            case 'location':
                return (
                    <div className="bg-slate-100 rounded-lg overflow-hidden max-w-[280px] mb-1">
                        <div className="h-32 bg-gradient-to-br from-green-200 to-blue-200 flex items-center justify-center">
                            <i className="fa-solid fa-location-dot text-3xl text-red-500"></i>
                        </div>
                        <div className="p-2">
                            <p className="text-sm font-medium">{msg.content?.locationName || 'Location'}</p>
                            {msg.content?.address && <p className="text-xs text-slate-500">{msg.content.address}</p>}
                        </div>
                    </div>
                );
            case 'interactive':
                return (
                    <div className="mb-1">
                        {msg.content?.text && <p className="text-sm mb-2">{msg.content.text}</p>}
                        {msg.content?.buttons?.map((btn, i) => (
                            <div key={i} className="border-t border-slate-200/50 py-2 text-center">
                                <span className="text-[#00a884] text-sm font-medium">{btn.text}</span>
                            </div>
                        ))}
                    </div>
                );
            case 'reaction':
                return <div className="text-2xl">{msg.content?.reactionEmoji || '❤️'}</div>;
            default:
                return msg.content?.text ? <p className="text-sm break-words whitespace-pre-wrap">{msg.content.text}</p> : <p className="text-sm text-slate-400 italic">Unsupported message</p>;
        }
    };

    const filteredConversations = filter === 'unread'
        ? conversations.filter(c => c.unreadCount > 0)
        : conversations;

    const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f0f2f5]">
                <div className="text-center">
                    <div className="w-16 h-16 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-600 font-medium">Loading conversations...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full bg-[#f0f2f5]">
            {/* ═══════════ LEFT SIDEBAR ═══════════ */}
            <div className="w-[380px] bg-white border-r border-[#e9edef] flex flex-col flex-shrink-0">
                {/* Sidebar Header */}
                <div className="p-3 bg-[#f0f2f5] flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-[#00a884] to-[#25d366] rounded-full flex items-center justify-center text-white">
                            <i className="fa-brands fa-whatsapp text-xl"></i>
                        </div>
                        <div>
                            <span className="font-semibold text-[#111b21] text-sm">Chats</span>
                            {totalUnread > 0 && (
                                <span className="ml-2 bg-[#25d366] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{totalUnread}</span>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setShowNewChatModal(true)}
                            className="w-9 h-9 rounded-full hover:bg-slate-200 flex items-center justify-center text-[#54656f] transition"
                            title="New chat"
                        >
                            <i className="fa-solid fa-pen-to-square text-lg"></i>
                        </button>
                    </div>
                </div>

                {/* Search */}
                <div className="px-3 py-2">
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-[#8696a0] text-sm"></i>
                        <input
                            type="text"
                            placeholder="Search or start new chat"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-2 bg-[#f0f2f5] border-none rounded-lg text-sm focus:outline-none focus:bg-white focus:shadow-sm transition"
                        />
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-3 pb-2 flex gap-2">
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'unread', label: 'Unread', count: totalUnread },
                        { id: 'archived', label: 'Archived' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setFilter(tab.id)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${filter === tab.id
                                ? 'bg-[#e7fce3] text-[#008069]'
                                : 'bg-[#f0f2f5] text-[#54656f] hover:bg-slate-200'}`}
                        >
                            {tab.label}
                            {tab.count > 0 && <span className="ml-1 bg-[#25d366] text-white text-[9px] px-1.5 py-0.5 rounded-full">{tab.count}</span>}
                        </button>
                    ))}
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto">
                    {filteredConversations.map(chat => (
                        <div
                            key={chat._id}
                            onClick={() => handleSelectChat(chat)}
                            className={`px-4 py-3 border-b border-[#f0f2f5] cursor-pointer transition-colors ${selectedChat?._id === chat._id
                                ? 'bg-[#f0f2f5]'
                                : 'hover:bg-[#f5f6f6]'}`}
                        >
                            <div className="flex gap-3">
                                <div className="flex-shrink-0">
                                    <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold ${chat.unreadCount > 0 ? 'bg-gradient-to-br from-[#00a884] to-[#25d366]' : 'bg-[#dfe5e7]'}`}>
                                        {chat.displayName ? chat.displayName.charAt(0).toUpperCase() : <i className="fa-solid fa-user text-[#8696a0]"></i>}
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-center mb-0.5">
                                        <h3 className={`text-[15px] truncate ${chat.unreadCount > 0 ? 'font-bold text-[#111b21]' : 'font-normal text-[#111b21]'}`}>
                                            {chat.displayName || chat.phone}
                                        </h3>
                                        <span className={`text-[11px] flex-shrink-0 ml-2 ${chat.unreadCount > 0 ? 'text-[#25d366] font-medium' : 'text-[#8696a0]'}`}>
                                            {chat.lastMessageAt ? formatTime(chat.lastMessageAt) : ''}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className="text-[13px] text-[#8696a0] truncate flex items-center gap-1">
                                            {chat.lastMessageDirection === 'outbound' && chat.lastMessage && (
                                                <span className="flex-shrink-0">{getStatusIcon('delivered', 'outbound')}</span>
                                            )}
                                            <span className={`truncate ${chat.unreadCount > 0 ? 'text-[#111b21] font-medium' : ''}`}>{chat.lastMessage || 'Start a conversation'}</span>
                                        </p>
                                        {chat.unreadCount > 0 && (
                                            <span className="bg-[#25d366] text-white text-[11px] font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                                                {chat.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {filteredConversations.length === 0 && (
                        <div className="p-10 text-center">
                            <i className="fa-brands fa-whatsapp text-6xl text-[#e9edef] mb-4"></i>
                            <p className="text-sm text-[#8696a0]">{filter === 'unread' ? 'No unread messages' : filter === 'archived' ? 'No archived chats' : 'No conversations yet'}</p>
                            <button onClick={() => setShowNewChatModal(true)} className="mt-3 text-[#00a884] text-sm font-medium hover:underline">
                                Start a new chat
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════════ CHAT WINDOW ═══════════ */}
            <div className="flex-1 flex flex-col min-w-0">
                {selectedChat ? (
                    <>
                        {/* Chat Header */}
                        <div className="h-[60px] px-4 bg-[#f0f2f5] border-b border-[#e9edef] flex items-center gap-3 flex-shrink-0">
                            <div className="w-10 h-10 bg-[#dfe5e7] rounded-full flex items-center justify-center text-[#8696a0] font-semibold">
                                {selectedChat.displayName ? selectedChat.displayName.charAt(0).toUpperCase() : <i className="fa-solid fa-user"></i>}
                            </div>
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setShowContactPanel(!showContactPanel)}>
                                <h3 className="font-semibold text-[15px] text-[#111b21] truncate">{selectedChat.displayName || selectedChat.phone}</h3>
                                <p className="text-xs text-[#8696a0]">
                                    {selectedChat.leadId ? `Lead: ${selectedChat.leadId.name || 'Linked'}` : selectedChat.phone}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setShowContactPanel(!showContactPanel)} className="w-9 h-9 rounded-full hover:bg-slate-200 flex items-center justify-center text-[#54656f] transition">
                                    <i className="fa-solid fa-user-circle text-xl"></i>
                                </button>
                                <button onClick={() => handleClearChat(selectedChat._id)} className="w-9 h-9 rounded-full hover:bg-red-50 flex items-center justify-center text-[#54656f] hover:text-red-500 transition" title="Clear chat history">
                                    <i className="fa-solid fa-trash-can"></i>
                                </button>
                                <button onClick={() => handleArchive(selectedChat._id, selectedChat.status === 'archived' ? 'active' : 'archived')} className="w-9 h-9 rounded-full hover:bg-slate-200 flex items-center justify-center text-[#54656f] transition" title={selectedChat.status === 'archived' ? 'Unarchive' : 'Archive'}>
                                    <i className={`fa-solid ${selectedChat.status === 'archived' ? 'fa-box-open' : 'fa-box-archive'}`}></i>
                                </button>
                            </div>
                        </div>

                        {/* Messages */}
                        <div 
                            className="flex-1 overflow-y-auto px-16 py-4" 
                            ref={scrollRef}
                            onScroll={handleChatScroll}
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='400' height='400' xmlns='http://www.w3.org/2000/svg'%3E%3Cdefs%3E%3Cpattern id='p' width='60' height='60' patternUnits='userSpaceOnUse'%3E%3Cpath d='M30 5 q5 8 0 16 q-5 8 0 16' fill='none' stroke='%23d4cfc4' stroke-width='.4' opacity='.6'/%3E%3Ccircle cx='10' cy='50' r='1.5' fill='%23d4cfc4' opacity='.3'/%3E%3Ccircle cx='50' cy='20' r='1' fill='%23d4cfc4' opacity='.3'/%3E%3C/pattern%3E%3C/defs%3E%3Crect fill='%23efeae2' width='400' height='400'/%3E%3Crect fill='url(%23p)' width='400' height='400'/%3E%3C/svg%3E")`, backgroundSize: '400px' }}
                        >
                            <div className="space-y-1 max-w-3xl mx-auto">
                                {/* Loading More Indicator */}
                                {loadingMore && (
                                    <div className="text-center py-2">
                                        <div className="inline-block w-5 h-5 border-2 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
                                    </div>
                                )}
                                {/* Date separator */}
                                {messages.length > 0 && (
                                    <div className="text-center my-3">
                                        <span className="bg-white text-[#8696a0] text-[11px] font-medium px-3 py-1.5 rounded-lg shadow-sm">
                                            {new Date(messages[0].timestamp).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
                                        </span>
                                    </div>
                                )}

                                {messages.length === 0 && !loadingMore && (
                                    <div className="py-16 text-center">
                                        <div className="inline-flex w-14 h-14 rounded-full bg-white shadow-sm items-center justify-center text-[#8696a0] mb-4">
                                            <i className="fa-regular fa-comment-dots text-2xl"></i>
                                        </div>
                                        <p className="text-sm font-medium text-[#54656f]">No messages in this chat</p>
                                        <p className="text-xs text-[#8696a0] mt-1">Send a message to start a fresh conversation.</p>
                                    </div>
                                )}

                                {messages.map((msg) => (
                                    <div key={msg._id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[65%] rounded-lg px-2.5 pt-1.5 pb-1 shadow-sm relative ${msg.direction === 'outbound' ? 'bg-[#d9fdd3]' : 'bg-white'}`}>
                                            {msg.type === 'text' ? (
                                                <p className="text-[14.2px] text-[#111b21] break-words whitespace-pre-wrap leading-[19px]">
                                                    {msg.content?.text}
                                                    <span className="float-right ml-3 mt-1 flex items-center gap-1">
                                                        <span className="text-[11px] text-[#8696a0]">{formatTime(msg.timestamp)}</span>
                                                        {getStatusIcon(msg.status, msg.direction)}
                                                    </span>
                                                </p>
                                            ) : (
                                                <>
                                                    {renderMediaContent(msg)}
                                                    <div className="flex items-center justify-end gap-1 mt-0.5">
                                                        <span className="text-[11px] text-[#8696a0]">{formatTime(msg.timestamp)}</span>
                                                        {getStatusIcon(msg.status, msg.direction)}
                                                    </div>
                                                </>
                                            )}
                                            {msg.status === 'failed' && msg.error && (
                                                <p className="text-[10px] text-red-500 mt-1"><i className="fa-solid fa-exclamation-triangle mr-1"></i>{msg.error.message}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Input Bar */}
                        <div className="bg-[#f0f2f5] border-t border-[#e9edef] flex-shrink-0">
                            {/* 24-hour window expired banner */}
                            {selectedChat && !isWindowOpen(selectedChat) && (
                                <div className="px-4 py-2 bg-amber-50 border-b border-amber-200">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-amber-700 text-xs">
                                            <i className="fa-solid fa-clock"></i>
                                            <span className="font-semibold">24-hour messaging window closed.</span>
                                            <span>Send a template to re-open it.</span>
                                        </div>
                                        <div className="relative">
                                            <button onClick={() => setShowTemplatePicker(!showTemplatePicker)} className="px-3 py-1.5 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5">
                                                <i className="fa-solid fa-file-lines"></i> Send Template
                                            </button>
                                            {showTemplatePicker && (
                                                <div className="absolute bottom-10 right-0 bg-white rounded-xl shadow-2xl border border-slate-200 w-[280px] max-h-[200px] overflow-y-auto z-50 p-2">
                                                    {templates.length === 0 ? (
                                                        <div className="p-4 text-center text-slate-400 text-xs">No approved templates found</div>
                                                    ) : templates.map(t => (
                                                        <button key={t._id} onClick={() => handleSendTemplate(t.name)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 rounded-lg transition flex items-center gap-2 text-sm">
                                                            <i className="fa-solid fa-file-lines text-[#00a884]"></i>
                                                            <span className="font-medium text-slate-700 truncate">{t.name}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Chatbot Paused Banner */}
                            {selectedChat && isChatbotPaused(selectedChat) && (
                                <div className="px-4 py-2 bg-blue-50 border-b border-blue-200">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-blue-700 text-xs">
                                            <i className="fa-solid fa-robot"></i>
                                            <span className="font-semibold">Chatbot is currently PAUSED for this chat.</span>
                                            <span>(Paused because you replied manually)</span>
                                        </div>
                                        <button 
                                            onClick={() => handleResumeChatbot(selectedChat._id)} 
                                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
                                        >
                                            <i className="fa-solid fa-play"></i> Resume Chatbot
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="px-4 py-2.5">
                            {/* ── Media Preview Bar ── */}
                            {mediaPreview && (
                                <div className="mb-2 bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex items-center gap-3">
                                    {mediaPreview.type === 'image' && mediaPreview.previewUrl ? (
                                        <img src={mediaPreview.previewUrl} alt="Preview" className="w-16 h-16 rounded-lg object-cover" />
                                    ) : (
                                        <div className={`w-14 h-14 rounded-lg flex items-center justify-center ${mediaPreview.type === 'document' ? 'bg-blue-50 text-blue-500' : 'bg-purple-50 text-purple-500'}`}>
                                            <i className={`fa-solid ${mediaPreview.type === 'document' ? 'fa-file-lines' : 'fa-video'} text-2xl`}></i>
                                        </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-[#111b21] truncate">{mediaPreview.file.name}</p>
                                        <p className="text-xs text-[#8696a0]">{(mediaPreview.file.size / 1024).toFixed(1)} KB • {mediaPreview.type}</p>
                                    </div>
                                    <button onClick={handleCancelMedia} className="w-8 h-8 rounded-full hover:bg-red-50 flex items-center justify-center text-red-400 hover:text-red-500 transition" title="Cancel">
                                        <i className="fa-solid fa-xmark text-lg"></i>
                                    </button>
                                </div>
                            )}

                            <form onSubmit={mediaPreview ? (e) => { e.preventDefault(); handleSendMedia(); } : handleSendMessage} className="flex items-center gap-2">
                                {/* Attach button */}
                                <div className="relative" ref={attachRef}>
                                    <button type="button" onClick={() => setShowAttachMenu(!showAttachMenu)} className="w-10 h-10 rounded-full hover:bg-slate-200 flex items-center justify-center text-[#54656f] transition">
                                        <i className={`fa-solid fa-paperclip text-xl transform ${showAttachMenu ? 'rotate-45 text-[#00a884]' : ''} transition-transform`}></i>
                                    </button>
                                    {showAttachMenu && (
                                        <div className="absolute bottom-14 left-0 bg-white rounded-2xl shadow-xl border border-slate-100 py-3 px-2 flex flex-col gap-1 z-50 min-w-[180px] animate-in slide-in-from-bottom-2">
                                            {[
                                                { icon: 'fa-image', label: 'Photos & Videos', accept: 'image/*,video/*', color: 'from-purple-500 to-pink-500' },
                                                { icon: 'fa-file', label: 'Document', accept: '.pdf,.doc,.docx,.xls,.xlsx', color: 'from-blue-500 to-indigo-500' },
                                            ].map((item, i) => (
                                                <button
                                                    key={i}
                                                    type="button"
                                                    onClick={() => {
                                                        fileInputRef.current.accept = item.accept;
                                                        fileInputRef.current.click();
                                                        setShowAttachMenu(false);
                                                    }}
                                                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition text-left"
                                                >
                                                    <div className={`w-9 h-9 bg-gradient-to-br ${item.color} rounded-full flex items-center justify-center text-white`}>
                                                        <i className={`fa-solid ${item.icon} text-sm`}></i>
                                                    </div>
                                                    <span className="text-sm font-medium text-[#111b21]">{item.label}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />

                                {/* Text Input + Inline Template Picker */}
                                <div className="flex-1 bg-white rounded-lg shadow-sm relative">
                                    <input
                                        ref={inputRef}
                                        type="text"
                                        value={newMessage}
                                        onChange={handleInputChange}
                                        onKeyDown={handleInputKeyDown}
                                        placeholder={mediaPreview ? 'Add a caption...' : isWindowOpen(selectedChat) ? 'Type a message — use @ to send a template' : 'Send a template to start messaging...'}
                                        className="w-full bg-transparent border-none focus:outline-none px-4 py-2.5 text-[15px] text-[#111b21]"
                                        disabled={sending || uploading || (!mediaPreview && !isWindowOpen(selectedChat))}
                                    />

                                    {/* @ Template Picker Dropdown */}
                                    {showInlineTemplatePicker && filteredInlineTemplates.length > 0 && (
                                        <div ref={templatePickerRef} className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-2xl border border-slate-200 max-h-[220px] overflow-y-auto z-50">
                                            <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-2">
                                                <i className="fa-solid fa-file-lines text-[#00a884] text-xs"></i>
                                                <span className="text-xs font-semibold text-[#8696a0] uppercase tracking-wider">Templates</span>
                                                {templateQuery && <span className="text-xs text-slate-400 ml-auto">filtering: "{templateQuery}"</span>}
                                            </div>
                                            {filteredInlineTemplates.map(t => (
                                                <button
                                                    key={t._id}
                                                    onClick={() => handleSelectInlineTemplate(t)}
                                                    className="w-full text-left px-3 py-2.5 hover:bg-[#f0faf7] transition flex items-center gap-3 border-b border-slate-50 last:border-b-0"
                                                >
                                                    <div className="w-8 h-8 bg-[#e7fce3] rounded-lg flex items-center justify-center flex-shrink-0">
                                                        <i className="fa-solid fa-file-lines text-[#00a884] text-sm"></i>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-medium text-[#111b21] truncate">{t.name}</p>
                                                        <p className="text-[11px] text-[#8696a0] truncate">{t.category} • {t.language}</p>
                                                    </div>
                                                    <i className="fa-solid fa-paper-plane text-[#00a884] text-xs opacity-0 group-hover:opacity-100"></i>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {showInlineTemplatePicker && filteredInlineTemplates.length === 0 && (
                                        <div ref={templatePickerRef} className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 p-4 text-center">
                                            <i className="fa-solid fa-file-circle-xmark text-2xl text-slate-300 mb-1"></i>
                                            <p className="text-xs text-[#8696a0]">No matching templates</p>
                                        </div>
                                    )}
                                </div>

                                {/* Send / Mic */}
                                <button
                                    type="submit"
                                    disabled={(!mediaPreview && !newMessage.trim()) || sending || uploading || (!mediaPreview && !isWindowOpen(selectedChat))}
                                    className="w-10 h-10 rounded-full flex items-center justify-center transition text-[#54656f] hover:bg-slate-200 disabled:opacity-40"
                                >
                                    {sending || uploading ? (
                                        <i className="fa-solid fa-spinner fa-spin text-xl"></i>
                                    ) : mediaPreview || newMessage.trim() ? (
                                        <i className="fa-solid fa-paper-plane text-[#00a884] text-xl"></i>
                                    ) : (
                                        <i className="fa-solid fa-microphone text-xl"></i>
                                    )}
                                </button>
                            </form>
                            </div>
                        </div>
                    </>
                ) : (
                    /* Empty State */
                    <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5]">
                        <div className="text-center max-w-md">
                            <div className="w-72 h-72 mx-auto mb-6 relative">
                                <div className="absolute inset-0 bg-gradient-to-br from-[#25d366]/10 to-[#128c7e]/10 rounded-full animate-pulse"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <i className="fa-brands fa-whatsapp text-[120px] text-[#25d366]/20"></i>
                                </div>
                            </div>
                            <h2 className="text-[28px] font-light text-[#41525d] mb-2">WhatsApp Business</h2>
                            <p className="text-sm text-[#8696a0] leading-relaxed">
                                Send and receive messages without keeping your phone online.<br />
                                Select a conversation from the left panel to start messaging.
                            </p>
                            <button onClick={() => setShowNewChatModal(true)} className="mt-6 bg-[#00a884] hover:bg-[#008f6f] text-white px-6 py-2.5 rounded-full text-sm font-medium transition shadow-md">
                                <i className="fa-solid fa-plus mr-2"></i>Start New Chat
                            </button>
                            <div className="flex items-center justify-center gap-2 text-xs text-[#8696a0] mt-8">
                                <i className="fa-solid fa-lock text-[10px]"></i>
                                <span>End-to-end encrypted</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* ═══════════ CONTACT INFO PANEL ═══════════ */}
            {showContactPanel && selectedChat && (
                <div className="w-[340px] bg-[#f0f2f5] border-l border-[#e9edef] flex flex-col flex-shrink-0 overflow-y-auto">
                    {/* Panel Header */}
                    <div className="h-[60px] px-6 bg-[#f0f2f5] border-b border-[#e9edef] flex items-center gap-4 flex-shrink-0">
                        <button onClick={() => setShowContactPanel(false)} className="text-[#54656f] hover:text-[#111b21] transition">
                            <i className="fa-solid fa-xmark text-xl"></i>
                        </button>
                        <h3 className="font-semibold text-[#111b21]">Contact Info</h3>
                    </div>

                    {/* Avatar + Name */}
                    <div className="bg-white p-6 text-center mb-2">
                        <div className="w-[120px] h-[120px] bg-gradient-to-br from-[#dfe5e7] to-[#c4cdd2] rounded-full mx-auto mb-4 flex items-center justify-center text-white text-4xl font-light">
                            {selectedChat.displayName ? selectedChat.displayName.charAt(0).toUpperCase() : <i className="fa-solid fa-user text-4xl text-[#8696a0]"></i>}
                        </div>
                        <h2 className="text-xl font-semibold text-[#111b21]">{selectedChat.displayName || 'Unknown'}</h2>
                        <p className="text-sm text-[#8696a0] mt-1">{selectedChat.phone}</p>
                    </div>

                    {/* Lead Info */}
                    {selectedChat.leadId && (
                        <div className="bg-white p-5 mb-2">
                            <h4 className="text-sm font-medium text-[#8696a0] mb-3 uppercase tracking-wider">Linked Lead</h4>
                            <div className="space-y-2.5">
                                <div className="flex items-center gap-3">
                                    <i className="fa-solid fa-user text-[#00a884] w-5 text-center"></i>
                                    <span className="text-sm text-[#111b21]">{selectedChat.leadId.name || '—'}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <i className="fa-solid fa-envelope text-[#00a884] w-5 text-center"></i>
                                    <span className="text-sm text-[#111b21]">{selectedChat.leadId.email || '—'}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <i className="fa-solid fa-circle-dot text-[#00a884] w-5 text-center"></i>
                                    <span className="text-sm text-[#111b21]">{selectedChat.leadId.status || '—'}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Chat Stats */}
                    <div className="bg-white p-5 mb-2">
                        <h4 className="text-sm font-medium text-[#8696a0] mb-3 uppercase tracking-wider">Chat Stats</h4>
                        <div className="grid grid-cols-3 gap-3 text-center">
                            <div className="bg-[#f0f2f5] rounded-xl p-3">
                                <div className="text-lg font-bold text-[#111b21]">{selectedChat.metadata?.totalMessages || 0}</div>
                                <div className="text-[10px] text-[#8696a0] font-medium">Messages</div>
                            </div>
                            <div className="bg-[#f0f2f5] rounded-xl p-3">
                                <div className="text-lg font-bold text-[#00a884]">{selectedChat.metadata?.totalInbound || 0}</div>
                                <div className="text-[10px] text-[#8696a0] font-medium">Received</div>
                            </div>
                            <div className="bg-[#f0f2f5] rounded-xl p-3">
                                <div className="text-lg font-bold text-blue-500">{selectedChat.metadata?.totalOutbound || 0}</div>
                                <div className="text-[10px] text-[#8696a0] font-medium">Sent</div>
                            </div>
                        </div>
                    </div>

                    {/* First Contact */}
                    {selectedChat.metadata?.firstMessageAt && (
                        <div className="bg-white p-5">
                            <h4 className="text-sm font-medium text-[#8696a0] mb-2 uppercase tracking-wider">First Contact</h4>
                            <p className="text-sm text-[#111b21]">{new Date(selectedChat.metadata.firstMessageAt).toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════ NEW CHAT MODAL ═══════════ */}
            {showNewChatModal && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setShowNewChatModal(false)}>
                    <div className="bg-white rounded-2xl shadow-2xl w-[440px] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="bg-gradient-to-r from-[#00a884] to-[#25d366] p-5 text-white">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <i className="fa-solid fa-comment-dots"></i> New Conversation
                                </h3>
                                <button onClick={() => setShowNewChatModal(false)} className="text-white/80 hover:text-white transition">
                                    <i className="fa-solid fa-xmark text-xl"></i>
                                </button>
                            </div>
                            <p className="text-sm text-white/80 mt-1">Select an approved template to initiate the chat</p>
                        </div>
                        <div className="p-5 space-y-4">
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                                <i className="fa-solid fa-circle-info text-amber-500 mt-0.5"></i>
                                <p className="text-xs text-amber-700">WhatsApp requires you to send an <strong>approved template</strong> as the first message to a new contact. After they reply, you can send free-form text.</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[#111b21] mb-1.5">Phone Number</label>
                                <div className="relative">
                                    <i className="fa-solid fa-phone absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8696a0]"></i>
                                    <input
                                        type="text"
                                        value={newChatPhone}
                                        onChange={(e) => setNewChatPhone(e.target.value)}
                                        placeholder="e.g. 919876543210"
                                        className="w-full pl-10 pr-4 py-3 border border-[#e9edef] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] text-sm"
                                    />
                                </div>
                                <p className="text-[11px] text-[#8696a0] mt-1">Include country code without +</p>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[#111b21] mb-1.5">Template Message</label>
                                <select
                                    value={newChatTemplate}
                                    onChange={(e) => setNewChatTemplate(e.target.value)}
                                    className="w-full px-4 py-3 border border-[#e9edef] rounded-xl focus:outline-none focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] text-sm bg-white"
                                >
                                    <option value="">Select an approved template</option>
                                    {templates.map(t => (
                                        <option key={t._id} value={t.name}>{t.name} ({t.category})</option>
                                    ))}
                                </select>
                                {templates.length === 0 && <p className="text-xs text-red-500 mt-1">No approved templates. Create one in Templates tab first.</p>}
                            </div>
                            <button
                                onClick={handleStartNewChat}
                                disabled={startingChat || !newChatPhone.trim() || !newChatTemplate}
                                className="w-full bg-[#00a884] hover:bg-[#008f6f] text-white py-3 rounded-xl font-medium transition disabled:opacity-50 flex items-center justify-center gap-2 shadow-md"
                            >
                                {startingChat ? <><i className="fa-solid fa-spinner fa-spin"></i> Sending...</> : <><i className="fa-solid fa-paper-plane"></i> Send Template</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* ═══════════ IMAGE LIGHTBOX ═══════════ */}
            {selectedImage && (
                <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col animate-in fade-in zoom-in duration-200">
                    <button onClick={() => setSelectedImage(null)} className="absolute top-6 right-6 w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition backdrop-blur-md">
                        <i className="fa-solid fa-xmark text-2xl"></i>
                    </button>
                    <div className="flex-1 flex items-center justify-center p-12">
                        <img src={selectedImage} alt="Fullscreen" className="max-w-full max-h-full object-contain shadow-2xl rounded-sm" />
                    </div>
                </div>
            )}
        </div>
    );
};

export default WhatsAppInbox;
