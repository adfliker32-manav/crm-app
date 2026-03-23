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
    const [newChatEmail, setNewChatEmail] = useState('');
    const [filter, setFilter] = useState('all'); 
    
    const scrollRef = useRef(null);

    const fetchConversations = useCallback(async () => {
        try {
            const status = filter === 'archived' ? 'archived' : 'active';
            const res = await api.get('/email-conversations', {
                params: { status, search: searchTerm }
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

    // Poll for new emails
    useEffect(() => {
        const interval = setInterval(() => {
            fetchConversations();
            if (selectedChat) fetchMessages(selectedChat._id);
        }, 10000);
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
            const payload = {
                to: selectedChat.email,
                subject: newSubject.trim() || `Re: ${selectedChat.lastMessage || 'Conversation'}`,
                html: newMessage.trim(), // Send as HTML or Text
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
        if (!newChatEmail.trim()) return;
        
        setSending(true);
        try {
            const payload = {
                to: newChatEmail.trim(),
                subject: newSubject.trim() || 'New Message',
                html: newMessage.trim(),
                text: newMessage.trim()
            };
            await api.post('/email/send', payload);
            setShowNewChatModal(false);
            setNewChatEmail('');
            setNewMessage('');
            setNewSubject('');
            
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
                        onClick={() => { setShowNewChatModal(true); setNewMessage(''); setNewSubject(''); setSelectedChat(null); }}
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
                        { id: 'unread', label: 'Unread', count: totalUnread }
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
            <div className="flex-1 flex flex-col min-w-0 bg-white relative">
                {selectedChat ? (
                    <>
                        {/* Chat Header */}
                        <div className="h-[70px] px-6 bg-white border-b border-slate-100 flex items-center justify-between shadow-sm z-10 flex-shrink-0">
                            <div className="flex items-center gap-4 cursor-pointer" onClick={() => setShowContactPanel(!showContactPanel)}>
                                <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-600 font-bold text-xl">
                                    {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className="font-bold text-[16px] text-slate-800">{selectedChat.displayName || selectedChat.email}</h3>
                                    <p className="text-xs text-slate-500 font-medium">{selectedChat.email}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setShowContactPanel(!showContactPanel)} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 transition" title="Contact Info">
                                    <i className="fa-solid fa-circle-info text-lg"></i>
                                </button>
                            </div>
                        </div>

                        {/* Messages Area */}
                        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50" ref={scrollRef}>
                            <div className="space-y-6 max-w-4xl mx-auto">
                                {messages.map((msg, index) => {
                                    const showDate = index === 0 || new Date(msg.timestamp).toDateString() !== new Date(messages[index - 1].timestamp).toDateString();
                                    
                                    return (
                                        <React.Fragment key={msg._id}>
                                            {showDate && (
                                                <div className="flex justify-center my-6">
                                                    <span className="bg-slate-200/50 text-slate-500 tracking-wide text-[11px] font-bold uppercase px-3 py-1 rounded-full">
                                                        {new Date(msg.timestamp).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                                                    </span>
                                                </div>
                                            )}
                                            
                                            <div className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[75%] rounded-2xl p-4 shadow-sm relative group
                                                    ${msg.direction === 'outbound' 
                                                        ? 'bg-blue-600 text-white rounded-br-sm' 
                                                        : 'bg-white border border-slate-100 text-slate-800 rounded-bl-sm'}`}
                                                >
                                                    {/* Email Subject Header */}
                                                    <div className={`text-xs font-bold mb-2 pb-2 border-b uppercase tracking-wide
                                                        ${msg.direction === 'outbound' ? 'border-blue-500/50 text-blue-200' : 'border-slate-100 text-slate-400'}`}>
                                                        {msg.subject || '(No Subject)'}
                                                    </div>
                                                    
                                                    {/* Email Body */}
                                                    <div className={`text-[14px] leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto custom-scrollbar pr-2
                                                        ${msg.direction === 'outbound' ? 'text-white/90' : 'text-slate-700'}`}
                                                        dangerouslySetInnerHTML={msg.html ? { __html: DOMPurify.sanitize(msg.html) } : undefined}
                                                    >
                                                        {!msg.html && msg.text}
                                                    </div>
                                                    
                                                    {/* Footer Metadata */}
                                                    <div className={`flex items-center justify-end gap-2 mt-3 text-[11px] font-medium
                                                        ${msg.direction === 'outbound' ? 'text-blue-200' : 'text-slate-400'}`}>
                                                        <span>{formatTime(msg.timestamp)}</span>
                                                        {msg.direction === 'outbound' && (
                                                            <i className={`fa-solid ${msg.status === 'failed' ? 'fa-circle-exclamation text-rose-300' : 'fa-check text-blue-300'}`}></i>
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
                        <div className="bg-white border-t border-slate-200 p-4 shadow-[0_-4px_20px_-15px_rgba(0,0,0,0.1)] z-10 flex-shrink-0">
                            <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto">
                                <div className="mb-2">
                                    <input 
                                        type="text" 
                                        value={newSubject}
                                        onChange={(e) => setNewSubject(e.target.value)}
                                        placeholder="Subject"
                                        className="w-full text-sm font-semibold text-slate-700 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 transition"
                                        disabled={sending}
                                    />
                                </div>
                                <div className="flex items-end gap-3 bg-slate-50 border border-slate-200 rounded-2xl p-2 focus-within:border-blue-400 focus-within:bg-white transition-all">
                                    <textarea
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                        placeholder="Type your email reply..."
                                        className="w-full bg-transparent border-none focus:outline-none px-3 py-2 text-[15px] text-slate-800 resize-none min-h-[60px] max-h-[200px] custom-scrollbar"
                                        disabled={sending}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                handleSendMessage(e);
                                            }
                                        }}
                                    />
                                    <button
                                        type="submit"
                                        disabled={!newMessage.trim() || sending}
                                        className="w-12 h-12 rounded-xl flex items-center justify-center transition-all flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed
                                            bg-blue-600 hover:bg-blue-700 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5"
                                    >
                                        {sending ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-paper-plane"></i>}
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400 text-right mt-2 font-medium">Press Enter to send, Shift+Enter for new line</p>
                            </form>
                        </div>
                    </>
                ) : (
                    /* Empty State */
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-50">
                        <div className="w-32 h-32 bg-white rounded-full shadow-sm flex items-center justify-center mb-6 border border-slate-100 cursor-pointer hover:shadow-md transition" onClick={() => setShowNewChatModal(true)}>
                            <i className="fa-solid fa-envelope-open-text text-5xl text-blue-500/80"></i>
                        </div>
                        <h2 className="text-2xl font-bold text-slate-700 mb-2">Email Command Center</h2>
                        <p className="text-slate-500 text-center max-w-sm">
                            Select a thread from the left or start a new conversation to communicate with leads via Email.
                        </p>
                    </div>
                )}
            </div>

            {/* Compose New Email Modal */}
            {showNewChatModal && !selectedChat && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up">
                        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                <i className="fa-solid fa-pen-to-square text-blue-600"></i> Compose New Email
                            </h3>
                            <button onClick={() => setShowNewChatModal(false)} className="text-slate-400 hover:text-slate-600">
                                <i className="fa-solid fa-xmark text-xl"></i>
                            </button>
                        </div>
                        <form onSubmit={handleStartNewChat} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">To: Email Address</label>
                                <input
                                    type="email"
                                    required
                                    value={newChatEmail}
                                    onChange={(e) => setNewChatEmail(e.target.value)}
                                    placeholder="lead@example.com"
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Subject</label>
                                <input
                                    type="text"
                                    required
                                    value={newSubject}
                                    onChange={(e) => setNewSubject(e.target.value)}
                                    placeholder="Enter subject..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Message</label>
                                <textarea
                                    required
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    placeholder="Write your email here..."
                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all outline-none min-h-[150px] resize-y"
                                ></textarea>
                            </div>
                            <div className="pt-4 flex justify-end gap-3">
                                <button type="button" onClick={() => setShowNewChatModal(false)} className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition">
                                    Cancel
                                </button>
                                <button type="submit" disabled={sending} className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition shadow-md flex items-center gap-2">
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
