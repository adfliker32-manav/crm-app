import React, { useState, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import AssignLeadDropdown from '../Leads/AssignLeadDropdown';

// SortIcon component moved outside to avoid re-creation on each render
const SortIcon = ({ sortConfig, column }) => {
    if (sortConfig.key !== column) return <i className="fa-solid fa-sort text-gray-300 ml-1"></i>;
    return sortConfig.direction === 'asc'
        ? <i className="fa-solid fa-sort-up text-blue-600 ml-1"></i>
        : <i className="fa-solid fa-sort-down text-blue-600 ml-1"></i>;
};

const LeadsTable = ({ leads, stages = [], searchQuery = "", onEdit, onDelete, onStatusChange, onNoteClick, onLeadClick, onBulkDelete, onBulkStatusUpdate, onRefresh }) => {
    const { user } = useAuth();
    const [selectedIds, setSelectedIds] = useState([]);
    const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });

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

    const handleSort = (key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedIds(sortedLeads.map(lead => lead._id));
        } else {
            setSelectedIds([]);
        }
    };

    const handleSelect = (id) => {
        setSelectedIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
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
            {/* Bulk Actions Bar */}
            {selectedIds.length > 0 && (
                <div className="absolute top-0 left-0 right-0 z-20 bg-blue-600 text-white p-3 rounded-t-xl flex items-center justify-between shadow-lg animate-fade-in-down">
                    <div className="flex items-center gap-3">
                        <span className="font-bold bg-white text-blue-600 px-2 py-0.5 rounded-full text-sm">
                            {selectedIds.length}
                        </span>
                        <span className="text-sm font-medium">Selected</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <select
                            onChange={(e) => {
                                if (e.target.value) {
                                    onBulkStatusUpdate(selectedIds, e.target.value);
                                    setSelectedIds([]);
                                }
                            }}
                            className="text-gray-800 text-sm rounded-lg px-3 py-1.5 outline-none border-none cursor-pointer"
                            defaultValue=""
                        >
                            <option value="" disabled>Move to...</option>
                            {stages.map(stage => (
                                <option key={stage._id} value={stage.name}>{stage.name}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => {
                                onBulkDelete(selectedIds);
                                setSelectedIds([]);
                            }}
                            className="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-2"
                        >
                            <i className="fa-solid fa-trash-can"></i> Delete
                        </button>
                        <button
                            onClick={() => setSelectedIds([])}
                            className="text-white hover:text-blue-200 px-3"
                        >
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                <div className={`p-6 border-b border-slate-100 flex justify-between items-center ${selectedIds.length > 0 ? 'invisible' : ''}`}>
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
                                        checked={sortedLeads.length > 0 && selectedIds.length === sortedLeads.length}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    />
                                </th>
                                <th onClick={() => handleSort('name')} className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition">
                                    Name <SortIcon sortConfig={sortConfig} column="name" />
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
                            {sortedLeads.slice(0, 50).map((lead) => (
                                <tr key={lead._id} className={`hover:bg-slate-50 transition ${selectedIds.includes(lead._id) ? 'bg-blue-50' : ''}`}>
                                    <td className="px-6 py-4">
                                        <input
                                            type="checkbox"
                                            onChange={() => handleSelect(lead._id)}
                                            checked={selectedIds.includes(lead._id)}
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
                                            </div>
                                        </div>
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
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onEdit(lead); }}
                                                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-blue-100 hover:text-blue-600 transition flex items-center justify-center text-slate-400"
                                                title="Edit Lead"
                                            >
                                                <i className="fa-solid fa-pen text-xs"></i>
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDelete(lead._id); }}
                                                className="w-8 h-8 rounded-full bg-slate-100 hover:bg-red-100 hover:text-red-600 transition flex items-center justify-center text-slate-400"
                                                title="Delete Lead"
                                            >
                                                <i className="fa-solid fa-trash text-xs"></i>
                                            </button>
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
            </div>
        </div>
    );
};

export default LeadsTable;
