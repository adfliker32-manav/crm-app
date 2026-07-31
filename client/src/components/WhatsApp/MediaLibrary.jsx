import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';

const TYPE_FILTERS = [
    { id: '',         label: 'All',       icon: 'fa-layer-group' },
    { id: 'IMAGE',    label: 'Images',    icon: 'fa-image' },
    { id: 'VIDEO',    label: 'Videos',    icon: 'fa-video' },
    { id: 'DOCUMENT', label: 'Documents', icon: 'fa-file-pdf' },
];

const ACCEPT = 'image/jpeg,image/png,video/mp4,video/3gpp,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,audio/mpeg';

export const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

export const iconForType = (t) =>
    t === 'IMAGE' ? 'fa-image' : t === 'VIDEO' ? 'fa-film' : t === 'AUDIO' ? 'fa-music' : 'fa-file-lines';

/**
 * Media Library — one upload, reusable across templates, broadcasts, chatbot
 * flows and manual sends. Files live in object storage (R2), never on the app server.
 *
 * Doubles as a picker: pass `pickerMode` + `onSelect` to embed it in a modal.
 */
export default function MediaLibrary({ pickerMode = false, allowedType = null, onSelect = null }) {
    const [assets, setAssets]       = useState([]);
    const [storage, setStorage]     = useState(null);
    const [loading, setLoading]     = useState(true);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress]   = useState(0);
    const [typeFilter, setTypeFilter] = useState(allowedType || '');
    const [search, setSearch]       = useState('');
    const [error, setError]         = useState('');
    const [dragging, setDragging]   = useState(false);
    const fileInputRef = useRef(null);
    const { showDanger } = useConfirm();

    // <img> cannot send an Authorization header — the preview route accepts the
    // JWT as a query param instead (same pattern as the WhatsApp media proxy).
    const rawUrl = (id) => `${api.defaults.baseURL}/media-library/${id}/raw?token=${encodeURIComponent(localStorage.getItem('token') || '')}`;

    const load = useCallback(async () => {
        try {
            setLoading(true);
            const params = {};
            if (typeFilter) params.type = typeFilter;
            if (search.trim()) params.search = search.trim();
            const res = await api.get('/media-library', { params });
            setAssets(res.data.assets || []);
            setStorage(res.data.storage || null);
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to load media library');
        } finally {
            setLoading(false);
        }
    }, [typeFilter, search]);

    useEffect(() => {
        const t = setTimeout(load, search ? 350 : 0); // debounce typing only
        return () => clearTimeout(t);
    }, [load, search]);

    const handleUpload = async (file) => {
        if (!file) return;
        setError('');
        setUploading(true);
        setProgress(0);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await api.post('/media-library/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (e) => {
                    if (e.total) setProgress(Math.round((e.loaded * 100) / e.total));
                }
            });
            if (res.data.success) {
                if (res.data.deduped) setError('This file is already in your library — reusing the existing copy.');
                await load();
            }
        } catch (err) {
            setError(err.response?.data?.message || 'Upload failed');
        } finally {
            setUploading(false);
            setProgress(0);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleDelete = async (asset) => {
        const ok = await showDanger(
            `"${asset.label}" will be permanently removed from storage.`,
            'Delete media?'
        );
        if (!ok) return;
        try {
            await api.delete(`/media-library/${asset.id}`);
            await load();
        } catch (err) {
            setError(err.response?.data?.message || 'Delete failed');
        }
    };

    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleUpload(file);
    };

    const usedPct = storage && !storage.unlimited && storage.limitMb > 0
        ? Math.min(100, Math.round((storage.usedBytes / (storage.limitMb * 1024 * 1024)) * 100))
        : 0;

    const visible = allowedType ? assets.filter(a => a.mediaType === allowedType) : assets;

    return (
        <div className={pickerMode ? '' : 'p-6'}>
            {/* ── Header ─────────────────────────────────────────────────── */}
            {!pickerMode && (
                <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                    <div>
                        <h2 className="text-xl font-black text-slate-800 flex items-center gap-3">
                            <span className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                                <i className="fa-solid fa-photo-film text-sm"></i>
                            </span>
                            Media Library
                        </h2>
                        <p className="text-xs text-slate-500 mt-1 ml-12">
                            Upload once — reuse in templates, broadcasts, chatbot flows and automations.
                        </p>
                    </div>
                    {storage && (
                        <div className="min-w-[190px]">
                            <div className="flex justify-between text-[11px] font-bold text-slate-500 mb-1">
                                <span>{formatBytes(storage.usedBytes)} used</span>
                                <span>{storage.unlimited ? 'Unlimited' : `${storage.limitMb} MB`}</span>
                            </div>
                            {!storage.unlimited && (
                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all ${usedPct > 90 ? 'bg-rose-500' : usedPct > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                        style={{ width: `${usedPct}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Upload zone ────────────────────────────────────────────── */}
            <div
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={() => !uploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all mb-5 ${
                    dragging ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-emerald-300 hover:bg-slate-50'
                } ${uploading ? 'pointer-events-none opacity-70' : ''}`}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={ACCEPT}
                    onChange={(e) => handleUpload(e.target.files?.[0])}
                />
                {uploading ? (
                    <div className="space-y-2">
                        <i className="fa-solid fa-cloud-arrow-up text-2xl text-emerald-500 animate-bounce"></i>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-xs mx-auto">
                            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-xs font-bold text-slate-500">Uploading… {progress}%</p>
                    </div>
                ) : (
                    <>
                        <i className="fa-solid fa-cloud-arrow-up text-2xl text-slate-300"></i>
                        <p className="text-sm font-bold text-slate-600 mt-2">Drop a file here or click to upload</p>
                        <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">
                            JPG/PNG 5 MB · MP4 16 MB · PDF &amp; Docs 100 MB
                        </p>
                    </>
                )}
            </div>

            {error && (
                <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-bold flex items-center justify-between gap-3">
                    <span><i className="fa-solid fa-circle-info mr-2"></i>{error}</span>
                    <button onClick={() => setError('')} className="text-amber-500 hover:text-amber-700"><i className="fa-solid fa-xmark"></i></button>
                </div>
            )}

            {/* ── Filters ────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2 mb-5 flex-wrap">
                {!allowedType && TYPE_FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setTypeFilter(f.id)}
                        className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
                            typeFilter === f.id ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                    >
                        <i className={`fa-solid ${f.icon}`}></i>{f.label}
                    </button>
                ))}
                <div className="relative ml-auto">
                    <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 text-xs"></i>
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search files…"
                        className="pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-emerald-400 w-48"
                    />
                </div>
            </div>

            {/* ── Grid ───────────────────────────────────────────────────── */}
            {loading ? (
                <div className="text-center py-12 text-slate-400"><i className="fa-solid fa-spinner fa-spin text-xl"></i></div>
            ) : visible.length === 0 ? (
                <div className="text-center py-12">
                    <i className="fa-solid fa-folder-open text-3xl text-slate-200"></i>
                    <p className="text-sm font-bold text-slate-400 mt-3">No media yet</p>
                    <p className="text-xs text-slate-400 mt-1">Upload a brochure, image or video to get started.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {visible.map(asset => (
                        <div
                            key={asset.id}
                            onClick={() => pickerMode && onSelect?.(asset)}
                            className={`group border border-slate-200 rounded-2xl overflow-hidden bg-white hover:shadow-md transition-all ${pickerMode ? 'cursor-pointer hover:border-emerald-400' : ''}`}
                        >
                            <div className="h-28 bg-slate-50 flex items-center justify-center relative overflow-hidden">
                                {asset.mediaType === 'IMAGE' ? (
                                    <img
                                        src={rawUrl(asset.id)}
                                        alt={asset.label}
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                    />
                                ) : (
                                    <i className={`fa-solid ${iconForType(asset.mediaType)} text-3xl text-slate-300`}></i>
                                )}
                                {!pickerMode && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDelete(asset); }}
                                        className="absolute top-2 right-2 w-7 h-7 bg-black/50 backdrop-blur rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-500 flex items-center justify-center"
                                        title="Delete"
                                    >
                                        <i className="fa-solid fa-trash-can text-[10px]"></i>
                                    </button>
                                )}
                            </div>
                            <div className="p-3">
                                <p className="text-xs font-bold text-slate-700 truncate" title={asset.label}>{asset.label}</p>
                                <div className="flex items-center justify-between mt-1">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{asset.mediaType}</span>
                                    <span className="text-[10px] font-medium text-slate-400">{formatBytes(asset.size)}</span>
                                </div>
                                {asset.usageCount > 0 && (
                                    <p className="text-[10px] text-emerald-600 font-bold mt-1">
                                        <i className="fa-solid fa-link mr-1"></i>Used in {asset.usageCount}
                                    </p>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
