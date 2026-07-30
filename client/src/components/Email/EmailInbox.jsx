import React, { useState, useEffect, useRef, useCallback } from 'react';
// Theme: CRM blue (matches sidebar + WhatsApp inbox)
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import useSocket from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import { hasEmailPermission } from './emailPermissions';
import DOMPurify from 'dompurify';

const PAGE_SIZE = 30;
const MESSAGE_PAGE_SIZE = 50;
// Sockets carry new mail now, so polling is only a safety net for a dropped
// connection — it no longer needs to run every 15 seconds.
const POLL_MS = 60000;

// A reply subject must not stack "Re:" every round-trip.
const buildReplySubject = (subject) => {
    const base = (subject || 'Conversation').replace(/^\s*(re\s*:\s*)+/i, '').trim();
    return `Re: ${base || 'Conversation'}`;
};

const formatBytes = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const EmailInbox = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const { socket } = useSocket();
    const { user } = useAuth();
    // Composing and replying are gated by sendEmails server-side; without it the
    // send controls must not render at all.
    const canSend = hasEmailPermission(user, 'sendEmails');

    const [conversations, setConversations] = useState([]);
    const [totalUnread, setTotalUnread] = useState(0);
    const [hasMoreConversations, setHasMoreConversations] = useState(false);
    const [page, setPage] = useState(1);
    const [loadingMore, setLoadingMore] = useState(false);

    const [selectedChat, setSelectedChat] = useState(null);
    const [messages, setMessages] = useState([]);
    const [olderCursor, setOlderCursor] = useState(null);
    const [loadingOlder, setLoadingOlder] = useState(false);

    const [newMessage, setNewMessage] = useState('');
    const [newSubject, setNewSubject] = useState('');
    const [replyFiles, setReplyFiles] = useState([]);

    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [showContactPanel, setShowContactPanel] = useState(false);
    const [showNewChatModal, setShowNewChatModal] = useState(false);
    const [showScheduled, setShowScheduled] = useState(false);
    const [scheduled, setScheduled] = useState([]);
    const [filter, setFilter] = useState('all');
    // Drafts — /email/drafts is a full CRUD API that nothing was calling.
    const [showDrafts, setShowDrafts] = useState(false);
    const [drafts, setDrafts] = useState([]);
    const [draftId, setDraftId] = useState(null);
    const [savingDraft, setSavingDraft] = useState(false);

    // Separate state for compose modal so it doesn't pollute the reply bar
    const [composeEmail, setComposeEmail] = useState('');
    const [composeCc, setComposeCc] = useState('');
    const [composeBcc, setComposeBcc] = useState('');
    const [composeSubject, setComposeSubject] = useState('');
    const [composeMessage, setComposeMessage] = useState('');
    const [composeSchedule, setComposeSchedule] = useState('');
    const [composeFiles, setComposeFiles] = useState([]);

    const scrollRef = useRef(null);
    const replyFileInput = useRef(null);
    const composeFileInput = useRef(null);

    // Refs let the poll read current values without being re-created every time
    // those values change — see the polling effect below.
    const selectedChatIdRef = useRef(null);
    const isFetchingRef = useRef(false);

    // ── Debounced search ─────────────────────────────────────────────────────
    // Every keystroke previously triggered a fresh unindexed $regex query
    // against the conversations collection.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 350);
        return () => clearTimeout(t);
    }, [searchTerm]);

    const fetchConversations = useCallback(async ({ silent = false, pageOverride } = {}) => {
        const targetPage = pageOverride || 1;
        if (isFetchingRef.current && silent) return;
        isFetchingRef.current = true;
        try {
            const status = filter === 'archived' ? 'archived' : 'active';
            const params = { status, limit: PAGE_SIZE, page: targetPage };
            if (debouncedSearch) params.search = debouncedSearch;
            // Unread is filtered server-side now: filtering the loaded page
            // client-side hid every unread thread past the first 30.
            if (filter === 'unread') params.unreadOnly = 'true';

            const res = await api.get('/email-conversations', { params });
            const list = res.data.conversations || [];

            setConversations(prev => (targetPage > 1 ? [...prev, ...list] : list));
            setTotalUnread(res.data.totalUnread || 0);
            setHasMoreConversations(!!res.data.pagination?.hasMore);
            setPage(targetPage);
        } catch (error) {
            console.error('Error fetching conversations:', error);
        } finally {
            isFetchingRef.current = false;
            if (!silent) setLoading(false);
        }
    }, [debouncedSearch, filter]);

    const fetchMessages = useCallback(async (conversationId, { silent = false } = {}) => {
        try {
            const res = await api.get(`/email-conversations/${conversationId}`, {
                params: { limit: MESSAGE_PAGE_SIZE }
            });
            setMessages(res.data.messages || []);
            setSelectedChat(res.data.conversation);
            setOlderCursor(res.data.pagination?.nextBefore || null);

            // Only write to the DB when there is something to clear. This used
            // to run on every 15s poll for every open inbox — an updateOne plus
            // an updateMany each time, almost always changing nothing.
            if (res.data.conversation?.unreadCount > 0) {
                await api.put(`/email-conversations/${conversationId}/read`);
                setConversations(prev => prev.map(c =>
                    c._id === conversationId ? { ...c, unreadCount: 0 } : c
                ));
                setTotalUnread(prev => Math.max(0, prev - (res.data.conversation.unreadCount || 0)));
            }
        } catch (error) {
            console.error('Error fetching messages:', error);
            if (!silent) showError('Failed to load messages');
        }
    }, [showError]);

    const loadOlderMessages = useCallback(async () => {
        if (!selectedChat || !olderCursor || loadingOlder) return;
        setLoadingOlder(true);
        try {
            const res = await api.get(`/email-conversations/${selectedChat._id}`, {
                params: { limit: MESSAGE_PAGE_SIZE, before: olderCursor }
            });
            const older = res.data.messages || [];
            setMessages(prev => [...older, ...prev]);
            setOlderCursor(res.data.pagination?.nextBefore || null);
        } catch {
            showError('Failed to load older messages');
        } finally {
            setLoadingOlder(false);
        }
    }, [selectedChat, olderCursor, loadingOlder, showError]);

    useEffect(() => {
        setPage(1);
        fetchConversations();
    }, [fetchConversations]);

    // Keep the poll's view of the selected chat in a ref so the interval isn't
    // torn down and rebuilt on every render. Previously `selectedChat` was a
    // dependency and each poll replaced it with a fresh object, so the timer
    // was destroyed and recreated continuously.
    useEffect(() => {
        selectedChatIdRef.current = selectedChat?._id || null;
    }, [selectedChat]);

    useEffect(() => {
        const interval = setInterval(() => {
            if (document.hidden) return; // Skip poll if tab not focused
            fetchConversations({ silent: true });
            if (selectedChatIdRef.current) {
                fetchMessages(selectedChatIdRef.current, { silent: true });
            }
        }, POLL_MS);
        return () => clearInterval(interval);
    }, [fetchConversations, fetchMessages]);

    // ── Real-time updates ────────────────────────────────────────────────────
    // Email previously had no socket events at all — new mail (and anything an
    // automation sent) only surfaced on the next poll. Handlers are attached
    // with refs so they never carry a stale closure over `selectedChat`.
    useEffect(() => {
        if (!socket) return;

        const handleNewMessage = ({ conversationId, message }) => {
            // Append to the open thread if it belongs there.
            if (conversationId && conversationId === String(selectedChatIdRef.current)) {
                setMessages(prev => (
                    prev.some(m => String(m._id) === String(message?._id))
                        ? prev // ignore echoes of a message we already rendered
                        : [...prev, message]
                ));
            }
        };

        const handleConversationUpdate = (payload) => {
            const { conversationId, lastMessage, lastMessageAt, lastMessageDirection, unreadCount } = payload || {};
            if (!conversationId) return;

            setConversations(prev => {
                const idx = prev.findIndex(c => String(c._id) === String(conversationId));
                // A thread we don't have loaded (new contact) — pull the list.
                if (idx === -1) {
                    fetchConversations({ silent: true });
                    return prev;
                }
                const isOpen = String(conversationId) === String(selectedChatIdRef.current);
                const updated = {
                    ...prev[idx],
                    lastMessage,
                    lastMessageAt,
                    lastMessageDirection,
                    // The open thread is being read right now, so don't badge it.
                    unreadCount: isOpen ? 0 : (unreadCount ?? prev[idx].unreadCount)
                };
                // Move to the top — the list is sorted by lastMessageAt.
                const rest = prev.filter((_, i) => i !== idx);
                return [updated, ...rest];
            });

            if (lastMessageDirection === 'inbound' && String(conversationId) !== String(selectedChatIdRef.current)) {
                setTotalUnread(prev => prev + 1);
            }
        };

        socket.on('email:newMessage', handleNewMessage);
        socket.on('email:conversationUpdate', handleConversationUpdate);

        return () => {
            socket.off('email:newMessage', handleNewMessage);
            socket.off('email:conversationUpdate', handleConversationUpdate);
        };
    }, [socket, fetchConversations]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    // Build the request body — multipart when files are attached, JSON otherwise.
    const buildSendRequest = (payload, files) => {
        if (!files || files.length === 0) return { data: payload, config: undefined };
        const form = new FormData();
        Object.entries(payload).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') form.append(k, v);
        });
        files.forEach(file => form.append('attachments', file));
        return { data: form, config: { headers: { 'Content-Type': 'multipart/form-data' } } };
    };

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!newMessage.trim() || !selectedChat || sending) return;
        setSending(true);

        try {
            const htmlBody = newMessage.trim().replace(/\n/g, '<br>');
            const payload = {
                to: selectedChat.email,
                subject: newSubject.trim() || buildReplySubject(selectedChat.lastMessage),
                html: htmlBody,
                text: newMessage.trim()
            };

            const { data, config } = buildSendRequest(payload, replyFiles);
            await api.post('/email/send', data, config);

            // Re-fetch to get the newly mapped message from the DB
            await fetchMessages(selectedChat._id);
            fetchConversations({ silent: true });

            setNewMessage('');
            setNewSubject('');
            setReplyFiles([]);
            if (replyFileInput.current) replyFileInput.current.value = '';
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to send email');
            // The failed attempt is now recorded server-side, so refresh the
            // thread to surface it rather than losing it behind the toast.
            fetchMessages(selectedChat._id, { silent: true });
        } finally {
            setSending(false);
        }
    };

    const resetCompose = () => {
        setComposeEmail(''); setComposeSubject(''); setComposeMessage('');
        setComposeCc(''); setComposeBcc(''); setComposeSchedule(''); setComposeFiles([]);
        setDraftId(null);
        if (composeFileInput.current) composeFileInput.current.value = '';
    };

    const openCompose = () => { resetCompose(); setShowNewChatModal(true); };

    // ── Drafts ───────────────────────────────────────────────────────────────
    const loadDrafts = async () => {
        try {
            const res = await api.get('/email/drafts');
            setDrafts(res.data.drafts || []);
            setShowDrafts(true);
        } catch {
            showError('Failed to load drafts');
        }
    };

    const handleSaveDraft = async () => {
        if (savingDraft) return;
        if (!composeEmail.trim() && !composeSubject.trim() && !composeMessage.trim()) {
            showError('Nothing to save yet');
            return;
        }
        setSavingDraft(true);
        try {
            const res = await api.post('/email/drafts', {
                draftId: draftId || undefined,
                to: composeEmail,
                cc: composeCc,
                bcc: composeBcc,
                subject: composeSubject,
                body: composeMessage
            });
            // Keep the id so repeated saves update rather than pile up copies.
            setDraftId(res.data.draft?._id || null);
            showSuccess('Draft saved');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to save draft');
        } finally {
            setSavingDraft(false);
        }
    };

    const resumeDraft = (draft) => {
        setComposeEmail(draft.to || '');
        setComposeCc(draft.cc || '');
        setComposeBcc(draft.bcc || '');
        setComposeSubject(draft.subject || '');
        setComposeMessage(draft.body || '');
        setComposeSchedule('');
        setComposeFiles([]);
        setDraftId(draft._id);
        setShowDrafts(false);
        setShowNewChatModal(true);
    };

    const deleteDraft = async (id) => {
        try {
            await api.delete(`/email/drafts/${id}`);
            setDrafts(prev => prev.filter(d => d._id !== id));
            if (draftId === id) setDraftId(null);
            showSuccess('Draft deleted');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to delete draft');
        }
    };

    const handleStartNewChat = async (e) => {
        e.preventDefault();
        if (!composeEmail.trim() || sending) return;

        if (composeSchedule && composeFiles.length > 0) {
            showError('Attachments cannot be used with scheduled emails.');
            return;
        }
        if (composeSchedule && new Date(composeSchedule).getTime() <= Date.now()) {
            showError('Schedule time must be in the future.');
            return;
        }

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

            const { data, config } = buildSendRequest(payload, composeFiles);
            const res = await api.post('/email/send', data, config);

            // A draft that has now been sent should not linger in the list.
            if (draftId) {
                await api.delete(`/email/drafts/${draftId}`).catch(() => {});
                setDrafts(prev => prev.filter(d => d._id !== draftId));
            }

            setShowNewChatModal(false);
            resetCompose();
            await fetchConversations();
            showSuccess(res.data?.scheduled ? res.data.message : 'Email sent successfully!');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to start conversation');
        } finally {
            setSending(false);
        }
    };

    const handleSelectChat = (chat) => {
        setSelectedChat(chat);
        setMessages([]);
        setOlderCursor(null);
        setNewSubject(buildReplySubject(chat.lastMessage));
        setReplyFiles([]);
        fetchMessages(chat._id);
        setShowContactPanel(false);
    };

    // ── Archive / restore ────────────────────────────────────────────────────
    // The "Archived" tab and the model's status field both existed, but nothing
    // could ever set it, so the tab was permanently empty.
    const handleToggleArchive = async () => {
        if (!selectedChat) return;
        const archiving = selectedChat.status !== 'archived';

        if (archiving) {
            const ok = await showDanger(
                'Archive this conversation? It moves to the Archived tab and returns automatically if the contact replies.',
                'Archive Conversation'
            );
            if (!ok) return;
        }

        try {
            await api.put(`/email-conversations/${selectedChat._id}/status`, {
                status: archiving ? 'archived' : 'active'
            });
            setSelectedChat(null);
            setMessages([]);
            await fetchConversations();
            showSuccess(archiving ? 'Conversation archived' : 'Conversation restored');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to update conversation');
        }
    };

    // ── Scheduled outbox ─────────────────────────────────────────────────────
    const loadScheduled = async () => {
        try {
            const res = await api.get('/email-conversations/scheduled');
            setScheduled(res.data.scheduled || []);
            setShowScheduled(true);
        } catch {
            showError('Failed to load scheduled emails');
        }
    };

    const cancelScheduled = async (jobId) => {
        try {
            await api.delete(`/email-conversations/scheduled/${jobId}`);
            setScheduled(prev => prev.filter(s => s.id !== jobId));
            showSuccess('Scheduled email cancelled');
        } catch (error) {
            showError(error.response?.data?.message || 'Failed to cancel');
        }
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
        <div className="flex h-full bg-slate-50 w-full font-sans select-none overflow-hidden animate-fade-in">
            {/* ═══════════ LEFT SIDEBAR ═══════════ */}
            <div className="w-[360px] bg-white border-r border-slate-200/60 flex flex-col flex-shrink-0 z-10 shadow-sm">
                {/* Sidebar Header */}
                <div className="px-5 py-5 bg-white flex items-center justify-between border-b border-slate-200/60">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm shadow-blue-600/20">
                            <i className="fa-solid fa-envelope text-base"></i>
                        </div>
                        <div>
                            <span className="font-semibold text-slate-900 text-[15px] tracking-tight">Email Inbox</span>
                            {totalUnread > 0 && (
                                <span className="ml-2 bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{totalUnread}</span>
                            )}
                        </div>
                    </div>
                    {canSend && (
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={loadDrafts}
                                className="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-all duration-200 active:scale-95 border border-slate-200/60"
                                title="Drafts"
                            >
                                <i className="fa-solid fa-file-pen text-[14px]"></i>
                            </button>
                            <button
                                onClick={loadScheduled}
                                className="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-500 flex items-center justify-center transition-all duration-200 active:scale-95 border border-slate-200/60"
                                title="Scheduled emails"
                            >
                                <i className="fa-solid fa-clock text-[14px]"></i>
                            </button>
                            <button
                                onClick={openCompose}
                                className="w-10 h-10 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-600 flex items-center justify-center transition-all duration-200 active:scale-95 border border-blue-100"
                                title="Compose Email"
                            >
                                <i className="fa-solid fa-pen-to-square text-[14px]"></i>
                            </button>
                        </div>
                    )}
                </div>

                {/* Search */}
                <div className="px-5 pt-4 pb-3 bg-white">
                    <div className="relative">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]"></i>
                        <input
                            type="text"
                            placeholder="Search emails or contacts..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2.5 bg-slate-100/70 border border-slate-200/60 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 rounded-xl text-[13px] transition duration-200 outline-none placeholder:text-slate-400 text-slate-700 font-medium"
                        />
                    </div>
                </div>

                {/* Filter Tabs */}
                <div className="px-5 pb-4 bg-white border-b border-slate-200/60 flex gap-1.5">
                    {[
                        { id: 'all', label: 'All' },
                        { id: 'unread', label: 'Unread', count: totalUnread },
                        { id: 'archived', label: 'Archived' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => { setFilter(tab.id); setSelectedChat(null); setMessages([]); }}
                            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition duration-200 active:scale-95 flex items-center ${filter === tab.id
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'bg-slate-100/70 text-slate-500 hover:bg-slate-100 border border-transparent'}`}
                        >
                            {tab.label}
                            {tab.count > 0 && <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${filter === tab.id ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'}`}>{tab.count}</span>}
                        </button>
                    ))}
                </div>

                {/* Conversations List */}
                <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50 p-3 space-y-1">
                    {conversations.map(chat => (
                        <div
                            key={chat._id}
                            onClick={() => handleSelectChat(chat)}
                            className={`p-3.5 rounded-xl cursor-pointer transition-all duration-200 border flex flex-col gap-1.5 ${selectedChat?._id === chat._id
                                ? 'bg-white border-blue-200 ring-1 ring-blue-100 shadow-sm'
                                : 'bg-white border-slate-200/60 hover:border-slate-200 hover:shadow-sm'}`}
                        >
                            <div className="flex gap-3">
                                <div className="flex-shrink-0">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-[14px] ${chat.unreadCount > 0 ? 'bg-blue-600' : 'bg-slate-200 text-slate-500'}`}>
                                        {(chat.displayName || chat.email).charAt(0).toUpperCase()}
                                    </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-0.5">
                                        <h3 className={`text-[13px] truncate w-[70%] ${chat.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                                            {chat.displayName || chat.email.split('@')[0]}
                                        </h3>
                                        <span className={`text-[10px] flex-shrink-0 ${chat.unreadCount > 0 ? 'text-blue-600 font-bold' : 'text-slate-400 font-medium'}`}>
                                            {formatTime(chat.lastMessageAt)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <p className={`text-xs truncate max-w-[85%] leading-relaxed ${chat.unreadCount > 0 ? 'text-slate-800 font-semibold' : 'text-slate-500 font-medium'}`}>
                                            {chat.lastMessageDirection === 'outbound' && (
                                                <i className="fa-solid fa-reply text-[9px] mr-1.5 text-slate-400"></i>
                                            )}
                                            {chat.lastMessage || 'No messages'}
                                        </p>
                                        {chat.unreadCount > 0 && (
                                            <span className="bg-blue-600 text-white text-[9.5px] font-bold min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center flex-shrink-0 ml-2">
                                                {chat.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Pagination — conversations past the first 30 used to be unreachable */}
                    {hasMoreConversations && (
                        <button
                            onClick={async () => {
                                setLoadingMore(true);
                                await fetchConversations({ silent: true, pageOverride: page + 1 });
                                setLoadingMore(false);
                            }}
                            disabled={loadingMore}
                            className="w-full py-2.5 mt-2 rounded-xl text-xs font-bold text-blue-600 bg-white border border-blue-100 hover:bg-blue-50 transition disabled:opacity-50"
                        >
                            {loadingMore ? <><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Loading...</> : 'Load more conversations'}
                        </button>
                    )}

                    {conversations.length === 0 && (
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
                            <div className="h-[72px] px-8 bg-white border-b border-slate-200/60 flex items-center justify-between flex-shrink-0 z-10">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                                        {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold text-[15px] text-slate-900 leading-tight">{selectedChat.displayName || selectedChat.email}</h3>
                                        <p className="text-[11px] text-slate-400 font-medium mt-0.5">{selectedChat.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {selectedChat.metadata?.totalMessages > 0 && (
                                        <span className="text-[11px] text-slate-500 font-semibold bg-slate-100/70 px-2.5 py-1 rounded-full border border-slate-200/60">
                                            {selectedChat.metadata.totalMessages} messages
                                        </span>
                                    )}
                                    <button
                                        onClick={handleToggleArchive}
                                        className="w-10 h-10 rounded-xl flex items-center justify-center text-sm transition-all duration-200 active:scale-95 border border-transparent hover:bg-slate-50 text-slate-400"
                                        title={selectedChat.status === 'archived' ? 'Restore conversation' : 'Archive conversation'}
                                    >
                                        <i className={`fa-solid ${selectedChat.status === 'archived' ? 'fa-box-open' : 'fa-box-archive'}`}></i>
                                    </button>
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
                            <div className="flex-1 overflow-y-auto px-8 py-8 bg-slate-50 custom-scrollbar" ref={scrollRef}>
                                <div className="space-y-5 max-w-3xl mx-auto">
                                    {/* Older history — the thread now loads newest-first, so the
                                        start of a long conversation is reached by paging back. */}
                                    {olderCursor && (
                                        <div className="flex justify-center">
                                            <button
                                                onClick={loadOlderMessages}
                                                disabled={loadingOlder}
                                                className="px-4 py-2 rounded-full text-[11px] font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
                                            >
                                                {loadingOlder
                                                    ? <><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Loading...</>
                                                    : <><i className="fa-solid fa-arrow-up mr-1.5"></i>Load earlier messages</>}
                                            </button>
                                        </div>
                                    )}

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
                                        const failed = msg.status === 'failed';

                                        return (
                                            <React.Fragment key={msg._id}>
                                                {showDate && (
                                                    <div className="flex justify-center my-4">
                                                        <span className="bg-white/80 text-slate-400 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full border border-slate-200/60">
                                                            {new Date(msg.timestamp).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className={`flex items-end gap-2.5 ${isOut ? 'justify-end' : 'justify-start'}`}>
                                                    {!isOut && (
                                                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-[11px] font-bold flex-shrink-0 mb-1">
                                                            {(selectedChat.displayName || selectedChat.email).charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                    <div className={`max-w-[80%] rounded-2xl overflow-hidden border flex flex-col bg-white shadow-sm
                                                        ${failed ? 'border-rose-200 rounded-br-md' : isOut ? 'border-blue-200 rounded-br-md' : 'border-slate-200/70 rounded-bl-md'}`}>
                                                        {/* Subject strip */}
                                                        <div className={`px-5 pt-3 pb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider border-b
                                                            ${failed ? 'text-rose-500 border-rose-50' : isOut ? 'text-blue-600 border-blue-50' : 'text-slate-400 border-slate-50'}`}>
                                                            <i className={`fa-solid ${isOut ? 'fa-paper-plane' : 'fa-inbox'} text-[9px] flex-shrink-0`}></i>
                                                            <span className="truncate">{msg.subject || '(No Subject)'}</span>
                                                            {msg.isAutomated && (
                                                                <span className="ml-auto flex items-center gap-1 text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-full flex-shrink-0">
                                                                    <i className="fa-solid fa-robot"></i> Auto
                                                                </span>
                                                            )}
                                                        </div>
                                                        {/* Body */}
                                                        {msg.html ? (
                                                            <div
                                                                className="px-5 py-3 text-[13px] leading-relaxed select-text text-slate-700 break-words [&_*]:max-w-full"
                                                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.html) }}
                                                            />
                                                        ) : (
                                                            <div className="px-5 py-3 text-[13px] leading-relaxed select-text text-slate-700 break-words whitespace-pre-line">
                                                                {msg.text}
                                                            </div>
                                                        )}

                                                        {/* Attachments */}
                                                        {msg.attachments?.length > 0 && (
                                                            <div className="px-5 pb-2 flex flex-wrap gap-1.5">
                                                                {msg.attachments.map((att, i) => (
                                                                    <span key={i} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 bg-slate-50 border border-slate-200/60 px-2 py-1 rounded-lg">
                                                                        <i className="fa-solid fa-paperclip text-[9px]"></i>
                                                                        <span className="truncate max-w-[140px]">{att.originalName || att.filename}</span>
                                                                        {att.size > 0 && <span className="text-slate-300">{formatBytes(att.size)}</span>}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}

                                                        {/* Failure reason */}
                                                        {failed && msg.error && (
                                                            <div className="px-5 pb-2">
                                                                <p className="text-[10px] text-rose-500 font-semibold bg-rose-50 border border-rose-100 rounded-lg px-2.5 py-1.5 break-words">
                                                                    <i className="fa-solid fa-circle-exclamation mr-1"></i>{msg.error}
                                                                </p>
                                                            </div>
                                                        )}

                                                        {/* Timestamp */}
                                                        <div className={`px-5 pb-2.5 flex items-center justify-end gap-1.5 text-[10px] font-semibold
                                                            ${failed ? 'text-rose-400' : isOut ? 'text-blue-400' : 'text-slate-300'}`}>
                                                            <span>{formatTime(msg.timestamp)}</span>
                                                            {isOut && (
                                                                <i className={`fa-solid text-[10px] ${failed ? 'fa-circle-exclamation text-rose-400' : 'fa-check-double text-blue-400'}`}></i>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Compose Bar — read-only users get no send controls */}
                            {!canSend ? (
                                <div className="bg-white border-t border-slate-200/60 px-8 py-5 flex-shrink-0 text-center">
                                    <p className="text-xs text-slate-400 font-semibold">
                                        <i className="fa-solid fa-lock mr-1.5"></i>
                                        You have read-only access to this inbox.
                                    </p>
                                </div>
                            ) : (
                            <div className="bg-white border-t border-slate-200/60 px-8 py-5 flex-shrink-0">
                                <form onSubmit={handleSendMessage}>
                                    <input
                                        type="text"
                                        value={newSubject}
                                        onChange={(e) => setNewSubject(e.target.value)}
                                        placeholder="Subject line..."
                                        className="w-full text-xs font-semibold text-slate-600 px-4 py-2.5 mb-2.5 bg-slate-50 border border-slate-200/60 rounded-xl focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 transition duration-200 outline-none"
                                        disabled={sending}
                                    />

                                    {replyFiles.length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                                            {replyFiles.map((f, i) => (
                                                <span key={i} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
                                                    <i className="fa-solid fa-paperclip text-[9px]"></i>
                                                    <span className="truncate max-w-[140px]">{f.name}</span>
                                                    <span className="text-slate-400">{formatBytes(f.size)}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setReplyFiles(prev => prev.filter((_, idx) => idx !== i))}
                                                        className="text-slate-400 hover:text-rose-500 ml-0.5"
                                                    >
                                                        <i className="fa-solid fa-xmark"></i>
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <div className="flex items-end gap-3 bg-slate-50 border border-slate-200/60 rounded-2xl px-4 py-3 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:bg-white transition-all duration-200">
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
                                        <input
                                            ref={replyFileInput}
                                            type="file"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => setReplyFiles(Array.from(e.target.files || []).slice(0, 5))}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => replyFileInput.current?.click()}
                                            disabled={sending}
                                            title="Attach files (max 5, 10MB each)"
                                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 active:scale-95 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
                                        >
                                            <i className="fa-solid fa-paperclip text-[13px]"></i>
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={!newMessage.trim() || sending}
                                            className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-200 active:scale-95
                                                bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            {sending ? <i className="fa-solid fa-spinner fa-spin text-xs"></i> : <i className="fa-solid fa-paper-plane text-[13px]"></i>}
                                        </button>
                                    </div>
                                    <p className="text-[10px] text-slate-400 text-right mt-2 font-medium">Enter to send · Shift+Enter new line</p>
                                </form>
                            </div>
                            )}
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
                            onClick={canSend ? openCompose : undefined}
                            className={`w-24 h-24 bg-white rounded-[24px] shadow-lg shadow-slate-100 flex items-center justify-center border border-slate-100 transition-all duration-300 ${canSend ? 'cursor-pointer hover:shadow-xl hover:scale-105 active:scale-95' : ''}`}
                        >
                            <i className="fa-solid fa-envelope-open-text text-3xl text-blue-500"></i>
                        </div>
                        <div>
                            <h2 className="text-base font-black text-slate-800 mb-1">Select a conversation</h2>
                            <p className="text-xs font-semibold text-slate-400 max-w-[280px] leading-relaxed mx-auto">
                                {canSend
                                    ? 'Pick a thread on the left, or create a brand new conversation to start emailing.'
                                    : 'Pick a thread on the left to read it. You have read-only access.'}
                            </p>
                        </div>
                        {canSend && (
                            <button
                                onClick={openCompose}
                                className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition duration-200 shadow-md shadow-blue-100 active:scale-95"
                            >
                                <i className="fa-solid fa-pen-to-square"></i> Compose New Email
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Drafts modal */}
            {showDrafts && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-fade-in-up">
                        <div className="px-6 py-4 bg-slate-800 flex justify-between items-center">
                            <h3 className="font-bold text-white text-sm flex items-center gap-2">
                                <i className="fa-solid fa-file-pen"></i> Drafts
                            </h3>
                            <button onClick={() => setShowDrafts(false)} className="text-white/80 hover:text-white transition duration-200">
                                <i className="fa-solid fa-xmark text-base"></i>
                            </button>
                        </div>
                        <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {drafts.length === 0 ? (
                                <div className="text-center py-10">
                                    <i className="fa-solid fa-file-pen text-3xl text-slate-200 mb-3"></i>
                                    <p className="text-sm text-slate-400 font-medium">No saved drafts</p>
                                    <p className="text-xs text-slate-300 mt-1">Use “Save Draft” in the compose window</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {drafts.map(d => (
                                        <div key={d._id} className="flex items-center gap-3 p-3.5 bg-slate-50 border border-slate-200/60 rounded-xl">
                                            <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 flex-shrink-0">
                                                <i className="fa-solid fa-file-lines text-xs"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[13px] font-semibold text-slate-700 truncate">{d.subject || '(No subject)'}</p>
                                                <p className="text-[11px] text-slate-400 truncate">
                                                    {d.to || 'No recipient'} · {new Date(d.updatedAt).toLocaleString()}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => resumeDraft(d)}
                                                className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 transition flex-shrink-0"
                                            >
                                                Resume
                                            </button>
                                            <button
                                                onClick={() => deleteDraft(d._id)}
                                                className="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition flex items-center justify-center flex-shrink-0"
                                                title="Delete draft"
                                            >
                                                <i className="fa-solid fa-trash text-xs"></i>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Scheduled outbox modal */}
            {showScheduled && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-fade-in-up">
                        <div className="px-6 py-4 bg-slate-800 flex justify-between items-center">
                            <h3 className="font-bold text-white text-sm flex items-center gap-2">
                                <i className="fa-solid fa-clock"></i> Scheduled Emails
                            </h3>
                            <button onClick={() => setShowScheduled(false)} className="text-white/80 hover:text-white transition duration-200">
                                <i className="fa-solid fa-xmark text-base"></i>
                            </button>
                        </div>
                        <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {scheduled.length === 0 ? (
                                <div className="text-center py-10">
                                    <i className="fa-solid fa-clock text-3xl text-slate-200 mb-3"></i>
                                    <p className="text-sm text-slate-400 font-medium">No emails are scheduled</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {scheduled.map(item => (
                                        <div key={item.id} className="flex items-center gap-3 p-3.5 bg-slate-50 border border-slate-200/60 rounded-xl">
                                            <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 flex-shrink-0">
                                                <i className="fa-solid fa-paper-plane text-xs"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-[13px] font-semibold text-slate-700 truncate">{item.subject || '(No subject)'}</p>
                                                <p className="text-[11px] text-slate-400 truncate">
                                                    To {item.to} · {item.scheduledFor ? new Date(item.scheduledFor).toLocaleString() : 'pending'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => cancelScheduled(item.id)}
                                                className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-100 transition flex-shrink-0"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Compose New Email Modal — uses isolated compose state, never touches reply bar */}
            {showNewChatModal && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up max-h-[92vh] flex flex-col">
                        <div className="px-6 py-4 bg-gradient-to-r from-blue-600 to-blue-700 flex justify-between items-center flex-shrink-0">
                            <h3 className="font-bold text-white text-sm flex items-center gap-2">
                                <i className="fa-solid fa-pen-to-square"></i> Compose New Email
                            </h3>
                            <button onClick={() => setShowNewChatModal(false)} className="text-white/80 hover:text-white transition duration-200">
                                <i className="fa-solid fa-xmark text-base"></i>
                            </button>
                        </div>
                        <form onSubmit={handleStartNewChat} className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
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

                            {/* Attachments */}
                            <div>
                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                                    Attachments {composeSchedule && <span className="text-slate-300 normal-case font-semibold">(not available for scheduled emails)</span>}
                                </label>
                                <input
                                    ref={composeFileInput}
                                    type="file"
                                    multiple
                                    disabled={!!composeSchedule}
                                    onChange={(e) => setComposeFiles(Array.from(e.target.files || []).slice(0, 5))}
                                    className="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-600 hover:file:bg-blue-100 disabled:opacity-40"
                                />
                                {composeFiles.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {composeFiles.map((f, i) => (
                                            <span key={i} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
                                                <i className="fa-solid fa-paperclip text-[9px]"></i>
                                                <span className="truncate max-w-[140px]">{f.name}</span>
                                                <span className="text-slate-400">{formatBytes(f.size)}</span>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                                <button type="button" onClick={() => setShowNewChatModal(false)} className="px-5 py-2.5 text-slate-500 font-bold hover:bg-slate-50 rounded-xl transition text-xs">
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveDraft}
                                    disabled={savingDraft}
                                    className="px-5 py-2.5 text-slate-600 font-bold bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-2 text-xs disabled:opacity-50"
                                >
                                    {savingDraft
                                        ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</>
                                        : <><i className="fa-solid fa-file-pen"></i> {draftId ? 'Update Draft' : 'Save Draft'}</>}
                                </button>
                                <button type="submit" disabled={sending} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition shadow-md shadow-blue-100 flex items-center gap-2 text-xs disabled:opacity-60">
                                    {sending
                                        ? <><i className="fa-solid fa-spinner fa-spin"></i> Sending...</>
                                        : <><i className={`fa-solid ${composeSchedule ? 'fa-clock' : 'fa-paper-plane'}`}></i> {composeSchedule ? 'Schedule Email' : 'Send Email'}</>}
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
