import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import api from '../../services/api';
import useSocket from '../../hooks/useSocket';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';

const ATTACH_LIMITS = { image: 5 * 1024 * 1024, video: 20 * 1024 * 1024 };

const CATEGORIES = [
    { value: '', label: 'Select category (optional)' },
    { value: 'billing', label: '💳 Billing & Plans' },
    { value: 'whatsapp', label: '🔧 WhatsApp' },
    { value: 'email', label: '📧 Email / SMTP' },
    { value: 'meta', label: '🔗 Meta / Facebook' },
    { value: 'leads', label: '👥 Leads' },
    { value: 'other', label: '📋 Other' },
];

const QUICK_HELP = [
    {
        icon: '🔧', title: 'WhatsApp Setup',
        content: 'Go to Settings → WhatsApp to connect your number via the Meta Business API. Make sure your Facebook Business is verified and you have a valid phone number that isn\'t registered on regular WhatsApp.',
        link: '/settings', linkLabel: 'Go to Settings →',
    },
    {
        icon: '📧', title: 'Email / SMTP Help',
        content: 'Configure your SMTP credentials in Settings → Email to start sending email campaigns. Use services like Gmail, Outlook, SendGrid or any SMTP provider. Test the connection before sending live campaigns.',
        link: '/settings', linkLabel: 'Go to Settings →',
    },
    {
        icon: '💳', title: 'Billing & Plans',
        content: 'Manage your subscription, upgrade or downgrade your plan, and view invoices from the Plans page. Contact support if you need a custom plan or have billing questions.',
        link: '/plans', linkLabel: 'View Plans →',
    },
    {
        icon: '🔗', title: 'Meta / Facebook Leads',
        content: 'Connect your Facebook Lead Ads in Settings → Meta Integration. Once connected, new leads from your Facebook forms will automatically sync to your CRM in real-time.',
        link: '/settings', linkLabel: 'Go to Settings →',
    },
];

