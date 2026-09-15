import React, { useState, useEffect, useRef, useCallback } from 'react';
// Theme: CRM blue (matches sidebar + WhatsApp inbox)
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import useSocket from '../../hooks/useSocket';
import { useAuth } from '../../context/AuthContext';
import { hasEmailPermission } from './emailPermissions';
import VariableSelector from '../VariableSelector';
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

// A stable per-contact avatar tint makes a long thread list scannable.
const AVATAR_COLORS = [
    'bg-blue-100 text-blue-700',
    'bg-emerald-100 text-emerald-700',
    'bg-amber-100 text-amber-700',
    'bg-violet-100 text-violet-700',
    'bg-rose-100 text-rose-700',
    'bg-cyan-100 text-cyan-700'
];
const avatarColor = (value) => {
    const seed = String(value || '');
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
};
const initialOf = (chat) => (chat?.displayName || chat?.email || '?').charAt(0).toUpperCase();
const nameOf = (chat) => chat?.displayName || (chat?.email || '').split('@')[0] || 'Unknown';

const inputCls = 'w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-400';
const labelCls = 'block text-sm font-medium text-slate-700 mb-1.5';
const iconBtnCls = 'w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors disabled:opacity-40';

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
    const [composeTemplates, setComposeTemplates] = useState([]);
    const [composeTemplateId, setComposeTemplateId] = useState('');
    const [showCcBcc, setShowCcBcc] = useState(false);

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

    // Inbound attachment bytes are private — the route requires the auth header,
    // so a plain <a href> cannot fetch them. Pull the blob through the API client
    // and hand it to the browser via a temporary object URL (same approach as
    // LeadDocuments).
    const [downloadingAtt, setDownloadingAtt] = useState(null);
    const downloadAttachment = useCallback(async (msg, index, label) => {
        const token = `${msg._id}:${index}`;
        setDownloadingAtt(token);
        try {
            const res = await api.get(
                `/email-conversations/${msg.conversationId}/messages/${msg._id}/attachments/${index}/download`,
                { responseType: 'blob', timeout: 120000 }
            );
            const url = URL.createObjectURL(res.data);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', label || 'attachment');
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            showError(error.response?.data?.message || 'Could not download this attachment');
        } finally {
            setDownloadingAtt(null);
        }
    }, [showError]);

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
        setComposeTemplateId('');
        setShowCcBcc(false);
        setDraftId(null);
        if (composeFileInput.current) composeFileInput.current.value = '';
    };

    const openCompose = () => {
        resetCompose();
        setShowNewChatModal(true);
        // Fetch templates for the dropdown
        api.get('/email-templates').then(r => setComposeTemplates(r.data || [])).catch(() => {});
    };

    const applyComposeTemplate = (id) => {
        setComposeTemplateId(id);
        if (!id) return;
        const tpl = composeTemplates.find(t => t._id === id);
        if (tpl) {
            setComposeSubject(tpl.subject || '');
            setComposeMessage(tpl.body || '');
        }
    };

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

            if (composeTemplateId) payload.templateId = composeTemplateId;

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
            <div className="flex flex-col items-center justify-center h-full bg-slate-50 gap-3">
                <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                <p className="text-sm text-slate-500">Loading inbox...</p>
            </div>
        );
    }

    const emptyListCopy = debouncedSearch
        ? { title: 'No matches', hint: 'Try a different name or email address.' }
        : filter === 'unread'
            ? { title: "You're all caught up", hint: 'No unread conversations.' }
            : filter === 'archived'
                ? { title: 'No archived conversations', hint: 'Archived threads will show up here.' }
                : { title: 'No conversations yet', hint: canSend ? 'Compose an email to start one.' : 'New email threads will appear here.' };

    const closeThread = () => { setSelectedChat(null); setMessages([]); setShowContactPanel(false); };

    return (
        <div className="flex h-full w-full bg-white font-sans overflow-hidden">
            {/* ═══════════ CONVERSATION LIST ═══════════ */}
            <aside className={`${selectedChat ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] lg:w-[360px] flex-col flex-shrink-0 bg-white border-r border-slate-200`}>
                <div className="px-4 pt-4 pb-3 space-y-3 border-b border-slate-200">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <h2 className="text-base font-semibold text-slate-900">Inbox</h2>
                            {totalUnread > 0 && (
                                <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-100 px-2 py-0.5 rounded-full">{totalUnread}</span>
                            )}
                        </div>
                        {canSend && (
                            <div className="flex items-center gap-1 flex-shrink-0">
                                <button onClick={loadDrafts} className={iconBtnCls} title="Drafts">
                                    <i className="fa-solid fa-file-pen text-[14px]"></i>
                                </button>
                                <button onClick={loadScheduled} className={iconBtnCls} title="Scheduled emails">
                                    <i className="fa-regular fa-clock text-[14px]"></i>
                                </button>
                                <button
                                    onClick={openCompose}
                                    className="ml-1 h-9 px-3.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 shadow-sm transition-colors"
                                >
                                    <i className="fa-solid fa-pen-to-square text-[13px]"></i>
                                    Compose
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="relative">
                        <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[13px]"></i>
                        <input
                            type="text"
                            placeholder="Search name or email"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
                        />
                    </div>

                    <div className="flex p-1 bg-slate-100 rounded-lg">
                        {[
                            { id: 'all', label: 'All' },
                            { id: 'unread', label: 'Unread', count: totalUnread },
                            { id: 'archived', label: 'Archived' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => { setFilter(tab.id); closeThread(); }}
                                className={`flex-1 py-1.5 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${filter === tab.id
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-800'}`}
                            >
                                {tab.label}
                                {tab.count > 0 && (
                                    <span className="text-[10px] min-w-[18px] px-1.5 py-px rounded-full bg-blue-600 text-white font-bold">{tab.count}</span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {conversations.map(chat => {
                        const active = selectedChat?._id === chat._id;
                        const unread = chat.unreadCount > 0;
                        return (
                            <button
                                type="button"
                                key={chat._id}
                                onClick={() => handleSelectChat(chat)}
                                className={`relative w-full text-left flex gap-3 px-4 py-3.5 border-b border-slate-100 transition-colors ${active ? 'bg-blue-50/70' : 'hover:bg-slate-50'}`}
                            >
                                {active && <span className="absolute left-0 inset-y-0 w-[3px] bg-blue-600 rounded-r"></span>}
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0 ${avatarColor(chat.email)}`}>
                                    {initialOf(chat)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-2">
                                        <h3 className={`text-sm truncate ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                                            {nameOf(chat)}
                                        </h3>
                                        <span className={`text-xs flex-shrink-0 ${unread ? 'text-blue-600 font-semibold' : 'text-slate-400'}`}>
                                            {formatTime(chat.lastMessageAt)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between gap-2 mt-1">
                                        <p className={`text-[13px] truncate ${unread ? 'text-slate-700 font-medium' : 'text-slate-500'}`}>
                                            {chat.lastMessageDirection === 'outbound' && <span className="text-slate-400 font-normal">You: </span>}
                                            {chat.lastMessage || 'No messages'}
                                        </p>
                                        {unread && (
                                            <span className="bg-blue-600 text-white text-[10px] font-bold min-w-[20px] h-5 px-1.5 rounded-full flex items-center justify-center flex-shrink-0">
                                                {chat.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </button>
                        );
                    })}

                    {/* Pagination — conversations past the first 30 used to be unreachable */}
                    {hasMoreConversations && (
                        <div className="p-3">
                            <button
                                onClick={async () => {
                                    setLoadingMore(true);
                                    await fetchConversations({ silent: true, pageOverride: page + 1 });
                                    setLoadingMore(false);
                                }}
                                disabled={loadingMore}
                                className="w-full py-2.5 rounded-lg text-sm font-medium text-blue-600 bg-white border border-slate-200 hover:bg-blue-50 hover:border-blue-200 transition disabled:opacity-50"
                            >
                                {loadingMore ? <><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading...</> : 'Load more conversations'}
                            </button>
                        </div>
                    )}

                    {conversations.length === 0 && (
                        <div className="px-6 py-16 text-center">
                            <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                                <i className="fa-solid fa-envelope-open"></i>
                            </div>
                            <p className="text-sm font-medium text-slate-700">{emptyListCopy.title}</p>
                            <p className="text-sm text-slate-400 mt-1">{emptyListCopy.hint}</p>
                        </div>
                    )}
                </div>
            </aside>

            {/* ═══════════ THREAD ═══════════ */}
            <section className={`${selectedChat ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 relative overflow-hidden h-full`}>
                {selectedChat ? (
                    <>
                        <div className="flex-1 flex flex-col min-w-0 h-full">
                            {/* Thread header */}
                            <div className="h-16 px-4 md:px-6 bg-white border-b border-slate-200 flex items-center justify-between gap-3 flex-shrink-0">
                                <div className="flex items-center gap-3 min-w-0">
                                    <button onClick={closeThread} className={`${iconBtnCls} md:hidden -ml-1`} title="Back to conversations">
                                        <i className="fa-solid fa-arrow-left"></i>
                                    </button>
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0 ${avatarColor(selectedChat.email)}`}>
                                        {initialOf(selectedChat)}
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="text-base font-semibold text-slate-900 truncate leading-tight">{selectedChat.displayName || selectedChat.email}</h3>
                                        <p className="text-xs text-slate-500 truncate mt-0.5">{selectedChat.email}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    {selectedChat.metadata?.totalMessages > 0 && (
                                        <span className="hidden lg:inline-flex text-xs text-slate-500 font-medium bg-slate-100 px-2.5 py-1 rounded-full mr-2">
                                            {selectedChat.metadata.totalMessages} messages
                                        </span>
                                    )}
                                    <button
                                        onClick={handleToggleArchive}
                                        className={iconBtnCls}
                                        title={selectedChat.status === 'archived' ? 'Restore conversation' : 'Archive conversation'}
                                    >
                                        <i className={`fa-solid ${selectedChat.status === 'archived' ? 'fa-box-open' : 'fa-box-archive'}`}></i>
                                    </button>
                                    <button
                                        onClick={() => setShowContactPanel(v => !v)}
                                        className={showContactPanel
                                            ? 'w-9 h-9 rounded-lg flex items-center justify-center bg-blue-50 text-blue-600 transition-colors'
                                            : iconBtnCls}
                                        title="Contact details"
                                    >
                                        <i className="fa-solid fa-circle-info"></i>
                                    </button>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto bg-slate-50 custom-scrollbar" ref={scrollRef}>
                                <div className="max-w-4xl mx-auto px-4 md:px-8 py-6 space-y-4">
                                    {/* Older history — the thread now loads newest-first, so the
                                        start of a long conversation is reached by paging back. */}
                                    {olderCursor && (
                                        <div className="flex justify-center">
                                            <button
                                                onClick={loadOlderMessages}
                                                disabled={loadingOlder}
                                                className="px-4 py-2 rounded-full text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition disabled:opacity-50"
                                            >
                                                {loadingOlder
                                                    ? <><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Loading...</>
                                                    : <><i className="fa-solid fa-arrow-up mr-1.5"></i>Load earlier messages</>}
                                            </button>
                                        </div>
                                    )}

                                    {messages.length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
                                            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center border border-slate-200 text-slate-400">
                                                <i className="fa-solid fa-envelope-open"></i>
                                            </div>
                                            <p className="text-sm text-slate-500">No messages in this thread yet</p>
                                        </div>
                                    )}

                                    {messages.map((msg, index) => {
                                        const showDate = index === 0 ||
                                            new Date(msg.timestamp).toDateString() !== new Date(messages[index - 1].timestamp).toDateString();
                                        const isOut = msg.direction === 'outbound';
                                        const failed = msg.status === 'failed';
                                        const sender = isOut
                                            ? (msg.isAutomated ? 'Automation' : 'You')
                                            : nameOf(selectedChat);

                                        return (
                                            <React.Fragment key={msg._id}>
                                                {showDate && (
                                                    <div className="flex items-center gap-3 pt-2">
                                                        <div className="flex-1 h-px bg-slate-200"></div>
                                                        <span className="text-xs font-medium text-slate-400">
                                                            {new Date(msg.timestamp).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                                                        </span>
                                                        <div className="flex-1 h-px bg-slate-200"></div>
                                                    </div>
                                                )}

                                                <article className={`bg-white rounded-xl border shadow-sm overflow-hidden ${failed ? 'border-rose-200' : isOut ? 'border-blue-100' : 'border-slate-200'}`}>
                                                    {/* Sender row */}
                                                    <div className="flex items-start gap-3 px-5 pt-4 pb-3">
                                                        <div className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm flex-shrink-0 ${isOut
                                                            ? 'bg-blue-600 text-white'
                                                            : avatarColor(selectedChat.email)}`}>
                                                            {isOut
                                                                ? (msg.isAutomated
                                                                    ? <i className="fa-solid fa-robot text-[13px]"></i>
                                                                    : (user?.name || 'Y').charAt(0).toUpperCase())
                                                                : initialOf(selectedChat)}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 flex-wrap">
                                                                <span className="text-sm font-semibold text-slate-900">{sender}</span>
                                                                <span className="text-xs text-slate-400 truncate">
                                                                    {isOut ? `to ${selectedChat.email}` : selectedChat.email}
                                                                </span>
                                                                {msg.isAutomated && (
                                                                    <span className="text-[11px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">Automated</span>
                                                                )}
                                                                {failed && (
                                                                    <span className="text-[11px] font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">Failed</span>
                                                                )}
                                                            </div>
                                                            <p className="text-sm text-slate-700 font-medium mt-0.5 break-words">{msg.subject || '(No subject)'}</p>
                                                        </div>
                                                        <div
                                                            className="flex items-center gap-1.5 text-xs text-slate-400 flex-shrink-0 pt-0.5"
                                                            title={msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''}
                                                        >
                                                            <span>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                                                            {isOut && (
                                                                <i className={`fa-solid ${failed ? 'fa-circle-exclamation text-rose-500' : 'fa-check-double text-blue-500'}`}></i>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Body — indented under the avatar on wider screens */}
                                                    <div className="px-5 sm:pl-[68px] pb-4">
                                                        {msg.html ? (
                                                            <div
                                                                className="text-sm leading-relaxed text-slate-700 break-words [&_*]:max-w-full [&_a]:text-blue-600 [&_a]:underline"
                                                                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.html) }}
                                                            />
                                                        ) : (
                                                            <div className="text-sm leading-relaxed text-slate-700 break-words whitespace-pre-line">
                                                                {msg.text}
                                                            </div>
                                                        )}

                                                        {/* Attachments. Inbound files carry a storageKey and are
                                                            downloadable; outbound rows record names only, since the
                                                            bytes were the caller's and are not stored. */}
                                                        {msg.attachments?.length > 0 && (
                                                            <div className="mt-3 flex flex-wrap gap-2">
                                                                {msg.attachments.map((att, i) => {
                                                                    const label = att.originalName || att.filename;
                                                                    const chip = (
                                                                        <>
                                                                            <i className={`fa-solid ${att.storageKey ? 'fa-download' : 'fa-paperclip'} text-[11px]`}></i>
                                                                            <span className="truncate max-w-[180px]">{label}</span>
                                                                            {att.size > 0 && <span className="text-slate-400 font-normal">{formatBytes(att.size)}</span>}
                                                                        </>
                                                                    );
                                                                    if (!att.storageKey) {
                                                                        return (
                                                                            <span key={i} className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-lg">
                                                                                {chip}
                                                                            </span>
                                                                        );
                                                                    }
                                                                    return (
                                                                        <button
                                                                            key={i}
                                                                            type="button"
                                                                            disabled={downloadingAtt === `${msg._id}:${i}`}
                                                                            onClick={() => downloadAttachment(msg, i, label)}
                                                                            title={`Download ${label}`}
                                                                            className="flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition disabled:opacity-50"
                                                                        >
                                                                            {chip}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}

                                                        {/* Failure reason */}
                                                        {failed && msg.error && (
                                                            <p className="mt-3 text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2 break-words">
                                                                <i className="fa-solid fa-circle-exclamation mr-1.5"></i>{msg.error}
                                                            </p>
                                                        )}
                                                    </div>
                                                </article>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Reply composer — read-only users get no send controls */}
                            {!canSend ? (
                                <div className="bg-white border-t border-slate-200 px-6 py-4 flex-shrink-0 text-center">
                                    <p className="text-sm text-slate-500">
                                        <i className="fa-solid fa-lock mr-2 text-slate-400"></i>
                                        You have read-only access to this inbox.
                                    </p>
                                </div>
                            ) : (
                                <div className="bg-white border-t border-slate-200 px-4 md:px-8 py-4 flex-shrink-0">
                                    <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto">
                                        <div className="rounded-xl border border-slate-300 bg-white transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
                                            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-100">
                                                <span className="text-xs font-medium text-slate-400 flex-shrink-0">Subject</span>
                                                <input
                                                    type="text"
                                                    value={newSubject}
                                                    onChange={(e) => setNewSubject(e.target.value)}
                                                    placeholder="Subject"
                                                    className="flex-1 min-w-0 bg-transparent text-sm font-medium text-slate-800 placeholder:text-slate-400 outline-none"
                                                    disabled={sending}
                                                />
                                            </div>

                                            <textarea
                                                value={newMessage}
                                                onChange={(e) => setNewMessage(e.target.value)}
                                                placeholder={`Reply to ${nameOf(selectedChat)}...`}
                                                rows={3}
                                                className="block w-full px-4 py-3 bg-transparent text-sm text-slate-800 placeholder:text-slate-400 leading-relaxed outline-none resize-none min-h-[84px] max-h-[220px] custom-scrollbar"
                                                disabled={sending}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e); }
                                                }}
                                            />

                                            {replyFiles.length > 0 && (
                                                <div className="flex flex-wrap gap-2 px-4 pb-3">
                                                    {replyFiles.map((f, i) => (
                                                        <span key={i} className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 pl-3 pr-1.5 py-1 rounded-lg">
                                                            <i className="fa-solid fa-paperclip text-[11px] text-slate-400"></i>
                                                            <span className="truncate max-w-[160px]">{f.name}</span>
                                                            <span className="text-slate-400 font-normal">{formatBytes(f.size)}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setReplyFiles(prev => prev.filter((_, idx) => idx !== i))}
                                                                className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                                                title="Remove"
                                                            >
                                                                <i className="fa-solid fa-xmark text-[11px]"></i>
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between gap-3 px-2.5 py-2 border-t border-slate-100 bg-slate-50/70 rounded-b-xl">
                                                <div className="flex items-center gap-1.5">
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
                                                        className={iconBtnCls}
                                                    >
                                                        <i className="fa-solid fa-paperclip"></i>
                                                    </button>
                                                    <VariableSelector placement="top" onInsert={(v) => setNewMessage(prev => prev + v)} />
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className="hidden lg:inline text-xs text-slate-400">Enter to send · Shift+Enter for a new line</span>
                                                    <button
                                                        type="submit"
                                                        disabled={!newMessage.trim() || sending}
                                                        className="h-9 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {sending
                                                            ? <><i className="fa-solid fa-spinner fa-spin text-xs"></i> Sending</>
                                                            : <><i className="fa-solid fa-paper-plane text-xs"></i> Send</>}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                            )}
                        </div>

                        {/* ═══ Contact panel ═══ */}
                        {showContactPanel && (
                            <div className="absolute xl:static inset-y-0 right-0 z-20 w-72 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col overflow-y-auto custom-scrollbar h-full shadow-xl xl:shadow-none">
                                <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
                                    <span className="text-sm font-semibold text-slate-900">Contact details</span>
                                    <button onClick={() => setShowContactPanel(false)} className={iconBtnCls} title="Close">
                                        <i className="fa-solid fa-xmark"></i>
                                    </button>
                                </div>

                                <div className="flex flex-col items-center gap-1 py-6 px-5 border-b border-slate-100 text-center">
                                    <div className={`w-16 h-16 rounded-full flex items-center justify-center font-semibold text-2xl mb-2 ${avatarColor(selectedChat.email)}`}>
                                        {initialOf(selectedChat)}
                                    </div>
                                    <p className="text-base font-semibold text-slate-900 leading-tight">{nameOf(selectedChat)}</p>
                                    <p className="text-sm text-slate-500 break-all">{selectedChat.email}</p>
                                    {selectedChat.leadId?.status && (
                                        <span className="mt-2 text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                                            {selectedChat.leadId.status}
                                        </span>
                                    )}
                                </div>

                                <div className="p-5 space-y-4">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Thread activity</p>
                                    <div className="grid grid-cols-2 gap-2.5">
                                        {[
                                            { label: 'Messages', value: selectedChat.metadata?.totalMessages ?? '—' },
                                            { label: 'Unread', value: selectedChat.unreadCount ?? 0 },
                                            { label: 'Sent', value: selectedChat.metadata?.totalOutbound ?? '—' },
                                            { label: 'Received', value: selectedChat.metadata?.totalInbound ?? '—' },
                                        ].map(row => (
                                            <div key={row.label} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
                                                <p className="text-lg font-semibold text-slate-900 leading-none">{row.value}</p>
                                                <p className="text-xs text-slate-500 mt-1.5">{row.label}</p>
                                            </div>
                                        ))}
                                    </div>
                                    {selectedChat.lastMessageAt && (
                                        <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-sm">
                                            <span className="text-slate-500">Last activity</span>
                                            <span className="font-medium text-slate-700">{formatTime(selectedChat.lastMessageAt)}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    /* Empty state */
                    <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 gap-5 p-6 text-center">
                        <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 text-blue-600 flex items-center justify-center">
                            <i className="fa-solid fa-envelope-open-text text-2xl"></i>
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-slate-900">Select a conversation</h2>
                            <p className="text-sm text-slate-500 max-w-sm mt-1 leading-relaxed">
                                {canSend
                                    ? 'Pick a thread from the list to read and reply, or compose a new email.'
                                    : 'Pick a thread from the list to read it. You have read-only access.'}
                            </p>
                        </div>
                        {canSend && (
                            <button
                                onClick={openCompose}
                                className="h-10 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center gap-2 shadow-sm transition-colors"
                            >
                                <i className="fa-solid fa-pen-to-square"></i> Compose email
                            </button>
                        )}
                    </div>
                )}
            </section>

            {/* ═══ Drafts modal ═══ */}
            {showDrafts && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-fade-in-up">
                        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                            <div>
                                <h3 className="text-base font-semibold text-slate-900">Drafts</h3>
                                <p className="text-sm text-slate-500">Pick up where you left off</p>
                            </div>
                            <button onClick={() => setShowDrafts(false)} className={iconBtnCls} title="Close">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {drafts.length === 0 ? (
                                <div className="text-center py-12">
                                    <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                                        <i className="fa-solid fa-file-pen"></i>
                                    </div>
                                    <p className="text-sm font-medium text-slate-700">No saved drafts</p>
                                    <p className="text-sm text-slate-400 mt-1">Use “Save draft” in the compose window.</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {drafts.map(d => (
                                        <div key={d._id} className="flex items-center gap-3 px-2 py-3">
                                            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0">
                                                <i className="fa-solid fa-file-lines text-sm"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-800 truncate">{d.subject || '(No subject)'}</p>
                                                <p className="text-xs text-slate-500 truncate mt-0.5">
                                                    {d.to || 'No recipient'} · {new Date(d.updatedAt).toLocaleString()}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => resumeDraft(d)}
                                                className="h-8 px-3 rounded-lg text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 transition flex-shrink-0"
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

            {/* ═══ Scheduled outbox modal ═══ */}
            {showScheduled && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden animate-fade-in-up">
                        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
                            <div>
                                <h3 className="text-base font-semibold text-slate-900">Scheduled emails</h3>
                                <p className="text-sm text-slate-500">Queued to send later</p>
                            </div>
                            <button onClick={() => setShowScheduled(false)} className={iconBtnCls} title="Close">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>
                        <div className="p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {scheduled.length === 0 ? (
                                <div className="text-center py-12">
                                    <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                                        <i className="fa-regular fa-clock"></i>
                                    </div>
                                    <p className="text-sm font-medium text-slate-700">No emails are scheduled</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {scheduled.map(item => (
                                        <div key={item.id} className="flex items-center gap-3 px-2 py-3">
                                            <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600 flex-shrink-0">
                                                <i className="fa-solid fa-paper-plane text-sm"></i>
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-slate-800 truncate">{item.subject || '(No subject)'}</p>
                                                <p className="text-xs text-slate-500 truncate mt-0.5">
                                                    To {item.to} · {item.scheduledFor ? new Date(item.scheduledFor).toLocaleString() : 'pending'}
                                                </p>
                                            </div>
                                            <button
                                                onClick={() => cancelScheduled(item.id)}
                                                className="h-8 px-3 rounded-lg text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 transition flex-shrink-0"
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

            {/* ═══ Compose modal — isolated compose state, never touches the reply bar ═══ */}
            {showNewChatModal && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in-up max-h-[92vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-shrink-0">
                            <div>
                                <h3 className="text-base font-semibold text-slate-900">New email</h3>
                                <p className="text-sm text-slate-500">{draftId ? 'Editing a saved draft' : 'Start a new conversation'}</p>
                            </div>
                            <button onClick={() => setShowNewChatModal(false)} className={iconBtnCls} title="Close">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </div>

                        <form onSubmit={handleStartNewChat} className="flex flex-col flex-1 min-h-0">
                            <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-sm font-medium text-slate-700">To <span className="text-rose-500">*</span></label>
                                        {!(showCcBcc || composeCc || composeBcc) && (
                                            <button type="button" onClick={() => setShowCcBcc(true)} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                                                Add Cc / Bcc
                                            </button>
                                        )}
                                    </div>
                                    <input
                                        type="email"
                                        required
                                        value={composeEmail}
                                        onChange={(e) => setComposeEmail(e.target.value)}
                                        placeholder="lead@example.com"
                                        className={inputCls}
                                    />
                                </div>

                                {(showCcBcc || composeCc || composeBcc) && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label className={labelCls}>Cc</label>
                                            <input
                                                type="text"
                                                value={composeCc}
                                                onChange={(e) => setComposeCc(e.target.value)}
                                                placeholder="Comma-separated emails"
                                                className={inputCls}
                                            />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Bcc</label>
                                            <input
                                                type="text"
                                                value={composeBcc}
                                                onChange={(e) => setComposeBcc(e.target.value)}
                                                placeholder="Comma-separated emails"
                                                className={inputCls}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className={labelCls}>Template <span className="text-slate-400 font-normal">(optional)</span></label>
                                        <select
                                            value={composeTemplateId}
                                            onChange={(e) => applyComposeTemplate(e.target.value)}
                                            className={inputCls}
                                        >
                                            <option value="">Write from scratch</option>
                                            {composeTemplates.filter(t => t.isActive).map(t => (
                                                <option key={t._id} value={t._id}>{t.name}{t.attachments?.length > 0 ? ` (${t.attachments.length} attachment${t.attachments.length > 1 ? 's' : ''})` : ''}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={labelCls}>Schedule for <span className="text-slate-400 font-normal">(optional)</span></label>
                                        <input
                                            type="datetime-local"
                                            value={composeSchedule}
                                            onChange={(e) => setComposeSchedule(e.target.value)}
                                            className={inputCls}
                                        />
                                    </div>
                                </div>
                                {composeTemplateId && (() => {
                                    const tpl = composeTemplates.find(t => t._id === composeTemplateId);
                                    return tpl?.attachments?.length > 0 ? (
                                        <p className="-mt-2 text-sm text-blue-700 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                                            <i className="fa-solid fa-paperclip mr-1.5"></i>
                                            {tpl.attachments.length} template attachment{tpl.attachments.length > 1 ? 's' : ''} will be included automatically.
                                        </p>
                                    ) : null;
                                })()}

                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-sm font-medium text-slate-700">Subject <span className="text-rose-500">*</span></label>
                                        <VariableSelector onInsert={(v) => setComposeSubject(prev => prev + v)} />
                                    </div>
                                    <input
                                        type="text"
                                        required
                                        value={composeSubject}
                                        onChange={(e) => setComposeSubject(e.target.value)}
                                        placeholder="What's this email about?"
                                        className={inputCls}
                                    />
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="text-sm font-medium text-slate-700">Message <span className="text-rose-500">*</span></label>
                                        <VariableSelector onInsert={(v) => setComposeMessage(prev => prev + v)} />
                                    </div>
                                    <textarea
                                        required
                                        value={composeMessage}
                                        onChange={(e) => setComposeMessage(e.target.value)}
                                        placeholder="Write your email here..."
                                        className={`${inputCls} min-h-[200px] resize-y leading-relaxed`}
                                    ></textarea>
                                </div>

                                {/* Attachments */}
                                <div>
                                    <label className={labelCls}>Attachments</label>
                                    <input
                                        ref={composeFileInput}
                                        type="file"
                                        multiple
                                        className="hidden"
                                        disabled={!!composeSchedule}
                                        onChange={(e) => setComposeFiles(Array.from(e.target.files || []).slice(0, 5))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => composeFileInput.current?.click()}
                                        disabled={!!composeSchedule}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-3 border border-dashed border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/40 transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-300 disabled:hover:text-slate-600 disabled:hover:bg-transparent"
                                    >
                                        <i className="fa-solid fa-paperclip"></i>
                                        {composeSchedule ? 'Attachments are not available for scheduled emails' : 'Add files (up to 5, 10MB each)'}
                                    </button>
                                    {composeFiles.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mt-2.5">
                                            {composeFiles.map((f, i) => (
                                                <span key={i} className="flex items-center gap-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 pl-3 pr-1.5 py-1 rounded-lg">
                                                    <i className="fa-solid fa-paperclip text-[11px] text-slate-400"></i>
                                                    <span className="truncate max-w-[160px]">{f.name}</span>
                                                    <span className="text-slate-400 font-normal">{formatBytes(f.size)}</span>
                                                    <button
                                                        type="button"
                                                        onClick={() => setComposeFiles(prev => prev.filter((_, idx) => idx !== i))}
                                                        className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                                        title="Remove"
                                                    >
                                                        <i className="fa-solid fa-xmark text-[11px]"></i>
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="px-6 py-4 flex justify-end gap-2.5 border-t border-slate-200 bg-slate-50 flex-shrink-0">
                                <button type="button" onClick={() => setShowNewChatModal(false)} className="h-10 px-4 text-sm font-medium text-slate-600 hover:bg-slate-200/60 rounded-lg transition">
                                    Cancel
                                </button>
                                <button
                                    type="button"
                                    onClick={handleSaveDraft}
                                    disabled={savingDraft}
                                    className="h-10 px-4 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition flex items-center gap-2 disabled:opacity-50"
                                >
                                    {savingDraft
                                        ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</>
                                        : <><i className="fa-solid fa-file-pen"></i> {draftId ? 'Update draft' : 'Save draft'}</>}
                                </button>
                                <button type="submit" disabled={sending} className="h-10 px-5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition shadow-sm flex items-center gap-2 disabled:opacity-60">
                                    {sending
                                        ? <><i className="fa-solid fa-spinner fa-spin"></i> Sending...</>
                                        : <><i className={`fa-solid ${composeSchedule ? 'fa-clock' : 'fa-paper-plane'}`}></i> {composeSchedule ? 'Schedule email' : 'Send email'}</>}
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
