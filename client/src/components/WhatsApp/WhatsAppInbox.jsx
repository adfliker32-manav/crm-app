import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const WhatsAppInbox = () => {
    const { showSuccess, showError } = useNotification();
    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const scrollRef = useRef(null);

    const fetchConversations = useCallback(async () => {
        try {
            const res = await api.get('/whatsapp/conversations', {
                params: { status: 'active', search: searchTerm }
            });
            setConversations(res.data.conversations || []);
        } catch (error) {
            console.error('Error fetching conversations:', error);
            showError('Failed to load conversations');
        } finally {
            setLoading(false);
        }
    }, [searchTerm, showError]);

    const fetchMessages = useCallback(async (conversationId) => {
        try {
            const res = await api.get(`/whatsapp/conversations/${conversationId}`);
            setMessages(res.data.messages || []);
            setSelectedChat(res.data.conversation);

            await api.put(`/whatsapp/conversations/${conversationId}/read`);

            setConversations(prev => prev.map(c =>
                c._id === conversationId ? { ...c, unreadCount: 0 } : c
            ));
        } catch (error) {
            console.error('Error fetching messages:', error);
            showError('Failed to load messages');
        }
    }, [showError]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    useEffect(() => {
        const interval = setInterval(() => {
            fetchConversations();
            if (selectedChat) {
                fetchMessages(selectedChat._id);
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [selectedChat, fetchConversations, fetchMessages]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedChat) return;

        setSending(true);
        try {
            const res = await api.post(`/whatsapp/conversations/${selectedChat._id}/send`, {
                text: newMessage.trim()
            });

            setMessages(prev => [...prev, res.data.message]);
            setNewMessage('');

            setConversations(prev => prev.map(c =>
                c._id === selectedChat._id
                    ? { ...c, lastMessage: newMessage.trim(), lastMessageAt: new Date(), lastMessageDirection: 'outbound' }
                    : c
            ));

            showSuccess('Message sent!');
        } catch (error) {
            console.error('Error sending message:', error);
            showError(error.response?.data?.message || 'Failed to send message');
        } finally {
            setSending(false);
        }
    };

    const handleSelectChat = (chat) => {
        setSelectedChat(chat);
        fetchMessages(chat._id);
    };

    const formatTime = (date) => {
        const d = new Date(date);
        const now = new Date();
        const diffMs = now - d;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return d.toLocaleDateString([], { weekday: 'short' });
        } else {
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    };

    const renderMessageContent = (message) => {
        if (message.type === 'text') {
            return message.content.text;
        } else if (message.type === 'image') {
            return message.content.caption || '📷 Image';
        } else if (message.type === 'document') {
            return `📄 ${message.content.fileName || 'Document'}`;
        } else if (message.type === 'audio') {
            return '🎵 Audio';
        } else if (message.type === 'video') {
            return message.content.caption || '🎬 Video';
        } else if (message.type === 'location') {
            return `📍 ${message.content.locationName || 'Location'}`;
        }
        return 'Message';
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f0f2f5]">
                <div className="text-center">
                    <i className="fa-solid fa-spinner fa-spin text-4xl text-[#00a884] mb-3"></i>
                    <p className="text-slate-600">Loading conversations...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full bg-[#f0f2f5]">
            {/* Left Sidebar - Conversations List */}
            <div className="w-[30%] bg-white border-r border-slate-200 flex flex-col">
                {/* Search Bar */}
                <div className="p-3 bg-[#f0f2f5]">
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input
                            type="text"
                            placeholder="Search or start new chat"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-2.5 bg-white border-none rounded-lg text-sm focus:outline-none"
                        />
                    </div>
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto bg-white">
                    {conversations.map(chat => (
                        <div
                            key={chat._id}
                            onClick={() => handleSelectChat(chat)}
                            className={`px-4 py-3 border-b border-slate-100 cursor-pointer hover:bg-[#f5f6f6] transition ${selectedChat?._id === chat._id ? 'bg-[#f0f2f5]' : ''
                                }`}
                        >
                            <div className="flex gap-3">
                                {/* Avatar */}
                                <div className="flex-shrink-0">
                                    <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center text-slate-600">
                                        <i className="fa-solid fa-user text-lg"></i>
                                    </div>
                                </div>

                                {/* Chat Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-semibold text-[#111b21] truncate">
                                            {chat.displayName || chat.phone}
                                        </h3>
                                        <span className="text-xs text-slate-500 flex-shrink-0 ml-2">
                                            {formatTime(chat.lastMessageAt)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className="text-sm text-slate-600 truncate flex items-center gap-1">
                                            {chat.lastMessageDirection === 'outbound' && (
                                                <i className="fa-solid fa-check-double text-[#53bdeb] text-xs"></i>
                                            )}
                                            <span className="truncate">{chat.lastMessage}</span>
                                        </p>
                                        {chat.unreadCount > 0 && (
                                            <span className="bg-[#25d366] text-white text-xs font-semibold px-2 py-0.5 rounded-full min-w-[20px] text-center flex-shrink-0 ml-2">
                                                {chat.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {conversations.length === 0 && (
                        <div className="p-8 text-center text-slate-400">
                            <i className="fa-brands fa-whatsapp text-6xl mb-4 text-slate-300"></i>
                            <p className="text-sm">No conversations yet</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Pane - Chat Window */}
            <div className="flex-1 flex flex-col">
                {selectedChat ? (
                    <>
                        {/* Chat Header */}
                        <div className="px-4 py-3 bg-[#f0f2f5] border-b border-slate-200 flex items-center gap-3">
                            <div className="w-10 h-10 bg-slate-200 rounded-full flex items-center justify-center text-slate-600">
                                <i className="fa-solid fa-user"></i>
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-[#111b21]">
                                    {selectedChat.displayName || selectedChat.phone}
                                </h3>
                                <p className="text-xs text-slate-500">{selectedChat.phone}</p>
                            </div>
                            <div className="flex gap-4 text-slate-600">
                                <button className="hover:text-slate-800 transition">
                                    <i className="fa-solid fa-search text-xl"></i>
                                </button>
                                <button className="hover:text-slate-800 transition">
                                    <i className="fa-solid fa-ellipsis-vertical text-xl"></i>
                                </button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div
                            className="flex-1 overflow-y-auto p-4 bg-[#efeae2]"
                            ref={scrollRef}
                            style={{
                                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 0h100v100H0z\' fill=\'%23efeae2\'/%3E%3Cpath d=\'M20 20h60v60H20z\' fill=\'%23fff\' opacity=\'.03\'/%3E%3C/svg%3E")'
                            }}
                        >
                            <div className="space-y-2 max-w-4xl mx-auto">
                                {messages.map((msg) => (
                                    <div
                                        key={msg._id}
                                        className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`max-w-[65%] rounded-lg px-3 py-2 shadow-sm ${msg.direction === 'outbound'
                                                    ? 'bg-[#d9fdd3]'
                                                    : 'bg-white'
                                                }`}
                                        >
                                            <p className="text-sm text-[#111b21] break-words">{renderMessageContent(msg)}</p>
                                            <div className="flex items-center justify-end gap-1 mt-1">
                                                <span className="text-[10px] text-slate-500">{formatTime(msg.timestamp)}</span>
                                                {msg.direction === 'outbound' && (
                                                    <i className={`fa-solid text-[10px] ${msg.status === 'read' ? 'fa-check-double text-[#53bdeb]' :
                                                            msg.status === 'delivered' ? 'fa-check-double text-slate-400' :
                                                                msg.status === 'sent' ? 'fa-check text-slate-400' :
                                                                    'fa-clock text-slate-400'
                                                        }`}></i>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Input Area */}
                        <div className="p-3 bg-[#f0f2f5] border-t border-slate-200">
                            <form onSubmit={handleSendMessage} className="flex gap-2 items-center">
                                <button type="button" className="p-2 text-slate-600 hover:text-slate-800 transition">
                                    <i className="fa-solid fa-face-smile text-2xl"></i>
                                </button>
                                <button type="button" className="p-2 text-slate-600 hover:text-slate-800 transition">
                                    <i className="fa-solid fa-paperclip text-xl"></i>
                                </button>

                                <div className="flex-1 bg-white rounded-lg flex items-center px-4">
                                    <input
                                        type="text"
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        placeholder="Type a message"
                                        className="w-full bg-transparent border-none focus:outline-none py-2.5 text-sm"
                                        disabled={sending}
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={!newMessage.trim() || sending}
                                    className="p-3 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-full transition disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    {sending ? (
                                        <i className="fa-solid fa-spinner fa-spin"></i>
                                    ) : (
                                        <i className="fa-solid fa-paper-plane"></i>
                                    )}
                                </button>
                            </form>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center bg-[#f0f2f5] border-l border-slate-200">
                        <div className="text-center max-w-md">
                            <div className="w-64 h-64 mx-auto mb-8 relative">
                                <div className="absolute inset-0 bg-gradient-to-br from-[#25d366] to-[#128c7e] rounded-full opacity-10"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <i className="fa-brands fa-whatsapp text-9xl text-[#25d366] opacity-30"></i>
                                </div>
                            </div>
                            <h2 className="text-3xl font-light text-[#41525d] mb-3">WhatsApp Business</h2>
                            <p className="text-sm text-slate-500 mb-6">
                                Send and receive messages without keeping your phone online.<br />
                                Select a conversation to start messaging.
                            </p>
                            <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
                                <i className="fa-solid fa-lock"></i>
                                <span>End-to-end encrypted</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default WhatsAppInbox;