const fileUrl = (relativeUrl) => {
    if (!relativeUrl) return '';
    if (/^https?:/i.test(relativeUrl)) return relativeUrl;
    const base = (import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api')).replace(/\/api$/, '');
    const token = localStorage.getItem('token');
    const sep = relativeUrl.includes('?') ? '&' : '?';
    return `${base}${relativeUrl}${sep}token=${encodeURIComponent(token || '')}`;
};

/* ─── Date separator helper ─── */
const isSameDay = (d1, d2) => {
    const a = new Date(d1), b = new Date(d2);
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};
const formatDateLabel = (dateStr) => {
    const d = new Date(dateStr);
    const today = new Date();
    const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
    if (isSameDay(d, today)) return 'Today';
    if (isSameDay(d, yesterday)) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/* ─── Inline styles for animations that Tailwind can't do ─── */
const widgetKeyframes = `
@keyframes supportWidgetIn {
    from { opacity: 0; transform: scale(0.88) translateY(16px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes supportMsgIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
}
@keyframes supportDotPulse {
    0%, 80%, 100% { transform: scale(0.4); opacity: 0.4; }
    40% { transform: scale(1); opacity: 1; }
}
@keyframes supportCardIn {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
}
`;

const SupportWidget = () => {
    const { user } = useAuth();
    const [open, setOpen] = useState(false);
    const [view, setView] = useState('welcome'); // 'welcome' | 'list' | 'new' | 'chat'
    const [tickets, setTickets] = useState([]);
    const [activeTicket, setActiveTicket] = useState(null);
    const [messages, setMessages] = useState([]);
    const [subject, setSubject] = useState('');
    const [category, setCategory] = useState('');
    const [draft, setDraft] = useState('');
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [unread, setUnread] = useState(0);
    const [expandedHelp, setExpandedHelp] = useState(null);
    const [isTyping, setIsTyping] = useState(false);
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const fileRef = useRef(null);
    const scrollRef = useRef(null);
    const { socket } = useSocket();
    const { showError, showSuccess } = useNotification();
    const { showDanger } = useConfirm();

    const openTicketCount = useMemo(() => tickets.filter(t => t.status !== 'closed').length, [tickets]);

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
                setIsTyping(false);
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
        const onTyping = ({ ticketId }) => {
            if (activeTicket && String(activeTicket._id) === String(ticketId)) {
                setIsTyping(true);
                // Auto-clear after 4 seconds in case the server doesn't send a stop
                setTimeout(() => setIsTyping(false), 4000);
            }
        };
        socket.on('support:newMessage', onNewMessage);
        socket.on('support:ticketClosed', onClosed);
        socket.on('support:typing', onTyping);
        return () => {
            socket.off('support:newMessage', onNewMessage);
            socket.off('support:ticketClosed', onClosed);
            socket.off('support:typing', onTyping);
        };
    }, [socket, activeTicket, loadTickets, showSuccess]);

    // When user opens a conversation, server marks it read — clear local unread for it
    useEffect(() => {
        if (view === 'chat' && activeTicket) {
            setTickets(prev => prev.map(t => t._id === activeTicket._id ? { ...t, unreadByUser: 0 } : t));
            setUnread(u => Math.max(0, u - (activeTicket.unreadByUser || 0)));
        }
    }, [view, activeTicket]);

    // Auto-scroll on new messages
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, isTyping]);

    // Track scroll position for scroll-to-bottom button
    const handleScroll = useCallback(() => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
    }, []);

    const scrollToBottom = () => {
        if (scrollRef.current) scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    };

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
            if (category) fd.append('category', category);
            files.forEach(f => fd.append('files', f));
            const res = await api.post('/support/tickets', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
            setSubject(''); setDraft(''); setFiles([]); setCategory('');
            showSuccess('Ticket sent');
            // Show typing indicator since AI will auto-reply
            setIsTyping(true);
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

    /* ─── Status badge helper ─── */
    const statusBadge = (status) => {
        switch (status) {
            case 'admin_replied':
                return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Support replied</span>;
            case 'user_replied':
                return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>Waiting</span>;
            default:
                return <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>Open</span>;
        }
    };

    /* ─── Navigation helpers ─── */
    const goBack = () => {
        if (view === 'chat' || view === 'new') { setView('list'); setActiveTicket(null); setMessages([]); setDraft(''); setFiles([]); }
        else if (view === 'list') { setView('welcome'); }
    };

    const headerTitle = () => {
        if (view === 'welcome') return 'Help & Support';
        if (view === 'list') return 'My Tickets';
        if (view === 'new') return 'New Ticket';
        if (view === 'chat') return activeTicket?.subject || 'Conversation';
        return 'Help & Support';
    };

    const firstName = user?.name ? user.name.split(' ')[0] : '';

    return (
        <>
            {/* Inject keyframe animations */}
            <style>{widgetKeyframes}</style>

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
                <div
                    className="fixed bottom-5 right-5 z-50 w-[400px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden"
                    style={{
                        animation: 'supportWidgetIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
                        borderRadius: '20px',
                        boxShadow: '0 25px 60px -12px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.08)',
                        background: '#f8fafc',
                    }}
                >
                    {/* ─── Glassmorphism Header ─── */}
                    <div
                        className="relative px-4 py-3.5 flex items-center justify-between text-white shrink-0"
                        style={{
                            background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 40%, #818cf8 100%)',
                            backdropFilter: 'blur(12px)',
                        }}
                    >
                        {/* Decorative glow */}
                        <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-20"
                             style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)' }} />

                        <div className="flex items-center gap-2.5 relative z-10">
                            {view !== 'welcome' && (
                                <button
                                    onClick={goBack}
                                    className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
                                    title="Back"
                                >
                                    <i className="fa-solid fa-arrow-left text-xs"></i>
                                </button>
                            )}
                            <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center">
                                <i className="fa-solid fa-life-ring text-sm"></i>
                            </div>
                            <div>
                                <p className="font-semibold text-sm leading-tight">{headerTitle()}</p>
                                {view === 'welcome' && <p className="text-[10px] text-indigo-200 leading-tight">We usually reply within minutes</p>}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 relative z-10">
                            {view === 'chat' && (
                                <button onClick={closeActive} className="text-[11px] bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-full transition-colors" title="Close & delete">
                                    <i className="fa-solid fa-check mr-1 text-[10px]"></i>Close
                                </button>
                            )}
                            <button
                                onClick={() => setOpen(false)}
                                className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
                                title="Minimize"
                            >
                                <i className="fa-solid fa-minus text-xs"></i>
                            </button>
                        </div>
                    </div>

                    {/* ─── Body ─── */}
                    <div className="flex-1 overflow-hidden flex flex-col">

                        {/* ═══ WELCOME VIEW ═══ */}
                        {view === 'welcome' && (
                            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                                {/* Greeting */}
                                <div className="text-center pt-2 pb-1" style={{ animation: 'supportCardIn 0.3s ease-out forwards' }}>
                                    <p className="text-2xl mb-1">👋</p>
                                    <h3 className="text-lg font-bold text-slate-800">
                                        Hi{firstName ? ` ${firstName}` : ''}! How can we help?
                                    </h3>
                                    <p className="text-xs text-slate-500 mt-1">Browse quick guides or contact our team</p>
                                </div>

                                {/* Quick Help Cards */}
                                <div className="space-y-2">
                                    {QUICK_HELP.map((item, idx) => (
                                        <div
                                            key={idx}
                                            className="bg-white rounded-xl border border-slate-200 overflow-hidden transition-all duration-200 hover:shadow-md"
                                            style={{ animation: `supportCardIn 0.3s ease-out ${0.05 * (idx + 1)}s both` }}
                                        >
                                            <button
                                                onClick={() => setExpandedHelp(expandedHelp === idx ? null : idx)}
                                                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                                            >
                                                <span className="text-xl shrink-0">{item.icon}</span>
                                                <span className="flex-1 text-sm font-semibold text-slate-800">{item.title}</span>
                                                <i className={`fa-solid fa-chevron-down text-[10px] text-slate-400 transition-transform duration-200 ${expandedHelp === idx ? 'rotate-180' : ''}`}></i>
                                            </button>
                                            {expandedHelp === idx && (
                                                <div className="px-4 pb-3 text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-2" style={{ animation: 'supportCardIn 0.2s ease-out forwards' }}>
                                                    <p>{item.content}</p>
                                                    <a href={item.link} className="inline-flex items-center gap-1 mt-2 text-indigo-600 font-semibold hover:text-indigo-800 transition-colors">
                                                        {item.linkLabel}
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                {/* Contact Support Button */}
                                <button
                                    onClick={() => { setView('list'); loadTickets(); }}
                                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                                    style={{ animation: 'supportCardIn 0.3s ease-out 0.3s both' }}
                                >
                                    <i className="fa-solid fa-envelope text-sm"></i>
                                    Contact Support
                                    {openTicketCount > 0 && (
                                        <span className="ml-1 bg-white/25 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                                            {openTicketCount} active
                                        </span>
                                    )}
                                </button>
                            </div>
                        )}

                        {/* ═══ TICKET LIST VIEW ═══ */}
                        {view === 'list' && (
                            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                <button
                                    onClick={() => setView('new')}
                                    className="w-full bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                                >
                                    <i className="fa-solid fa-plus text-xs"></i> New Support Ticket
                                </button>
                                {tickets.length === 0 && (
                                    <div className="text-center py-10" style={{ animation: 'supportCardIn 0.3s ease-out forwards' }}>
                                        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                                            <i className="fa-solid fa-ticket text-slate-400 text-xl"></i>
                                        </div>
                                        <p className="text-sm text-slate-500">No open tickets</p>
                                        <p className="text-xs text-slate-400 mt-1">Click above to start a conversation</p>
                                    </div>
                                )}
                                {tickets.map((t, idx) => (
                                    <button
                                        key={t._id}
                                        onClick={() => { loadMessages(t._id); setView('chat'); }}
                                        className="w-full text-left bg-white hover:bg-indigo-50/50 border border-slate-200 rounded-xl p-3.5 transition-all duration-200 hover:shadow-sm hover:border-indigo-200"
                                        style={{ animation: `supportCardIn 0.25s ease-out ${0.04 * idx}s both` }}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-semibold text-slate-800 truncate">{t.subject}</p>
                                                <div className="flex items-center gap-2 mt-1.5">
                                                    {statusBadge(t.status)}
                                                    <span className="text-[10px] text-slate-400">
                                                        {new Date(t.updatedAt || t.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                                    </span>
                                                </div>
                                            </div>
                                            {t.unreadByUser > 0 && (
                                                <span className="bg-indigo-600 text-white text-[10px] font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center shrink-0 animate-pulse">{t.unreadByUser}</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* ═══ NEW TICKET VIEW ═══ */}
                        {view === 'new' && (
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                                {/* Category dropdown */}
                                <div>
                                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Category</label>
                                    <select
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all appearance-none cursor-pointer"
                                        style={{
                                            backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 20 20\' fill=\'%2394a3b8\'%3E%3Cpath d=\'M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z\'/%3E%3C/svg%3E")',
                                            backgroundPosition: 'right 12px center',
                                            backgroundRepeat: 'no-repeat',
                                            backgroundSize: '16px',
                                        }}
                                    >
                                        {CATEGORIES.map(c => (
                                            <option key={c.value} value={c.value}>{c.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Subject */}
                                <div>
                                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Subject</label>
                                    <input
                                        type="text"
                                        placeholder="e.g. WhatsApp template not approved"
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                        maxLength={200}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                    />
                                </div>

                                {/* Description */}
                                <div>
                                    <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 block">Description</label>
                                    <textarea
                                        placeholder="Describe your issue in detail..."
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        rows={5}
                                        maxLength={4000}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                                    />
                                </div>

                                {/* File previews */}
                                {files.length > 0 && (
                                    <div className="space-y-1.5">
                                        {files.map((f, i) => (
                                            <div key={i} className="flex items-center justify-between text-xs bg-white border border-slate-200 rounded-lg px-3 py-2">
                                                <span className="truncate text-slate-700">{f.type.startsWith('video/') ? '🎥' : '🖼️'} {f.name}</span>
                                                <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 ml-2 transition-colors">
                                                    <i className="fa-solid fa-times"></i>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex items-center gap-2 pt-1">
                                    <button
                                        onClick={() => fileRef.current?.click()}
                                        className="text-xs px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-1.5 text-slate-600 transition-colors"
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
                                        className="ml-auto bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 text-white text-sm font-semibold px-5 py-2 rounded-xl transition-all duration-200 hover:shadow-lg active:scale-[0.98]"
                                    >
                                        {busy ? (
                                            <span className="flex items-center gap-2">
                                                <i className="fa-solid fa-spinner fa-spin text-xs"></i> Sending...
                                            </span>
                                        ) : 'Send'}
                                    </button>
                                </div>
                                <p className="text-[10px] text-slate-400">Images up to 5MB, videos up to 20MB (max 3 files).</p>
                            </div>
                        )}

                        {/* ═══ CHAT VIEW ═══ */}
                        {view === 'chat' && activeTicket && (
                            <>
                                <div
                                    ref={scrollRef}
                                    onScroll={handleScroll}
                                    className="flex-1 overflow-y-auto p-3 space-y-1"
                                    style={{ background: 'linear-gradient(180deg, #f1f5f9 0%, #f8fafc 100%)' }}
                                >
                                    {messages.map((m, idx) => {
                                        const showDateSep = idx === 0 || !isSameDay(messages[idx - 1].createdAt, m.createdAt);
                                        return (
                                            <React.Fragment key={m._id}>
                                                {/* Date separator */}
                                                {showDateSep && (
                                                    <div className="flex items-center gap-3 py-2">
                                                        <div className="flex-1 h-px bg-slate-200"></div>
                                                        <span className="text-[10px] font-medium text-slate-400 shrink-0">{formatDateLabel(m.createdAt)}</span>
                                                        <div className="flex-1 h-px bg-slate-200"></div>
                                                    </div>
                                                )}

                                                {/* Message bubble */}
                                                <div
                                                    className={`flex ${m.senderRole === 'customer' ? 'justify-end' : 'justify-start'} mb-2`}
                                                    style={{ animation: 'supportMsgIn 0.25s ease-out forwards' }}
                                                >
                                                    {/* Admin avatar */}
                                                    {m.senderRole !== 'customer' && (
                                                        <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center mr-2 mt-1 shrink-0">
                                                            <i className="fa-solid fa-headset text-indigo-500 text-[10px]"></i>
                                                        </div>
                                                    )}
                                                    <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm ${
                                                        m.senderRole === 'customer'
                                                            ? 'bg-indigo-600 text-white rounded-br-md'
                                                            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm'
                                                    }`}>
                                                        {m.text && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>}
                                                        {(m.attachments || []).map((a, i) => (
                                                            <div key={i} className="mt-2">
                                                                {a.kind === 'image' ? (
                                                                    <a href={fileUrl(a.url)} target="_blank" rel="noreferrer">
                                                                        <img src={fileUrl(a.url)} alt={a.filename} className="rounded-lg max-w-full max-h-40" />
                                                                    </a>
                                                                ) : (
                                                                    <video src={fileUrl(a.url)} controls className="rounded-lg max-w-full max-h-40" />
                                                                )}
                                                            </div>
                                                        ))}
                                                        <p className={`text-[10px] mt-1 ${m.senderRole === 'customer' ? 'text-indigo-200' : 'text-slate-400'}`}>
                                                            {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </p>
                                                    </div>
                                                </div>
                                            </React.Fragment>
                                        );
                                    })}

                                    {/* Typing indicator */}
                                    {isTyping && (
                                        <div className="flex items-center gap-2 mb-2" style={{ animation: 'supportMsgIn 0.2s ease-out forwards' }}>
                                            <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                                                <i className="fa-solid fa-headset text-indigo-500 text-[10px]"></i>
                                            </div>
                                            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] text-slate-400 mr-1">Support is typing</span>
                                                    {[0, 1, 2].map(i => (
                                                        <span
                                                            key={i}
                                                            className="w-1.5 h-1.5 rounded-full bg-indigo-400"
                                                            style={{
                                                                animation: `supportDotPulse 1.4s ease-in-out ${i * 0.16}s infinite`,
                                                                display: 'inline-block',
                                                            }}
                                                        />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Scroll-to-bottom button */}
                                {showScrollBtn && (
                                    <div className="absolute bottom-[68px] left-1/2 -translate-x-1/2 z-10">
                                        <button
                                            onClick={scrollToBottom}
                                            className="bg-white border border-slate-200 shadow-lg text-slate-500 hover:text-indigo-600 w-8 h-8 rounded-full flex items-center justify-center transition-all hover:shadow-xl"
                                        >
                                            <i className="fa-solid fa-arrow-down text-xs"></i>
                                        </button>
                                    </div>
                                )}

                                {/* Chat input bar */}
                                <div className="p-3 border-t border-slate-200 bg-white shrink-0">
                                    {files.length > 0 && (
                                        <div className="space-y-1 mb-2">
                                            {files.map((f, i) => (
                                                <div key={i} className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5">
                                                    <span className="truncate text-slate-600">{f.type.startsWith('video/') ? '🎥' : '🖼️'} {f.name}</span>
                                                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 transition-colors">×</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => fileRef.current?.click()} className="text-slate-400 hover:text-indigo-600 transition-colors p-1" title="Attach">
                                            <i className="fa-solid fa-paperclip"></i>
                                        </button>
                                        <input ref={fileRef} type="file" accept="image/*,video/*" multiple onChange={onFilesPicked} className="hidden" />
                                        <input
                                            type="text"
                                            placeholder="Type a message..."
                                            value={draft}
                                            onChange={(e) => setDraft(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                                            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                                        />
                                        <button
                                            onClick={sendReply}
                                            disabled={busy}
                                            className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 disabled:from-slate-400 disabled:to-slate-400 text-white w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-200 hover:shadow-lg active:scale-95"
                                        >
                                            <i className="fa-solid fa-paper-plane text-xs"></i>
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
