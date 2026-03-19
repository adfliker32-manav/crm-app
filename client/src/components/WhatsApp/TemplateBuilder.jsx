import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const TemplateBuilder = ({ templateId, onBack }) => {
    const { showSuccess, showError } = useNotification();
    const [template, setTemplate] = useState({
        name: '',
        language: 'en',
        category: 'UTILITY',
        components: [
            { type: 'BODY', format: 'TEXT', text: '', example: { body_text: [[]] } }
        ],
        isAutomated: false,
        triggerType: 'manual',
        stage: '',
        variableMapping: {}
    });
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [mediaPreview, setMediaPreview] = useState(null); // local preview URL
    const [stages, setStages] = useState([]);
    const bodyRef = useRef(null);
    const fileInputRef = useRef(null);

    useEffect(() => {
        if (templateId && templateId !== 'new') fetchTemplate();
        fetchStages();
    }, [templateId]);

    const fetchStages = async () => {
        try {
            const res = await api.get('/stages');
            setStages(res.data || []);
        } catch (err) { console.error('Failed to load stages:', err); }
    };

    const fetchTemplate = async () => {
        try {
            setLoading(true);
            const res = await api.get(`/whatsapp/templates/${templateId}`);
            setTemplate(res.data.template || res.data);
        } catch { showError('Failed to load template'); }
        finally { setLoading(false); }
    };

    const handleSave = async () => {
        try {
            setLoading(true);
            if (!/^[a-z0-9_]+$/.test(template.name)) { showError('Name must be lowercase with underscores only'); setLoading(false); return; }
            const bodyComp = template.components.find(c => c.type === 'BODY');
            if (!bodyComp?.text) { showError('Body text is required'); setLoading(false); return; }

            // Validate media header has been uploaded
            const headerComp = template.components.find(c => c.type === 'HEADER');
            if (headerComp && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerComp.format)) {
                if (!headerComp.example?.header_handle?.length) {
                    showError('Please upload a media file for the header');
                    setLoading(false);
                    return;
                }
            }

            if (templateId && templateId !== 'new') {
                await api.put(`/whatsapp/templates/${templateId}`, template);
                showSuccess('Template updated!');
            } else {
                await api.post('/whatsapp/templates', template);
                showSuccess('Template created!');
            }
            setTimeout(() => onBack(), 1200);
        } catch (err) { showError(err.response?.data?.message || 'Failed to save'); }
        finally { setLoading(false); }
    };

    const handleSubmitToMeta = async () => {
        try {
            setLoading(true);
            await api.post(`/whatsapp/templates/${templateId}/submit`);
            showSuccess('Submitted to Meta! Review takes up to 24 hours.');
            setTimeout(fetchTemplate, 1000);
        } catch (err) { showError(err.response?.data?.message || 'Failed to submit'); }
        finally { setLoading(false); }
    };

    const handleSyncStatus = async () => {
        try {
            setSyncing(true);
            const res = await api.post(`/whatsapp/templates/${templateId}/sync`);
            setTemplate(res.data.template || res.data);
            showSuccess('Status synced from Meta!');
        } catch (err) { showError(err.response?.data?.message || 'Failed to sync'); }
        finally { setSyncing(false); }
    };

    const updateComponent = (type, field, value) => {
        setTemplate(prev => {
            const components = [...prev.components];
            let comp = components.find(c => c.type === type);
            if (!comp) { comp = { type, format: 'TEXT' }; components.push(comp); }
            comp[field] = value;
            return { ...prev, components };
        });
    };

    const removeComponent = (type) => {
        if (type === 'BODY') return;
        if (type === 'HEADER') setMediaPreview(null);
        setTemplate(prev => ({ ...prev, components: prev.components.filter(c => c.type !== type) }));
    };

    const addButton = () => {
        setTemplate(prev => {
            const components = [...prev.components];
            let btnComp = components.find(c => c.type === 'BUTTONS');
            if (!btnComp) { btnComp = { type: 'BUTTONS', buttons: [] }; components.push(btnComp); }
            if (!btnComp.buttons) btnComp.buttons = [];
            if (btnComp.buttons.length >= 3) { showError('Max 3 buttons allowed'); return prev; }
            btnComp.buttons.push({ type: 'QUICK_REPLY', text: '' });
            return { ...prev, components };
        });
    };

    const updateButton = (idx, field, value) => {
        setTemplate(prev => {
            const components = [...prev.components];
            const btnComp = components.find(c => c.type === 'BUTTONS');
            if (btnComp?.buttons) btnComp.buttons[idx][field] = value;
            return { ...prev, components };
        });
    };

    const removeButton = (idx) => {
        setTemplate(prev => {
            const components = [...prev.components];
            const btnComp = components.find(c => c.type === 'BUTTONS');
            if (btnComp?.buttons) {
                btnComp.buttons.splice(idx, 1);
                if (btnComp.buttons.length === 0) return { ...prev, components: components.filter(c => c.type !== 'BUTTONS') };
            }
            return { ...prev, components };
        });
    };

    const insertVariable = (varNum) => {
        const textarea = bodyRef.current;
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = template.components.find(c => c.type === 'BODY')?.text || '';
        const newText = text.substring(0, start) + `{{${varNum}}}` + text.substring(end);
        updateComponent('BODY', 'text', newText);
        setTimeout(() => { textarea.focus(); textarea.setSelectionRange(start + varNum.toString().length + 4, start + varNum.toString().length + 4); }, 50);
    };

    // ────────── Header Format Handling ──────────
    const setHeaderFormat = (format) => {
        setMediaPreview(null);
        setTemplate(prev => {
            const components = prev.components.filter(c => c.type !== 'HEADER');
            if (format === 'NONE') return { ...prev, components };
            const newHeader = { type: 'HEADER', format };
            if (format === 'TEXT') {
                newHeader.text = '';
            } else {
                newHeader.example = { header_handle: [] };
            }
            components.unshift(newHeader);
            return { ...prev, components };
        });
    };

    const handleMediaUpload = async (file) => {
        if (!file) return;

        const MB = 1024 * 1024;
        const headerComp = template.components.find(c => c.type === 'HEADER');
        if (!headerComp) return;

        // Client-side validation
        if (headerComp.format === 'IMAGE') {
            if (file.size > 5 * MB) { showError('Image must be under 5 MB'); return; }
            if (!['image/jpeg', 'image/png'].includes(file.type)) { showError('Only JPG and PNG allowed'); return; }
        } else if (headerComp.format === 'VIDEO') {
            if (file.size > 16 * MB) { showError('Video must be under 16 MB'); return; }
            if (!['video/mp4', 'video/3gpp'].includes(file.type)) { showError('Only MP4 and 3GPP allowed'); return; }
        } else if (headerComp.format === 'DOCUMENT') {
            if (file.size > 10 * MB) { showError('Document must be under 10 MB'); return; }
        }

        // Show local preview
        if (headerComp.format === 'IMAGE') {
            setMediaPreview(URL.createObjectURL(file));
        } else if (headerComp.format === 'VIDEO') {
            setMediaPreview(URL.createObjectURL(file));
        } else {
            setMediaPreview(file.name);
        }

        // Upload to Meta via backend
        setUploading(true);
        setUploadProgress(0);
        try {
            const formData = new FormData();
            formData.append('file', file);

            const res = await api.post('/whatsapp/upload-media', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (e) => {
                    setUploadProgress(Math.round((e.loaded / e.total) * 100));
                }
            });

            if (res.data.success && res.data.handle) {
                // Store the handle in the header component
                setTemplate(prev => {
                    const components = [...prev.components];
                    const hdr = components.find(c => c.type === 'HEADER');
                    if (hdr) {
                        if (!hdr.example) hdr.example = {};
                        hdr.example.header_handle = [res.data.handle];
                        hdr._uploadedFileName = res.data.fileName;
                        hdr._uploadedFileSize = res.data.fileSize;
                    }
                    return { ...prev, components };
                });
                showSuccess('Media uploaded to Meta successfully!');
            } else {
                showError(res.data.message || 'Upload failed');
                setMediaPreview(null);
            }
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to upload media');
            setMediaPreview(null);
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer?.files?.[0];
        if (file) handleMediaUpload(file);
    };

    const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    // ────────── Derived State ──────────
    const getComponent = (type) => template.components?.find(c => c.type === type);
    const headerComp = getComponent('HEADER');
    const bodyComp = getComponent('BODY');
    const footerComp = getComponent('FOOTER');
    const btnComp = getComponent('BUTTONS');
    const isDraft = !template.status || template.status === 'DRAFT' || template.status === 'REJECTED';
    const bodyCharCount = bodyComp?.text?.length || 0;
    const currentHeaderFormat = headerComp?.format || 'NONE';

    const statusConfig = {
        DRAFT: { bg: 'bg-slate-100', text: 'text-slate-700', icon: 'fa-file', dot: 'bg-slate-400' },
        PENDING: { bg: 'bg-amber-50', text: 'text-amber-700', icon: 'fa-clock', dot: 'bg-amber-400' },
        APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: 'fa-check-circle', dot: 'bg-emerald-400' },
        REJECTED: { bg: 'bg-red-50', text: 'text-red-700', icon: 'fa-times-circle', dot: 'bg-red-400' },
        PAUSED: { bg: 'bg-orange-50', text: 'text-orange-700', icon: 'fa-pause-circle', dot: 'bg-orange-400' },
        DISABLED: { bg: 'bg-slate-50', text: 'text-slate-500', icon: 'fa-ban', dot: 'bg-slate-300' }
    };
    const currentStatus = statusConfig[template.status] || statusConfig.DRAFT;

    // Preview: replace {{1}}, {{2}} etc with highlighted spans
    const renderPreviewText = (text) => {
        if (!text) return <span className="text-slate-400 italic">Your message here...</span>;
        const parts = text.split(/(\{\{\d+\}\})/g);
        return parts.map((part, i) => {
            if (/^\{\{\d+\}\}$/.test(part)) {
                return <span key={i} className="bg-blue-100 text-blue-700 px-1 rounded text-xs font-mono">{part}</span>;
            }
            return <span key={i}>{part}</span>;
        });
    };

    // Format options for header
    const headerFormats = [
        { value: 'NONE', label: 'None', icon: 'fa-ban', color: 'text-slate-400' },
        { value: 'TEXT', label: 'Text', icon: 'fa-font', color: 'text-blue-500' },
        { value: 'IMAGE', label: 'Image', icon: 'fa-image', color: 'text-purple-500', limit: '5 MB · JPG, PNG' },
        { value: 'VIDEO', label: 'Video', icon: 'fa-video', color: 'text-pink-500', limit: '16 MB · MP4' },
        { value: 'DOCUMENT', label: 'Document', icon: 'fa-file-pdf', color: 'text-orange-500', limit: '10 MB · PDF' }
    ];

    // ────────── Render ──────────
    if (loading && templateId && templateId !== 'new') {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="w-12 h-12 border-4 border-[#00a884] border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-[#f0f2f5]">
            {/* ═══ Top Bar ═══ */}
            <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between shadow-sm flex-shrink-0">
                <div className="flex items-center gap-3">
                    <button onClick={onBack} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-600 transition">
                        <i className="fa-solid fa-arrow-left"></i>
                    </button>
                    <div>
                        <h2 className="text-lg font-bold text-[#111b21]">
                            {templateId !== 'new' ? 'Edit Template' : 'Create Template'}
                        </h2>
                        <div className="flex items-center gap-2 mt-0.5">
                            {template.status && (
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${currentStatus.bg} ${currentStatus.text}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${currentStatus.dot}`}></span>
                                    {template.status}
                                </span>
                            )}
                            {template.quality && template.quality !== 'UNKNOWN' && (
                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${template.quality === 'HIGH' ? 'bg-emerald-50 text-emerald-700' : template.quality === 'MEDIUM' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
                                    <i className="fa-solid fa-star mr-1"></i>{template.quality}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    {template.status === 'PENDING' && templateId !== 'new' && (
                        <button onClick={handleSyncStatus} disabled={syncing} className="px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-sm font-medium transition disabled:opacity-50">
                            <i className={`fa-solid ${syncing ? 'fa-spinner fa-spin' : 'fa-sync'} mr-2`}></i>
                            {syncing ? 'Syncing...' : 'Sync Status'}
                        </button>
                    )}
                    {isDraft && templateId !== 'new' && (
                        <button onClick={handleSubmitToMeta} disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50 shadow-sm">
                            <i className="fa-solid fa-paper-plane mr-2"></i>Submit to Meta
                        </button>
                    )}
                    <button onClick={handleSave} disabled={loading} className="px-4 py-2 bg-[#00a884] hover:bg-[#008f6f] text-white rounded-lg text-sm font-medium transition disabled:opacity-50 shadow-sm">
                        <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`}></i>
                        {loading ? 'Saving...' : 'Save Template'}
                    </button>
                </div>
            </div>

            {/* Rejection Reason Alert */}
            {template.status === 'REJECTED' && template.rejectionReason && (
                <div className="mx-5 mt-3 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
                    <i className="fa-solid fa-exclamation-triangle text-red-500 mt-0.5"></i>
                    <div>
                        <p className="text-sm font-semibold text-red-800">Template Rejected by Meta</p>
                        <p className="text-sm text-red-700 mt-1">{template.rejectionReason}</p>
                    </div>
                </div>
            )}

            {/* ═══ Main Content ═══ */}
            <div className="flex-1 overflow-hidden flex">
                {/* ──── Form Panel ──── */}
                <div className="w-[55%] overflow-y-auto p-5 space-y-4">
                    {/* Basic Info Card */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-[#111b21] uppercase tracking-wider mb-4 flex items-center gap-2">
                            <i className="fa-solid fa-info-circle text-[#00a884]"></i> Basic Information
                        </h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">Template Name <span className="text-red-500">*</span></label>
                                <input type="text" value={template.name} onChange={(e) => setTemplate({ ...template, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                                    placeholder="e.g. welcome_message" disabled={!isDraft && templateId !== 'new'}
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] outline-none text-sm font-mono bg-slate-50 disabled:opacity-60 transition" />
                                <p className="text-[11px] text-slate-400 mt-1">Lowercase, numbers, underscores only</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Category</label>
                                    <select value={template.category} onChange={(e) => setTemplate({ ...template, category: e.target.value })} disabled={!isDraft}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] outline-none text-sm bg-slate-50 disabled:opacity-60 transition">
                                        <option value="UTILITY">🔧 Utility</option>
                                        <option value="MARKETING">📣 Marketing</option>
                                        <option value="AUTHENTICATION">🔐 Authentication</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">Language</label>
                                    <select value={template.language} onChange={(e) => setTemplate({ ...template, language: e.target.value })} disabled={!isDraft}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] outline-none text-sm bg-slate-50 disabled:opacity-60 transition">
                                        <option value="en">🇺🇸 English</option>
                                        <option value="en_US">🇺🇸 English (US)</option>
                                        <option value="hi">🇮🇳 Hindi</option>
                                        <option value="es">🇪🇸 Spanish</option>
                                        <option value="fr">🇫🇷 French</option>
                                        <option value="de">🇩🇪 German</option>
                                        <option value="pt_BR">🇧🇷 Portuguese</option>
                                        <option value="ar">🇸🇦 Arabic</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ════════ HEADER CARD (Fully Enhanced) ════════ */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-bold text-[#111b21] uppercase tracking-wider flex items-center gap-2">
                                <i className="fa-solid fa-heading text-[#00a884]"></i> Header <span className="text-slate-400 font-normal normal-case">(Optional)</span>
                            </h3>
                            {headerComp && (
                                <button onClick={() => { removeComponent('HEADER'); setHeaderFormat('NONE'); }} disabled={!isDraft} className="text-xs text-red-500 hover:text-red-700 transition">
                                    <i className="fa-solid fa-trash mr-1"></i>Remove
                                </button>
                            )}
                        </div>

                        {/* Format Picker Buttons */}
                        <div className="grid grid-cols-5 gap-2 mb-4">
                            {headerFormats.map(fmt => (
                                <button
                                    key={fmt.value}
                                    onClick={() => setHeaderFormat(fmt.value)}
                                    disabled={!isDraft}
                                    className={`flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border-2 transition text-center disabled:opacity-50 ${
                                        currentHeaderFormat === fmt.value
                                            ? 'border-[#00a884] bg-[#00a884]/5'
                                            : 'border-slate-200 hover:border-slate-300 bg-slate-50'
                                    }`}
                                >
                                    <i className={`fa-solid ${fmt.icon} text-lg ${currentHeaderFormat === fmt.value ? 'text-[#00a884]' : fmt.color}`}></i>
                                    <span className={`text-xs font-semibold ${currentHeaderFormat === fmt.value ? 'text-[#00a884]' : 'text-slate-600'}`}>{fmt.label}</span>
                                    {fmt.limit && <span className="text-[9px] text-slate-400 leading-tight">{fmt.limit}</span>}
                                </button>
                            ))}
                        </div>

                        {/* TEXT Header Input */}
                        {currentHeaderFormat === 'TEXT' && (
                            <div>
                                <input type="text" value={headerComp?.text || ''} onChange={(e) => updateComponent('HEADER', 'text', e.target.value)}
                                    placeholder="e.g. 🎉 Special Offer!" disabled={!isDraft} maxLength={60}
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] outline-none text-sm disabled:opacity-60 transition" />
                                <p className="text-[11px] text-slate-400 mt-1 text-right">{(headerComp?.text || '').length}/60</p>
                            </div>
                        )}

                        {/* MEDIA Header Upload Area */}
                        {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(currentHeaderFormat) && (
                            <div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    className="hidden"
                                    accept={
                                        currentHeaderFormat === 'IMAGE' ? 'image/jpeg,image/png' :
                                        currentHeaderFormat === 'VIDEO' ? 'video/mp4,video/3gpp' :
                                        '.pdf,application/pdf'
                                    }
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleMediaUpload(file);
                                        e.target.value = '';
                                    }}
                                />

                                {/* Upload State: No file yet */}
                                {!mediaPreview && !headerComp?.example?.header_handle?.length && !uploading && (
                                    <div
                                        onDrop={handleDrop}
                                        onDragOver={handleDragOver}
                                        onClick={() => isDraft && fileInputRef.current?.click()}
                                        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
                                            isDraft ? 'border-slate-300 hover:border-[#00a884] hover:bg-[#00a884]/5' : 'border-slate-200 opacity-60 cursor-not-allowed'
                                        }`}
                                    >
                                        <div className="w-14 h-14 mx-auto mb-3 bg-gradient-to-br from-slate-100 to-slate-200 rounded-2xl flex items-center justify-center">
                                            <i className={`fa-solid ${
                                                currentHeaderFormat === 'IMAGE' ? 'fa-cloud-arrow-up' :
                                                currentHeaderFormat === 'VIDEO' ? 'fa-film' : 'fa-file-arrow-up'
                                            } text-2xl text-slate-400`}></i>
                                        </div>
                                        <p className="text-sm font-medium text-slate-600 mb-1">
                                            {currentHeaderFormat === 'IMAGE' && 'Upload Image'}
                                            {currentHeaderFormat === 'VIDEO' && 'Upload Video'}
                                            {currentHeaderFormat === 'DOCUMENT' && 'Upload Document'}
                                        </p>
                                        <p className="text-xs text-slate-400 mb-3">
                                            Drag & drop or <span className="text-[#00a884] font-semibold">browse</span>
                                        </p>
                                        <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg">
                                            <i className="fa-solid fa-circle-info text-slate-400 text-xs"></i>
                                            <span className="text-[11px] text-slate-500">
                                                {currentHeaderFormat === 'IMAGE' && 'JPG, PNG · Max 5 MB'}
                                                {currentHeaderFormat === 'VIDEO' && 'MP4, 3GPP · Max 16 MB'}
                                                {currentHeaderFormat === 'DOCUMENT' && 'PDF · Max 10 MB'}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Upload State: Uploading */}
                                {uploading && (
                                    <div className="border-2 border-[#00a884] border-dashed rounded-xl p-8 text-center bg-[#00a884]/5">
                                        <div className="w-14 h-14 mx-auto mb-3 relative">
                                            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                                                <circle cx="28" cy="28" r="24" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                                                <circle cx="28" cy="28" r="24" fill="none" stroke="#00a884" strokeWidth="4"
                                                    strokeDasharray={`${2 * Math.PI * 24}`}
                                                    strokeDashoffset={`${2 * Math.PI * 24 * (1 - uploadProgress / 100)}`}
                                                    strokeLinecap="round" className="transition-all duration-300" />
                                            </svg>
                                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-[#00a884]">{uploadProgress}%</span>
                                        </div>
                                        <p className="text-sm font-medium text-[#00a884]">Uploading to Meta...</p>
                                        <p className="text-xs text-slate-400 mt-1">Please wait while the file is processed</p>
                                    </div>
                                )}

                                {/* Upload State: Uploaded / Preview */}
                                {!uploading && (mediaPreview || headerComp?.example?.header_handle?.length > 0) && (
                                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
                                        {/* Preview area */}
                                        {currentHeaderFormat === 'IMAGE' && mediaPreview && (
                                            <div className="relative group">
                                                <img src={mediaPreview} alt="Header preview" className="w-full h-48 object-cover" />
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                                    {isDraft && (
                                                        <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-white rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition shadow-lg">
                                                            <i className="fa-solid fa-arrow-up-from-bracket mr-2"></i>Replace
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {currentHeaderFormat === 'VIDEO' && mediaPreview && (
                                            <div className="relative group">
                                                <video src={mediaPreview} className="w-full h-48 object-cover bg-black" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="w-14 h-14 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                                                        <i className="fa-solid fa-play text-xl text-slate-700 ml-1"></i>
                                                    </div>
                                                </div>
                                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                                                    {isDraft && (
                                                        <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-white rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 transition shadow-lg">
                                                            <i className="fa-solid fa-arrow-up-from-bracket mr-2"></i>Replace
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {currentHeaderFormat === 'DOCUMENT' && (
                                            <div className="p-4 flex items-center gap-4">
                                                <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm">
                                                    <i className="fa-solid fa-file-pdf text-white text-xl"></i>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium text-slate-700 truncate">{headerComp?._uploadedFileName || mediaPreview || 'Document'}</p>
                                                    <p className="text-xs text-slate-400">{headerComp?._uploadedFileSize ? formatFileSize(headerComp._uploadedFileSize) : 'PDF Document'}</p>
                                                </div>
                                                {isDraft && (
                                                    <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition">
                                                        <i className="fa-solid fa-arrow-up-from-bracket mr-1"></i>Replace
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        {/* Success badge */}
                                        <div className="px-4 py-2.5 border-t border-slate-200 flex items-center justify-between bg-emerald-50/50">
                                            <div className="flex items-center gap-2">
                                                <i className="fa-solid fa-check-circle text-emerald-500"></i>
                                                <span className="text-xs font-medium text-emerald-700">Uploaded to Meta</span>
                                            </div>
                                            {isDraft && (
                                                <button onClick={() => { setMediaPreview(null); updateComponent('HEADER', 'example', { header_handle: [] }); }}
                                                    className="text-xs text-red-500 hover:text-red-700 transition">
                                                    <i className="fa-solid fa-trash mr-1"></i>Remove
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Body Card */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-[#111b21] uppercase tracking-wider mb-3 flex items-center gap-2">
                            <i className="fa-solid fa-align-left text-[#00a884]"></i> Body <span className="text-red-500">*</span>
                        </h3>
                        <textarea ref={bodyRef} value={bodyComp?.text || ''} onChange={(e) => updateComponent('BODY', 'text', e.target.value)}
                            placeholder="Hi {{1}}! Thank you for your interest in {{2}}. We'll get back to you shortly." rows={5} disabled={!isDraft} maxLength={1024}
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] outline-none text-sm resize-none disabled:opacity-60 transition leading-relaxed" />
                        <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-slate-400 mr-1">Insert variable:</span>
                                {[1, 2, 3, 4, 5].map(n => (
                                    <button key={n} onClick={() => insertVariable(n)} disabled={!isDraft}
                                        className="px-2 py-1 bg-blue-50 text-blue-600 rounded text-[11px] font-mono font-bold hover:bg-blue-100 transition disabled:opacity-50">{`{{${n}}}`}</button>
                                ))}
                            </div>
                            <span className={`text-[11px] font-medium ${bodyCharCount > 900 ? 'text-red-500' : 'text-slate-400'}`}>{bodyCharCount}/1024</span>
                        </div>
                        {(() => {
                            const textValues = [
                                template.components.find(c => c.type === 'BODY')?.text || '',
                                template.components.find(c => c.type === 'HEADER' && c.format === 'TEXT')?.text || ''
                            ].join(' ');
                            
                            const matches = textValues.match(/\{\{(\d+)\}\}/g);
                            if (!matches || matches.length === 0) return null;
                            
                            const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a,b)=>a-b);
                            
                            return (
                                <div className="mt-4 pt-4 border-t border-slate-100">
                                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-3">Variable Mapping</h4>
                                    <div className="space-y-3">
                                        {nums.map(num => (
                                            <div key={num} className="flex items-center gap-3">
                                                <div className="w-12 text-center py-1.5 bg-blue-50 text-blue-700 font-mono text-xs font-bold rounded-lg border border-blue-100">
                                                    {`{{${num}}}`}
                                                </div>
                                                <i className="fa-solid fa-arrow-right text-slate-300 text-xs"></i>
                                                <select 
                                                    value={template.variableMapping?.[num] || ''}
                                                    onChange={(e) => setTemplate(prev => ({ 
                                                        ...prev, 
                                                        variableMapping: { ...(prev.variableMapping || {}), [num]: e.target.value } 
                                                    }))}
                                                    disabled={!isDraft}
                                                    className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none bg-slate-50 disabled:opacity-60"
                                                >
                                                    <option value="" disabled>Select mapping mapping...</option>
                                                    <option value="lead.name">Lead Name</option>
                                                    <option value="lead.phone">Lead Phone</option>
                                                    <option value="lead.email">Lead Email</option>
                                                    <option value="lead.status">Lead Stage / Status</option>
                                                    <option value="company.name">Company Name</option>
                                                    <option value="user.name">Representative Name</option>
                                                    <option value="custom">Static / Custom Text</option>
                                                </select>
                                                {template.variableMapping?.[num] === 'custom' && (
                                                    <input 
                                                        type="text" 
                                                        placeholder="Enter static fallback text..."
                                                        value={template.variableMapping?.[`${num}_custom`] || ''}
                                                        onChange={(e) => setTemplate(prev => ({ 
                                                            ...prev, 
                                                            variableMapping: { ...(prev.variableMapping || {}), [`${num}_custom`]: e.target.value } 
                                                        }))}
                                                        disabled={!isDraft}
                                                        className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none bg-white disabled:opacity-60"
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-slate-400 mt-2 italic">Select what CRM data fields these variables will be replaced with during Automations and Broadcasts.</p>
                                </div>
                            );
                        })()}
                    </div>

                    {/* Footer Card */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-[#111b21] uppercase tracking-wider flex items-center gap-2">
                                <i className="fa-solid fa-shoe-prints text-[#00a884]"></i> Footer <span className="text-slate-400 font-normal normal-case">(Optional)</span>
                            </h3>
                            {footerComp && <button onClick={() => removeComponent('FOOTER')} disabled={!isDraft} className="text-xs text-red-500 hover:text-red-700 transition"><i className="fa-solid fa-trash mr-1"></i>Remove</button>}
                        </div>
                        {!footerComp ? (
                            <button onClick={() => updateComponent('FOOTER', 'text', '')} disabled={!isDraft}
                                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-[#00a884] hover:text-[#00a884] transition text-sm font-medium disabled:opacity-50">
                                <i className="fa-solid fa-plus mr-2"></i>Add Footer
                            </button>
                        ) : (
                            <div>
                                <input type="text" value={footerComp.text || ''} onChange={(e) => updateComponent('FOOTER', 'text', e.target.value)}
                                    placeholder="e.g. Powered by ADFLIKER CRM" disabled={!isDraft} maxLength={60}
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#00a884]/30 focus:border-[#00a884] outline-none text-sm disabled:opacity-60 transition" />
                                <p className="text-[11px] text-slate-400 mt-1 text-right">{(footerComp.text || '').length}/60</p>
                            </div>
                        )}
                    </div>

                    {/* Buttons Card */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-sm font-bold text-[#111b21] uppercase tracking-wider flex items-center gap-2">
                                <i className="fa-solid fa-hand-pointer text-[#00a884]"></i> Interactive Buttons <span className="text-slate-400 font-normal normal-case">(Optional, max 3)</span>
                            </h3>
                            {btnComp?.buttons?.length > 0 && btnComp.buttons.length < 3 && (
                                <button onClick={addButton} disabled={!isDraft} className="text-xs text-[#00a884] hover:text-[#008f6f] transition font-medium"><i className="fa-solid fa-plus mr-1"></i>Add</button>
                            )}
                        </div>
                        {!btnComp?.buttons?.length ? (
                            <button onClick={addButton} disabled={!isDraft}
                                className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-500 hover:border-[#00a884] hover:text-[#00a884] transition text-sm font-medium disabled:opacity-50">
                                <i className="fa-solid fa-plus mr-2"></i>Add Quick Reply / CTA Button
                            </button>
                        ) : (
                            <div className="space-y-3">
                                {btnComp.buttons.map((btn, idx) => (
                                    <div key={idx} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                                        <div className="flex items-center justify-between mb-3">
                                            <span className="text-xs font-bold text-slate-600 uppercase">Button {idx + 1}</span>
                                            <button onClick={() => removeButton(idx)} disabled={!isDraft} className="text-red-400 hover:text-red-600 transition"><i className="fa-solid fa-trash text-xs"></i></button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-[11px] font-medium text-slate-500 mb-1">Type</label>
                                                <select value={btn.type} onChange={(e) => updateButton(idx, 'type', e.target.value)} disabled={!isDraft}
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none bg-white disabled:opacity-60">
                                                    <option value="QUICK_REPLY">💬 Quick Reply</option>
                                                    <option value="URL">🔗 URL Button</option>
                                                    <option value="PHONE_NUMBER">📞 Call Button</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-medium text-slate-500 mb-1">Label (max 20 chars)</label>
                                                <input type="text" value={btn.text} onChange={(e) => updateButton(idx, 'text', e.target.value)}
                                                    placeholder="e.g. Yes, I'm interested" disabled={!isDraft} maxLength={20}
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none disabled:opacity-60" />
                                            </div>
                                        </div>
                                        {btn.type === 'URL' && (
                                            <div className="mt-3">
                                                <label className="block text-[11px] font-medium text-slate-500 mb-1">URL</label>
                                                <input type="url" value={btn.url || ''} onChange={(e) => updateButton(idx, 'url', e.target.value)}
                                                    placeholder="https://yoursite.com" disabled={!isDraft}
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none disabled:opacity-60" />
                                            </div>
                                        )}
                                        {btn.type === 'PHONE_NUMBER' && (
                                            <div className="mt-3">
                                                <label className="block text-[11px] font-medium text-slate-500 mb-1">Phone Number</label>
                                                <input type="tel" value={btn.phone_number || ''} onChange={(e) => updateButton(idx, 'phone_number', e.target.value)}
                                                    placeholder="+919876543210" disabled={!isDraft}
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none disabled:opacity-60" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Automation Card */}
                    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                        <h3 className="text-sm font-bold text-[#111b21] uppercase tracking-wider mb-4 flex items-center gap-2">
                            <i className="fa-solid fa-robot text-[#00a884]"></i> Automation Settings
                        </h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-medium text-slate-700">Auto-send this template</p>
                                    <p className="text-[11px] text-slate-400">Trigger this template automatically based on CRM events</p>
                                </div>
                                <button onClick={() => setTemplate(prev => ({ ...prev, isAutomated: !prev.isAutomated }))}
                                    className={`w-12 h-6 rounded-full transition-colors ${template.isAutomated ? 'bg-[#00a884]' : 'bg-slate-300'} relative`}>
                                    <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${template.isAutomated ? 'translate-x-6' : 'translate-x-0.5'}`}></div>
                                </button>
                            </div>
                            {template.isAutomated && (
                                <div className="bg-slate-50 rounded-xl p-4 space-y-3 border border-slate-100">
                                    <div>
                                        <label className="block text-[11px] font-medium text-slate-500 mb-1">Trigger Event</label>
                                        <select value={template.triggerType || 'manual'} onChange={(e) => setTemplate({ ...template, triggerType: e.target.value })}
                                            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none bg-white">
                                            <option value="on_lead_create">🆕 When new lead is created</option>
                                            <option value="on_stage_change">🔄 When lead stage changes</option>
                                        </select>
                                    </div>
                                    {template.triggerType === 'on_stage_change' && (
                                        <div>
                                            <label className="block text-[11px] font-medium text-slate-500 mb-1">Target Stage</label>
                                            <select value={template.stage || ''} onChange={(e) => setTemplate({ ...template, stage: e.target.value })}
                                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-[#00a884]/30 outline-none bg-white">
                                                <option value="">Select a stage...</option>
                                                {stages.map(s => (
                                                    <option key={s._id} value={s.name}>{s.name}</option>
                                                ))}
                                            </select>
                                            {stages.length === 0 && <p className="text-xs text-amber-500 mt-1">No stages found. Create stages in your Lead Pipeline first.</p>}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* ──── Preview Panel ──── */}
                <div className="w-[45%] border-l border-slate-200 bg-gradient-to-br from-slate-100 to-slate-200 flex items-start justify-center p-8 overflow-y-auto">
                    <div className="w-full max-w-[320px] sticky top-0">
                        <div className="text-center mb-4">
                            <h3 className="text-sm font-bold text-slate-700">Live Preview</h3>
                            <p className="text-[11px] text-slate-500">How your template appears on WhatsApp</p>
                        </div>

                        {/* Phone Frame */}
                        <div className="bg-black rounded-[2.5rem] p-2.5 shadow-2xl">
                            <div className="bg-white rounded-[2rem] overflow-hidden">
                                {/* Notch */}
                                <div className="bg-slate-900 h-7 flex items-center justify-center">
                                    <div className="bg-black w-28 h-5 rounded-full flex items-center justify-center">
                                        <div className="w-2 h-2 bg-slate-700 rounded-full"></div>
                                    </div>
                                </div>
                                {/* WA Header */}
                                <div className="bg-[#008069] text-white px-3 py-2.5 flex items-center gap-2.5">
                                    <i className="fa-solid fa-arrow-left text-xs"></i>
                                    <div className="w-8 h-8 bg-slate-300 rounded-full flex items-center justify-center"><i className="fa-solid fa-user text-slate-500 text-xs"></i></div>
                                    <div className="flex-1"><div className="font-semibold text-sm">Lead Name</div><div className="text-[10px] text-white/80">online</div></div>
                                </div>
                                {/* Chat */}
                                <div className="bg-[#efeae2] p-3 min-h-[380px] flex flex-col justify-end"
                                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='200' height='200' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M40 20 q10 15 0 30' fill='none' stroke='%23d4cfc4' stroke-width='.5' opacity='.4'/%3E%3Ccircle cx='120' cy='80' r='2' fill='%23d4cfc4' opacity='.2'/%3E%3C/svg%3E")` }}>
                                    {/* Message Bubble */}
                                    <div className="flex justify-end">
                                        <div className="bg-[#d9fdd3] rounded-xl shadow-sm max-w-[90%] overflow-hidden">
                                            {/* ─── Media Header Preview ─── */}
                                            {headerComp && currentHeaderFormat === 'IMAGE' && (
                                                <div className="bg-gradient-to-br from-slate-200 to-slate-300 h-36 flex items-center justify-center relative">
                                                    {mediaPreview ? (
                                                        <img src={mediaPreview} alt="Header" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="text-center">
                                                            <i className="fa-solid fa-image text-3xl text-slate-400"></i>
                                                            <p className="text-[10px] text-slate-400 mt-1">Image Header</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {headerComp && currentHeaderFormat === 'VIDEO' && (
                                                <div className="bg-gradient-to-br from-slate-800 to-slate-900 h-36 flex items-center justify-center relative">
                                                    {mediaPreview ? (
                                                        <>
                                                            <video src={mediaPreview} className="w-full h-full object-cover opacity-60" />
                                                            <div className="absolute inset-0 flex items-center justify-center">
                                                                <div className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center">
                                                                    <i className="fa-solid fa-play text-slate-700 ml-0.5"></i>
                                                                </div>
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <div className="text-center">
                                                            <i className="fa-solid fa-video text-3xl text-slate-400"></i>
                                                            <p className="text-[10px] text-slate-400 mt-1">Video Header</p>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            {headerComp && currentHeaderFormat === 'DOCUMENT' && (
                                                <div className="bg-gradient-to-br from-red-50 to-orange-50 p-3 flex items-center gap-3 border-b border-[#c6e8c3]">
                                                    <div className="w-10 h-10 bg-red-500 rounded-lg flex items-center justify-center flex-shrink-0">
                                                        <i className="fa-solid fa-file-pdf text-white"></i>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-[12px] font-medium text-slate-700 truncate">{headerComp._uploadedFileName || 'document.pdf'}</p>
                                                        <p className="text-[10px] text-slate-400">PDF • {headerComp._uploadedFileSize ? formatFileSize(headerComp._uploadedFileSize) : 'Document'}</p>
                                                    </div>
                                                    <i className="fa-solid fa-download text-slate-400 text-xs"></i>
                                                </div>
                                            )}

                                            {/* Text Content */}
                                            <div className="p-2.5">
                                                {headerComp?.format === 'TEXT' && headerComp?.text && (
                                                    <div className="font-bold text-[13px] text-[#111b21] mb-1.5 pb-1.5 border-b border-[#c6e8c3]">
                                                        {headerComp.text}
                                                    </div>
                                                )}
                                                <div className="text-[13px] text-[#111b21] whitespace-pre-wrap leading-[18px]">
                                                    {renderPreviewText(bodyComp?.text)}
                                                </div>
                                                {footerComp?.text && (
                                                    <div className="text-[11px] text-[#8696a0] mt-1.5 pt-1.5 border-t border-[#c6e8c3]">
                                                        {footerComp.text}
                                                    </div>
                                                )}
                                                <div className="text-[10px] text-[#8696a0] mt-1 text-right flex items-center justify-end gap-1">
                                                    12:00 PM <i className="fa-solid fa-check-double text-[#53bdeb]"></i>
                                                </div>
                                            </div>
                                            {/* Buttons Preview */}
                                            {btnComp?.buttons?.length > 0 && (
                                                <div className="border-t border-[#c6e8c3]">
                                                    {btnComp.buttons.map((btn, idx) => (
                                                        <div key={idx} className={`text-center py-2 ${idx < btnComp.buttons.length - 1 ? 'border-b border-[#c6e8c3]' : ''}`}>
                                                            <span className="text-[#00a5f4] text-[13px] font-medium flex items-center justify-center gap-1.5">
                                                                {btn.type === 'URL' && <i className="fa-solid fa-external-link text-[10px]"></i>}
                                                                {btn.type === 'PHONE_NUMBER' && <i className="fa-solid fa-phone text-[10px]"></i>}
                                                                {btn.type === 'QUICK_REPLY' && <i className="fa-solid fa-reply text-[10px]"></i>}
                                                                {btn.text || `Button ${idx + 1}`}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                {/* Bottom bar */}
                                <div className="bg-[#f0f2f5] px-3 py-2 flex items-center gap-2">
                                    <div className="flex-1 bg-white rounded-full px-3 py-1.5"><span className="text-[11px] text-slate-400">Type a message</span></div>
                                    <div className="w-7 h-7 bg-[#00a884] rounded-full flex items-center justify-center"><i className="fa-solid fa-microphone text-white text-[10px]"></i></div>
                                </div>
                            </div>
                        </div>

                        {/* Analytics (if editing existing template) */}
                        {template.analytics && template.analytics.sent > 0 && (
                            <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                <h4 className="text-xs font-bold text-slate-600 uppercase mb-3">Template Analytics</h4>
                                <div className="grid grid-cols-4 gap-2 text-center">
                                    {[
                                        { label: 'Sent', value: template.analytics.sent, color: 'text-slate-700' },
                                        { label: 'Delivered', value: template.analytics.delivered, color: 'text-emerald-600' },
                                        { label: 'Read', value: template.analytics.read, color: 'text-blue-600' },
                                        { label: 'Failed', value: template.analytics.failed, color: 'text-red-600' },
                                    ].map(metric => (
                                        <div key={metric.label}>
                                            <div className={`text-lg font-bold ${metric.color}`}>{metric.value || 0}</div>
                                            <div className="text-[10px] text-slate-500">{metric.label}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TemplateBuilder;
