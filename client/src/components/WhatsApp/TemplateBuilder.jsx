/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import TemplatePhonePreview from './TemplatePhonePreview';
import TemplateAutomationCard from './TemplateAutomationCard';

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
            const exists = prev.components.some(c => c.type === type);
            let components;
            if (exists) {
                components = prev.components.map(c =>
                    c.type === type ? { ...c, [field]: value } : c
                );
            } else {
                components = [...prev.components, { type, format: 'TEXT', [field]: value }];
            }
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
            const existing = prev.components.find(c => c.type === 'BUTTONS');
            const currentButtons = existing?.buttons || [];
            if (currentButtons.length >= 3) { showError('Max 3 buttons allowed'); return prev; }
            const newButtons = [...currentButtons, { type: 'QUICK_REPLY', text: '' }];
            const components = existing
                ? prev.components.map(c => c.type === 'BUTTONS' ? { ...c, buttons: newButtons } : c)
                : [...prev.components, { type: 'BUTTONS', buttons: newButtons }];
            return { ...prev, components };
        });
    };

    const updateButton = (idx, field, value) => {
        setTemplate(prev => {
            const components = prev.components.map(c => {
                if (c.type !== 'BUTTONS' || !c.buttons) return c;
                const newButtons = c.buttons.map((btn, i) =>
                    i === idx ? { ...btn, [field]: value } : btn
                );
                return { ...c, buttons: newButtons };
            });
            return { ...prev, components };
        });
    };

    const removeButton = (idx) => {
        setTemplate(prev => {
            const btnComp = prev.components.find(c => c.type === 'BUTTONS');
            if (!btnComp?.buttons) return prev;
            const newButtons = btnComp.buttons.filter((_, i) => i !== idx);
            if (newButtons.length === 0) {
                return { ...prev, components: prev.components.filter(c => c.type !== 'BUTTONS') };
            }
            const components = prev.components.map(c =>
                c.type === 'BUTTONS' ? { ...c, buttons: newButtons } : c
            );
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
    const handleHeaderFormatChange = (format) => {
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
                    const components = prev.components.map(c => {
                        if (c.type !== 'HEADER') return c;
                        return {
                            ...c,
                            example: { ...(c.example || {}), header_handle: [res.data.handle] },
                            _uploadedFileName: res.data.fileName,
                            _uploadedFileSize: res.data.fileSize
                        };
                    });
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

    const extractVariables = (text) => {
        if (!text) return [];
        const matches = text.match(/\{\{(\d+)\}\}/g);
        if (!matches) return [];
        return [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
    };

    const updateVariableExample = (type, num, value) => {
        setTemplate(prev => {
            const components = prev.components.map(c => {
                if (c.type !== type) return c;
                const example = { ...(c.example || {}) };
                if (type === 'BODY') {
                    const bodyText = example.body_text ? example.body_text.map(arr => [...arr]) : [[]];
                    if (!bodyText[0]) bodyText[0] = [];
                    bodyText[0][num - 1] = value;
                    example.body_text = bodyText;
                } else if (type === 'HEADER' && c.format === 'TEXT') {
                    const headerText = example.header_text ? [...example.header_text] : [];
                    headerText[num - 1] = value;
                    example.header_text = headerText;
                }
                return { ...c, example };
            });
            return { ...prev, components };
        });
    };

    const addVariable = (type) => {
        setTemplate(prev => {
            const components = prev.components.map(c => {
                if (c.type !== type) return c;
                const vars = extractVariables(c.text);
                const nextNum = vars.length > 0 ? Math.max(...vars) + 1 : 1;
                return { ...c, text: (c.text || '') + `{{${nextNum}}}` };
            });
            return { ...prev, components };
        });
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
                    {/* Basic Info Card - REDESIGNED */}
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-[#00a884]/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-[#00a884]/10 transition-colors"></div>

                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                            Basic Information
                        </h3>

                        <div className="space-y-8 relative z-10">
                            {/* Template Name */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2 px-1">Template Name <span className="text-rose-500">*</span></label>
                                <div className="relative group/input">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400 group-focus-within/input:text-[#00a884] transition-colors">
                                        <i className="fa-solid fa-tag text-xs"></i>
                                    </div>
                                    <input
                                        type="text"
                                        value={template.name}
                                        onChange={(e) => setTemplate(prev => ({ ...prev, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                                        placeholder="e.g. order_confirmation"
                                        disabled={!isDraft && templateId !== 'new'}
                                        className="w-full pl-11 pr-4 py-3.5 bg-slate-50 border-2 border-transparent focus:border-[#00a884]/20 focus:bg-white rounded-2xl focus:ring-4 focus:ring-[#00a884]/5 outline-none text-sm font-mono transition-all disabled:opacity-60 shadow-inner"
                                    />
                                </div>
                                <div className="flex justify-between mt-2 px-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">a-z, 0-9, and underscores only</p>
                                    <p className="text-[10px] font-bold text-slate-300">{(template.name || '').length}/512</p>
                                </div>
                            </div>

                            {/* Category Selection - Visual Cards */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-3 px-1">Category <span className="text-slate-400 font-medium">(Select one)</span></label>
                                <div className="grid grid-cols-3 gap-3">
                                    {[
                                        { id: 'UTILITY', label: 'Utility', desc: 'Confirmations, status updates', icon: 'fa-wrench',
                                          activeBorder: 'border-blue-500', activeBg: 'bg-blue-50', checkBg: 'bg-blue-500', iconColor: 'text-blue-600', labelColor: 'text-blue-900' },
                                        { id: 'MARKETING', label: 'Marketing', desc: 'Promos, news, re-engagement', icon: 'fa-bullhorn',
                                          activeBorder: 'border-purple-500', activeBg: 'bg-purple-50', checkBg: 'bg-purple-500', iconColor: 'text-purple-600', labelColor: 'text-purple-900' },
                                        { id: 'AUTHENTICATION', label: 'Auth', desc: 'OTP, security codes', icon: 'fa-shield-halved',
                                          activeBorder: 'border-amber-500', activeBg: 'bg-amber-50', checkBg: 'bg-amber-500', iconColor: 'text-amber-600', labelColor: 'text-amber-900' }
                                    ].map(cat => (
                                        <button
                                            key={cat.id}
                                            onClick={() => isDraft && setTemplate(prev => ({ ...prev, category: cat.id }))}
                                            disabled={!isDraft}
                                            className={`p-4 rounded-2xl border-2 text-left transition-all duration-300 relative overflow-hidden group/cat ${template.category === cat.id
                                                    ? `${cat.activeBorder} ${cat.activeBg} shadow-md`
                                                    : 'border-slate-100 bg-slate-50 hover:bg-white hover:border-slate-200'
                                                } ${!isDraft ? 'opacity-60 cursor-not-allowed' : ''}`}
                                        >
                                            {template.category === cat.id && (
                                                <div className={`absolute top-2 right-2 w-5 h-5 ${cat.checkBg} rounded-full flex items-center justify-center text-white text-[10px]`}>
                                                    <i className="fa-solid fa-check"></i>
                                                </div>
                                            )}
                                            <div className={`w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center mb-3 group-hover/cat:scale-110 transition-transform ${template.category === cat.id ? cat.iconColor : 'text-slate-400'
                                                }`}>
                                                <i className={`fa-solid ${cat.icon} text-lg`}></i>
                                            </div>
                                            <div className={`text-xs font-black ${template.category === cat.id ? cat.labelColor : 'text-slate-700'}`}>{cat.label}</div>
                                            <div className="text-[9px] text-slate-400 leading-tight mt-1 font-medium">{cat.desc}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Language Selection */}
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-2 px-1">Language</label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-slate-400">
                                        <i className="fa-solid fa-globe text-xs"></i>
                                    </div>
                                    <select
                                        value={template.language}
                                        onChange={(e) => setTemplate(prev => ({ ...prev, language: e.target.value }))}
                                        disabled={!isDraft}
                                        className="w-full pl-11 pr-10 py-3.5 bg-slate-50 border-2 border-transparent focus:border-[#00a884]/20 focus:bg-white rounded-2xl focus:ring-4 focus:ring-[#00a884]/5 outline-none text-sm font-bold text-slate-700 transition-all appearance-none cursor-pointer"
                                        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%23a1a1aa\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 1rem center', backgroundSize: '1.25rem' }}
                                    >
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

                    {/* ════════ HEADER CARD ════════ */}
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-blue-500/10 transition-colors"></div>

                        <div className="flex items-center justify-between mb-6 relative z-10">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                    <i className="fa-solid fa-heading text-xs"></i>
                                </span>
                                Header <span className="text-[10px] lowercase font-bold text-slate-300 ml-1">(Optional)</span>
                            </h3>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Format:</span>
                                <select
                                    value={currentHeaderFormat}
                                    onChange={(e) => handleHeaderFormatChange(e.target.value)}
                                    className="bg-slate-50 border-none text-[11px] font-black text-blue-600 uppercase tracking-wider px-3 py-1.5 rounded-lg outline-none cursor-pointer hover:bg-blue-50 transition-colors"
                                >
                                    <option value="NONE">None</option>
                                    <option value="TEXT">Text</option>
                                    <option value="IMAGE">Image</option>
                                    <option value="VIDEO">Video</option>
                                    <option value="DOCUMENT">Document</option>
                                </select>
                            </div>
                        </div>

                        {currentHeaderFormat !== 'NONE' && (
                            <div className="space-y-6 relative z-10 animate-in fade-in slide-in-from-top-2 duration-300">
                                {currentHeaderFormat === 'TEXT' ? (
                                    <div>
                                        <div className="relative group/input">
                                            <input
                                                type="text"
                                                value={headerComp?.text || ''}
                                                onChange={(e) => updateComponent('HEADER', 'text', e.target.value)}
                                                placeholder="Enter header text..."
                                                className="w-full px-5 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-500/20 focus:bg-white rounded-2xl focus:ring-4 focus:ring-blue-500/5 outline-none text-sm font-bold transition-all shadow-inner"
                                            />
                                        </div>
                                        <div className="flex justify-between mt-2 px-1">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Supports variables like {'{{1}}'}</p>
                                            <p className="text-[10px] font-bold text-slate-300">{(headerComp?.text || '').length}/60</p>
                                        </div>
                                    </div>
                                ) : (
                                    <div
                                        className="border-2 border-dashed border-slate-200 rounded-[2rem] p-10 bg-slate-50/50 hover:bg-blue-50/30 hover:border-blue-200 transition-all cursor-pointer group/upload text-center relative overflow-hidden"
                                        onClick={() => isDraft && fileInputRef.current?.click()}
                                    >
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            className="hidden"
                                            accept={currentHeaderFormat === 'IMAGE' ? 'image/jpeg,image/png' : currentHeaderFormat === 'VIDEO' ? 'video/mp4' : '.pdf'}
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) handleMediaUpload(file);
                                                e.target.value = '';
                                            }}
                                        />
                                        <div className="relative z-10">
                                            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center mx-auto mb-4 group-hover/upload:scale-110 transition-transform text-blue-500 border border-slate-100">
                                                <i className={`fa-solid ${currentHeaderFormat === 'IMAGE' ? 'fa-image' : currentHeaderFormat === 'VIDEO' ? 'fa-film' : 'fa-file-lines'} text-2xl`}></i>
                                            </div>
                                            <p className="text-sm font-black text-slate-700">{uploading ? 'Uploading...' : `Click to upload ${currentHeaderFormat.toLowerCase()}`}</p>
                                            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-wider">Max size 5MB • {currentHeaderFormat === 'IMAGE' ? 'JPG/PNG' : currentHeaderFormat === 'VIDEO' ? 'MP4' : 'PDF'}</p>
                                        </div>

                                        {(mediaPreview || headerComp?.example?.header_handle?.length > 0) && !uploading && (
                                            <div className="absolute inset-0 bg-white z-20 flex items-center justify-center p-2">
                                                {currentHeaderFormat === 'IMAGE' ? (
                                                    <img src={mediaPreview} className="h-full w-full object-cover rounded-2xl shadow-md" alt="Preview" />
                                                ) : currentHeaderFormat === 'VIDEO' ? (
                                                    <video src={mediaPreview} className="h-full w-full object-cover rounded-2xl shadow-md" />
                                                ) : (
                                                    <div className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100 w-full shadow-sm">
                                                        <div className="w-12 h-12 bg-rose-500 rounded-xl flex items-center justify-center text-white shadow-lg"><i className="fa-solid fa-file-pdf text-xl"></i></div>
                                                        <div className="text-left flex-1 min-w-0">
                                                            <div className="text-sm font-black text-slate-800 truncate">{headerComp?._uploadedFileName || 'Document'}</div>
                                                            <div className="text-[10px] font-bold text-slate-400">{headerComp?._uploadedFileSize ? formatFileSize(headerComp._uploadedFileSize) : 'Uploaded'}</div>
                                                        </div>
                                                    </div>
                                                )}
                                                <div className="absolute top-4 right-4 z-30 opacity-0 group-hover/upload:opacity-100 transition-opacity">
                                                    <button onClick={(e) => { e.stopPropagation(); setMediaPreview(null); handleHeaderFormatChange('NONE'); }} className="w-8 h-8 bg-black/50 backdrop-blur-md rounded-full text-white flex items-center justify-center hover:bg-rose-500 transition-colors shadow-lg"><i className="fa-solid fa-trash-can text-[10px]"></i></button>
                                                </div>
                                            </div>
                                        )}

                                        {uploading && (
                                            <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-30 flex flex-col items-center justify-center">
                                                <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                                                <p className="text-xs font-black text-blue-600 uppercase tracking-widest">{uploadProgress}% Uploading</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ════════ BODY CARD ════════ */}
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-emerald-500/10 transition-colors"></div>

                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
                            <span className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center text-emerald-600">
                                <i className="fa-solid fa-align-left text-xs"></i>
                            </span>
                            Body Content <span className="text-rose-500">*</span>
                        </h3>

                        <div className="relative z-10 space-y-4">
                            <div className="relative group/input">
                                <textarea
                                    rows="6"
                                    value={bodyComp?.text || ''}
                                    onChange={(e) => updateComponent('BODY', 'text', e.target.value)}
                                    className="w-full px-5 py-5 bg-slate-50 border-2 border-transparent focus:border-emerald-500/20 focus:bg-white rounded-[2rem] focus:ring-4 focus:ring-emerald-500/5 outline-none text-[15px] font-medium transition-all shadow-inner leading-relaxed resize-none"
                                    placeholder="Enter the main content of your message... Use {{1}}, {{2}} for dynamic fields."
                                ></textarea>

                                <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-focus-within/input:opacity-100 transition-opacity">
                                    <button
                                        onClick={() => addVariable('BODY')}
                                        className="px-3 py-1.5 bg-emerald-500 text-white text-[10px] font-black rounded-full shadow-lg hover:bg-emerald-600 transition-all flex items-center gap-1.5"
                                    >
                                        <i className="fa-solid fa-plus-circle"></i> ADD {'{{x}}'}
                                    </button>
                                </div>
                            </div>

                            <div className="flex justify-between px-1">
                                <div className="flex gap-4">
                                    <div className="flex items-center gap-1.5 text-slate-400">
                                        <i className="fa-solid fa-circle-check text-[10px] text-emerald-500"></i>
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Variables</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 text-slate-400">
                                        <i className="fa-solid fa-circle-check text-[10px] text-emerald-500"></i>
                                        <span className="text-[10px] font-bold uppercase tracking-wider">Emojis</span>
                                    </div>
                                </div>
                                <p className="text-[10px] font-bold text-slate-300">{(bodyComp?.text || '').length}/1024</p>
                            </div>
                        </div>

                        {/* Variable Mapping Section */}
                        {bodyComp?.text?.includes('{{') && (
                            <div className="mt-8 pt-8 border-t border-slate-100 animate-in fade-in zoom-in-95 duration-500">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Sample Data for Variables</p>
                                <div className="grid grid-cols-2 gap-4">
                                    {extractVariables(bodyComp.text).map((num) => (
                                        <div key={num} className="relative group/var">
                                            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                                                <span className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-black flex items-center justify-center">
                                                    {num}
                                                </span>
                                            </div>
                                            <input
                                                type="text"
                                                placeholder={`Value for {{${num}}}`}
                                                value={bodyComp.example?.body_text?.[0]?.[num - 1] || ''}
                                                onChange={(e) => updateVariableExample('BODY', num, e.target.value)}
                                                className="w-full pl-12 pr-4 py-3 bg-slate-50 border-2 border-transparent focus:border-emerald-500/20 focus:bg-white rounded-xl focus:ring-4 focus:ring-emerald-500/5 outline-none text-xs font-bold transition-all shadow-inner"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* ════════ FOOTER CARD ════════ */}
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-slate-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-slate-500/10 transition-colors"></div>

                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <span className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-600">
                                    <i className="fa-solid fa-shoe-prints text-xs"></i>
                                </span>
                                Footer <span className="text-[10px] lowercase font-bold text-slate-300 ml-1">(Optional)</span>
                            </h3>
                            {footerComp && <button onClick={() => removeComponent('FOOTER')} className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:text-rose-700 transition">Remove</button>}
                        </div>

                        {!footerComp ? (
                            <button onClick={() => updateComponent('FOOTER', 'text', '')} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-[2rem] text-slate-400 hover:border-slate-300 hover:bg-slate-50 transition-all text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3">
                                <i className="fa-solid fa-plus-circle"></i> Add Footer Text
                            </button>
                        ) : (
                            <div className="relative animate-in fade-in slide-in-from-top-2">
                                <input
                                    type="text"
                                    value={footerComp.text || ''}
                                    onChange={(e) => updateComponent('FOOTER', 'text', e.target.value)}
                                    className="w-full px-5 py-4 bg-slate-50 border-2 border-transparent focus:border-slate-500/20 focus:bg-white rounded-2xl focus:ring-4 focus:ring-slate-500/5 outline-none text-sm font-bold transition-all shadow-inner"
                                    placeholder="e.g. Reply STOP to opt out"
                                    maxLength={60}
                                />
                                <p className="text-[10px] font-bold text-slate-300 text-right mt-2 px-1">{(footerComp.text || '').length}/60</p>
                            </div>
                        )}
                    </div>

                    {/* ════════ BUTTONS CARD ════════ */}
                    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-blue-500/10 transition-colors"></div>

                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
                                <span className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                                    <i className="fa-solid fa-hand-pointer text-xs"></i>
                                </span>
                                Interactive Buttons <span className="text-[10px] lowercase font-bold text-slate-300 ml-1">(Optional, Max 3)</span>
                            </h3>
                            {btnComp?.buttons?.length > 0 && btnComp.buttons.length < 3 && (
                                <button onClick={addButton} className="px-3 py-1 bg-blue-600 text-white text-[10px] font-black rounded-full shadow-lg hover:bg-blue-700 transition-all">
                                    <i className="fa-solid fa-plus mr-1"></i> ADD
                                </button>
                            )}
                        </div>

                        {!btnComp?.buttons?.length ? (
                            <button onClick={addButton} className="w-full py-8 border-2 border-dashed border-slate-200 rounded-[2rem] text-slate-400 hover:border-blue-200 hover:bg-blue-50/30 transition-all text-xs font-black uppercase tracking-widest flex flex-col items-center justify-center gap-3">
                                <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-blue-500 border border-slate-100">
                                    <i className="fa-solid fa-mouse-pointer text-xl"></i>
                                </div>
                                Add Quick Replies or CTA
                            </button>
                        ) : (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                                {btnComp.buttons.map((btn, idx) => (
                                    <div key={idx} className="bg-slate-50/50 rounded-[2rem] p-6 border border-slate-100 relative group/btn-card">
                                        <button onClick={() => removeButton(idx)} className="absolute top-4 right-4 w-8 h-8 bg-white text-rose-500 rounded-full flex items-center justify-center shadow-sm opacity-0 group-hover/btn-card:opacity-100 transition-all hover:bg-rose-50 border border-rose-100">
                                            <i className="fa-solid fa-trash-can text-[10px]"></i>
                                        </button>

                                        <div className="grid grid-cols-2 gap-6">
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Button Type</label>
                                                <select
                                                    value={btn.type}
                                                    onChange={(e) => updateButton(idx, 'type', e.target.value)}
                                                    className="w-full px-4 py-3 bg-white border-2 border-transparent focus:border-blue-500/20 rounded-xl outline-none text-xs font-black text-slate-700 shadow-sm"
                                                >
                                                    <option value="QUICK_REPLY">💬 Quick Reply</option>
                                                    <option value="URL">🔗 URL Button</option>
                                                    <option value="PHONE_NUMBER">📞 Call Button</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Label (Max 20)</label>
                                                <input
                                                    type="text"
                                                    value={btn.text}
                                                    onChange={(e) => updateButton(idx, 'text', e.target.value)}
                                                    className="w-full px-4 py-3 bg-white border-2 border-transparent focus:border-blue-500/20 rounded-xl outline-none text-xs font-black text-slate-700 shadow-sm"
                                                    placeholder="e.g. Contact Us"
                                                />
                                            </div>
                                        </div>

                                        {btn.type === 'URL' && (
                                            <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">URL Address</label>
                                                <input
                                                    type="url"
                                                    value={btn.url || ''}
                                                    onChange={(e) => updateButton(idx, 'url', e.target.value)}
                                                    className="w-full px-4 py-3 bg-white border-2 border-transparent focus:border-blue-500/20 rounded-xl outline-none text-xs font-bold text-blue-600 shadow-sm"
                                                    placeholder="https://example.com"
                                                />
                                            </div>
                                        )}
                                        {btn.type === 'PHONE_NUMBER' && (
                                            <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                                                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 px-1">Phone Number</label>
                                                <input
                                                    type="tel"
                                                    value={btn.phone_number || ''}
                                                    onChange={(e) => updateButton(idx, 'phone_number', e.target.value)}
                                                    className="w-full px-4 py-3 bg-white border-2 border-transparent focus:border-blue-500/20 rounded-xl outline-none text-xs font-bold text-slate-700 shadow-sm"
                                                    placeholder="+1 234 567 890"
                                                />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* ════════ AUTOMATION CARD ════════ */}
                    <TemplateAutomationCard template={template} setTemplate={setTemplate} stages={stages} />
                </div>

                {/* ──── Live Realistic Phone Preview ──── */}
                <TemplatePhonePreview
                    headerComp={headerComp}
                    currentHeaderFormat={currentHeaderFormat}
                    mediaPreview={mediaPreview}
                    bodyComp={bodyComp}
                    footerComp={footerComp}
                    btnComp={btnComp}
                    renderPreviewText={renderPreviewText}
                    formatFileSize={formatFileSize}
                    analytics={template.analytics}
                />
            </div>
        </div>
    );
};

export default TemplateBuilder;
