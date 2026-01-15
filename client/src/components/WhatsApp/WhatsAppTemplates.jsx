import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import WhatsAppTemplateModal from './WhatsAppTemplateModal';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const WhatsAppTemplates = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedTemplate, setSelectedTemplate] = useState(null);

    const fetchTemplates = async () => {
        try {
            const res = await api.get('/whatsapp/templates');
            setTemplates(res.data);
        } catch (error) {
            console.error("Error fetching templates", error);
            showError('Failed to load templates');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTemplates();
    }, []);

    const handleCreate = () => {
        setSelectedTemplate(null);
        setIsModalOpen(true);
    };

    const handleEdit = (template) => {
        setSelectedTemplate(template);
        setIsModalOpen(true);
    };

    const handleDelete = async (template) => {
        const confirmed = await showDanger(
            `Template "${template.name}" will be permanently deleted.`,
            "Delete Template?"
        );
        if (!confirmed) return;

        try {
            await api.delete(`/whatsapp/templates/${template._id}`);
            showSuccess('Template deleted successfully!');
            fetchTemplates();
        } catch (error) {
            console.error('Error deleting template:', error);
            showError(error.response?.data?.message || 'Failed to delete template');
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500">Loading templates...</div>;

    return (
        <div className="p-6">
            {/* Header with Create Button */}
            <div className="flex justify-end mb-6">
                <button
                    onClick={handleCreate}
                    className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2"
                >
                    <i className="fa-solid fa-plus"></i> New Template
                </button>
            </div>

            {templates.length === 0 ? (
                <div className="text-center py-16">
                    <i className="fa-brands fa-whatsapp text-7xl text-gray-300 mb-4"></i>
                    <p className="text-gray-400 text-lg mb-4">No WhatsApp templates yet</p>
                    <button
                        onClick={handleCreate}
                        className="text-green-600 hover:underline text-sm font-medium"
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
                                    <div className="flex flex-wrap gap-2">
                                        {template.isAutomated && (
                                            <span className="px-2 py-1 bg-purple-100 text-purple-700 text-xs rounded-full font-medium">
                                                <i className="fa-solid fa-robot mr-1"></i>Automated
                                            </span>
                                        )}
                                        <span className={`px-2 py-1 text-xs rounded-full font-medium ${template.isActive
                                            ? 'bg-green-100 text-green-700'
                                            : 'bg-gray-100 text-gray-700'
                                            }`}>
                                            {template.isActive ? 'Active' : 'Inactive'}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <p className="text-sm text-gray-600 mb-3 line-clamp-3 font-mono bg-gray-50 p-3 rounded border border-gray-200 whitespace-pre-wrap">
                                {template.message || template.body || template.components?.[0]?.text || 'No content'}
                            </p>

                            {/* Automation Info */}
                            {template.isAutomated && (
                                <div className="mb-3 text-xs text-gray-600 bg-blue-50 p-2 rounded border border-blue-100">
                                    <i className="fa-solid fa-bolt mr-1 text-blue-600"></i>
                                    Trigger: {template.triggerType === 'on_lead_create'
                                        ? 'On Lead Create'
                                        : template.triggerType === 'on_stage_change'
                                            ? `On Stage: ${template.stage}`
                                            : 'Manual'}
                                </div>
                            )}

                            <div className="flex gap-2 pt-4 border-t border-gray-200">
                                <button
                                    onClick={() => handleEdit(template)}
                                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                                >
                                    <i className="fa-solid fa-edit mr-1"></i>Edit
                                </button>
                                <button
                                    onClick={() => handleDelete(template)}
                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
                                >
                                    <i className="fa-solid fa-trash mr-1"></i>Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Template Modal */}
            <WhatsAppTemplateModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                template={selectedTemplate}
                onSuccess={fetchTemplates}
            />
        </div>
    );
};

export default WhatsAppTemplates;
