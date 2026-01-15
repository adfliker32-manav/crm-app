import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import AttachmentUploadModal from './AttachmentUploadModal';

const TemplateDetailsModal = ({ isOpen, onClose, template, onEdit, onDelete, onRefresh }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

    const formatFileSize = (bytes) => {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const getFileIcon = (mimetype) => {
        if (!mimetype) return 'fa-file';
        if (mimetype.startsWith('image/')) return 'fa-file-image';
        if (mimetype.includes('pdf')) return 'fa-file-pdf';
        if (mimetype.includes('word')) return 'fa-file-word';
        if (mimetype.includes('excel') || mimetype.includes('sheet')) return 'fa-file-excel';
        if (mimetype.includes('zip')) return 'fa-file-zipper';
        return 'fa-file';
    };

    const handleDeleteAttachment = async (attachmentId) => {
        const confirmed = await showDanger(
            'This will permanently delete the attachment. This action cannot be undone.',
            'Delete Attachment?'
        );

        if (!confirmed) return;

        try {
            await api.delete(`/email-templates/${template._id}/attachments`, {
                data: { attachmentId }
            });
            showSuccess('Attachment deleted successfully');
            if (onRefresh) onRefresh();
        } catch (error) {
            console.error('Error deleting attachment:', error);
            showError(error.response?.data?.message || 'Failed to delete attachment');
        }
    };

    if (!isOpen || !template) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b border-gray-200">
                        <div className="flex justify-between items-start">
                            <div>
                                <h3 className="text-xl font-bold text-gray-800">{template.name}</h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    Subject: <span className="text-gray-800 font-medium">{template.subject}</span>
                                </p>
                            </div>
                            <button onClick={onClose} className="text-gray-400 hover:text-red-500">
                                <i className="fa-solid fa-times text-xl"></i>
                            </button>
                        </div>
                    </div>

                    <div className="p-6 space-y-6">
                        {/* Email Body */}
                        <div>
                            <h4 className="font-bold text-gray-700 mb-2">Email Body</h4>
                            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 max-h-64 overflow-y-auto">
                                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-700">{template.body}</pre>
                            </div>
                        </div>

                        {/* Status & Automation */}
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <span className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Status</span>
                                <span className={`px-2 py-1 text-xs rounded-full font-medium ${template.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                                    {template.isActive ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                            <div>
                                <span className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Automation</span>
                                <span className={`px-2 py-1 text-xs rounded-full font-medium ${template.isAutomated ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                                    {template.isAutomated ? 'Enabled' : 'Disabled'}
                                </span>
                                {template.isAutomated && (
                                    <p className="text-xs text-gray-500 mt-1">
                                        Trigger: {template.triggerType === 'on_stage_change' ? `Stage Change -> ${template.stage}` : 'Lead Creation'}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Attachments Section */}
                        <div>
                            <div className="flex justify-between items-center mb-3">
                                <h4 className="font-bold text-gray-700">
                                    Attachments ({template.attachments?.length || 0})
                                </h4>
                                <button
                                    onClick={() => setIsUploadModalOpen(true)}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition shadow-md"
                                >
                                    <i className="fa-solid fa-plus mr-2"></i>
                                    Add Files
                                </button>
                            </div>

                            {template.attachments && template.attachments.length > 0 ? (
                                <div className="space-y-2">
                                    {template.attachments.map((attachment) => (
                                        <div
                                            key={attachment._id}
                                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
                                        >
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <i className={`fa-solid ${getFileIcon(attachment.mimetype)} text-2xl text-blue-600`}></i>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-gray-800 truncate">
                                                        {attachment.originalName || attachment.filename}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {formatFileSize(attachment.size)}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteAttachment(attachment._id)}
                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition ml-2"
                                                title="Delete attachment"
                                            >
                                                <i className="fa-solid fa-trash"></i>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                                    <i className="fa-regular fa-file text-4xl text-gray-300 mb-2"></i>
                                    <p className="text-sm text-gray-500">No attachments added yet</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
                        <button
                            onClick={() => onDelete(template._id)}
                            className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg font-medium transition"
                        >
                            <i className="fa-solid fa-trash mr-2"></i> Delete
                        </button>
                        <button
                            onClick={() => onEdit(template)}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md"
                        >
                            <i className="fa-solid fa-edit mr-2"></i> Edit Template
                        </button>
                    </div>
                </div>
            </div>

            {/* Attachment Upload Modal */}
            <AttachmentUploadModal
                isOpen={isUploadModalOpen}
                onClose={() => setIsUploadModalOpen(false)}
                templateId={template._id}
                onSuccess={() => {
                    if (onRefresh) onRefresh();
                }}
            />
        </>
    );
};

export default TemplateDetailsModal;
