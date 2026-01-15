import React, { useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const AttachmentUploadModal = ({ isOpen, onClose, templateId, onSuccess }) => {
    const { showSuccess, showError } = useNotification();
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const MAX_FILES = 5;
    const ALLOWED_TYPES = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'text/plain',
        'application/zip'
    ];

    const validateFile = (file) => {
        if (file.size > MAX_FILE_SIZE) {
            return `${file.name} exceeds 10MB limit`;
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
            return `${file.name} has unsupported file type`;
        }
        return null;
    };

    const handleFileSelect = (e) => {
        const files = Array.from(e.target.files);
        addFiles(files);
    };

    const addFiles = (files) => {
        const errors = [];
        const validFiles = [];

        if (selectedFiles.length + files.length > MAX_FILES) {
            showError(`Maximum ${MAX_FILES} files allowed`);
            return;
        }

        files.forEach(file => {
            const error = validateFile(file);
            if (error) {
                errors.push(error);
            } else {
                validFiles.push(file);
            }
        });

        if (errors.length > 0) {
            showError(errors.join(', '));
        }

        setSelectedFiles(prev => [...prev, ...validFiles]);
    };

    const removeFile = (index) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);

        const files = Array.from(e.dataTransfer.files);
        addFiles(files);
    };

    const handleUpload = async () => {
        if (selectedFiles.length === 0) {
            showError('Please select at least one file');
            return;
        }

        setUploading(true);

        try {
            const formData = new FormData();
            selectedFiles.forEach(file => {
                formData.append('attachments', file);
            });

            await api.post(`/email-templates/${templateId}/attachments`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });

            showSuccess(`${selectedFiles.length} file(s) uploaded successfully`);
            setSelectedFiles([]);
            if (onSuccess) onSuccess();
            onClose();
        } catch (error) {
            console.error('Error uploading files:', error);
            showError(error.response?.data?.message || 'Failed to upload files');
        } finally {
            setUploading(false);
        }
    };

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const getFileIcon = (type) => {
        if (type.startsWith('image/')) return 'fa-file-image';
        if (type.includes('pdf')) return 'fa-file-pdf';
        if (type.includes('word')) return 'fa-file-word';
        if (type.includes('excel') || type.includes('sheet')) return 'fa-file-excel';
        if (type.includes('zip')) return 'fa-file-zipper';
        return 'fa-file';
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-slate-200">
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Upload Attachments</h3>
                            <p className="text-sm text-slate-500 mt-1">
                                Max {MAX_FILES} files, 10MB each. Supported: PDF, DOC, XLS, Images
                            </p>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition">
                            <i className="fa-solid fa-times text-xl"></i>
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {/* Drag & Drop Zone */}
                    <div
                        className={`border-2 border-dashed rounded-lg p-8 text-center transition ${dragActive
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-slate-300 hover:border-blue-400'
                            }`}
                        onDragEnter={handleDrag}
                        onDragLeave={handleDrag}
                        onDragOver={handleDrag}
                        onDrop={handleDrop}
                    >
                        <i className="fa-solid fa-cloud-arrow-up text-5xl text-slate-400 mb-4"></i>
                        <p className="text-lg font-medium text-slate-700 mb-2">
                            Drag & drop files here
                        </p>
                        <p className="text-sm text-slate-500 mb-4">or</p>
                        <label className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium cursor-pointer transition shadow-md">
                            <i className="fa-solid fa-folder-open mr-2"></i>
                            Browse Files
                            <input
                                type="file"
                                multiple
                                onChange={handleFileSelect}
                                className="hidden"
                                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.txt,.zip"
                            />
                        </label>
                    </div>

                    {/* Selected Files List */}
                    {selectedFiles.length > 0 && (
                        <div className="space-y-2">
                            <h4 className="font-bold text-slate-700">
                                Selected Files ({selectedFiles.length}/{MAX_FILES})
                            </h4>
                            <div className="space-y-2 max-h-64 overflow-y-auto">
                                {selectedFiles.map((file, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition"
                                    >
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <i className={`fa-solid ${getFileIcon(file.type)} text-2xl text-blue-600`}></i>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-slate-800 truncate">{file.name}</p>
                                                <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeFile(index)}
                                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition ml-2"
                                            title="Remove file"
                                        >
                                            <i className="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={uploading}
                        className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleUpload}
                        disabled={uploading || selectedFiles.length === 0}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-50 flex items-center gap-2"
                    >
                        {uploading ? (
                            <>
                                <i className="fa-solid fa-spinner fa-spin"></i>
                                Uploading...
                            </>
                        ) : (
                            <>
                                <i className="fa-solid fa-upload"></i>
                                Upload {selectedFiles.length > 0 && `(${selectedFiles.length})`}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AttachmentUploadModal;
