import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../services/api';
import useSocket from '../../hooks/useSocket';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const ATTACH_LIMITS = { image: 5 * 1024 * 1024, video: 20 * 1024 * 1024 };

const fileUrl = (relativeUrl) => {
    if (!relativeUrl) return '';
    if (/^https?:/i.test(relativeUrl)) return relativeUrl;
    const base = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api')).replace(/\/api$/, '');
    const token = localStorage.getItem('token');
    const sep = relativeUrl.includes('?') ? '&' : '?';
    return `${base}${relativeUrl}${sep}token=${encodeURIComponent(token || '')}`;
};

const SupportWidget = () => {
    const { pathname } = useLocation();
    const [open, setOpen] = useState(false);
    const [view, setView] = useState('list'); // 'list' | 'new' | 'chat'
    const [tickets, setTickets] = useState([]);
    const [activeTicket, setActiveTicket] = useState(null);
    const [messages, setMessages] = useState([]);
    const [subject, setSubject] = useState('');
    const [draft, setDraft] = useState('');
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [unread, setUnread] = useState(0);
    const fileRef = useRef(null);
    const scrollRef = useRef(null);
    const { socket } = useSocket();
    const { showError, showSuccess } = useNotification();
    const { showDanger } = useConfirm();

    // Sum unread across the user's own tickets — used to badge the floating button.
    const recomputeUnread = useCallback((list) => {
        const total = (list || []).reduce((sum, t) => sum + (Number(t.unreadByUser) || 0), 0);
        setUnread(total);
    }, []);

    const loadTickets = useCallback(async () => {
        try {
            const res = await api.get('/support/tickets');
            const list = res.data.tickets || [];
            setTickets(list);
            recomputeUnread(list);
        } catch { /* silent — widget is non-critical */ }
    }, [recomputeUnread]);

    const loadMessages = useCallback(async (ticketId) => {
        try {
            const res = await api.get(`/support/tickets/${ticketId}/messages`);
            setActiveTicket(res.data.ticket);
            setMessages(res.data.messages || []);
        } catch {
            showError('Could not load conversation');
        }
    }, [showError]);

    useEffect(() => {
        if (open) loadTickets();
    }, [open, loadTickets]);

    // Initial unread sweep on mount so the red dot appears even before the panel is opened
    useEffect(() => {
        loadTickets();
    }, [loadTickets]);

    useEffect(() => {
        if (!socket) return;
        const onNewMessage = ({ ticketId, message }) => {
            const isAdminMsg = message?.senderRole === 'superadmin';
            const isActive = activeTicket && String(activeTicket._id) === String(ticketId);

            if (isActive) {
                setMessages(prev => [...prev, message]);
                // Conversation is open & visible — server has marked read on next refresh
            } else if (isAdminMsg) {
                // Optimistically bump the red dot immediately so user sees it without re-fetch
                setUnread(u => u + 1);
                // Soft chime via browser if allowed (no-op if blocked)
                try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(() => {}); } catch { /* audio blocked — ignore */ }
                loadTickets();
            }
        };
        const onClosed = ({ ticketId }) => {
            if (activeTicket && String(activeTicket._id) === String(ticketId)) {
                setActiveTicket(null);
                setMessages([]);
                setView('list');
                showSuccess('Support ticket closed');
            }
            loadTickets();
        };
        socket.on('support:newMessage', onNewMessage);
        socket.on('support:ticketClosed', onClosed);
        return () => {
            socket.off('support:newMessage', onNewMessage);
            socket.off('support:ticketClosed', onClosed);
        };
    }, [socket, activeTicket, loadTickets, showSuccess]);

    // When user opens a conversation, server marks it read — clear local unread for it
    useEffect(() => {
        if (view === 'chat' && activeTicket) {
            setTickets(prev => prev.map(t => t._id === activeTicket._id ? { ...t, unreadByUser: 0 } : t));
            setUnread(u => Math.max(0, u - (activeTicket.unreadByUser || 0)));
        }
    }, [view, activeTicket]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    const validateFiles = (incoming) => {
        for (const f of incoming) {
            const isImage = f.type.startsWith('image/');
            const isVideo = f.type.startsWith('video/');
            if (!isImage && !isVideo) {
                showError(`${f.name}: only images or videos allowed`);
                return false;
            }
            const cap = isImage ? ATTACH_LIMITS.image : ATTACH_LIMITS.video;
            if (f.size > cap) {
                showError(`${f.name}: max ${isImage ? '5MB' : '20MB'}`);
                return false;
            }
        }
        return true;
    };

    const onFilesPicked = (e) => {
        const picked = Array.from(e.target.files || []).slice(0, 3);
        if (validateFiles(picked)) setFiles(picked);
        e.target.value = '';
    };

    const createTicket = async () => {
        if (!subject.trim()) return showError('Please enter a subject');
        if (!draft.trim() && !files.length) return showError('Please describe your issue or attach a file');
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append('subject', subject.trim());
            fd.append('message', draft.trim());
            files.forEach(f => fd.append('files', f));
            const res = await api.post('/support/tickets', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setSubject(''); setDraft(''); setFiles([]);
            showSuccess('Ticket sent');
            await loadMessages(res.data.ticket._id);
            setView('chat');
            loadTickets();
        } catch (e) {
            showError(e.response?.data?.message || 'Failed to create ticket');
        } finally { setBusy(false); }
    };

    const sendReply = async () => {
        if (!activeTicket) return;
        if (!draft.trim() && !files.length) return;
        setBusy(true);
        try {
            const fd = new FormData();
            fd.append('text', draft.trim());
            files.forEach(f => fd.append('files', f));
            const res = await api.post(`/support/tickets/${activeTicket._id}/messages`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            setMessages(prev => [...prev, res.data.message]);
            setDraft(''); setFiles([]);
        } catch (e) {
            showError(e.response?.data?.message || 'Failed to send');
        } finally { setBusy(false); }
    };

    const closeActive = async () => {
        if (!activeTicket) return;
        const ok = await showDanger('Close this ticket? All messages and attachments will be permanently deleted.', 'Close ticket');
        if (!ok) return;
        try {
            await api.patch(`/support/tickets/${activeTicket._id}/close`);
            setActiveTicket(null);
            setMessages([]);
            setView('list');
            loadTickets();
            showSuccess('Ticket closed and cleaned up');
        } catch (e) {
            showError(e.response?.data?.message || 'Failed to close');
        }
    };

    // Show Help button only on dashboard pages — it overlaps action buttons elsewhere
    if (pathname !== '/dashboard' && pathname !== '/agency/dashboard') return null;

    return (
        <>
            {/* Floating launcher — compact "Help" pill with unread dot */}
            {!open && (
                <button
                    onClick={() => setOpen(true)}
                    title={unread > 0 ? `${unread} new message${unread > 1 ? 's' : ''} from support` : 'Help & Support'}
                    className="fixed bottom-5 right-5 z-50 flex items-center gap-1.5 pl-2 pr-3 py-1.5
                               bg-gradient-to-br from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800
                               text-white rounded-full shadow-md
                               hover:scale-105 active:scale-95 transition-all duration-200"
                >
                    <span className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center">
                        <i className="fa-solid fa-headset text-[12px]"></i>
                    </span>
                    <span className="font-semibold text-xs tracking-wide">Help</span>

                    {/* Red unread dot — only when admin has replied */}
                    {unread > 0 && (
                        <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full
                                         bg-red-500 text-white text-[9px] font-bold flex items-center justify-center
                                         border border-white shadow animate-pulse">
                            {unread > 9 ? '9+' : unread}
                        </span>
                    )}
                </button>
            )}

            {/* Chat panel */}
            {open && (
                <div className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-2rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {view !== 'list' && (
                                <button
                                    onClick={() => { setView('list'); setActiveTicket(null); setMessages([]); }}
                                    className="hover:text-blue-200"
                                    title="Back"
                                >
                                    <i className="fa-solid fa-arrow-left"></i>
                                </button>
                            )}
                            <i className="fa-solid fa-life-ring"></i>
                            <span className="font-semibold text-sm">
                                {view === 'list' && 'Help & Support'}
                                {view === 'new' && 'New Ticket'}
                                {view === 'chat' && (activeTicket?.subject || 'Conversation')}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {view === 'chat' && (
                                <button onClick={closeActive} className="text-xs bg-white/20 hover:bg-white/30 px-2 py-1 rounded" title="Close & delete">
                                    <i className="fa-solid fa-check mr-1"></i>Close
                                </button>
                            )}
                            <button onClick={() => setOpen(false)} className="hover:text-blue-200" title="Minimize">
                                <i className="fa-solid fa-minus"></i>
                            </button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 overflow-hidden flex flex-col">
                        {view === 'list' && (
                            <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-slate-50">
                                <button
                                    onClick={() => setView('new')}
                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg flex items-center justify-center gap-2"
                                >
                                    <i className="fa-solid fa-plus"></i> New Support Ticket
                                </button>
                                {tickets.length === 0 && (
                                    <p className="text-sm text-slate-500 text-center mt-6">No open tickets. Click above to start a conversation.</p>
                                )}
                                {tickets.map(t => (
                                    <button
                                        key={t._id}
                                        onClick={() => { loadMessages(t._id); setView('chat'); }}
                                        className="w-full text-left bg-white hover:bg-blue-50 border border-slate-200 rounded-lg p-3 transition"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-slate-800 truncate">{t.subject}</p>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    {t.status === 'admin_replied' ? 'Support replied' : t.status === 'user_replied' ? 'Waiting on support' : 'Open'}
                                                </p>
                                            </div>
                                            {t.unreadByUser > 0 && (
                                                <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.unreadByUser}</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {view === 'new' && (
                            <div className="flex-1 overflow-y-auto p-3 bg-slate-50 space-y-3">
                                <input
                                    type="text"
                                    placeholder="Subject (e.g. WhatsApp template not approved)"
                                    value={subject}
                                    onChange={(e) => setSubject(e.target.value)}
                                    maxLength={200}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <textarea
                                    placeholder="Describe your issue in detail..."
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    rows={6}
                                    maxLength={4000}
                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                {files.length > 0 && (
                                    <div className="space-y-1">
                                        {files.map((f, i) => (
                                            <div key={i} className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded px-2 py-1">
                                                <span className="truncate">{f.type.startsWith('video/') ? '🎥' : '🖼️'} {f.name}</span>
                                                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-red-500 hover:text-red-700">
                                                    <i className="fa-solid fa-times"></i>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => fileRef.current?.click()}
                                        className="text-xs px-3 py-1.5 bg-slate-200 hover:bg-slate-300 rounded-lg flex items-center gap-1"
                                    >
                                        <i className="fa-solid fa-paperclip"></i> Attach
                                    </button>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="image/*,video/*"
                                        multiple
                                        onChange={onFilesPicked}
                                        className="hidden"
                                    />
                                    <button
                                        onClick={createTicket}
                                        disabled={busy}
                                        className="ml-auto bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm font-medium px-4 py-1.5 rounded-lg"
                                    >
                                        {busy ? 'Sending...' : 'Send'}
                                    </button>
                                </div>
                                <p className="text-[11px] text-slate-500">Images up to 5MB, videos up to 20MB (max 3 files).</p>
                            </div>
                        )}

                        {view === 'chat' && activeTicket && (
                            <>
                                <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
                                    {messages.map(m => (
                                        <div key={m._id} className={`flex ${m.senderRole === 'customer' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.senderRole === 'customer' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-200 text-slate-800'}`}>
                                                {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                                                {(m.attachments || []).map((a, i) => (
                                                    <div key={i} className="mt-2">
                                                        {a.kind === 'image' ? (
                                                            <a href={fileUrl(a.url)} target="_blank" rel="noreferrer">
                                                                <img src={fileUrl(a.url)} alt={a.filename} className="rounded max-w-full max-h-40" />
                                                            </a>
                                                        ) : (
                                                            <video src={fileUrl(a.url)} controls className="rounded max-w-full max-h-40" />
                                                        )}
                                                    </div>
                                                ))}
                                                <p className={`text-[10px] mt-1 ${m.senderRole === 'customer' ? 'text-blue-200' : 'text-slate-400'}`}>
                                                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="p-2 border-t border-slate-200 bg-white">
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
                                            placeholder="Type a message..."
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                            className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button
                                            onClick={sendReply}
                                            disabled={busy}
                                            className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white p-2 rounded-lg"
                                        >
                                            <i className="fa-solid fa-paper-plane"></i>
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

export default SupportWidget;
