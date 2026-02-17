import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import api from '../services/api';
import LeadsTable from '../components/Dashboard/LeadsTable';
import AddLeadModal from '../components/Dashboard/AddLeadModal';
import AddStageModal from '../components/Dashboard/AddStageModal';
import EditLeadModal from '../components/Dashboard/EditLeadModal';
import LeadDetailsModal from '../components/Dashboard/LeadDetailsModal';
import NoteModal from '../components/Dashboard/NoteModal';
import { useNotification } from '../context/NotificationContext';
import { useConfirm } from '../context/ConfirmContext';

const Leads = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    // View state: 'pipeline' or 'table'
    const [view, setView] = useState('table');

    // Common state
    const [loading, setLoading] = useState(true);
    const [leads, setLeads] = useState([]);
    const [stages, setStages] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");

    // Filter & Sort State
    const [filterSource, setFilterSource] = useState("All");
    const [sortOption, setSortOption] = useState("newest");

    // Pipeline-specific state
    const [columns, setColumns] = useState({});

    // Inline edit stage state
    const [editingStageId, setEditingStageId] = useState(null);
    const [editingStageName, setEditingStageName] = useState('');
    const editInputRef = useRef(null);

    // Modal states
    const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false);
    const [isAddStageModalOpen, setIsAddStageModalOpen] = useState(false);
    const [isEditLeadModalOpen, setIsEditLeadModalOpen] = useState(false);
    const [isLeadDetailsModalOpen, setIsLeadDetailsModalOpen] = useState(false);
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState(null);

    const fetchData = useCallback(async () => {
        try {
            const [leadsRes, stagesRes] = await Promise.all([
                api.get('/leads'),
                api.get('/stages')
            ]);

            const fetchedLeads = leadsRes.data;
            let fetchedStages = stagesRes.data;

            if (fetchedStages.length === 0) {
                fetchedStages = [{ _id: 'new', name: 'New' }];
            }

            setLeads(fetchedLeads);
            setStages(fetchedStages);
        } catch (error) {
            console.error("Error loading data", error);
            showError("Failed to load leads data");
        } finally {
            setLoading(false);
        }
    }, [showError]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Focus the edit input when editing starts
    useEffect(() => {
        if (editingStageId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingStageId]);

    // Derived Sources for Filter Dropdown
    const sources = React.useMemo(() => {
        const uniqueSources = [...new Set(leads.map(lead => lead.source || 'Manual'))];
        return ['All', ...uniqueSources];
    }, [leads]);

    // Central Filtering & Sorting Logic
    const filteredLeads = React.useMemo(() => {
        let processed = [...leads];

        // 1. Filter by Search Query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            processed = processed.filter(lead =>
                (lead.name && lead.name.toLowerCase().includes(query)) ||
                (lead.phone && lead.phone.toLowerCase().includes(query)) ||
                (lead.email && lead.email.toLowerCase().includes(query)) ||
                (lead.source && lead.source.toLowerCase().includes(query)) ||
                (lead.status && lead.status.toLowerCase().includes(query))
            );
        }

        // 2. Filter by Source
        if (filterSource !== "All") {
            processed = processed.filter(lead => (lead.source || 'Manual') === filterSource);
        }

        // 3. Sort
        processed.sort((a, b) => {
            const dateA = new Date(a.createdAt || a.date).getTime();
            const dateB = new Date(b.createdAt || b.date).getTime();

            switch (sortOption) {
                case "newest":
                    return dateB - dateA;
                case "oldest":
                    return dateA - dateB;
                case "last_updated":
                    const updateA = new Date(a.updatedAt || a.createdAt).getTime();
                    const updateB = new Date(b.updatedAt || b.createdAt).getTime();
                    return updateB - updateA;
                case "name_asc":
                    return a.name.localeCompare(b.name);
                case "name_desc":
                    return b.name.localeCompare(a.name);
                default:
                    return 0;
            }
        });

        return processed;
    }, [leads, searchQuery, filterSource, sortOption]);

    // Update Pipeline Columns when filteredLeads or stages change
    useEffect(() => {
        const newColumns = {};
        stages.forEach(stage => {
            newColumns[stage.name] = {
                id: stage._id,
                name: stage.name,
                items: filteredLeads.filter(lead => (lead.status || 'New') === stage.name)
            };
        });
        setColumns(newColumns);
    }, [filteredLeads, stages]);

    // Pipeline handlers
    const onDragEnd = async (result) => {
        console.log('🔄 [DEBUG] onDragEnd triggered:', result);

        if (!result.destination) return;

        const { source, destination } = result;

        if (source.droppableId !== destination.droppableId) {
            const sourceColumn = columns[source.droppableId];
            const destColumn = columns[destination.droppableId];

            if (!sourceColumn || !destColumn) return;

            const sourceItems = [...sourceColumn.items];
            const destItems = [...destColumn.items];
            const [removed] = sourceItems.splice(source.index, 1);

            if (!removed) return;

            const newStatus = destColumn.name;
            const updatedItem = { ...removed, status: newStatus };
            destItems.splice(destination.index, 0, updatedItem);

            setColumns({
                ...columns,
                [source.droppableId]: { ...sourceColumn, items: sourceItems },
                [destination.droppableId]: { ...destColumn, items: destItems }
            });

            // Optimistically update main leads state
            setLeads(prevLeads => prevLeads.map(lead =>
                lead._id === removed._id ? { ...lead, status: newStatus } : lead
            ));

            try {
                await api.put(`/leads/${removed._id}`, { status: newStatus });
                showSuccess(`Lead moved to "${newStatus}"`);
            } catch (error) {
                console.error("Failed to update status", error);
                showError("Failed to update status");
                fetchData(); // Revert
            }
        }
    };

    // ---- Stage Rename (Edit) ----
    const startEditingStage = (stageId, stageName) => {
        setEditingStageId(stageId);
        setEditingStageName(stageName);
    };

    const cancelEditingStage = () => {
        setEditingStageId(null);
        setEditingStageName('');
    };

    const saveStageRename = async (stageId) => {
        const newName = editingStageName.trim();
        if (!newName) {
            showError('Stage name cannot be empty');
            cancelEditingStage();
            return;
        }
        try {
            await api.put(`/stages/${stageId}`, { name: newName });
            showSuccess('Stage renamed successfully');
            cancelEditingStage();
            fetchData();
        } catch (error) {
            console.error("Failed to rename stage", error);
            showError(error.response?.data?.message || 'Failed to rename stage');
            cancelEditingStage();
        }
    };

    const handleEditKeyDown = (e, stageId) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            saveStageRename(stageId);
        } else if (e.key === 'Escape') {
            cancelEditingStage();
        }
    };

    // ---- Stage Delete ----
    const deleteStage = async (stageId, stageName) => {
        if (stageName === 'New') return showError("Cannot delete default 'New' stage");
        const confirmed = await showDanger(`Delete "${stageName}" stage? All leads will be moved to "New".`, "Delete Stage");
        if (!confirmed) return;
        try {
            await api.delete(`/stages/${stageId}`);
            showSuccess('Stage deleted');
            fetchData();
        } catch (error) { showError("Failed to delete stage"); }
    };

    // Table handlers
    const handleEditLead = (lead) => {
        setSelectedLead(lead);
        setIsEditLeadModalOpen(true);
    };

    const handleLeadClick = (lead) => {
        setSelectedLead(lead);
        setIsLeadDetailsModalOpen(true);
    };

    const handleDeleteLead = async (id) => {
        const confirmed = await showDanger(
            "This action cannot be undone. The lead will be permanently deleted.",
            "Delete Lead?"
        );
        if (!confirmed) return;

        try {
            await api.delete(`/leads/${id}`);
            showSuccess('Lead deleted successfully');
            fetchData();
        } catch (err) {
            console.error("Failed to delete lead", err);
            showError("Failed to delete lead");
        }
    };

    const handleStatusChange = async (leadId, newStatus) => {
        try {
            await api.put(`/leads/${leadId}`, { status: newStatus });
            showSuccess('Status updated successfully');
            fetchData();
        } catch (err) {
            console.error("Failed to update status", err);
            showError("Failed to update status");
        }
    };

    const handleNoteClick = (lead) => {
        setSelectedLead(lead);
        setIsNoteModalOpen(true);
    };

    const handleBulkDelete = async (ids) => {
        const confirmed = await showDanger(
            `This will permanently delete ${ids.length} leads.`,
            `Delete ${ids.length} Leads?`
        );
        if (!confirmed) return;

        try {
            await Promise.all(ids.map(id => api.delete(`/leads/${id}`)));
            showSuccess(`${ids.length} leads deleted successfully`);
            fetchData();
        } catch (err) {
            console.error("Failed to delete leads", err);
            showError("Failed to delete leads");
        }
    };

    const handleBulkStatusUpdate = async (ids, newStatus) => {
        try {
            await Promise.all(ids.map(id => api.put(`/leads/${id}`, { status: newStatus })));
            showSuccess(`${ids.length} leads updated successfully`);
            fetchData();
        } catch (err) {
            console.error("Failed to update leads", err);
            showError("Failed to update leads");
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading leads...</div>;

    return (
        <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 to-blue-50/20">
            {/* Header with View Toggle */}
            <div className="flex flex-col lg:flex-row justify-between items-center p-6 bg-white/80 backdrop-blur-md border-b border-white/50 sticky top-0 z-20 gap-4">
                <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-800 to-indigo-600 flex items-center gap-3 w-full lg:w-auto">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-blue-500/30 shadow-lg">
                        <i className="fa-solid fa-users text-lg"></i>
                    </div>
                    Leads Pipeline
                </h1>

                <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-end">
                    {/* Search Bar */}
                    <div className="relative group w-full sm:w-60">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <i className="fa-solid fa-search text-slate-400 group-focus-within:text-blue-500 transition-colors"></i>
                        </div>
                        <input
                            type="text"
                            placeholder="Search leads..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 bg-slate-100/50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm focus:shadow-md"
                        />
                    </div>

                    {/* Source Filter */}
                    <div className="relative w-full sm:w-auto">
                        <select
                            value={filterSource}
                            onChange={(e) => setFilterSource(e.target.value)}
                            className="w-full sm:w-auto appearance-none bg-slate-100/50 border border-slate-200 rounded-xl py-2 pl-4 pr-10 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer hover:bg-slate-100 transition shadow-sm"
                        >
                            {sources.map(source => (
                                <option key={source} value={source}>
                                    {source === 'All' ? 'All Sources' : source}
                                </option>
                            ))}
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-slate-400">
                            <i className="fa-solid fa-filter text-xs"></i>
                        </div>
                    </div>

                    {/* Sort Filter */}
                    <div className="relative w-full sm:w-auto">
                        <select
                            value={sortOption}
                            onChange={(e) => setSortOption(e.target.value)}
                            className="w-full sm:w-auto appearance-none bg-slate-100/50 border border-slate-200 rounded-xl py-2 pl-4 pr-10 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 cursor-pointer hover:bg-slate-100 transition shadow-sm"
                        >
                            <option value="newest">Newest First</option>
                            <option value="oldest">Oldest First</option>
                            <option value="last_updated">Last Updated</option>
                            <option value="name_asc">Name (A-Z)</option>
                            <option value="name_desc">Name (Z-A)</option>
                        </select>
                        <div className="absolute inset-y-0 right-0 flex items-center px-3 pointer-events-none text-slate-400">
                            <i className="fa-solid fa-sort text-xs"></i>
                        </div>
                    </div>

                    {/* View Toggle */}
                    <div className="flex bg-slate-100/80 p-1 rounded-xl shadow-inner border border-slate-200/50">
                        <button
                            onClick={() => setView('pipeline')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-300 flex items-center gap-2 ${view === 'pipeline'
                                ? 'bg-white text-blue-600 shadow-sm transform scale-100'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                                }`}
                        >
                            <i className="fa-solid fa-grip-vertical"></i>
                        </button>
                        <button
                            onClick={() => setView('table')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all duration-300 flex items-center gap-2 ${view === 'table'
                                ? 'bg-white text-blue-600 shadow-sm transform scale-100'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                                }`}
                        >
                            <i className="fa-solid fa-table"></i>
                        </button>
                    </div>

                    {/* Action Buttons */}
                    <button
                        onClick={() => setIsAddLeadModalOpen(true)}
                        className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white w-8 h-8 sm:w-auto sm:h-auto sm:px-4 sm:py-2 rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 shrink-0"
                        title="Add Lead"
                    >
                        <i className="fa-solid fa-plus"></i> <span className="hidden sm:inline">Add</span>
                    </button>
                    <button
                        onClick={() => setIsAddStageModalOpen(true)}
                        className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 w-8 h-8 sm:w-auto sm:h-auto sm:px-4 sm:py-2 rounded-xl text-sm font-bold transition-all shadow-sm flex items-center justify-center gap-2 shrink-0"
                        title="Add Stage"
                    >
                        <i className="fa-solid fa-layer-group text-slate-400"></i> <span className="hidden sm:inline">Stage</span>
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {view === 'pipeline' ? (
                // Pipeline View
                <div className="flex-1 overflow-x-auto pb-8 pt-4 px-6">
                    <div className="flex h-full gap-8 min-w-max">
                        <DragDropContext onDragEnd={onDragEnd}>
                            {Object.entries(columns).map(([columnId, column]) => {
                                // Filter items for this column if search query exists
                                const filteredItems = searchQuery
                                    ? column.items.filter(item =>
                                        (item.name && item.name.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                        (item.lead?.phone && item.lead.phone.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                        (item.lead?.email && item.lead.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
                                        (item.lead?.source && item.lead.source.toLowerCase().includes(searchQuery.toLowerCase()))
                                    )
                                    : column.items;

                                return (
                                    <div key={columnId} className="flex flex-col w-[340px] max-h-full">
                                        <div className="group flex items-center justify-between p-4 mb-3 rounded-xl bg-white/60 backdrop-blur-sm border border-slate-200/60 shadow-sm">
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${column.name === 'New' ? 'bg-blue-500' :
                                                    column.name === 'Contacted' ? 'bg-yellow-500' :
                                                        column.name === 'Won' ? 'bg-green-500' :
                                                            column.name === 'Lost' ? 'bg-red-500' : 'bg-slate-400'
                                                    } ring-4 ring-white/50`}></div>
                                                {editingStageId === column.id ? (
                                                    <input
                                                        ref={editInputRef}
                                                        type="text"
                                                        value={editingStageName}
                                                        onChange={(e) => setEditingStageName(e.target.value)}
                                                        onKeyDown={(e) => handleEditKeyDown(e, column.id)}
                                                        onBlur={() => saveStageRename(column.id)}
                                                        className="bg-white border border-blue-300 text-slate-700 text-sm font-bold uppercase tracking-tight px-2 py-1 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 w-full"
                                                    />
                                                ) : (
                                                    <span className="font-extrabold text-slate-700 tracking-tight text-sm uppercase truncate">{column.name}</span>
                                                )}
                                                {editingStageId !== column.id && (
                                                    <span className="bg-slate-100 text-slate-500 text-xs font-bold px-2.5 py-1 rounded-lg border border-slate-200/50 flex-shrink-0">
                                                        {filteredItems.length}
                                                    </span>
                                                )}
                                            </div>
                                            {column.name !== 'New' && editingStageId !== column.id && (
                                                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                                    <button
                                                        onClick={() => startEditingStage(column.id, column.name)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 transition-all"
                                                        title="Rename Stage"
                                                    >
                                                        <i className="fa-solid fa-pen text-xs"></i>
                                                    </button>
                                                    <button
                                                        onClick={() => deleteStage(column.id, column.name)}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                                                        title="Delete Stage"
                                                    >
                                                        <i className="fa-solid fa-trash text-xs"></i>
                                                    </button>
                                                </div>
                                            )}
                                            {editingStageId === column.id && (
                                                <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                                    <button
                                                        onMouseDown={(e) => { e.preventDefault(); saveStageRename(column.id); }}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-green-500 hover:bg-green-50 transition-all"
                                                        title="Save"
                                                    >
                                                        <i className="fa-solid fa-check text-xs"></i>
                                                    </button>
                                                    <button
                                                        onMouseDown={(e) => { e.preventDefault(); cancelEditingStage(); }}
                                                        className="w-7 h-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 transition-all"
                                                        title="Cancel"
                                                    >
                                                        <i className="fa-solid fa-xmark text-xs"></i>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <Droppable droppableId={columnId}>
                                            {(provided, snapshot) => (
                                                <div
                                                    {...provided.droppableProps}
                                                    ref={provided.innerRef}
                                                    className={`min-h-[150px] transition-all duration-300 rounded-2xl flex-1 p-2 ${snapshot.isDraggingOver ? 'bg-slate-100/50 ring-2 ring-blue-500/20 ring-dashed' : 'bg-slate-100/30'}`}
                                                >
                                                    {filteredItems.map((item, index) => (
                                                        <Draggable
                                                            key={item._id}
                                                            draggableId={item._id}
                                                            index={index}
                                                            isDragDisabled={!!searchQuery}
                                                        >
                                                            {(provided, snapshot) => (
                                                                <div
                                                                    ref={provided.innerRef}
                                                                    {...provided.draggableProps}
                                                                    {...provided.dragHandleProps}
                                                                    onClick={() => handleLeadClick(item)}
                                                                    className={`group mb-3 bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1 transition-all duration-300 cursor-grab relative overflow-hidden ${searchQuery ? 'cursor-default hover:translate-y-0' : ''} ${snapshot.isDragging ? 'rotate-2 shadow-2xl scale-105 z-50 ring-2 ring-blue-500 ring-offset-2' : ''}`}
                                                                    style={{ ...provided.draggableProps.style }}
                                                                >
                                                                    {/* Accent Line */}
                                                                    <div className={`absolute top-0 left-0 w-1 h-full ${column.name === 'New' ? 'bg-blue-500' :
                                                                        column.name === 'Contacted' ? 'bg-yellow-500' :
                                                                            column.name === 'Won' ? 'bg-green-500' :
                                                                                column.name === 'Lost' ? 'bg-red-500' : 'bg-slate-300'
                                                                        }`}></div>

                                                                    <div className="pl-2">
                                                                        <div className="flex justify-between items-start mb-2">
                                                                            <h4 className="font-bold text-slate-800 text-base leading-tight group-hover:text-blue-600 transition-colors">
                                                                                {item.name}
                                                                            </h4>
                                                                            <button className="text-slate-300 hover:text-blue-500 transition-colors -mr-1">
                                                                                <i className="fa-solid fa-ellipsis-vertical px-2"></i>
                                                                            </button>
                                                                        </div>

                                                                        <div className="space-y-1.5 mb-4">
                                                                            <p className="text-sm text-slate-500 flex items-center gap-2.5">
                                                                                <span className="w-6 h-6 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center text-[10px]">
                                                                                    <i className="fa-solid fa-phone"></i>
                                                                                </span>
                                                                                <span className="font-medium">{item.phone || 'No phone'}</span>
                                                                            </p>
                                                                            {item.email && (
                                                                                <p className="text-sm text-slate-500 flex items-center gap-2.5 truncate">
                                                                                    <span className="w-6 h-6 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center text-[10px]">
                                                                                        <i className="fa-solid fa-envelope"></i>
                                                                                    </span>
                                                                                    <span className="truncate">{item.email}</span>
                                                                                </p>
                                                                            )}
                                                                        </div>

                                                                        <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                                                                            <span className={`text-[10px] uppercase font-bold px-2 py-1 rounded shadow-sm ${item.source === 'Facebook' ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-500'}`}>
                                                                                {item.source || 'Manual'}
                                                                            </span>
                                                                            <button className="text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transform translate-y-2 group-hover:translate-y-0 duration-200">
                                                                                View
                                                                                <i className="fa-solid fa-arrow-right text-[10px]"></i>
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </Draggable>
                                                    ))}
                                                    {provided.placeholder}
                                                </div>
                                            )}
                                        </Droppable>
                                    </div>
                                );
                            })}
                        </DragDropContext>
                    </div>
                </div>
            ) : (
                // Table View
                <div className="flex-1 overflow-auto p-6">
                    <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 overflow-hidden">
                        <LeadsTable
                            leads={filteredLeads}
                            stages={stages}
                            searchQuery={searchQuery}
                            onEdit={handleEditLead}
                            onDelete={handleDeleteLead}
                            onLeadClick={handleLeadClick}
                            onStatusChange={handleStatusChange}
                            onNoteClick={handleNoteClick}
                            onBulkDelete={handleBulkDelete}
                            onBulkStatusUpdate={handleBulkStatusUpdate}
                            onRefresh={fetchData}
                        />
                    </div>
                </div>
            )}

            {/* Modals */}
            <AddLeadModal
                isOpen={isAddLeadModalOpen}
                onClose={() => setIsAddLeadModalOpen(false)}
                onSuccess={fetchData}
            />

            <AddStageModal
                isOpen={isAddStageModalOpen}
                onClose={() => setIsAddStageModalOpen(false)}
                onSuccess={fetchData}
            />

            <EditLeadModal
                isOpen={isEditLeadModalOpen}
                onClose={() => setIsEditLeadModalOpen(false)}
                lead={selectedLead}
                onSuccess={fetchData}
            />

            <LeadDetailsModal
                isOpen={isLeadDetailsModalOpen}
                onClose={() => setIsLeadDetailsModalOpen(false)}
                lead={selectedLead}
                onSuccess={fetchData}
            />

            {selectedLead && (
                <NoteModal
                    isOpen={isNoteModalOpen}
                    onClose={() => setIsNoteModalOpen(false)}
                    lead={selectedLead}
                    onSuccess={fetchData}
                />
            )}
        </div>
    );
};

export default Leads;
