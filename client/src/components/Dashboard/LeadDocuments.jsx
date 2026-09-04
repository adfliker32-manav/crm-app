/* eslint-disable react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// ============================================================
// LEAD DOCUMENTS
// ============================================================
// Attachments on a single lead. Files live in Cloudflare R2 and are private —
// there is no public URL to link to, so every download goes through the
// authenticated API as a blob (a plain <a href> would 401: the token travels in
// an Authorization header, not a cookie).
// ============================================================

const DOC_ICONS = {
    IMAGE:       { icon: 'fa-file-image',       color: 'text-purple-500', bg: 'bg-purple-50' },
    PDF:         { icon: 'fa-file-pdf',         color: 'text-red-500',    bg: 'bg-red-50' },
    SPREADSHEET: { icon: 'fa-file-excel',       color: 'text-green-600',  bg: 'bg-green-50' },
    DOCUMENT:    { icon: 'fa-file-word',        color: 'text-blue-500',   bg: 'bg-blue-50' },
    OTHER:       { icon: 'fa-file',             color: 'text-slate-400',  bg: 'bg-slate-50' }
};

const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const LeadDocuments = ({ leadId, canEdit = true }) => {
    const { showSuccess, showError } = useNotification();
    const fileInputRef = useRef(null);

    const [documents, setDocuments] = useState([]);
    const [limits, setLimits] = useState(null);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress] = useState(0);
    const [dragActive, setDragActive] = useState(false);
    const [busyId, setBusyId] = useState(null);

    const load = useCallback(async () => {
        if (!leadId) return;
        setLoading(true);
        try {
            const res = await api.get(`/leads/${leadId}/documents`);
            setDocuments(res.data.documents || []);
            setLimits(res.data.limits || null);
        } catch (error) {
            console.error('Failed to load lead documents:', error);
        } finally {
            setLoading(false);
        }
    }, [leadId]);

    useEffect(() => { load(); }, [load]);

    const uploadFile = async (file) => {
        if (!file || uploading) return;

        const maxMb = limits?.maxFileMb || 25;
        if (file.size > maxMb * 1024 * 1024) {
            showError(`"${file.name}" is larger than ${maxMb} MB.`);
            return;
        }

        setUploading(true);
        setProgress(0);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await api.post(`/leads/${leadId}/documents`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                // Uploads can outlast the client's default 30s timeout on a slow line.
                timeout: 120000,
                onUploadProgress: (e) => {
                    if (e.total) setProgress(Math.round((e.loaded * 100) / e.total));
                }
            });

            if (res.data.alreadyExists) {
                showSuccess('This file is already attached to the lead.');
            } else {
                showSuccess(`"${file.name}" uploaded`);
            }
            await load();
        } catch (error) {
            showError(error.response?.data?.message || 'Upload failed');
        } finally {
            setUploading(false);
            setProgress(0);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // Files come back as an authenticated blob, then get handed to the browser
    // through a temporary object URL.
    const openDocument = async (doc, { inline = false } = {}) => {
        setBusyId(doc.id);
        try {
            const res = await api.get(
                `/leads/${leadId}/documents/${doc.id}/download${inline ? '?inline=1' : ''}`,
                { responseType: 'blob', timeout: 120000 }
            );
            const url = URL.createObjectURL(res.data);

            if (inline) {
                window.open(url, '_blank', 'noopener');
                // Give the new tab time to claim the URL before revoking it.
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', doc.fileName);
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            showError(error.response?.data?.message || 'Could not open this file');
        } finally {
            setBusyId(null);
        }
    };

    const handleDelete = async (doc) => {
        if (!window.confirm(`Delete "${doc.fileName}"? This cannot be undone.`)) return;
        setBusyId(doc.id);
        try {
            await api.delete(`/leads/${leadId}/documents/${doc.id}`);
            showSuccess('Document deleted');
            await load();
        } catch (error) {
            showError(error.response?.data?.message || 'Delete failed');
        } finally {
            setBusyId(null);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setDragActive(false);
        if (!canEdit) return;
        const file = e.dataTransfer?.files?.[0];
        if (file) uploadFile(file);
    };

    const atFileLimit = limits && documents.length >= limits.maxFilesPerLead;

    return (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">

            {/* Upload zone */}
            {canEdit && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={handleDrop}
                    onClick={() => !uploading && !atFileLimit && fileInputRef.current?.click()}
                    className={`mb-5 rounded-xl border-2 border-dashed p-6 text-center transition cursor-pointer ${
                        dragActive
                            ? 'border-cyan-500 bg-cyan-50'
                            : atFileLimit
                                ? 'border-slate-200 bg-slate-50 cursor-not-allowed'
                                : 'border-slate-300 bg-slate-50 hover:border-cyan-400 hover:bg-cyan-50/40'
                    }`}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept={limits?.accept || undefined}
                        onChange={(e) => uploadFile(e.target.files?.[0])}
                        disabled={uploading || atFileLimit}
                    />

                    {uploading ? (
                        <div className="space-y-2">
                            <p className="text-sm font-bold text-slate-600">
                                <i className="fa-solid fa-spinner fa-spin mr-2 text-cyan-600"></i>
                                Uploading… {progress}%
                            </p>
                            <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                                <div className="h-full bg-cyan-500 transition-all duration-200" style={{ width: `${progress}%` }} />
                            </div>
                        </div>
                    ) : atFileLimit ? (
                        <p className="text-sm font-semibold text-slate-500">
                            Maximum of {limits.maxFilesPerLead} documents reached. Delete one to add another.
                        </p>
                    ) : (
                        <>
                            <i className="fa-solid fa-cloud-arrow-up text-2xl text-cyan-500 mb-2"></i>
                            <p className="text-sm font-bold text-slate-600">
                                Drop a file here, or <span className="text-cyan-600 underline">browse</span>
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                PDF, images, Excel, CSV, Word, PowerPoint, TXT — up to {limits?.maxFileMb || 25} MB
                            </p>
                        </>
                    )}
                </div>
            )}

            {/* Document list */}
            {loading ? (
                <p className="text-sm text-slate-400 text-center py-6">
                    <i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading documents…
                </p>
            ) : documents.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    No documents attached yet. Contracts, quotations, ID proofs and spreadsheets can all live here.
                </p>
            ) : (
                <ul className="space-y-2">
                    {documents.map(doc => {
                        const meta = DOC_ICONS[doc.docType] || DOC_ICONS.OTHER;
                        const previewable = ['IMAGE', 'PDF'].includes(doc.docType);
                        const busy = busyId === doc.id;

                        return (
                            <li
                                key={doc.id}
                                className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-white hover:border-cyan-300 hover:bg-cyan-50/30 transition"
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className={`w-10 h-10 rounded-lg ${meta.bg} flex items-center justify-center shrink-0`}>
                                        <i className={`fa-solid ${meta.icon} ${meta.color}`}></i>
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-bold text-slate-800 truncate" title={doc.fileName}>
                                            {doc.fileName}
                                        </p>
                                        <p className="text-xs text-slate-500">
                                            {formatBytes(doc.size)}
                                            {' · '}
                                            {new Date(doc.createdAt).toLocaleDateString()}
                                            {doc.uploadedByName ? ` · ${doc.uploadedByName}` : ''}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                    {previewable && (
                                        <button
                                            onClick={() => openDocument(doc, { inline: true })}
                                            disabled={busy}
                                            title="Preview"
                                            className="w-8 h-8 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 transition disabled:opacity-40"
                                        >
                                            <i className="fa-solid fa-eye"></i>
                                        </button>
                                    )}
                                    <button
                                        onClick={() => openDocument(doc)}
                                        disabled={busy}
                                        title="Download"
                                        className="w-8 h-8 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50 transition disabled:opacity-40"
                                    >
                                        <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-download'}`}></i>
                                    </button>
                                    {canEdit && (
                                        <button
                                            onClick={() => handleDelete(doc)}
                                            disabled={busy}
                                            title="Delete"
                                            className="w-8 h-8 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
                                        >
                                            <i className="fa-solid fa-trash"></i>
                                        </button>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            {documents.length > 0 && limits && (
                <p className="text-[11px] text-slate-400 mt-3 text-right">
                    {documents.length} of {limits.maxFilesPerLead} documents
                </p>
            )}
        </div>
    );
};

export default LeadDocuments;
