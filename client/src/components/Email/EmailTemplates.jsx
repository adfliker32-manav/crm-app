import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import TemplateModal from './TemplateModal';
import TemplateDetailsModal from './TemplateDetailsModal';
import { useConfirm } from '../../context/ConfirmContext';
import { useNotification } from '../../context/NotificationContext';

const EmailTemplates = () => {
    const { showDanger } = useConfirm();
    const { showError, showSuccess } = useNotification();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [isEditMode, setIsEditMode] = useState(false); // If true, opening create modal in edit mode

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/email-templates');
            setTemplates(res.data);
        } catch (error) {
            console.error("Error fetching templates", error);
        } finally {
            setLoading(false);
        }
    };

    // Handlers
    const handleCreateClick = () => {
        setSelectedTemplate(null);
        setIsEditMode(false);
        setIsCreateModalOpen(true);
    };

    const handleViewClick = (template) => {
        setSelectedTemplate(template);
        setIsDetailsModalOpen(true);
    };

    const handleEditClick = (template) => {
        setSelectedTemplate(template);
        setIsDetailsModalOpen(false); // Close details if open
        setIsEditMode(true);
        setIsCreateModalOpen(true);
    };

    const handleDeleteClick = async (id) => {
        const confirmed = await showDanger("Are you sure you want to delete this template?", "Delete Template");
        if (!confirmed) return;

        try {
            await api.delete(`/email-templates/${id}`);
            setIsDetailsModalOpen(false);
            showSuccess("Template deleted successfully");
            fetchTemplates();
        } catch (error) {
            console.error("Failed to delete template", error);
            showError("Failed to delete template");
        }
    };

    const handleModalSuccess = () => {
        fetchTemplates();
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    if (loading) return <div className="p-8 text-center text-slate-500">Loading templates...</div>;

    return (
        <div className="p-6">
            <div className="flex justify-end mb-6">
                <button
                    onClick={handleCreateClick}
                    className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i> New Template
                </button>
            </div>

            {templates.length === 0 ? (
                <div className="text-center py-12">
                    <i className="fa-solid fa-envelope text-6xl text-gray-300 mb-4"></i>
                    <p className="text-gray-400 text-lg mb-4">No email templates yet</p>
                    <button
                        onClick={handleCreateClick}
                        className="text-blue-600 hover:underline text-sm font-medium"
                    >
                        Create your first template
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {templates.map(template => (
                        <div key={template._id} className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition border border-gray-200">
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-gray-800 mb-2 truncate">{template.name}</h3>
                                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">{template.subject}</p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {template.isAutomated && (
                                    <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                                        <i className="fa-solid fa-robot mr-1"></i>Automated
                                    </span>
                                )}
                                <span className={`px-2 py-1 text-xs rounded-full font-medium ${template.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                    {template.isActive ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                            <div className="flex gap-2 pt-4 border-t border-gray-200">
                                <button
                                    onClick={() => handleViewClick(template)}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                                >
                                    <i className="fa-solid fa-eye mr-1"></i>View
                                </button>
                                <button
                                    onClick={() => handleEditClick(template)}
                                    className="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                                >
                                    <i className="fa-solid fa-edit mr-1"></i>Edit
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <TemplateModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSuccess={handleModalSuccess}
                template={isEditMode ? selectedTemplate : null}
            />

            <TemplateDetailsModal
                isOpen={isDetailsModalOpen}
                onClose={() => setIsDetailsModalOpen(false)}
                template={selectedTemplate}
                onEdit={handleEditClick}
                onDelete={handleDeleteClick}
                onRefresh={() => {
                    fetchTemplates();
                }}
            />
        </div>
    );
};

export default EmailTemplates;
