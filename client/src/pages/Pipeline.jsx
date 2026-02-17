import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import api from '../services/api';
import AddLeadModal from '../components/Dashboard/AddLeadModal';
import AddStageModal from '../components/Dashboard/AddStageModal';
import LeadDetailsModal from '../components/Dashboard/LeadDetailsModal';
import { useConfirm } from '../context/ConfirmContext';
import { useNotification } from '../context/NotificationContext';

// Stage color palette
const stageColors = [
    { gradient: 'from-violet-500 to-purple-600', shadow: 'shadow-violet-500/30', border: 'border-violet-400', bg: 'bg-violet-50' },
    { gradient: 'from-blue-500 to-cyan-500', shadow: 'shadow-blue-500/30', border: 'border-blue-400', bg: 'bg-blue-50' },
    { gradient: 'from-emerald-500 to-teal-500', shadow: 'shadow-emerald-500/30', border: 'border-emerald-400', bg: 'bg-emerald-50' },
    { gradient: 'from-amber-500 to-orange-500', shadow: 'shadow-amber-500/30', border: 'border-amber-400', bg: 'bg-amber-50' },
    { gradient: 'from-rose-500 to-pink-500', shadow: 'shadow-rose-500/30', border: 'border-rose-400', bg: 'bg-rose-50' },
    { gradient: 'from-slate-600 to-slate-700', shadow: 'shadow-slate-500/30', border: 'border-slate-400', bg: 'bg-slate-50' },
];

const getStageColor = (index) => stageColors[index % stageColors.length];

