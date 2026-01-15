import React, { useState, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import api from '../services/api';
import AddLeadModal from '../components/Dashboard/AddLeadModal';
import AddStageModal from '../components/Dashboard/AddStageModal';
import { useConfirm } from '../context/ConfirmContext';
import { useNotification } from '../context/NotificationContext';

const Pipeline = () => {
    const { showDanger } = useConfirm();
    const { showError } = useNotification();
    const [columns, setColumns] = useState({});
    const [loading, setLoading] = useState(true);
    const [isAddLeadModalOpen, setIsAddLeadModalOpen] = useState(false);
    const [isAddStageModalOpen, setIsAddStageModalOpen] = useState(false);

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

    if (loading) return <div className="p-8 text-center text-slate-500">Loading pipeline...</div>;

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex justify-between items-center p-4 bg-white border-b border-slate-200">
                <h1 className="text-xl font-bold text-slate-800">Pipeline</h1>
                <div className="flex gap-2">
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

            {/* Modals */}
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
