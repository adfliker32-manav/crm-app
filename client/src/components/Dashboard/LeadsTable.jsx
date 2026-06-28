import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import AssignLeadDropdown from '../Leads/AssignLeadDropdown';

// SortIcon component moved outside to avoid re-creation on each render
const SortIcon = ({ sortConfig, column }) => {
    if (sortConfig.key !== column) return <i className="fa-solid fa-sort text-gray-300 ml-1"></i>;
    return sortConfig.direction === 'asc'
        ? <i className="fa-solid fa-sort-up text-blue-600 ml-1"></i>
        : <i className="fa-solid fa-sort-down text-blue-600 ml-1"></i>;
};

// Lead-score badge — colour scales with engagement (Mailchimp/HubSpot-style)
const ScoreBadge = ({ score = 0 }) => {
    const s = Number(score) || 0;
    let tier, icon, classes;
    if (s >= 80) {
        tier = 'Hot';   icon = 'fa-fire';      classes = 'bg-red-50 text-red-700 ring-red-200';
    } else if (s >= 40) {
        tier = 'Warm';  icon = 'fa-sun';       classes = 'bg-amber-50 text-amber-700 ring-amber-200';
    } else if (s >= 10) {
        tier = 'Cool';  icon = 'fa-leaf';      classes = 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    } else {
        tier = 'Cold';  icon = 'fa-snowflake'; classes = 'bg-slate-100 text-slate-500 ring-slate-200';
    }
    return (
        <span
            title={`${tier} lead · score ${s}`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 ${classes}`}
        >
            <i className={`fa-solid ${icon} text-[9px]`}></i>
            {s}
        </span>
    );
};

const PAGE_SIZE = 50;

const LeadsTable = ({ leads, stages = [], userTags = [], searchQuery = "", onEdit, onDelete, onStatusChange, onNoteClick, onLeadClick, onBulkDelete, onBulkStatusUpdate, onBulkTag, onBulkRemoveTag, onBulkAssign, onBulkExport, onRefresh }) => {
    const { user } = useAuth();
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const sentinelRef = useRef(null);

    // Team members for bulk assign
    const [agents, setAgents] = useState([]);
    const [agentsLoading, setAgentsLoading] = useState(false);
    const agentsFetched = useRef(false);

    // Fetch agents once when the bulk bar first appears (lazy load)
    useEffect(() => {
        const canAssign = user?.role === 'manager' || user?.role === 'superadmin' || user?.permissions?.assignLeads;
        if (selectedIds.size > 0 && canAssign && !agentsFetched.current) {
            agentsFetched.current = true;
            setAgentsLoading(true);
            import('../../services/api').then(({ default: api }) => {
                api.get('/auth/my-team?includeManager=true')
                    .then(res => setAgents(res.data || []))
                    .catch(err => console.error('Failed to load agents:', err))
                    .finally(() => setAgentsLoading(false));
            });
        }
    }, [selectedIds.size, user]);

    // Auto-clear selection when the leads list changes (e.g. after bulk delete/status update)
    useEffect(() => {
        setSelectedIds(new Set());
    }, [leads]);


    // Sort and filter leads using useMemo instead of useEffect + setState
    const sortedLeads = useMemo(() => {
        let processed = [...leads];

        // Local Sort (respecting parent's initial sort/filter)
        // Note: Search filtering is now done by parent (Leads.jsx) before passing 'leads' prop.

        // Sort
        if (sortConfig.key) {
            processed.sort((a, b) => {
                let aValue = a[sortConfig.key];
                let bValue = b[sortConfig.key];

                // Handle special cases
                if (sortConfig.key === 'nextFollowUpDate') {
                    aValue = a.nextFollowUpDate ? new Date(a.nextFollowUpDate).getTime() : 0;
                    bValue = b.nextFollowUpDate ? new Date(b.nextFollowUpDate).getTime() : 0;
                } else if (sortConfig.key === 'date') {
                    aValue = new Date(a.createdAt || a.date).getTime();
                    bValue = new Date(b.createdAt || b.date).getTime();
                }

                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        return processed;
    }, [leads, searchQuery, sortConfig]);

    // Reset visible count whenever the filtered/sorted list changes
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [sortedLeads]);

    // IntersectionObserver: load more rows when the sentinel scrolls into view
    const loadMore = useCallback(() => {
        setVisibleCount(prev => Math.min(prev + PAGE_SIZE, sortedLeads.length));
    }, [sortedLeads.length]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;
        const observer = new IntersectionObserver(
            (entries) => { if (entries[0].isIntersecting) loadMore(); },
            { threshold: 0.1 }
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [loadMore]);

    const handleSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    // Visible rows (what the user actually sees)
    const visibleLeads = sortedLeads.slice(0, visibleCount);

    // BUG FIX: Select-All only applies to currently VISIBLE rows, not all 500+
    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(new Set(visibleLeads.map(l => l._id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const handleSelect = (id) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'New': return 'bg-blue-100 text-blue-800';
            case 'Contacted': return 'bg-yellow-100 text-yellow-800';
            case 'Won': return 'bg-green-100 text-green-800';
            case 'Lost': return 'bg-red-100 text-red-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const formatDate = (dateString) => {
        if (!dateString) return '-';
        const d = new Date(dateString);
        return isNaN(d.getTime()) ? '-' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const getRelativeTime = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '-';

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(date);
        target.setHours(0, 0, 0, 0);

        const diffTime = target - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        if (diffDays === -1) return 'Yesterday';
        if (diffDays > 0) return `In ${diffDays} days`;
        return `${Math.abs(diffDays)} days ago`;
    };

    const getFollowUpBadge = (dateString, done) => {
        if (!dateString || done) return <span className="text-gray-400 text-xs">-</span>;

        const date = new Date(dateString);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(date);
        target.setHours(0, 0, 0, 0);

        const isToday = target.getTime() === today.getTime();
        const isOverdue = target.getTime() < today.getTime();
        const relative = getRelativeTime(dateString);
        const dateDisplay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        if (isToday) {
            return (
                <span className="text-xs font-medium text-orange-600 bg-orange-50 px-2 py-1 rounded-full flex items-center gap-1 w-max">
                    <i className="fa-solid fa-bell"></i> Today
                </span>
            );
        } else if (isOverdue) {
            return (
                <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded-full flex items-center gap-1 w-max">
                    <i className="fa-solid fa-triangle-exclamation"></i> {relative}
                </span>
            );
        }
        return (
            <span className="text-xs font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded-full flex items-center gap-1 w-max">
                <i className="fa-regular fa-calendar"></i> {dateDisplay}
            </span>
        );
    };



    return (
        <div className="relative">
            {/* ── Bulk Actions Bar ── */}
            {selectedIds.size > 0 && (
                <div className="absolute top-0 left-0 right-0 z-20 rounded-t-xl shadow-2xl overflow-hidden">
                    {/* Gradient header */}
                    <div className="bg-gradient-to-r from-indigo-600 via-blue-600 to-blue-500 text-white px-4 py-3 flex flex-wrap items-center gap-3">

                        {/* Selection count badge */}
                        <div className="flex items-center gap-2 mr-2">
                            <span className="flex items-center justify-center w-7 h-7 bg-white text-blue-700 rounded-full text-sm font-black shadow">
                                {selectedIds.size}
                            </span>
                            <span className="text-sm font-semibold tracking-wide">
                                lead{selectedIds.size !== 1 ? 's' : ''} selected
                            </span>
                        </div>

                        {/* Divider */}
                        <div className="h-6 w-px bg-white/25 hidden sm:block" />

                        {/* ── Move to Stage ── */}
                        <div className="relative group">
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        onBulkStatusUpdate([...selectedIds], e.target.value);
                                        e.target.value = '';
                                    }
                                }}
                                defaultValue=""
                                title="Move selected leads to a pipeline stage"
                                className="appearance-none bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg pl-8 pr-3 py-2 outline-none border border-white/20 hover:border-white/40 cursor-pointer transition backdrop-blur-sm"
                            >
                                <option value="" disabled className="text-gray-800">Move to Stage…</option>
                                {stages.map(stage => (
                                    <option key={stage._id} value={stage.name} className="text-gray-800">{stage.name}</option>
                                ))}
                            </select>
                            <i className="fa-solid fa-right-left absolute left-2.5 top-1/2 -translate-y-1/2 text-white/70 text-[10px] pointer-events-none" />
                        </div>

                        {/* ── Apply Tag ── */}
                        {userTags && userTags.length > 0 && (
                            <div className="relative group">
                                <select
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            onBulkTag([...selectedIds], JSON.parse(e.target.value));
                                            e.target.value = '';
                                        }
                                    }}
                                    defaultValue=""
                                    title="Apply a tag to selected leads"
                                    className="appearance-none bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg pl-8 pr-3 py-2 outline-none border border-white/20 hover:border-white/40 cursor-pointer transition backdrop-blur-sm"
                                >
                                    <option value="" disabled className="text-gray-800">Add Tag…</option>
                                    {userTags.map(tag => (
                                        <option key={tag._id} value={JSON.stringify([tag.name])} className="text-gray-800">{tag.name}</option>
                                    ))}
                                </select>
                                <i className="fa-solid fa-tag absolute left-2.5 top-1/2 -translate-y-1/2 text-white/70 text-[10px] pointer-events-none" />
                            </div>
                        )}

                        {/* ── Remove Tag ── */}
                        {userTags && userTags.length > 0 && onBulkRemoveTag && (
                            <div className="relative group">
                                <select
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            onBulkRemoveTag([...selectedIds], JSON.parse(e.target.value));
                                            e.target.value = '';
                                        }
                                    }}
                                    defaultValue=""
                                    title="Remove a tag from selected leads"
                                    className="appearance-none bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg pl-8 pr-3 py-2 outline-none border border-white/20 hover:border-white/40 cursor-pointer transition backdrop-blur-sm"
                                >
                                    <option value="" disabled className="text-gray-800">Remove Tag…</option>
                                    {userTags.map(tag => (
                                        <option key={tag._id} value={JSON.stringify([tag.name])} className="text-gray-800">{tag.name}</option>
                                    ))}
                                </select>
                                <i className="fa-solid fa-tag-slash absolute left-2.5 top-1/2 -translate-y-1/2 text-white/70 text-[10px] pointer-events-none" />
                            </div>
                        )}

                        {/* Divider */}
                        <div className="h-6 w-px bg-white/25 hidden sm:block" />

                        {/* ── Bulk Assign ── */}
                        {(user?.role === 'manager' || user?.role === 'superadmin' || user?.permissions?.assignLeads) && onBulkAssign && (
                            <div className="relative group">
                                <select
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        const agentName = agents.find(a => a._id === val)?.name || 'Unassigned';
                                        onBulkAssign([...selectedIds], val || null, agentName);
                                        e.target.value = '';
                                    }}
                                    defaultValue=""
                                    disabled={agentsLoading}
                                    title="Assign selected leads to a team member"
                                    className="appearance-none bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg pl-8 pr-3 py-2 outline-none border border-white/20 hover:border-white/40 cursor-pointer transition backdrop-blur-sm disabled:opacity-50"
                                >
                                    <option value="" disabled className="text-gray-800">
                                        {agentsLoading ? 'Loading…' : 'Assign To…'}
                                    </option>
                                    <option value="" className="text-gray-800">— Unassign —</option>
                                    {agents.map(agent => (
                                        <option key={agent._id} value={agent._id} className="text-gray-800">{agent.name}</option>
                                    ))}
                                </select>
                                <i className="fa-solid fa-user-check absolute left-2.5 top-1/2 -translate-y-1/2 text-white/70 text-[10px] pointer-events-none" />
                            </div>
                        )}

                        {/* ── Export Selected ── */}
                        {onBulkExport && (
                            <button
                                onClick={() => onBulkExport([...selectedIds])}
                                title={`Export ${selectedIds.size} selected lead${selectedIds.size !== 1 ? 's' : ''} to CSV`}
                                className="flex items-center gap-1.5 bg-white/15 hover:bg-white/25 border border-white/20 hover:border-white/40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition backdrop-blur-sm"
                            >
                                <i className="fa-solid fa-file-arrow-down text-[10px]" />
                                Export
                            </button>
                        )}

                        {/* Divider */}
                        <div className="h-6 w-px bg-white/25 hidden sm:block" />

                        {/* ── Delete ── */}
                        {(user?.role === 'superadmin' || user?.role === 'manager' || user?.permissions?.deleteLeads) && (
                            <button
                                onClick={() => {
                                    onBulkDelete([...selectedIds]);
                                }}
                                title={`Permanently delete ${selectedIds.size} lead${selectedIds.size !== 1 ? 's' : ''}`}
                                className="flex items-center gap-1.5 bg-red-500/80 hover:bg-red-500 border border-red-400/40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
                            >
                                <i className="fa-solid fa-trash-can text-[10px]" />
                                Delete
                            </button>
                        )}

                        {/* ── Clear selection ── */}
                        <button
                            onClick={() => setSelectedIds(new Set())}
                            title="Clear selection"
                            className="ml-auto flex items-center gap-1.5 text-white/70 hover:text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-white/10 transition"
                        >
                            <i className="fa-solid fa-xmark" /> Clear
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                <div className={`p-6 border-b border-slate-100 flex justify-between items-center ${selectedIds.size > 0 ? 'invisible' : ''}`}>
                    <h3 className="text-lg font-bold text-slate-800">Recent Leads</h3>
                    <span className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full">
                        Total: {sortedLeads.length}
                    </span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-bold tracking-wider">
                            <tr>
                                <th className="px-6 py-4 w-10">
                                    <input
                                        type="checkbox"
                                        onChange={handleSelectAll}
                                        checked={visibleLeads.length > 0 && visibleLeads.every(l => selectedIds.has(l._id))}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                </th>
                                <th onClick={() => handleSort('name')} className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition">
                                    Name <SortIcon sortConfig={sortConfig} column="name" />
                                </th>
                                <th onClick={() => handleSort('score')} className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition text-center">
                                    Score <SortIcon sortConfig={sortConfig} column="score" />
                                </th>
                                <th className="px-6 py-4">Status</th>
                                <th onClick={() => handleSort('nextFollowUpDate')} className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition">
                                    Next Follow-up <SortIcon sortConfig={sortConfig} column="nextFollowUpDate" />
                                </th>
                                <th onClick={() => handleSort('source')} className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition">
                                    Source <SortIcon sortConfig={sortConfig} column="source" />
                                </th>
                                <th onClick={() => handleSort('date')} className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition">
                                    Created <SortIcon sortConfig={sortConfig} column="date" />
                                </th>
                                {(user?.role === 'manager' || user?.role === 'superadmin' || user?.permissions?.assignLeads) && (
                                    <th className="px-6 py-4">Assigned To</th>
                                )}
                                <th className="px-6 py-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {/* BUG FIX: use Set.has() — O(1) vs Array.includes() O(n) */}
                            {visibleLeads.map((lead) => (
                                <tr key={lead._id} className={`hover:bg-slate-50 transition ${selectedIds.has(lead._id) ? 'bg-blue-50' : ''}`}>
                                    <td className="px-6 py-4">
                                        <input
                                            type="checkbox"
                                            onChange={() => handleSelect(lead._id)}
                                            checked={selectedIds.has(lead._id)}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        />
                                    </td>
                                    <td className="px-6 py-4">
                                        <div
                                            className="flex items-center gap-3 cursor-pointer group"
                                            onClick={() => onLeadClick && onLeadClick(lead)}
                                        >
                                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs ring-2 ring-white group-hover:ring-blue-200 transition">
                                                {lead.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-700 group-hover:text-blue-600 transition">{lead.name}</div>
                                                <div className="text-xs text-slate-500">{lead.phone || '-'}</div>
                                                {lead.tags && lead.tags.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {lead.tags.map(tagName => {
                                                            const tagObj = userTags?.find(t => t.name === tagName);
                                                            return (
                                                                <span key={tagName} className="text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap" style={{ backgroundColor: tagObj ? `${tagObj.color}20` : '#f1f5f9', color: tagObj ? tagObj.color : '#64748b', borderColor: tagObj ? `${tagObj.color}40` : '#cbd5e1' }}>
                                                                    {tagName}
                                                                </span>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center">
                                        <ScoreBadge score={lead.score} />
                                    </td>
                                    <td className="px-6 py-4">
                                        <select
                                            value={lead.status || 'New'}
                                            onChange={(e) => onStatusChange(lead._id, e.target.value)}
                                            className={`px-3 py-1 rounded-lg text-xs font-bold border-0 cursor-pointer focus:ring-2 focus:ring-blue-500 ${getStatusColor(lead.status || 'New')}`}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {!stages.some(s => s.name === (lead.status || 'New')) && (
                                                <option value={lead.status || 'New'}>{lead.status || 'New'}</option>
                                            )}
                                            {stages.map(stage => (
                                                <option key={stage._id} value={stage.name} className="bg-white text-gray-800">
                                                    {stage.name}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="px-6 py-4">
                                        {getFollowUpBadge(lead.nextFollowUpDate, false)}
                                    </td>
                                    <td className="px-6 py-4 text-xs font-medium text-slate-500">
                                        <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200 whitespace-nowrap">
                                            {lead.source || 'Manual'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-sm text-slate-500">
                                        {formatDate(lead.createdAt || lead.date)}
                                    </td>
                                    {(user?.role === 'manager' || user?.role === 'superadmin' || user?.permissions?.assignLeads) && (
                                        <td className="px-6 py-4">
                                            <AssignLeadDropdown
                                                leadId={lead._id}
                                                currentAssignee={lead.assignedTo?._id}
                                                onAssign={onRefresh}
                                            />
                                        </td>
                                    )}
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onLeadClick && onLeadClick(lead); }}
                                                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-blue-100 hover:text-blue-600 transition flex items-center justify-center text-slate-400 border border-transparent hover:border-blue-200"
                                                title="View Full Details"
                                            >
                                                <i className="fa-solid fa-eye text-xs"></i>
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onNoteClick(lead); }}
                                                className="w-8 h-8 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-600 transition flex items-center justify-center border border-orange-200"
                                                title="Add Note"
                                            >
                                                <i className="fa-regular fa-note-sticky text-xs"></i>
                                            </button>
                                            {(user?.role === 'manager' || user?.role === 'superadmin' || user?.permissions?.editLeads !== false) && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onEdit(lead); }}
                                                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-blue-100 hover:text-blue-600 transition flex items-center justify-center text-slate-400"
                                                    title="Edit Lead"
                                                >
                                                    <i className="fa-solid fa-pen text-xs"></i>
                                                </button>
                                            )}
                                            {(user?.role === 'manager' || user?.role === 'superadmin' || user?.permissions?.deleteLeads) && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onDelete(lead._id); }}
                                                    className="w-8 h-8 rounded-full bg-slate-100 hover:bg-red-100 hover:text-red-600 transition flex items-center justify-center text-slate-400"
                                                    title="Delete Lead"
                                                >
                                                    <i className="fa-solid fa-trash text-xs"></i>
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {sortedLeads.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-gray-400">
                                        <div className="flex flex-col items-center gap-3">
                                            <i className="fa-solid fa-user-xmark text-4xl text-gray-200"></i>
                                            <p>No leads found matching your search.</p>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Infinite-scroll sentinel + progress indicator */}
                {visibleCount < sortedLeads.length && (
                    <div
                        ref={sentinelRef}
                        className="flex items-center justify-center gap-3 py-5 border-t border-slate-100 bg-slate-50/50"
                    >
                        <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                        </svg>
                        <span className="text-xs text-slate-400 font-medium">
                            Showing {visibleCount} of {sortedLeads.length} leads…
                        </span>
                    </div>
                )}
                {visibleCount >= sortedLeads.length && sortedLeads.length > PAGE_SIZE && (
                    <div className="flex items-center justify-center py-3 border-t border-slate-100 bg-slate-50/50">
                        <span className="text-xs text-slate-400 font-medium">All {sortedLeads.length} leads loaded</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LeadsTable;
