import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import VariableSelector from '../VariableSelector';
import MediaLibraryPickerModal from './MediaLibraryPickerModal';
import {
    ACCEPT_ATTR,
    MAX_FILE_BYTES,
    MAX_FILES,
    MAX_TOTAL_BYTES,
    formatBytes,
    iconForMime,
    validateAddition
} from './attachmentLimits';

const MB = 1024 * 1024;

const TemplateModal = ({ isOpen, onClose, onSuccess, template = null }) => {
    const [formData, setFormData] = useState({
        name: '',
        subject: '',
        body: '',
        isActive: true,
        isAutomated: false,
        triggerType: 'manual',
        stage: ''
    });
    const [stages, setStages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // ── Attachments ─────────────────────────────────────────────────────────
    // Attachments used to be reachable only AFTER saving, through View → Add
    // Files, and only as fresh uploads. Both are staged here instead, so a
    // template can be created with its brochure already on it, picked from the
    // shared Media Library (the WhatsApp one) or uploaded fresh.
    const [saved, setSaved] = useState([]);          // rows already on the template
    const [removedIds, setRemovedIds] = useState([]); // saved rows staged for removal
    const [libraryPicks, setLibraryPicks] = useState([]); // MediaAsset picks, not yet linked
    const [newFiles, setNewFiles] = useState([]);    // File objects, not yet uploaded
    const [showPicker, setShowPicker] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const fileInputRef = useRef(null);

    // Set once a create succeeds. Without it, a failure while attaching files
    // would turn the user's retry into a SECOND template.
    const createdIdRef = useRef(null);

    useEffect(() => {
        if (template) {
            setFormData({
                name: template.name || '',
                subject: template.subject || '',
                body: template.body || '',
                isActive: template.isActive ?? true,
                isAutomated: template.isAutomated ?? false,
                triggerType: template.triggerType || 'manual',
                stage: template.stage || ''
            });
            setSaved(template.attachments || []);
        } else {
            // Reset form for create mode
            setFormData({
                name: '',
                subject: '',
                body: '',
                isActive: true,
                isAutomated: false,
                triggerType: 'manual',
                stage: ''
            });
            setSaved([]);
        }
        setRemovedIds([]);
        setLibraryPicks([]);
        setNewFiles([]);
        setError(null);
        createdIdRef.current = null;
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [template, isOpen]);

    useEffect(() => {
        const fetchStages = async () => {
            try {
                const res = await api.get('/stages');
                setStages(res.data);
            } catch (err) {
                console.error("Failed to load stages", err);
            }
        };
        if (isOpen) fetchStages();
    }, [isOpen]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    // One list for the UI, whatever each row's origin is.
    const rows = [
        ...saved
            .filter(a => !removedIds.includes(a._id))
            .map(a => ({
                key: `saved-${a._id}`,
                name: a.originalName || a.filename,
                size: a.size,
                mimetype: a.mimetype,
                fromLibrary: !!a.mediaAssetId,
                onRemove: () => setRemovedIds(prev => [...prev, a._id])
            })),
        ...libraryPicks.map(p => ({
            key: `lib-${p.id}`,
            name: p.label || p.fileName,
            size: p.size,
            mimetype: p.mimeType,
            fromLibrary: true,
            pending: true,
            onRemove: () => setLibraryPicks(prev => prev.filter(x => x.id !== p.id))
        })),
        ...newFiles.map((f, i) => ({
            key: `file-${i}-${f.name}`,
            name: f.name,
            size: f.size,
            mimetype: f.type,
            fromLibrary: false,
            pending: true,
            onRemove: () => setNewFiles(prev => prev.filter((_, idx) => idx !== i))
        }))
    ];

    const usedBytes = rows.reduce((sum, r) => sum + (r.size || 0), 0);

    const handlePickFromLibrary = (asset) => {
        setShowPicker(false);
        if (rows.some(r => r.key === `lib-${asset.id}`)) return;
        // Already linked from a previous save — the server would ignore it.
        if (saved.some(a => String(a.mediaAssetId) === String(asset.id) && !removedIds.includes(a._id))) {
            setError('That file is already attached to this template.');
            return;
        }
        const err = validateAddition(rows, [{ name: asset.label || asset.fileName, size: asset.size }]);
        if (err) return setError(err);
        setError(null);
        setLibraryPicks(prev => [...prev, asset]);
    };

    const addFiles = (picked) => {
        if (picked.length === 0) return;
        const err = validateAddition(
            rows,
            picked.map(f => ({ name: f.name, size: f.size, mimetype: f.type })),
            { checkMime: true }
        );
        if (err) {
            setError(err);
        } else {
            setError(null);
            setNewFiles(prev => [...prev, ...picked]);
        }
    };

    const handleSelectFiles = (e) => {
        addFiles(Array.from(e.target.files || []));
        // Always clear, or re-picking the same file fires no change event.
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDrag = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(e.type === 'dragenter' || e.type === 'dragover');
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        addFiles(Array.from(e.dataTransfer.files || []));
    };

    /** Apply staged attachment changes to a template that now exists. */
    const syncAttachments = async (templateId, { skipLibrary = false } = {}) => {
        for (const id of removedIds) {
            await api.delete(`/email-templates/${templateId}/attachments`, { data: { attachmentId: id } });
        }

        // On create these rode along with the template itself — re-sending them
        // would be a no-op, but skipping the round trip is cheaper.
        if (!skipLibrary && libraryPicks.length > 0) {
            await api.post(`/email-templates/${templateId}/attachments/library`, {
                mediaAssetIds: libraryPicks.map(p => p.id)
            });
        }

        if (newFiles.length > 0) {
            const form = new FormData();
            newFiles.forEach(file => form.append('attachments', file));
            await api.post(`/email-templates/${templateId}/attachments`, form, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        // The upload route takes 5 files per request; stay inside it.
        if (newFiles.length > 5) {
            setLoading(false);
            return setError('You can upload at most 5 new files at a time. Save, then add the rest.');
        }

        try {
            const data = { ...formData };
            if (!data.isAutomated) {
                data.triggerType = 'manual';
                data.stage = null;
            } else if (data.triggerType !== 'on_stage_change') {
                data.stage = null;
            }

            const existingId = template?._id || createdIdRef.current;

            if (existingId) {
                await api.put(`/email-templates/${existingId}`, data);
                await syncAttachments(existingId);
            } else {
                // Library picks go WITH the create, so the template is never
                // saved in a half-attached state.
                if (libraryPicks.length > 0) data.mediaAssetIds = libraryPicks.map(p => p.id);
                const res = await api.post('/email-templates', data);
                const newId = res.data?._id;
                createdIdRef.current = newId;
                if (newId) await syncAttachments(newId, { skipLibrary: true });
            }
            onSuccess();
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to save template');
            // The template itself may already be saved — refresh the list so
            // the card is not missing behind the error.
            if (createdIdRef.current) onSuccess();
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <>
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-gray-800">
                        {template ? 'Edit Template' : 'Create Template'}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-red-500">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {error && <div className="bg-red-100 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Template Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                required
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="e.g. Welcome Email"
                            />
                        </div>
                        <div>
                            <div className="flex items-center justify-between">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                                <VariableSelector onInsert={(v) => setFormData({ ...formData, subject: formData.subject + v })} />
                            </div>
                            <input
                                type="text"
                                name="subject"
                                value={formData.subject}
                                onChange={handleChange}
                                required
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Subject line..."
                            />
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Email Body</label>
                            <VariableSelector onInsert={(v) => setFormData({ ...formData, body: formData.body + v })} />
                        </div>
                        <textarea
                            name="body"
                            value={formData.body}
                            onChange={handleChange}
                            required
                            rows="8"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-mono text-sm"
                            placeholder="Hello {{lead.name}}, ..."
                        ></textarea>
                        <p className="text-xs text-gray-500 mt-1">Select variables using the dropdown above to insert them into your template.</p>
                    </div>

                    {/* ── Attachments ─────────────────────────────────────── */}
                    {/* The whole box is a drop target: dragging a PDF onto it is the
                        fastest way to attach one, and it matches what people expect
                        from every mail client. */}
                    <div
                        onDragEnter={handleDrag}
                        onDragOver={handleDrag}
                        onDragLeave={handleDrag}
                        onDrop={handleDrop}
                        className={`p-4 rounded-lg border-2 space-y-3 transition-colors ${
                            dragActive
                                ? 'bg-blue-50 border-dashed border-blue-400'
                                : 'bg-gray-50 border-gray-200'
                        }`}
                    >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <h4 className="font-bold text-gray-700 text-sm">
                                <i className="fa-solid fa-paperclip mr-2 text-gray-400"></i>
                                Attachments {rows.length > 0 && <span className="text-gray-400 font-medium">({rows.length})</span>}
                            </h4>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowPicker(true)}
                                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold rounded-lg transition"
                                >
                                    <i className="fa-solid fa-photo-film mr-1.5"></i>
                                    Media Library
                                </button>
                                <button
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="px-3 py-1.5 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 text-xs font-semibold rounded-lg transition"
                                >
                                    <i className="fa-solid fa-arrow-up-from-bracket mr-1.5"></i>
                                    Upload file
                                </button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    className="hidden"
                                    accept={ACCEPT_ATTR}
                                    onChange={handleSelectFiles}
                                />
                            </div>
                        </div>

                        {rows.length === 0 ? (
                            <div className="text-center py-4">
                                <i className={`fa-solid fa-cloud-arrow-up text-2xl ${dragActive ? 'text-blue-500' : 'text-gray-300'}`}></i>
                                <p className="text-sm font-medium text-gray-600 mt-2">
                                    {dragActive ? 'Drop to attach' : 'Drag files here, or use the buttons above'}
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                    <strong>Media Library</strong> reuses the files you already use in WhatsApp
                                    templates; <strong>Upload file</strong> adds one just for this template.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {rows.map(row => (
                                    <div
                                        key={row.key}
                                        className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-lg border border-gray-200"
                                    >
                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                            <i className={`fa-solid ${iconForMime(row.mimetype)} text-lg ${row.fromLibrary ? 'text-emerald-600' : 'text-blue-600'}`}></i>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-gray-800 truncate">{row.name}</p>
                                                <p className="text-[11px] text-gray-500">
                                                    {formatBytes(row.size)}
                                                    {row.fromLibrary && <span className="ml-2 text-emerald-600 font-semibold">· Media Library</span>}
                                                    {row.pending && <span className="ml-2 text-amber-600 font-semibold">· saves with template</span>}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={row.onRemove}
                                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                                            title={row.fromLibrary ? 'Detach (the file stays in your Media Library)' : 'Remove'}
                                        >
                                            <i className="fa-solid fa-xmark"></i>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <p className="text-[11px] text-gray-400">
                            Up to {MAX_FILES} files · {MAX_FILE_BYTES / MB} MB each · {MAX_TOTAL_BYTES / MB} MB total
                            {rows.length > 0 && ` · ${formatBytes(usedBytes)} used`}
                            . Removing a Media Library file here only detaches it — it stays in your library.
                        </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
                        <h4 className="font-bold text-gray-700 text-sm">Settings</h4>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="isActive"
                                name="isActive"
                                checked={formData.isActive}
                                onChange={handleChange}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <label htmlFor="isActive" className="text-sm text-gray-700">Active Template</label>
                        </div>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="isAutomated"
                                name="isAutomated"
                                checked={formData.isAutomated}
                                onChange={handleChange}
                                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                            />
                            <label htmlFor="isAutomated" className="text-sm text-gray-700">Enable Automation</label>
                        </div>

                        {formData.isAutomated && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pl-6 border-l-2 border-purple-200 mt-2">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Trigger Event</label>
                                    <select
                                        name="triggerType"
                                        value={formData.triggerType}
                                        onChange={handleChange}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"
                                    >
                                        <option value="manual">Manual (No Trigger)</option>
                                        <option value="on_lead_create">When Lead is Created</option>
                                        <option value="on_stage_change">When Stage Changes</option>
                                    </select>
                                </div>

                                {formData.triggerType === 'on_stage_change' && (
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Target Stage</label>
                                        <select
                                            name="stage"
                                            value={formData.stage}
                                            onChange={handleChange}
                                            required
                                            className="w-full p-2 border border-gray-300 rounded-lg text-sm bg-white"
                                        >
                                            <option value="">Select Stage...</option>
                                            {stages.map(s => (
                                                <option key={s._id} value={s.name}>{s.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition shadow-md disabled:opacity-70"
                        >
                            {loading ? 'Saving...' : 'Save Template'}
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <MediaLibraryPickerModal
            isOpen={showPicker}
            onClose={() => setShowPicker(false)}
            onSelect={handlePickFromLibrary}
        />
        </>
    );
};

export default TemplateModal;
