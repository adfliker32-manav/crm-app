import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

/**
 * Super Admin → Support → Video Management.
 *
 * The whole point of this screen: a non-technical super admin changes a help
 * video here and the "? Help" drawer in the customer's CRM serves the new one on
 * its next open. No deploy, no developer.
 *
 * MODULE / SUB-MODULE ARE NOT A FIXED LIST. The dropdowns are seeded from the
 * backend catalog (which itself unions the seed vocabulary with every key
 * already in use), and both pickers offer "+ New…" so a topic that does not
 * exist yet can be typed in. That is what keeps the Help component free of code
 * changes as the CRM grows.
 */

// Sentinel values for the two pickers. '' is a real, meaningful value here (the
// module-level overview), so "no filter" needs its own marker.
const CUSTOM = '__custom__';
const MODULE_LEVEL_FILTER = '__module__';

const emptyForm = () => ({
    id: null,
    module: '',
    submodule: '',
    title: '',
    description: '',
    youtubeUrl: '',
    isActive: true,
    sortOrder: 0
});

const fmtDate = (d) => d
    ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 mt-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300';
const labelCls = 'text-xs font-bold text-slate-600 uppercase tracking-wider';

const HelpVideosView = () => {
    const [videos, setVideos] = useState([]);
    const [catalog, setCatalog] = useState([]);
    const [stats, setStats] = useState({ total: 0, active: 0 });
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(null);

    // Filters
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [filterModule, setFilterModule] = useState('');
    const [filterSubmodule, setFilterSubmodule] = useState('');
    const [filterStatus, setFilterStatus] = useState('');

    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();

    const LIMIT = 25;

    // A changed filter always means page 1 — otherwise a narrow filter lands the
    // admin on an empty page 3 and looks like the library is gone.
    //
    // ⚠️ The reset happens in the SETTERS, never in an effect keyed on the
    // filters. As an effect it ran before the load effect in the same flush, so
    // load() still held the stale page: every filter change fired TWO requests,
    // the first for the page the admin was about to leave.
    useEffect(() => {
        const t = setTimeout(() => {
            setDebouncedSearch(search.trim());
            setPage(1);
        }, 350);
        return () => clearTimeout(t);
    }, [search]);

    const loadCatalog = useCallback(async () => {
        try {
            const res = await api.get('/help-videos/admin/catalog');
            setCatalog(res.data?.modules || []);
        } catch {
            // Non-fatal: the form still works, the pickers just fall back to
            // free text.
            setCatalog([]);
        }
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/help-videos/admin', {
                params: {
                    search: debouncedSearch || undefined,
                    module: filterModule || undefined,
                    submodule: filterSubmodule || undefined,
                    status: filterStatus || undefined,
                    page,
                    limit: LIMIT
                }
            });
            setVideos(res.data?.videos || []);
            setTotal(res.data?.total || 0);
            setStats(res.data?.stats || { total: 0, active: 0 });
        } catch (err) {
            showError(err.response?.data?.message || 'Failed to load help videos');
        } finally {
            setLoading(false);
        }
    }, [debouncedSearch, filterModule, filterSubmodule, filterStatus, page, showError]);

    useEffect(() => { loadCatalog(); }, [loadCatalog]);
    useEffect(() => { load(); }, [load]);

    const filterSubmoduleOptions = useMemo(() => {
        const mod = catalog.find(m => m.key === filterModule);
        return mod?.submodules || [];
    }, [catalog, filterModule]);

    const save = async (form) => {
        if (!form.module.trim()) { showError('Module is required'); return; }
        if (!form.title.trim()) { showError('Video title is required'); return; }
        if (!form.youtubeUrl.trim()) { showError('YouTube URL is required'); return; }

        setSaving(true);
        try {
            const payload = {
                module: form.module.trim(),
                submodule: form.submodule.trim(),
                title: form.title.trim(),
                description: form.description.trim(),
                youtubeUrl: form.youtubeUrl.trim(),
                isActive: form.isActive,
                sortOrder: Number(form.sortOrder) || 0
            };
            if (form.id) await api.put(`/help-videos/admin/${form.id}`, payload);
            else await api.post('/help-videos/admin', payload);

            showSuccess(`Help video ${form.id ? 'updated' : 'added'}`);
            setEditing(null);
            await Promise.all([load(), loadCatalog()]);
        } catch (err) {
            showError(err.response?.data?.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const toggle = async (v) => {
        try {
            await api.patch(`/help-videos/admin/${v.id}/toggle`, { isActive: !v.isActive });
            load();
        } catch (err) {
            showError(err.response?.data?.message || 'Could not change status');
        }
    };

    const remove = async (v) => {
        const ok = await showDanger(
            `Delete "${v.title}"? Customers on ${v.moduleLabel} will stop seeing it immediately. Deactivate instead if you only want to hide it for now.`,
            'Delete help video'
        );
        if (!ok) return;
        try {
            await api.delete(`/help-videos/admin/${v.id}`);
            showSuccess('Help video deleted');
            // Removing the only row on the last page would otherwise leave the
            // admin staring at "no videos match these filters" on a page that no
            // longer exists. Step back instead; the page change re-runs load().
            if (videos.length === 1 && page > 1) setPage(p => p - 1);
            else load();
        } catch (err) {
            showError(err.response?.data?.message || 'Delete failed');
        }
    };

    const pageCount = Math.max(1, Math.ceil(total / LIMIT));
    const hasFilters = Boolean(debouncedSearch || filterModule || filterSubmodule || filterStatus);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900">Video Management</h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Tutorial videos behind the <span className="font-semibold">? Help</span> button in every CRM module.
                        Changes take effect for customers immediately.
                    </p>
                </div>
                <button
                    onClick={() => setEditing(emptyForm())}
                    className="bg-slate-900 hover:bg-black text-white text-sm font-bold px-4 py-2 rounded-xl flex items-center gap-2 flex-shrink-0"
                >
                    <i className="fa-solid fa-plus" /> Add video
                </button>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                    { label: 'Total videos', value: stats.total },
                    { label: 'Active', value: stats.active },
                    { label: 'Inactive', value: Math.max(0, stats.total - stats.active) }
                ].map(s => (
                    <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4">
                        <p className="text-xs text-slate-500 uppercase font-semibold tracking-wide">{s.label}</p>
                        <p className="text-2xl font-black text-slate-900 mt-1">{s.value}</p>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                    <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
                    <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search title, description or URL…"
                        className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                    />
                </div>

                <select
                    value={filterModule}
                    onChange={e => { setFilterModule(e.target.value); setFilterSubmodule(''); setPage(1); }}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                    <option value="">All modules</option>
                    {catalog.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>

                <select
                    value={filterSubmodule}
                    onChange={e => { setFilterSubmodule(e.target.value); setPage(1); }}
                    disabled={!filterModule}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                    <option value="">All sub-modules</option>
                    <option value={MODULE_LEVEL_FILTER}>Module overview only</option>
                    {filterSubmoduleOptions.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>

                <select
                    value={filterStatus}
                    onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
                    className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
                >
                    <option value="">Active &amp; inactive</option>
                    <option value="active">Active only</option>
                    <option value="inactive">Inactive only</option>
                </select>

                {hasFilters && (
                    <button
                        onClick={() => { setSearch(''); setFilterModule(''); setFilterSubmodule(''); setFilterStatus(''); setPage(1); }}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2"
                    >
                        Clear
                    </button>
                )}
            </div>

            {/* Table */}
            {loading ? (
                <div className="text-center py-12">
                    <div className="w-6 h-6 border-2 border-slate-300 border-t-slate-700 rounded-full animate-spin mx-auto" />
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[860px]">
                            <thead className="bg-slate-50">
                                <tr className="text-left text-xs uppercase text-slate-500 font-semibold tracking-wider">
                                    <th className="px-4 py-3">Video</th>
                                    <th className="px-4 py-3">Module</th>
                                    <th className="px-4 py-3">Sub-module</th>
                                    <th className="px-4 py-3 text-center">Order</th>
                                    <th className="px-4 py-3">Updated</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {videos.map(v => (
                                    <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                                        <td className="px-4 py-3">
                                            <div className="flex items-start gap-3">
                                                {v.thumbnailUrl ? (
                                                    <img
                                                        src={v.thumbnailUrl}
                                                        alt=""
                                                        loading="lazy"
                                                        className="w-20 h-[45px] object-cover rounded-md border border-slate-200 flex-shrink-0 bg-slate-100"
                                                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                                                    />
                                                ) : (
                                                    <span className="w-20 h-[45px] rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center flex-shrink-0">
                                                        <i className="fa-solid fa-film text-slate-300" />
                                                    </span>
                                                )}
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-slate-900 leading-snug">{v.title}</p>
                                                    {v.description && (
                                                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{v.description}</p>
                                                    )}
                                                    {!v.linkValid && (
                                                        <p className="text-[11px] font-bold text-rose-600 mt-1">
                                                            <i className="fa-solid fa-triangle-exclamation" /> Link is not a valid YouTube video
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="text-slate-800 font-medium">{v.moduleLabel}</span>
                                            <p className="text-[11px] text-slate-400 font-mono">{v.module}</p>
                                        </td>
                                        <td className="px-4 py-3">
                                            {v.submodule ? (
                                                <>
                                                    <span className="text-slate-700">{v.submoduleLabel}</span>
                                                    <p className="text-[11px] text-slate-400 font-mono">{v.submodule}</p>
                                                </>
                                            ) : (
                                                <span className="text-xs font-semibold text-slate-400 italic">Module overview</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center text-slate-600 font-mono">{v.sortOrder}</td>
                                        <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{fmtDate(v.updatedAt)}</td>
                                        <td className="px-4 py-3">
                                            <button
                                                onClick={() => toggle(v)}
                                                title={v.isActive ? 'Deactivate' : 'Activate'}
                                                className={`text-xs font-bold uppercase px-2.5 py-1 rounded-full transition
                                                    ${v.isActive
                                                        ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                                                        : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}
                                            >
                                                {v.isActive ? 'Active' : 'Off'}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right whitespace-nowrap space-x-3">
                                            {v.watchUrl && (
                                                <a
                                                    href={v.watchUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    title="Open on YouTube"
                                                    className="text-slate-400 hover:text-slate-700 transition inline-block"
                                                >
                                                    <i className="fa-solid fa-arrow-up-right-from-square text-sm" />
                                                </a>
                                            )}
                                            <button onClick={() => setEditing({ ...v })} title="Edit"
                                                className="text-blue-600 hover:text-blue-800 transition">
                                                <i className="fa-solid fa-pen text-sm" />
                                            </button>
                                            <button onClick={() => remove(v)} title="Delete"
                                                className="text-rose-500 hover:text-rose-700 transition">
                                                <i className="fa-solid fa-trash text-sm" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}

                                {videos.length === 0 && (
                                    <tr>
                                        <td colSpan="7" className="px-4 py-14 text-center text-slate-400 text-sm">
                                            <i className="fa-solid fa-film text-3xl block mb-3 opacity-30" />
                                            {hasFilters
                                                ? 'No videos match these filters.'
                                                : 'No help videos yet. Click "Add video" to create the first one.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {pageCount > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
                            <p className="text-xs text-slate-500">
                                Page {page} of {pageCount} · {total} video{total === 1 ? '' : 's'}
                            </p>
                            <div className="flex gap-2">
                                <button
                                    disabled={page <= 1}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100"
                                >
                                    Previous
                                </button>
                                <button
                                    disabled={page >= pageCount}
                                    onClick={() => setPage(p => Math.min(pageCount, p + 1))}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-100"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {editing && (
                <HelpVideoForm
                    initial={editing}
                    catalog={catalog}
                    saving={saving}
                    onCancel={() => setEditing(null)}
                    onSave={save}
                />
            )}
        </div>
    );
};

/* ─────────────────────────────────────────────────────────────────────────
   Add / Edit modal
   ───────────────────────────────────────────────────────────────────────── */
const HelpVideoForm = ({ initial, catalog, saving, onCancel, onSave }) => {
    const [form, setForm] = useState(initial);

    // A module/sub-module that is not in the catalog (a brand-new topic) opens
    // the form in free-text mode instead of silently snapping to another value.
    const [moduleMode, setModuleMode] = useState(
        () => (!initial.module || catalog.some(m => m.key === initial.module) ? 'pick' : 'custom')
    );
    const [submoduleMode, setSubmoduleMode] = useState('pick');

    const [preview, setPreview] = useState(null); // { valid, thumbnailUrl?, message? }
    const previewSeq = useRef(0);

    const set = (patch) => setForm(f => ({ ...f, ...patch }));

    const submoduleOptions = useMemo(() => {
        const mod = catalog.find(m => m.key === form.module);
        return mod?.submodules || [];
    }, [catalog, form.module]);

    // Once the catalog arrives, an existing record whose sub-module is not in it
    // must switch to free text — otherwise the picker would show a value it does
    // not contain and the first save would blank it.
    useEffect(() => {
        if (!initial.submodule) return;
        const known = catalog.find(m => m.key === initial.module)
            ?.submodules?.some(s => s.key === initial.submodule);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from an async catalog load
        setSubmoduleMode(known ? 'pick' : 'custom');
    }, [catalog, initial.module, initial.submodule]);

    // Validate the pasted link with the SAME parser the save path uses, so
    // "looks fine" here can never disagree with what gets stored. Every setPreview
    // happens inside the debounce callback, never synchronously in the effect
    // body — clearing on an empty field is just another (immediate) result.
    useEffect(() => {
        const url = (form.youtubeUrl || '').trim();
        const seq = ++previewSeq.current;

        const t = setTimeout(async () => {
            if (!url) {
                if (seq === previewSeq.current) setPreview(null);
                return;
            }
            try {
                const res = await api.post('/help-videos/admin/preview', { youtubeUrl: url });
                if (seq === previewSeq.current) setPreview(res.data);
            } catch {
                if (seq === previewSeq.current) setPreview(null);
            }
        }, url ? 450 : 0);

        return () => clearTimeout(t);
    }, [form.youtubeUrl]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl">
                <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
                    <h2 className="text-lg font-black text-slate-900">
                        {form.id ? 'Edit help video' : 'Add help video'}
                    </h2>
                    <button onClick={onCancel} className="text-slate-400 hover:text-slate-700">
                        <i className="fa-solid fa-times text-xl" />
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* Where it appears */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Module</label>
                            {moduleMode === 'pick' ? (
                                <select
                                    value={form.module}
                                    onChange={e => {
                                        if (e.target.value === CUSTOM) {
                                            setModuleMode('custom');
                                            setSubmoduleMode('custom');
                                            set({ module: '', submodule: '' });
                                        } else {
                                            set({ module: e.target.value, submodule: '' });
                                            setSubmoduleMode('pick');
                                        }
                                    }}
                                    className={inputCls}
                                >
                                    <option value="">Select a module…</option>
                                    {catalog.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
                                    <option value={CUSTOM}>+ New module…</option>
                                </select>
                            ) : (
                                <div className="flex gap-2 mt-1">
                                    <input
                                        value={form.module}
                                        onChange={e => set({ module: e.target.value })}
                                        placeholder="e.g. inventory"
                                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-300"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setModuleMode('pick'); setSubmoduleMode('pick'); set({ module: '', submodule: '' }); }}
                                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                            <p className="text-[11px] text-slate-400 mt-1">
                                The CRM page this video belongs to.
                            </p>
                        </div>

                        <div>
                            <label className={labelCls}>Sub-module</label>
                            {submoduleMode === 'pick' ? (
                                <select
                                    value={form.submodule}
                                    onChange={e => {
                                        if (e.target.value === CUSTOM) {
                                            setSubmoduleMode('custom');
                                            set({ submodule: '' });
                                        } else {
                                            set({ submodule: e.target.value });
                                        }
                                    }}
                                    disabled={!form.module}
                                    className={`${inputCls} disabled:bg-slate-100 disabled:text-slate-400`}
                                >
                                    <option value="">Module overview (whole module)</option>
                                    {submoduleOptions.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                                    <option value={CUSTOM}>+ New sub-module…</option>
                                </select>
                            ) : (
                                <div className="flex gap-2 mt-1">
                                    <input
                                        value={form.submodule}
                                        onChange={e => set({ submodule: e.target.value })}
                                        placeholder="e.g. stock-alerts"
                                        className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-300"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => { setSubmoduleMode('pick'); set({ submodule: '' }); }}
                                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            )}
                            <p className="text-[11px] text-slate-400 mt-1">
                                Leave as <em>Module overview</em> to use this video whenever a tab has none of its own.
                            </p>
                        </div>
                    </div>

                    {/* Title */}
                    <div>
                        <label className={labelCls}>Video title</label>
                        <input
                            value={form.title}
                            onChange={e => set({ title: e.target.value })}
                            maxLength={150}
                            placeholder="e.g. Sending your first WhatsApp broadcast"
                            className={inputCls}
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className={labelCls}>Description</label>
                        <textarea
                            value={form.description}
                            onChange={e => set({ description: e.target.value })}
                            maxLength={1000}
                            rows={3}
                            placeholder="One or two lines the customer reads before pressing play."
                            className={`${inputCls} resize-y`}
                        />
                        <p className="text-[11px] text-slate-400 mt-1">{(form.description || '').length}/1000</p>
                    </div>

                    {/* YouTube URL + live check */}
                    <div>
                        <label className={labelCls}>YouTube URL</label>
                        <input
                            value={form.youtubeUrl}
                            onChange={e => set({ youtubeUrl: e.target.value })}
                            maxLength={500}
                            placeholder="https://www.youtube.com/watch?v=..."
                            className={`${inputCls} font-mono text-xs`}
                        />
                        <p className="text-[11px] text-slate-400 mt-1">
                            Accepts watch, youtu.be, shorts and embed links.
                        </p>

                        {preview && form.youtubeUrl.trim() && (
                            preview.valid ? (
                                <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                                    <img
                                        src={preview.thumbnailUrl}
                                        alt=""
                                        className="w-24 h-[54px] object-cover rounded-md border border-emerald-200 bg-white flex-shrink-0"
                                        onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                                    />
                                    <div className="min-w-0">
                                        <p className="text-xs font-bold text-emerald-800">
                                            <i className="fa-solid fa-circle-check" /> Video found
                                        </p>
                                        <a
                                            href={preview.watchUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-[11px] text-emerald-700 hover:underline break-all"
                                        >
                                            Open on YouTube to confirm it is the right one
                                        </a>
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-3 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                                    <i className="fa-solid fa-triangle-exclamation" /> {preview.message}
                                </p>
                            )
                        )}
                    </div>

                    {/* Status + order */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className={labelCls}>Status</label>
                            <select
                                value={form.isActive ? 'active' : 'inactive'}
                                onChange={e => set({ isActive: e.target.value === 'active' })}
                                className={inputCls}
                            >
                                <option value="active">Active — visible to customers</option>
                                <option value="inactive">Inactive — hidden</option>
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>Sort order</label>
                            <input
                                type="number"
                                min="0"
                                max="9999"
                                value={form.sortOrder}
                                onChange={e => set({ sortOrder: e.target.value })}
                                className={inputCls}
                            />
                            <p className="text-[11px] text-slate-400 mt-1">
                                Lowest number is the primary video for this topic; the rest show as related guides.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 border-t border-slate-200 flex gap-3 justify-end sticky bottom-0 bg-white">
                    <button onClick={onCancel}
                        className="px-4 py-2 text-slate-600 font-semibold hover:bg-slate-100 rounded-lg transition">
                        Cancel
                    </button>
                    <button onClick={() => onSave(form)} disabled={saving}
                        className="px-5 py-2 bg-slate-900 hover:bg-black text-white font-bold rounded-lg disabled:opacity-50 transition">
                        {saving
                            ? <><span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-2" />Saving</>
                            : form.id ? 'Save changes' : 'Add video'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default HelpVideosView;
