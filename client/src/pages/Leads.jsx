import React, { useState, useEffect, useCallback } from 'react';
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
    const [view, setView] = useState('pipeline');

    // Common state
    const [loading, setLoading] = useState(true);
    const [leads, setLeads] = useState([]);
    const [stages, setStages] = useState([]);
    const [searchQuery] = useState('');

    // Pipeline-specific state
    const [columns, setColumns] = useState({});

    // Modal states
    const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false);
    const [isAddStageModalOpen, setIsAddStageModalOpen] = useState(false);
    const [isEditLeadModalOpen, setIsEditLeadModalOpen] = useState(false);
    const [isLeadDetailsModalOpen, setIsLeadDetailsModalOpen] = useState(false);
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState(null);

    useEffect(() => {
        fetchData();
    }, []);

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

            // Transform data for pipeline view
            const newColumns = {};
            fetchedStages.forEach(stage => {
                newColumns[stage.name] = {
                    id: stage._id,
                    name: stage.name,
                    items: fetchedLeads.filter(lead => (lead.status || 'New') === stage.name)
                };
            });
            setColumns(newColumns);
        } catch (error) {
            console.error("Error loading data", error);
            showError("Failed to load leads data");
        } finally {
            setLoading(false);
        }
    }, [showError]);

    // Pipeline handlers
    const onDragEnd = async (result) => {
        if (!result.destination) return;
        const { source, destination } = result;

        if (source.droppableId !== destination.droppableId) {
            const sourceColumn = columns[source.droppableId];
            const destColumn = columns[destination.droppableId];
            const sourceItems = [...sourceColumn.items];
            const destItems = [...destColumn.items];
            const [removed] = sourceItems.splice(source.index, 1);

            const newStatus = destColumn.name;
            const updatedItem = { ...removed, status: newStatus };
            destItems.splice(destination.index, 0, updatedItem);

            setColumns({
                ...columns,
                [source.droppableId]: { ...sourceColumn, items: sourceItems },
                [destination.droppableId]: { ...destColumn, items: destItems }
            });

            // Optimistically update the leads state so Table view is in sync
            setLeads(prevLeads => prevLeads.map(lead =>
                lead._id === removed._id ? { ...lead, status: newStatus } : lead
            ));

            try {
                await api.put(`/leads/${removed._id}`, { status: newStatus });
            } catch (error) {
                console.error("Failed to update status", error);
                fetchData();
            }
        }
    };

    const deleteStage = async (stageId, stageName) => {
        if (stageName === 'New') {
            showError("Cannot delete the default 'New' stage");
            return;
        }

        const confirmed = await showDanger(
            `Leads will be moved to "New" stage.`,
            `Delete "${stageName}" stage?`
        );
        if (!confirmed) return;

        try {
            await api.delete(`/stages/${stageId}`);
            showSuccess('Stage deleted successfully');
            fetchData();
        } catch (error) {
            console.error("Failed to delete stage", error);
            showError("Failed to delete stage");
        }
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
        <div className="h-full flex flex-col">
            {/* Header with View Toggle */}
            <div className="flex justify-between items-center p-4 bg-white border-b border-slate-200">
                <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <i className="fa-solid fa-users text-blue-600"></i>
                    Leads
                </h1>

                <div className="flex items-center gap-3">
                    {/* View Toggle */}
                    <div className="flex bg-slate-100 rounded-lg p-1">
                        <button
                            onClick={() => setView('pipeline')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'pipeline'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-600 hover:text-slate-800'
                                }`}
                        >
                            <i className="fa-solid fa-grip-vertical mr-2"></i>
                            Pipeline
                        </button>
                        <button
                            onClick={() => setView('table')}
                            className={`px-4 py-2 rounded-md text-sm font-medium transition ${view === 'table'
                                ? 'bg-white text-blue-600 shadow-sm'
                                : 'text-slate-600 hover:text-slate-800'
                                }`}
                        >
                            <i className="fa-solid fa-table mr-2"></i>
                            Table
                        </button>
                    </div>

                    {/* Action Buttons */}
                    <button
                        onClick={() => setIsAddLeadModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-md flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i> New Lead
                    </button>
                    <button
                        onClick={() => setIsAddStageModalOpen(true)}
                        className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition shadow-md flex items-center gap-2"
                    >
                        <i className="fa-solid fa-layer-group"></i> New Stage
                    </button>
                </div>
            </div>

            {/* Content Area */}
            {view === 'pipeline' ? (
                // Pipeline View
                <div className="flex-1 overflow-x-auto pb-6">
                    <div className="flex h-full gap-6 min-w-max p-4">
                        <DragDropContext onDragEnd={onDragEnd}>
                            {Object.entries(columns).map(([columnId, column]) => (
                                <div key={columnId} className="flex flex-col w-80 max-h-full">
                                    <div className="flex items-center justify-between p-4 bg-slate-800 text-white rounded-t-xl font-bold shadow-md">
                                        <div className="flex items-center gap-3">
                                            <span className="truncate uppercase text-sm tracking-wide">{column.name}</span>
                                            <span className="bg-slate-600 text-xs px-2 py-1 rounded-full">{column.items.length}</span>
                                        </div>
                                        {column.name !== 'New' && (
                                            <button
                                                onClick={() => deleteStage(column.id, column.name)}
                                                className="text-slate-400 hover:text-red-400 transition"
                                                title="Delete Stage"
                                            >
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        )}
                                    </div>
                                    <Droppable droppableId={columnId}>
                                        {(provided, snapshot) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                                className={`flex-1 p-3 bg-slate-200 rounded-b-xl overflow-y-auto space-y-3 transition-colors ${snapshot.isDraggingOver ? 'bg-slate-300' : ''}`}
                                            >
                                                {column.items.map((item, index) => (
                                                    <Draggable key={item._id} draggableId={item._id} index={index}>
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                className={`bg-white p-4 rounded-lg shadow-sm border-l-4 border-blue-500 cursor-grab hover:shadow-md transition ${snapshot.isDragging ? 'rotate-2 shadow-xl scale-105' : ''}`}
                                                                style={{ ...provided.draggableProps.style }}
                                                            >
                                                                <h4 className="font-bold text-slate-800 text-sm">{item.name}</h4>
                                                                <p className="text-xs text-slate-500 mt-2 flex items-center gap-2">
                                                                    <i className="fa-solid fa-phone"></i> {item.phone || 'No phone'}
                                                                </p>
                                                                {item.email && (
                                                                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 truncate">
                                                                        <i className="fa-solid fa-envelope"></i> {item.email}
                                                                    </p>
                                                                )}
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </div>
                                        )}
                                    </Droppable>
                                </div>
                            ))}
                        </DragDropContext>
                    </div>
                </div>
            ) : (
                // Table View
                <div className="flex-1 overflow-auto">
                    <LeadsTable
                        leads={leads}
                        stages={stages}
                        searchQuery={searchQuery}
                        onEdit={handleEditLead}
                        onDelete={handleDeleteLead}
                        onLeadClick={handleLeadClick}
                        onStatusChange={handleStatusChange}
                        onNoteClick={handleNoteClick}
                        onBulkDelete={handleBulkDelete}
                        onBulkStatusUpdate={handleBulkStatusUpdate}
                    />
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
