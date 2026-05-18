import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import DOMPurify from 'dompurify';

const EmailInbox = () => {
    const { showSuccess, showError } = useNotification();
    const [conversations, setConversations] = useState([]);
    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [newSubject, setNewSubject] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showContactPanel, setShowContactPanel] = useState(false);
    const [showNewChatModal, setShowNewChatModal] = useState(false);
    const [filter, setFilter] = useState('all');
    // Separate state for compose modal so it doesn't pollute the reply bar
    const [composeEmail, setComposeEmail] = useState('');
    const [composeCc, setComposeCc] = useState('');
    const [composeBcc, setComposeBcc] = useState('');
    const [composeSubject, setComposeSubject] = useState('');
    const [composeMessage, setComposeMessage] = useState('');
    const [composeSchedule, setComposeSchedule] = useState('');

    const scrollRef = useRef(null);

    const fetchConversations = useCallback(async () => {
        try {
            const status = filter === 'archived' ? 'archived' : 'active';
            const res = await api.get('/email-conversations', {
                params: { status, search: searchTerm, limit: 30 }
            });
            setConversations(res.data.conversations || []);
        } catch (error) {
            console.error('Error fetching conversations:', error);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, filter]);

    const fetchMessages = useCallback(async (conversationId) => {
        try {
            const res = await api.get(`/email-conversations/${conversationId}`);
            setMessages(res.data.messages || []);
            setSelectedChat(res.data.conversation);
            await api.put(`/email-conversations/${conversationId}/read`);
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

    // Poll for new emails — FIX G4: Pause when tab is not visible
    useEffect(() => {
        const interval = setInterval(() => {
            if (document.hidden) return; // Skip poll if tab not focused
            fetchConversations();
            if (selectedChat) fetchMessages(selectedChat._id);
        }, 15000); // Increased from 10s to 15s for less server load
        return () => clearInterval(interval);
    }, [selectedChat, fetchConversations, fetchMessages]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedChat) return;
        setSending(true);

        try {
            const htmlBody = newMessage.trim().replace(/\n/g, '<br>');
            const payload = {
                to: selectedChat.email,
                subject: newSubject.trim() || `Re: ${selectedChat.lastMessage || 'Conversation'}`,
                html: htmlBody,
                text: newMessage.trim()
            };
            
            await api.post('/email/send', payload);
            
            // Re-fetch to get the newly mapped message from the DB
            await fetchMessages(selectedChat._id);
            fetchConversations();
            
            setNewMessage('');
            setNewSubject('');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to send email');
        } finally {
            setSending(false);
        }
    };

    const handleStartNewChat = async (e) => {
        e.preventDefault();
        if (!composeEmail.trim()) return;

        setSending(true);
        try {
            const htmlBody = composeMessage.trim().replace(/\n/g, '<br>');
            const payload = {
                to: composeEmail.trim(),
                subject: composeSubject.trim() || 'New Message',
                html: htmlBody,
                text: composeMessage.trim()
            };

            if (composeCc.trim()) payload.cc = composeCc.trim();
            if (composeBcc.trim()) payload.bcc = composeBcc.trim();
            if (composeSchedule) payload.scheduledFor = new Date(composeSchedule).toISOString();

            await api.post('/email/send', payload);
            setShowNewChatModal(false);
            setComposeEmail('');
            setComposeCc('');
            setComposeBcc('');
            setComposeSchedule('');
            setComposeSubject('');
            setComposeMessage('');

            await fetchConversations();
            showSuccess('Email sent successfully!');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to start conversation');
        } finally {
            setSending(false);
        }
    };

    const handleSelectChat = (chat) => {
        setSelectedChat(chat);
        setNewSubject(`Re: ${chat.lastMessage || 'Conversation'}`);
        fetchMessages(chat._id);
        setShowContactPanel(false);
    };

    const formatTime = (date) => {
        if (!date) return '';
        const d = new Date(date);
        const now = new Date();
        const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    };

    // 'archived' filter is handled server-side via status param.
    // 'unread' is client-side since we already have the full page loaded.
    const filteredConversations = filter === 'unread'
        ? conversations.filter(c => c.unreadCount > 0)
        : conversations;

    const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-full bg-[#f0f2f5]">
                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <p className="text-slate-500 font-medium">Loading inbox...</p>
            </div>
        );
    }

    return (
        <div className="flex h-full bg-[#f0f2f5] w-full">
            {/* ═══════════ LEFT SIDEBAR ═══════════ */}
            <div className="w-[380px] bg-white border-r border-[#e9edef] flex flex-col flex-shrink-0 z-10">
                {/* Sidebar Header */}
                <div className="p-3 bg-slate-50 flex items-center justify-between border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center text-white shadow-sm">
                            <i className="fa-solid fa-envelope text-lg"></i>
                        </div>
                        <div>
                            <span className="font-bold text-slate-800 text-sm">Email Inbox</span>
                            {totalUnread > 0 && (
                                <span className="ml-2 bg-blue-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{totalUnread}</span>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={() => { setShowNewChatModal(true); setComposeEmail(''); setComposeSubject(''); setComposeMessage(''); setComposeCc(''); setComposeBcc(''); setComposeSchedule(''); }}
                        className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition"
                        title="Compose Email"
                    >
                        <i className="fa-solid fa-pen-to-square"></i>
                    </button>
                </div>

                {/* Search */}
                <div className="p-3 bg-white">
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
                        <input
                            type="text"
                            placeholder="Search emails or contacts"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-4 py-2 bg-slate-100 border-transparent focus:border-blue-500 focus:ring-2 focus:ring-blue-200 rounded-xl text-sm transition"
                        />
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-3 pb-3 border-b border-slate-50 flex gap-2">
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'unread', label: 'Unread', count: totalUnread },
                        { id: 'archived', label: 'Archived' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setFilter(tab.id)}
                            className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${filter === tab.id
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {tab.label}
                            {tab.count > 0 && <span className="ml-1.5 bg-blue-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{tab.count}</span>}
                        </button>
                    ))}
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {filteredConversations.map(chat => (
                        <div
                            key={chat._id}
                            onClick={() => handleSelectChat(chat)}
                            className={`px-4 py-3 border-b border-slate-50 cursor-pointer transition-colors ${selectedChat?._id === chat._id
                                ? 'bg-blue-50/50 border-l-4 border-l-blue-500'
                                : 'hover:bg-slate-50 border-l-4 border-l-transparent'}`}
                        >
                            <div className="flex gap-3">
                                <div className="flex-shrink-0 mt-1">
                                    <div className={`w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-sm ${chat.unreadCount > 0 ? 'bg-gradient-to-br from-blue-500 to-indigo-500' : 'bg-slate-300'}`}>
                                        {(chat.displayName || chat.email).charAt(0).toUpperCase()}
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className={`text-[15px] truncate w-4/5 ${chat.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                                            {chat.displayName || chat.email.split('@')[0]}
                                        </h3>
                                        <span className={`text-[11px] flex-shrink-0 ${chat.unreadCount > 0 ? 'text-blue-600 font-bold' : 'text-slate-400'}`}>
                                            {formatTime(chat.lastMessageAt)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className={`text-[13px] truncate ${chat.unreadCount > 0 ? 'text-slate-800 font-medium' : 'text-slate-500'}`}>
                                            {chat.lastMessageDirection === 'outbound' && (
                                                <i className="fa-solid fa-reply text-[10px] mr-1 text-slate-400"></i>
                                            )}
                                            {chat.lastMessage || 'No messages'}
                                        </p>
                                        {chat.unreadCount > 0 && (
                                            <span className="bg-blue-500 text-white text-[11px] font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                                                {chat.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {filteredConversations.length === 0 && (
                        <div className="p-10 text-center flex flex-col items-center">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                                <i className="fa-solid fa-envelope-open text-2xl text-slate-300"></i>
                            </div>
                            <p className="text-sm font-medium text-slate-500">No conversations found</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════════ CHAT WINDOW ═══════════ */}
            <div className="flex-1 flex min-w-0 bg-white relative overflow-hidden">
                {selectedChat ? (
                    <>
                        {/* Main thread column */}
                        <div className="flex-1 flex flex-col min-w-0">
                            {/* Chat Header */}
                            <div className="h-[68px] px-5 bg-white border-b border-slate-100 flex items-center justify-between flex-shrink-0">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-br from-indigo-400 to-blue-500 rounded-full flex items-center justify-center text-white font-bold text-base shadow-sm flex-shrink-0">
                                        {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-[15px] text-slate-800 leading-tight">{selectedChat.displayName || selectedChat.email}</h3>
                                        <p className="text-[11px] text-slate-400 font-medium">{selectedChat.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {selectedChat.metadata?.totalMessages > 0 && (
                                        <span className="text-xs text-slate-400 font-medium mr-2">
                                            {selectedChat.metadata.totalMessages} messages
                                        </span>
                                    )}
                                    <button
                                        onClick={() => setShowContactPanel(v => !v)}
                                        className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm transition
                                            ${showContactPanel ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-slate-100 text-slate-400'}`}
                                        title="Contact Info"
                                    >
                                        <i className="fa-solid fa-circle-info"></i>
                                    </button>
                                </div>
                            </div>

                            {/* Messages Area */}
                            <div className="flex-1 overflow-y-auto px-5 py-4 bg-[#f7f8fc]" ref={scrollRef}>
                                <div className="space-y-4 max-w-3xl mx-auto">
                                    {messages.length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
                                            <i className="fa-solid fa-envelope-open text-3xl text-slate-200"></i>
                                            <p className="text-sm text-slate-400">No messages yet in this thread</p>
                                        </div>
                                    )}
                                    {messages.map((msg, index) => {
                                        const showDate = index === 0 ||
                                            new Date(msg.timestamp).toDateString() !== new Date(messages[index - 1].timestamp).toDateString();
                                        const isOut = msg.direction === 'outbound';

                                        return (
                                            <React.Fragment key={msg._id}>
                                                {showDate && (
                                                    <div className="flex justify-center my-4">
                                                        <span className="bg-white/80 text-slate-400 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                                                            {new Date(msg.timestamp).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className={`flex items-end gap-2 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                                    {!isOut && (
                                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-400 to-slate-500 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 mb-1">
                                                            {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className={`max-w-[72%] rounded-2xl overflow-hidden shadow-sm
                                                        ${isOut ? 'bg-indigo-600 rounded-br-sm' : 'bg-white border border-slate-200 rounded-bl-sm'}`}>
                                                        {/* Subject strip */}
                                                        <div className={`px-4 pt-3 pb-2 border-b text-[10px] font-bold uppercase tracking-widest truncate
                                                            ${isOut ? 'border-indigo-500/40 text-indigo-300' : 'border-slate-100 text-slate-400'}`}>
                                                            {msg.subject || '(No Subject)'}
                                                        </div>
                                                        {/* Body */}
                                                        {msg.html ? (
                                                            <div
                                                                className={`px-4 pt-2 pb-3 text-[13.5px] leading-relaxed max-h-[380px] overflow-y-auto custom-scrollbar
                                                                    ${isOut ? 'text-white/90' : 'text-slate-700'}`}
                                                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.html) }}
                                                            />
                                                        ) : (
                                                            <div className={`px-4 pt-2 pb-3 text-[13.5px] leading-relaxed max-h-[380px] overflow-y-auto custom-scrollbar
                                                                ${isOut ? 'text-white/90' : 'text-slate-700'}`}>
                                                                {msg.text}
                                                            </div>
                                                        )}
                                                        {/* Timestamp */}
                                                        <div className={`px-4 pb-2.5 flex items-center justify-end gap-1.5 text-[10px] font-medium
                                                            ${isOut ? 'text-indigo-300' : 'text-slate-300'}`}>
                                                            <span>{formatTime(msg.timestamp)}</span>
                                                            {isOut && (
                                                                <i className={`fa-solid text-[9px] ${msg.status === 'failed' ? 'fa-circle-exclamation text-rose-300' : 'fa-check-double'}`}></i>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Compose Bar */}
                            <div className="bg-white border-t border-slate-200 px-5 py-3 flex-shrink-0">
                                <form onSubmit={handleSendMessage}>
                                    <input
                                        type="text"
                                        value={newSubject}
                                        onChange={(e) => setNewSubject(e.target.value)}
                                        placeholder="Subject line..."
                                        className="w-full text-xs font-semibold text-slate-600 px-3 py-2 mb-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-indigo-300 transition"
                                        disabled={sending}
                                    />
                                    <div className="flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-3 py-2 focus-within:border-indigo-400 focus-within:bg-white transition-all">
                                        <textarea
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            placeholder="Write your reply..."
                                            rows={2}
                                            className="flex-1 bg-transparent border-none focus:outline-none text-[14px] text-slate-800 resize-none min-h-[44px] max-h-[180px] custom-scrollbar"
                                            disabled={sending}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); }
                                            }}
                                        />
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || sending}
                                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all
                                                bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {sending ? <i className="fa-solid fa-spinner fa-spin text-sm"></i> : <i className="fa-solid fa-paper-plane text-sm"></i>}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-slate-300 text-right mt-1.5 font-medium">Enter to send · Shift+Enter new line</p>
                                </form>
                            </div>
                        </div>

                        {/* ═══ Contact Panel (slide-in) ═══ */}
                        {showContactPanel && (
                            <div className="w-64 flex-shrink-0 border-l border-slate-100 bg-slate-50/60 flex flex-col overflow-y-auto">
                                {/* Panel Header */}
                                <div className="px-4 py-4 border-b border-slate-100 flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Contact Info</span>
                                    <button onClick={() => setShowContactPanel(false)} className="text-slate-300 hover:text-slate-500 transition">
                                        <i className="fa-solid fa-xmark text-sm"></i>
                                    </button>
                                </div>

                                {/* Avatar + name */}
                                <div className="flex flex-col items-center gap-2 py-6 px-4 border-b border-slate-100">
                                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-400 to-blue-500 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-md">
                                        {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                    </div>
                                    <p className="text-sm font-bold text-slate-800 text-center leading-tight">
                                        {selectedChat.displayName || selectedChat.email.split('@')[0]}
                                    </p>
                                    <p className="text-xs text-slate-400 font-medium text-center break-all">{selectedChat.email}</p>
                                    {selectedChat.leadId?.status && (
                                        <span className="mt-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-600">
                                            {selectedChat.leadId.status}
                                        </span>
                                    )}
                                </div>

                                {/* Stats */}
                                <div className="px-4 py-4 space-y-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Thread Stats</p>
                                    {[
                                        { icon: 'fa-envelope', label: 'Total Messages', value: selectedChat.metadata?.totalMessages ?? '—' },
                                        { icon: 'fa-arrow-up', label: 'Sent', value: selectedChat.metadata?.totalOutbound ?? '—' },
                                        { icon: 'fa-arrow-down', label: 'Received', value: selectedChat.metadata?.totalInbound ?? '—' },
                                        { icon: 'fa-circle-dot', label: 'Unread', value: selectedChat.unreadCount ?? 0 },
                                    ].map(row => (
                                        <div key={row.label} className="flex items-center justify-between">
                                            <span className="flex items-center gap-2 text-xs text-slate-500">
                                                <i className={`fa-solid ${row.icon} text-slate-300 w-3`}></i>
                                                {row.label}
                                            </span>
                                            <span className="text-xs font-bold text-slate-700">{row.value}</span>
                                        </div>
                                    ))}
                                    {selectedChat.lastMessageAt && (
                                        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                                            <span className="text-xs text-slate-400">Last message</span>
                                            <span className="text-xs font-semibold text-slate-500">{formatTime(selectedChat.lastMessageAt)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    /* Empty State */
                    <div className="flex-1 flex flex-col items-center justify-center bg-[#f7f8fc] gap-5">
                        <div
                            onClick={() => { setShowNewChatModal(true); setComposeEmail(''); setComposeSubject(''); setComposeMessage(''); setComposeCc(''); setComposeBcc(''); setComposeSchedule(''); }}
                            className="w-24 h-24 bg-white rounded-3xl shadow-md flex items-center justify-center cursor-pointer hover:shadow-lg hover:scale-105 transition-all border border-slate-100"
                        >
                            <i className="fa-solid fa-envelope-open-text text-4xl text-indigo-500/70"></i>
                        </div>
                        <div className="text-center">
                            <h2 className="text-xl font-bold text-slate-700 mb-1">Select a conversation</h2>
                            <p className="text-sm text-slate-400 max-w-xs">Pick a thread on the left, or click the icon above to compose a new email.</p>
                        </div>
                        <button
                            onClick={() => { setShowNewChatModal(true); setComposeEmail(''); setComposeSubject(''); setComposeMessage(''); setComposeCc(''); setComposeBcc(''); setComposeSchedule(''); }}
                            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition shadow-md shadow-indigo-200"
                        >
                            <i className="fa-solid fa-pen-to-square"></i> Compose New Email
                        </button>
                    </div>
                )}
            </div>

            {/* Compose New Email Modal — uses isolated compose state, never touches reply bar */}
            {showNewChatModal && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up">
                        <div className="px-6 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 flex justify-between items-center">
                            <h3 className="font-bold text-white text-base flex items-center gap-2">
                                <i className="fa-solid fa-pen-to-square"></i> Compose New Email
                            </h3>
                            <button onClick={() => setShowNewChatModal(false)} className="text-white/70 hover:text-white transition">
                                <i className="fa-solid fa-xmark text-lg"></i>
                            </button>
                        </div>
                        <form onSubmit={handleStartNewChat} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">To: Email Address <span className="text-red-500">*</span></label>
                                    <input
                                        type="email"
                                        required
                                        value={composeEmail}
                                        onChange={(e) => setComposeEmail(e.target.value)}
                                        placeholder="lead@example.com"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Schedule For (Optional)</label>
                                    <input
                                        type="datetime-local"
                                        value={composeSchedule}
                                        onChange={(e) => setComposeSchedule(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">CC (Optional)</label>
                                    <input
                                        type="text"
                                        value={composeCc}
                                        onChange={(e) => setComposeCc(e.target.value)}
                                        placeholder="comma separated emails"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">BCC (Optional)</label>
                                    <input
                                        type="text"
                                        value={composeBcc}
                                        onChange={(e) => setComposeBcc(e.target.value)}
                                        placeholder="comma separated emails"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Subject</label>
                                <input
                                    type="text"
                                    required
                                    value={composeSubject}
                                    onChange={(e) => setComposeSubject(e.target.value)}
                                    placeholder="Enter subject..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Message</label>
                                <textarea
                                    required
                                    value={composeMessage}
                                    onChange={(e) => setComposeMessage(e.target.value)}
                                    placeholder="Write your email here..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none min-h-[150px] resize-y"
                                ></textarea>
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button type="button" onClick={() => setShowNewChatModal(false)} className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition">
                                    Cancel
                                </button>
                                <button type="submit" disabled={sending} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition shadow-md shadow-indigo-200 flex items-center gap-2 text-sm">
                                    {sending ? <><i className="fa-solid fa-spinner fa-spin"></i> Sending...</> : <><i className="fa-solid fa-paper-plane"></i> Send Email</>}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EmailInbox;
