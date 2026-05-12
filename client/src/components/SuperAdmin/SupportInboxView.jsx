import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import useSocket from '../../hooks/useSocket';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const fileUrl = (relativeUrl) => {
    if (!relativeUrl) return '';
    if (/^https?:/i.test(relativeUrl)) return relativeUrl;
    const base = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api')).replace(/\/api$/, '');
    const token = localStorage.getItem('token');
    const sep = relativeUrl.includes('?') ? '&' : '?';
    return `${base}${relativeUrl}${sep}token=${encodeURIComponent(token || '')}`;
};

const TAG_COLORS = {
    billing: 'bg-amber-100 text-amber-700',
    whatsapp: 'bg-green-100 text-green-700',
    meta: 'bg-blue-100 text-blue-700',
    email: 'bg-indigo-100 text-indigo-700',
    error: 'bg-red-100 text-red-700',
    leads: 'bg-purple-100 text-purple-700',
    general: 'bg-slate-100 text-slate-700'
};

const SupportInboxView = () => {
    const [tickets, setTickets] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [activeTicket, setActiveTicket] = useState(null);
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(true);
    const fileRef = useRef(null);
    const scrollRef = useRef(null);
    const { socket } = useSocket();
    const { showError, showSuccess } = useNotification();
    const { showDanger } = useConfirm();

    const loadTickets = useCallback(async () => {
        try {
            const res = await api.get('/support/admin/tickets');
            setTickets(res.data.tickets || []);
        } catch (e) {
            showError('Failed to load support inbox');
        }
    }, [showError]);

    const loadSuggestions = useCallback(async (ticketId, tag) => {
        try {
            const r = await api.get('/support/admin/canned', { params: { tag: tag || 'general', ticketId } });
            setSuggestions(r.data.suggestions || (r.data.suggestion ? [r.data.suggestion] : []));
            setShowSuggestions(true);
        } catch (_) { setSuggestions([]); }
    }, []);

    const loadConversation = useCallback(async (ticketId) => {
        try {
            const res = await api.get(`/support/tickets/${ticketId}/messages`);
            setActiveTicket(res.data.ticket);
            setMessages(res.data.messages || []);
            setActiveId(ticketId);
            loadSuggestions(ticketId, res.data.ticket?.tag);
            // Optimistically clear unread badge locally
            setTickets(prev => prev.map(t => t._id === ticketId ? { ...t, unreadByAdmin: 0 } : t));
        } catch (e) {
            showError('Could not load conversation');
        }
    }, [showError, loadSuggestions]);

    useEffect(() => { loadTickets(); }, [loadTickets]);

    useEffect(() => {
        if (!socket) return;
        const onNewTicket = () => loadTickets();
        const onNewMessage = ({ ticketId, message }) => {
            if (activeId && String(activeId) === String(ticketId)) {
                setMessages(prev => [...prev, message]);
                // Refresh suggestions when a NEW customer message arrives
                if (message?.senderRole === 'customer') {
                    loadSuggestions(ticketId, activeTicket?.tag);
                }
            }
            loadTickets();
        };
        const onClosed = ({ ticketId }) => {
            if (activeId && String(activeId) === String(ticketId)) {
                setActiveId(null);
                setActiveTicket(null);
                setMessages([]);
            }
            loadTickets();
        };
        socket.on('support:newTicket', onNewTicket);
        socket.on('support:newMessage', onNewMessage);
        socket.on('support:ticketClosed', onClosed);
        return () => {
            socket.off('support:newTicket', onNewTicket);
            socket.off('support:newMessage', onNewMessage);
            socket.off('support:ticketClosed', onClosed);
        };
    }, [socket, activeId, loadTickets, loadSuggestions, activeTicket]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    const onFilesPicked = (e) => {
        const picked = Array.from(e.target.files || []).slice(0, 3);
        setFiles(picked);
        e.target.value = '';
    };

    const sendReply = async () => {
        if (!activeId || (!draft.trim() && !files.length)) return;
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append('text', draft.trim());
            files.forEach(f => fd.append('files', f));
            const res = await api.post(`/support/tickets/${activeId}/messages`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setMessages(prev => [...prev, res.data.message]);
            setDraft(''); setFiles([]);
            loadTickets();
        } catch (e) {
            showError(e.response?.data?.message || 'Failed to send');
        } finally { setBusy(false); }
    };

    const closeActive = async () => {
        if (!activeId) return;
        const ok = await showDanger('Close this ticket? All messages and attachments will be permanently deleted from the database and disk.', 'Close & purge');
        if (!ok) return;
        try {
            await api.patch(`/support/tickets/${activeId}/close`);
            setActiveId(null);
            setActiveTicket(null);
            setMessages([]);
            loadTickets();
            showSuccess('Ticket closed and purged');
        } catch (e) {
            showError(e.response?.data?.message || 'Failed to close');
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800">Support Inbox</h1>
                    <p className="text-sm text-slate-500">Live help requests from customers. Conversations are purged on close.</p>
                </div>
                <button
                    onClick={loadTickets}
                    className="text-sm bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg"
                >
                    <i className="fa-solid fa-rotate"></i> Refresh
                </button>
            </div>

            <div className="grid grid-cols-12 gap-4 bg-white rounded-xl border border-slate-200 overflow-hidden" style={{ height: 'calc(100vh - 200px)' }}>
                {/* Ticket list */}
                <div className="col-span-4 border-r border-slate-200 overflow-y-auto">
                    {tickets.length === 0 && (
                        <p className="p-6 text-sm text-slate-500 text-center">No open tickets right now.</p>
                    )}
                    {tickets.map(t => (
                        <button
                            key={t._id}
                            onClick={() => loadConversation(t._id)}
                            className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-blue-50 transition ${activeId === t._id ? 'bg-blue-50' : ''}`}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase ${TAG_COLORS[t.tag] || TAG_COLORS.general}`}>{t.tag}</span>
                                        {t.unreadByAdmin > 0 && (
                                            <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.unreadByAdmin}</span>
                                        )}
                                    </div>
                                    <p className="text-sm font-semibold text-slate-800 truncate">{t.subject}</p>
                                    <p className="text-xs text-slate-500 truncate">{t.createdByName || t.createdByEmail}</p>
                                </div>
                                <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                    {new Date(t.lastMessageAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Conversation */}
                <div className="col-span-8 flex flex-col">
                    {!activeTicket && (
                        <div className="flex-1 flex items-center justify-center text-slate-400">
                            <p>Select a ticket to view the conversation</p>
                        </div>
                    )}
                    {activeTicket && (
                        <>
                            <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between bg-slate-50">
                                <div>
                                    <p className="font-semibold text-slate-800">{activeTicket.subject}</p>
                                    <p className="text-xs text-slate-500">
                                        From <strong>{activeTicket.createdByName}</strong> ({activeTicket.createdByEmail}) · {activeTicket.createdByRole}
                                    </p>
                                </div>
                                <button
                                    onClick={closeActive}
                                    className="text-sm bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg"
                                >
                                    <i className="fa-solid fa-check"></i> Close & Purge
                                </button>
                            </div>

                            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
                                {messages.map(m => (
                                    <div key={m._id} className={`flex ${m.senderRole === 'superadmin' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.senderRole === 'superadmin' ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                                            <p className={`text-[10px] font-semibold mb-0.5 ${m.senderRole === 'superadmin' ? 'text-indigo-200' : 'text-slate-500'}`}>{m.senderName || (m.senderRole === 'superadmin' ? 'You' : 'Customer')}</p>
                                            {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                                            {(m.attachments || []).map((a, i) => (
                                                <div key={i} className="mt-2">
                                                    {a.kind === 'image' ? (
                                                        <a href={fileUrl(a.url)} target="_blank" rel="noreferrer">
                                                            <img src={fileUrl(a.url)} alt={a.filename} className="rounded max-w-full max-h-56" />
                                                        </a>
                                                    ) : (
                                                        <video src={fileUrl(a.url)} controls className="rounded max-w-full max-h-56" />
                                                    )}
                                                </div>
                                            ))}
                                            <p className={`text-[10px] mt-1 ${m.senderRole === 'superadmin' ? 'text-indigo-200' : 'text-slate-400'}`}>
                                                {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {suggestions.length > 0 && showSuggestions && (
                                <div className="px-3 py-2 bg-amber-50 border-t border-amber-200">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <span className="text-[11px] font-semibold text-amber-700 flex items-center gap-1">
                                            <i className="fa-solid fa-wand-magic-sparkles"></i> Smart suggestions ({suggestions.length})
                                        </span>
                                        <button
                                            onClick={() => setShowSuggestions(false)}
                                            className="text-amber-700 hover:text-amber-900 text-xs"
                                            title="Hide suggestions"
                                        >
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {suggestions.map((s, i) => (
                                            <button
                                                key={i}
                                                onClick={() => setDraft(s)}
                                                title={s}
                                                className="text-[11px] bg-white hover:bg-amber-100 border border-amber-300 text-amber-900 rounded-full px-3 py-1 max-w-[280px] truncate transition"
                                            >
                                                <i className="fa-solid fa-bolt text-amber-500 mr-1"></i>
                                                {s.length > 70 ? s.slice(0, 70) + '…' : s}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {suggestions.length > 0 && !showSuggestions && (
                                <button
                                    onClick={() => setShowSuggestions(true)}
                                    className="text-[11px] text-amber-700 hover:text-amber-900 px-3 py-1 border-t border-amber-200 bg-amber-50 text-left"
                                >
                                    <i className="fa-solid fa-wand-magic-sparkles mr-1"></i> Show {suggestions.length} smart suggestion{suggestions.length > 1 ? 's' : ''}
                                </button>
                            )}

                            <div className="p-3 border-t border-slate-200 bg-white">
                                {files.length > 0 && (
                                    <div className="space-y-1 mb-2">
                                        {files.map((f, i) => (
                                            <div key={i} className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                                <span className="truncate">{f.type.startsWith('video/') ? '🎥' : '🖼️'} {f.name}</span>
                                                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-red-500">×</button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center gap-2">
                                    <button onClick={() => fileRef.current?.click()} className="text-slate-500 hover:text-blue-600" title="Attach">
                                        <i className="fa-solid fa-paperclip"></i>
                                    </button>
                                    <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={onFilesPicked} className="hidden" />
                                    <input
                                        type="text"
                                        placeholder="Type your reply..."
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                    <button
                                        onClick={sendReply}
                                        disabled={busy}
                                        className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white px-4 py-2 rounded-lg"
                                    >
                                        <i className="fa-solid fa-paper-plane mr-1"></i> Send
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SupportInboxView;
