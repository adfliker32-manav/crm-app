import React, { useState, useEffect, useRef, useCallback } from 'react';
// Theme: CRM blue (matches sidebar + WhatsApp inbox)
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
            <div className="flex flex-col items-center justify-center h-full bg-slate-50/50">
                <div className="relative">
                    <div className="w-12 h-12 border-4 border-blue-100 rounded-full animate-spin"></div>
                    <div className="w-12 h-12 border-4 border-transparent border-t-blue-600 rounded-full animate-spin absolute top-0 left-0"></div>
                </div>
                <p className="text-slate-500 font-semibold text-xs mt-4 tracking-wide">Loading premium inbox...</p>
            </div>
        );
    }

    return (
        <div className="flex h-full bg-[#f8fafc] w-full font-sans select-none overflow-hidden animate-fade-in">
            {/* ═══════════ LEFT SIDEBAR ═══════════ */}
            <div className="w-[360px] bg-white border-r border-slate-200/60 flex flex-col flex-shrink-0 z-10 shadow-sm">
                {/* Sidebar Header */}
                <div className="px-5 py-4 bg-white flex items-center justify-between border-b border-slate-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-tr from-blue-500 via-blue-600 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-500/25">
                            <i className="fa-solid fa-envelope text-base"></i>
                        </div>
                        <div>
                            <span className="font-bold text-slate-800 text-[15px] tracking-tight">Email Inbox</span>
                            {totalUnread > 0 && (
                                <span className="ml-2 bg-blue-600 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm shadow-blue-600/20">{totalUnread}</span>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={() => { setShowNewChatModal(true); setComposeEmail(''); setComposeSubject(''); setComposeMessage(''); setComposeCc(''); setComposeBcc(''); setComposeSchedule(''); }}
                        className="w-10 h-10 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-all duration-200 active:scale-95 shadow-sm border border-blue-100/50"
                        title="Compose Email"
                    >
                        <i className="fa-solid fa-pen-to-square text-[14px]"></i>
                    </button>
                </div>

                {/* Search */}
                <div className="px-5 py-3.5 bg-white">
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]"></i>
                        <input
                            type="text"
                            placeholder="Search emails or contacts..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200/80 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl text-xs transition duration-200 outline-none placeholder:text-slate-400 text-slate-700 font-medium"
                        />
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-5 pb-3.5 bg-white border-b border-slate-100 flex gap-1.5">
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'unread', label: 'Unread', count: totalUnread },
                        { id: 'archived', label: 'Archived' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setFilter(tab.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition duration-200 active:scale-95 flex items-center ${filter === tab.id
                                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/10'
                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100/80 border border-transparent'}`}
                        >
                            {tab.label}
                            {tab.count > 0 && <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-black ${filter === tab.id ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'}`}>{tab.count}</span>}
                        </button>
                    ))}
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50/40 p-3 space-y-2">
                    {filteredConversations.map(chat => (
                        <div
                            key={chat._id}
                            onClick={() => handleSelectChat(chat)}
                            className={`p-3.5 rounded-xl cursor-pointer transition-all duration-300 border flex flex-col gap-1.5 ${selectedChat?._id === chat._id
                                ? 'bg-white border-blue-200/80 shadow-md shadow-blue-500/5 ring-1 ring-blue-500/5 -translate-y-0.5'
                                : 'bg-white/60 hover:bg-white border-slate-100 hover:shadow-sm hover:-translate-y-0.5'}`}
                        >
                            <div className="flex gap-3">
                                <div className="flex-shrink-0">
                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-[14px] shadow-sm ${chat.unreadCount > 0 ? 'bg-gradient-to-br from-blue-500 to-blue-600' : 'bg-slate-200 text-slate-500'}`}>
                                        {(chat.displayName || chat.email).charAt(0).toUpperCase()}
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-0.5">
                                        <h3 className={`text-xs truncate w-[70%] ${chat.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                                            {chat.displayName || chat.email.split('@')[0]}
                                        </h3>
                                        <span className={`text-[10px] flex-shrink-0 ${chat.unreadCount > 0 ? 'text-blue-600 font-bold' : 'text-slate-400 font-medium'}`}>
                                            {formatTime(chat.lastMessageAt)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className={`text-[11.5px] truncate max-w-[85%] leading-relaxed ${chat.unreadCount > 0 ? 'text-slate-800 font-bold' : 'text-slate-500 font-medium'}`}>
                                            {chat.lastMessageDirection === 'outbound' && (
                                                <i className="fa-solid fa-reply text-[9px] mr-1.5 text-slate-400"></i>
                                            )}
                                            {chat.lastMessage || 'No messages'}
                                        </p>
                                        {chat.unreadCount > 0 && (
                                            <span className="bg-blue-600 text-white text-[9.5px] font-black min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center flex-shrink-0 ml-2 shadow-sm shadow-blue-600/10">
                                                {chat.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {filteredConversations.length === 0 && (
                        <div className="p-12 text-center flex flex-col items-center justify-center h-full">
                            <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 border border-slate-100 shadow-sm">
                                <i className="fa-solid fa-envelope-open text-xl text-slate-300"></i>
                            </div>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">No conversations</p>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══════════ CHAT WINDOW ═══════════ */}
            <div className="flex-1 flex min-w-0 bg-white relative overflow-hidden h-full">
                {selectedChat ? (
                    <>
                        {/* Main thread column */}
                        <div className="flex-1 flex flex-col min-w-0 h-full">
                            {/* Chat Header */}
                            <div className="h-[72px] px-6 bg-white border-b border-slate-100 flex items-center justify-between flex-shrink-0 shadow-sm z-10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-gradient-to-tr from-blue-500 via-blue-600 to-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm flex-shrink-0">
                                        {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-[14px] text-slate-800 leading-tight">{selectedChat.displayName || selectedChat.email}</h3>
                                        <p className="text-[10px] text-slate-400 font-semibold mt-0.5 tracking-wide">{selectedChat.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedChat.metadata?.totalMessages > 0 && (
                                        <span className="text-[11px] text-slate-400 font-bold bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                                            {selectedChat.metadata.totalMessages} messages
                                        </span>
                                    )}
                                    <button
                                        onClick={() => setShowContactPanel(v => !v)}
                                        className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm transition-all duration-200 active:scale-95 border
                                            ${showContactPanel ? 'bg-blue-50 text-blue-600 border-blue-100/50' : 'hover:bg-slate-50 text-slate-400 border-transparent bg-transparent'}`}
                                        title="Contact Info"
                                    >
                                        <i className="fa-solid fa-circle-info"></i>
                                    </button>
                                </div>
                            </div>

                            {/* Messages Area */}
                            <div className="flex-1 overflow-y-auto px-6 py-6 bg-slate-50/30 custom-scrollbar" ref={scrollRef}>
                                <div className="space-y-6 max-w-4xl mx-auto">
                                    {messages.length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                                            <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm border border-slate-100">
                                                <i className="fa-solid fa-envelope-open text-lg text-slate-300"></i>
                                            </div>
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">No messages yet in this thread</p>
                                        </div>
                                    )}
                                    {messages.map((msg, index) => {
                                        const showDate = index === 0 ||
                                            new Date(msg.timestamp).toDateString() !== new Date(messages[index - 1].timestamp).toDateString();
                                        const isOut = msg.direction === 'outbound';

                                        return (
                                            <React.Fragment key={msg._id}>
                                                {showDate && (
                                                    <div className="flex justify-center my-6">
                                                        <span className="bg-white text-slate-400 text-[9px] font-black uppercase tracking-widest px-3.5 py-1.5 rounded-xl border border-slate-100 shadow-sm">
                                                            {new Date(msg.timestamp).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className={`flex items-start gap-3.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                                    {!isOut && (
                                                        <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-400 to-slate-500 flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0 shadow-sm mt-0.5">
                                                            {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className={`max-w-[75%] rounded-2xl overflow-hidden shadow-sm border flex flex-col
                                                        ${isOut ? 'bg-gradient-to-br from-blue-600 via-blue-700 to-blue-700 border-blue-700 text-white rounded-tr-none' : 'bg-white border-slate-100 text-slate-800 rounded-tl-none'}`}>
                                                        {/* Subject strip */}
                                                        <div className={`px-6 py-2.5 border-b text-[9.5px] font-black uppercase tracking-widest truncate
                                                            ${isOut ? 'border-white/10 text-blue-200' : 'border-slate-50 text-slate-400'}`}>
                                                            {msg.subject || '(No Subject)'}
                                                        </div>
                                                        {/* Body */}
                                                        {msg.html ? (
                                                            <div
                                                                className={`px-6 py-3.5 text-[13px] leading-relaxed select-text font-medium
                                                                    ${isOut ? 'text-white/95' : 'text-slate-700'}`}
                                                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.html) }}
                                                            />
                                                        ) : (
                                                            <div className={`px-6 py-3.5 text-[13px] leading-relaxed select-text font-medium
                                                                ${isOut ? 'text-white/95' : 'text-slate-700'}`}>
                                                                {msg.text}
                                                            </div>
                                                        )}
                                                        {/* Timestamp */}
                                                        <div className={`px-6 pb-2.5 flex items-center justify-end gap-2 text-[9px] font-bold tracking-wide
                                                            ${isOut ? 'text-blue-200' : 'text-slate-400'}`}>
                                                            <span>{formatTime(msg.timestamp)}</span>
                                                            {isOut && (
                                                                <i className={`fa-solid text-[9.5px] ${msg.status === 'failed' ? 'fa-circle-exclamation text-rose-300' : 'fa-check-double text-blue-300'}`}></i>
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
                            <div className="bg-white border-t border-slate-100 px-6 py-4 flex-shrink-0 shadow-inner">
                                <form onSubmit={handleSendMessage}>
                                    <input
                                        type="text"
                                        value={newSubject}
                                        onChange={(e) => setNewSubject(e.target.value)}
                                        placeholder="Subject line..."
                                        className="w-full text-xs font-bold text-slate-600 px-4 py-2.5 mb-3 bg-slate-50/50 border border-slate-200/80 rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition duration-200 outline-none"
                                        disabled={sending}
                                    />
                                    <div className="flex items-end gap-3 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:bg-white transition-all duration-200">
                                        <textarea
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                            placeholder="Write your reply..."
                                            rows={2}
                                            className="flex-1 bg-transparent border-none focus:outline-none text-[13px] text-slate-800 font-medium resize-none min-h-[44px] max-h-[180px] custom-scrollbar"
                                            disabled={sending}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); }
                                            }}
                                        />
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || sending}
                                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 active:scale-95
                                                bg-blue-600 hover:bg-blue-700 text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {sending ? <i className="fa-solid fa-spinner fa-spin text-xs"></i> : <i className="fa-solid fa-paper-plane text-[13px]"></i>}
                                        </button>
                                    </div>
                                    <p className="text-[9.5px] text-slate-400 text-right mt-2 font-bold tracking-wide">Enter to send · Shift+Enter new line</p>
                                </form>
                            </div>
                        </div>

                        {/* ═══ Contact Panel (slide-in) ═══ */}
                        {showContactPanel && (
                            <div className="w-68 flex-shrink-0 border-l border-slate-200/80 bg-white flex flex-col overflow-y-auto custom-scrollbar h-full shadow-sm">
                                {/* Panel Header */}
                                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact Info</span>
                                    <button onClick={() => setShowContactPanel(false)} className="text-slate-300 hover:text-slate-500 transition duration-200">
                                        <i className="fa-solid fa-xmark text-base"></i>
                                    </button>
                                </div>

                                {/* Avatar + name */}
                                <div className="flex flex-col items-center gap-2 py-8 px-5 border-b border-slate-50 bg-slate-50/20">
                                    <div className="w-16 h-16 bg-gradient-to-tr from-blue-500 via-blue-700 to-blue-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-md shadow-blue-500/10">
                                        {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                    </div>
                                    <p className="text-sm font-bold text-slate-800 text-center leading-tight mt-3">
                                        {selectedChat.displayName || selectedChat.email.split('@')[0]}
                                    </p>
                                    <p className="text-[11px] text-slate-400 font-semibold text-center break-all">{selectedChat.email}</p>
                                    {selectedChat.leadId?.status && (
                                        <span className="mt-3 text-[9.5px] font-black uppercase tracking-widest px-3 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100/50 shadow-sm">
                                            {selectedChat.leadId.status}
                                        </span>
                                    )}
                                </div>

                                {/* Stats */}
                                <div className="px-5 py-5 space-y-4">
                                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Thread Stats</p>
                                    {[
                                        { icon: 'fa-envelope', label: 'Total Messages', value: selectedChat.metadata?.totalMessages ?? '—' },
                                        { icon: 'fa-arrow-up', label: 'Sent', value: selectedChat.metadata?.totalOutbound ?? '—' },
                                        { icon: 'fa-arrow-down', label: 'Received', value: selectedChat.metadata?.totalInbound ?? '—' },
                                        { icon: 'fa-circle-dot', label: 'Unread', value: selectedChat.unreadCount ?? 0 },
                                    ].map(row => (
                                        <div key={row.label} className="flex items-center justify-between">
                                            <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                                                <i className={`fa-solid ${row.icon} text-slate-300 w-3`}></i>
                                                {row.label}
                                            </span>
                                            <span className="text-xs font-bold text-slate-700">{row.value}</span>
                                        </div>
                                    ))}
                                    {selectedChat.lastMessageAt && (
                                        <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
                                            <span className="text-[11px] font-bold text-slate-400">Last activity</span>
                                            <span className="text-xs font-bold text-slate-500">{formatTime(selectedChat.lastMessageAt)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    /* Empty State */
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-50/20 gap-6 h-full p-6 text-center select-none">
                        <div
                            onClick={() => { setShowNewChatModal(true); setComposeEmail(''); setComposeSubject(''); setComposeMessage(''); setComposeCc(''); setComposeBcc(''); setComposeSchedule(''); }}
                            className="w-24 h-24 bg-white rounded-[24px] shadow-lg shadow-slate-100 flex items-center justify-center cursor-pointer hover:shadow-xl hover:scale-105 active:scale-95 border border-slate-100 transition-all duration-300"
                        >
                            <i className="fa-solid fa-envelope-open-text text-3xl text-blue-500"></i>
                        </div>
                        <div>
                            <h2 className="text-base font-black text-slate-800 mb-1">Select a conversation</h2>
                            <p className="text-xs font-semibold text-slate-400 max-w-[280px] leading-relaxed mx-auto">Pick a thread on the left, or create a brand new conversation to start emailing.</p>
                        </div>
                        <button
                            onClick={() => { setShowNewChatModal(true); setComposeEmail(''); setComposeSubject(''); setComposeMessage(''); setComposeCc(''); setComposeBcc(''); setComposeSchedule(''); }}
                            className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition duration-200 shadow-md shadow-blue-100 active:scale-95"
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
                        <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700 flex justify-between items-center">
                            <h3 className="font-bold text-white text-sm flex items-center gap-2">
                                <i className="fa-solid fa-pen-to-square"></i> Compose New Email
                            </h3>
                            <button onClick={() => setShowNewChatModal(false)} className="text-white/80 hover:text-white transition duration-200">
                                <i className="fa-solid fa-xmark text-base"></i>
                            </button>
                        </div>
                        <form onSubmit={handleStartNewChat} className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">To: Email Address <span className="text-red-500">*</span></label>
                                    <input
                                        type="email"
                                        required
                                        value={composeEmail}
                                        onChange={(e) => setComposeEmail(e.target.value)}
                                        placeholder="lead@example.com"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl transition-all duration-200 outline-none text-xs font-bold text-slate-700"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Schedule For (Optional)</label>
                                    <input
                                        type="datetime-local"
                                        value={composeSchedule}
                                        onChange={(e) => setComposeSchedule(e.target.value)}
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl transition-all duration-200 outline-none text-xs font-semibold text-slate-700"
                                    />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">CC (Optional)</label>
                                    <input
                                        type="text"
                                        value={composeCc}
                                        onChange={(e) => setComposeCc(e.target.value)}
                                        placeholder="comma separated emails"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl transition-all duration-200 outline-none text-xs font-semibold text-slate-700"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">BCC (Optional)</label>
                                    <input
                                        type="text"
                                        value={composeBcc}
                                        onChange={(e) => setComposeBcc(e.target.value)}
                                        placeholder="comma separated emails"
                                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl transition-all duration-200 outline-none text-xs font-semibold text-slate-700"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Subject</label>
                                <input
                                    type="text"
                                    required
                                    value={composeSubject}
                                    onChange={(e) => setComposeSubject(e.target.value)}
                                    placeholder="Enter subject..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl transition-all duration-200 outline-none text-xs font-bold text-slate-700"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Message</label>
                                <textarea
                                    required
                                    value={composeMessage}
                                    onChange={(e) => setComposeMessage(e.target.value)}
                                    placeholder="Write your email here..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 rounded-xl transition-all duration-200 outline-none min-h-[150px] resize-y text-xs font-medium text-slate-700 leading-relaxed"
                                ></textarea>
                            </div>
                            <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                                <button type="button" onClick={() => setShowNewChatModal(false)} className="px-5 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition">
                                    Cancel
                                </button>
                                <button type="submit" disabled={sending} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-md shadow-blue-100 flex items-center gap-2 text-xs">
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