const Pipeline = () => {
    const { showDanger } = useConfirm();
    const { showError } = useNotification();
    const [columns, setColumns] = useState({});
    const [loading, setLoading] = useState(true);
    const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false);
    const [isAddStageModalOpen, setIsAddStageModalOpen] = useState(false);
    const [isLeadDetailsModalOpen, setIsLeadDetailsModalOpen] = useState(false);
    const [selectedLead, setSelectedLead] = useState(null);

    useEffect(() => {
        fetchKanbanData();
    }, []);

    const fetchKanbanData = async () => {
        try {
            const [leadsRes, stagesRes] = await Promise.all([
                api.get('/leads'),
                api.get('/stages')
            ]);

            const leads = leadsRes.data;
            let stages = stagesRes.data;

            if (stages.length === 0) {
                stages = [{ _id: 'new', name: 'New' }];
            }

            // Transform data for dnd
            const newColumns = {};
            stages.forEach(stage => {
                newColumns[stage.name] = {
                    id: stage._id,
                    name: stage.name,
                    items: leads.filter(lead => (lead.status || 'New') === stage.name)
                };
            });
            setColumns(newColumns);
        } catch (error) {
            console.error("Error loading kanban", error);
        } finally {
            setLoading(false);
        }
    };

    const deleteStage = async (stageId, stageName) => {
        if (stageName === 'New') return showError("Cannot delete the default 'New' stage");

        const confirmed = await showDanger(
            `Are you sure you want to delete stage "${stageName}"? Leads will be moved to "New".`,
            "Delete Stage"
        );
        if (!confirmed) return;

        try {
            await api.delete(`/stages/${stageId}`);
            fetchKanbanData(); // Refresh to move leads and remove column
        } catch (error) {
            console.error("Failed to delete stage", error);
            showError("Failed to delete stage");
        }
    };

    const onDragEnd = async (result) => {
        if (!result.destination) return;
        const { source, destination } = result;

        if (source.droppableId !== destination.droppableId) {
            const sourceColumn = columns[source.droppableId];
            const destColumn = columns[destination.droppableId];
            const sourceItems = [...sourceColumn.items];
            const destItems = [...destColumn.items];
            const [removed] = sourceItems.splice(source.index, 1);

            // Optimistic update
            const newStatus = destColumn.name;
            const updatedItem = { ...removed, status: newStatus };
            destItems.splice(destination.index, 0, updatedItem);

            setColumns({
                ...columns,
                [source.droppableId]: { ...sourceColumn, items: sourceItems },
                [destination.droppableId]: { ...destColumn, items: destItems }
            });

            // API Call
            try {
                await api.put(`/leads/${removed._id}`, { status: newStatus });
            } catch (error) {
                console.error("Failed to update status", error);
                // Revert or show error
                fetchKanbanData();
            }
        } else {
            // Reordering within same column (if supported)
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-violet-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="relative">
                        <div className="w-16 h-16 border-4 border-violet-200 rounded-full animate-spin mx-auto mb-6"></div>
                        <div className="w-16 h-16 border-4 border-transparent border-t-violet-600 rounded-full animate-spin mx-auto mb-6 absolute top-0 left-1/2 -translate-x-1/2"></div>
                    </div>
                    <p className="text-slate-500 text-sm font-medium">Loading pipeline...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 via-blue-50/50 to-violet-50/50">
            {/* Animated background */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-10 right-1/4 w-64 h-64 bg-violet-400/10 rounded-full blur-3xl animate-pulse"></div>
                <div className="absolute bottom-10 left-1/4 w-80 h-80 bg-blue-400/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
            </div>

            {/* Header */}
            <div className="relative z-10 flex justify-between items-center px-6 py-5 bg-white/70 backdrop-blur-xl border-b border-white/50 shadow-lg shadow-slate-200/50">
                <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 via-slate-700 to-slate-600 bg-clip-text text-transparent">
                        Pipeline
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">Manage your sales stages</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setIsAddLeadModalOpen(true)}
                        className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-400 hover:to-cyan-400 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5 flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i> New Lead
                    </button>
                    <button
                        onClick={() => setIsAddStageModalOpen(true)}
                        className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:-translate-y-0.5 flex items-center gap-2"
                    >
                        <i className="fa-solid fa-layer-group"></i> New Stage
                    </button>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="relative z-10 flex-1 overflow-x-auto pb-8">
                <div className="flex h-full gap-5 min-w-max p-6">
                    <DragDropContext onDragEnd={onDragEnd}>
                        {Object.entries(columns).map(([columnId, column], colIndex) => {
                            const colors = getStageColor(colIndex);
                            return (
                                <div key={columnId} className="flex flex-col w-80 max-h-full">
                                    {/* Column Header */}
                                    <div className={`flex items-center justify-between p-4 bg-gradient-to-r ${colors.gradient} text-white rounded-t-2xl shadow-lg ${colors.shadow}`}>
                                        <div className="flex items-center gap-3">
                                            <span className="font-bold uppercase text-sm tracking-wider">{column.name}</span>
                                            <span className="bg-white/20 backdrop-blur-sm text-xs px-2.5 py-1 rounded-full font-semibold">
                                                {column.items.length}
                                            </span>
                                        </div>
                                        {column.name !== 'New' && (
                                            <button
                                                onClick={() => deleteStage(column.id, column.name)}
                                                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/25 flex items-center justify-center transition-all duration-200"
                                                title="Delete Stage"
                                            >
                                                <i className="fa-solid fa-trash text-sm"></i>
                                            </button>
                                        )}
                                    </div>

                                    {/* Column Content */}
                                    <Droppable droppableId={columnId}>
                                        {(provided, snapshot) => (
                                            <div
                                                {...provided.droppableProps}
                                                ref={provided.innerRef}
                                                className={`flex-1 p-4 bg-white/50 backdrop-blur-sm rounded-b-2xl overflow-y-auto space-y-4 transition-all duration-300 border border-t-0 ${snapshot.isDraggingOver
                                                    ? `${colors.bg} border-2 ${colors.border}`
                                                    : 'border-slate-100/50'
                                                    }`}
                                            >
                                                {column.items.map((item, index) => (
                                                    <Draggable key={item._id} draggableId={item._id} index={index}>
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                onClick={() => {
                                                                    setSelectedLead(item);
                                                                    setIsLeadDetailsModalOpen(true);
                                                                }}
                                                                className={`group relative bg-white p-5 rounded-xl cursor-grab hover:shadow-xl transition-all duration-300 
                                                                    ${snapshot.isDragging
                                                                        ? 'rotate-2 shadow-2xl scale-105 ring-2 ring-blue-400 ring-offset-2'
                                                                        : 'shadow-lg shadow-slate-200/50 hover:-translate-y-1'
                                                                    }`}
                                                                style={{ ...provided.draggableProps.style }}
                                                            >
                                                                {/* Card accent */}
                                                                <div className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full bg-gradient-to-b ${colors.gradient}`}></div>

                                                                {/* Content */}
                                                                <div className="pl-3">
                                                                    <h4 className="font-bold text-slate-800 text-sm group-hover:text-slate-900 transition-colors">
                                                                        {item.name}
                                                                    </h4>
                                                                    <div className="mt-3 space-y-2">
                                                                        <p className="text-xs text-slate-500 flex items-center gap-2">
                                                                            <span className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                                                                                <i className="fa-solid fa-phone text-slate-400 text-[10px]"></i>
                                                                            </span>
                                                                            {item.phone || 'No phone'}
                                                                        </p>
                                                                        {item.email && (
                                                                            <p className="text-xs text-slate-500 flex items-center gap-2 truncate">
                                                                                <span className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
                                                                                    <i className="fa-solid fa-envelope text-slate-400 text-[10px]"></i>
                                                                                </span>
                                                                                <span className="truncate">{item.email}</span>
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                    <div className="mt-4 pt-3 border-t border-slate-100">
                                                                        <button className="text-xs font-medium text-blue-500 hover:text-blue-700 flex items-center gap-1.5 transition-colors">
                                                                            <i className="fa-solid fa-eye"></i> View Details
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

            {/* Modals */}
            <LeadDetailsModal
                isOpen={isLeadDetailsModalOpen}
                onClose={() => setIsLeadDetailsModalOpen(false)}
                lead={selectedLead}
                onSuccess={fetchKanbanData}
            />

            <AddLeadModal
                isOpen={isAddLeadModalOpen}
                onClose={() => setIsAddLeadModalOpen(false)}
                onSuccess={fetchKanbanData}
            />

            <AddStageModal
                isOpen={isAddStageModalOpen}
                onClose={() => setIsAddStageModalOpen(false)}
                onSuccess={fetchKanbanData}
            />
        </div>
    );
};

export default Pipeline;
