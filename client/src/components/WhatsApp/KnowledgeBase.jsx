import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';

// What the AI can actually read. .xls/.doc are absent on purpose: the parsers
// (exceljs / mammoth) only handle the modern OOXML containers, so accepting the
// legacy binaries would mean taking the upload and failing at index time.
const ACCEPT = '.csv,.txt,.xlsx,.docx,.pdf';

const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const FILE_ICON = {
    csv:  'fa-file-csv',
    xlsx: 'fa-file-excel',
    docx: 'fa-file-word',
    pdf:  'fa-file-pdf',
    txt:  'fa-file-lines'
};

// `stale` is its own state, not an error: the documents are intact, they were
// just embedded with a different AI provider than the workspace now uses, so
// they are skipped at retrieval until re-indexed.
const STATUS = {
    queued:     { label: 'Queued',     cls: 'bg-slate-100 text-slate-600',   icon: 'fa-clock' },
    processing: { label: 'Indexing',   cls: 'bg-blue-50 text-blue-700',      icon: 'fa-spinner fa-spin' },
    ready:      { label: 'Ready',      cls: 'bg-emerald-50 text-emerald-700', icon: 'fa-circle-check' },
    error:      { label: 'Failed',     cls: 'bg-red-50 text-red-700',        icon: 'fa-circle-exclamation' },
    stale:      { label: 'Needs re-index', cls: 'bg-amber-50 text-amber-700', icon: 'fa-rotate' }
};

// Downloadable starters. Kept as plain strings so they cost no network request
// and always match the "header row + one row per item" shape the parser expects.
const SAMPLES = [
    {
        id: 'cars', name: 'Car Dealership', icon: 'fa-car', file: 'car-price-list.csv',
        body: 'Brand,Model,Variant,Fuel,Transmission,Price,Offer\n' +
              'Hyundai,Creta,EX,Petrol,Manual,11.00L,None\n' +
              'Hyundai,Creta,SX(O) Turbo,Petrol,Automatic,18.20L,50K exchange bonus\n' +
              'Tata,Nexon,XZ+,Diesel,Manual,14.50L,Free insurance\n'
    },
    {
        id: 'property', name: 'Real Estate', icon: 'fa-building', file: 'property-list.csv',
        body: 'Project,Location,Type,Area,Price,Possession\n' +
              'Sunrise Tower,Andheri West,3BHK,1200 sq ft,2.50 Cr,Ready to move\n' +
              'Green Villas,Powai,3BHK,1050 sq ft,1.80 Cr,Dec 2026\n'
    },
    {
        id: 'course', name: 'Coaching Institute', icon: 'fa-graduation-cap', file: 'course-fees.csv',
        body: 'Course,Duration,Batch Timing,Fee,Scholarship\n' +
              'JEE Main,1 Year,4pm to 8pm,85000,Up to 50% on scholarship test\n' +
              'JEE Main + Advanced,2 Years,4pm to 8pm,120000,Up to 50% on scholarship test\n'
    },
    {
        id: 'faq', name: 'General FAQ', icon: 'fa-circle-question', file: 'business-faq.txt',
        body: 'We are open Monday to Saturday, 9am to 7pm. We are closed on Sundays.\n\n' +
              'Delivery within city limits takes 2 to 3 working days and is free above 2000 rupees.\n\n' +
              'All products carry a 1 year manufacturer warranty from the date of purchase.\n\n' +
              'We accept cash, UPI, credit and debit cards. EMI is available on orders above 10000 rupees.\n'
    }
];

/**
 * Knowledge Base — upload the documents the AI chatbot answers customers from.
 *
 * Three views: the document list, a retrieval tester, and downloadable starter
 * files. The tester matters more than it looks: without it, a tenant whose bot
 * gives a vague answer cannot tell whether the AI is at fault or their price
 * list simply has no row for what was asked.
 */
export default function KnowledgeBase() {
    const [view, setView]           = useState('documents');
    const [documents, setDocuments] = useState([]);
    const [stats, setStats]         = useState(null);
    const [loading, setLoading]     = useState(true);
    const [uploading, setUploading] = useState(false);
    const [progress, setProgress]   = useState(0);
    const [error, setError]         = useState('');
    const [notice, setNotice]       = useState('');
    const [dragging, setDragging]   = useState(false);
    const [description, setDescription] = useState('');

    const [query, setQuery]         = useState('');
    const [testing, setTesting]     = useState(false);
    const [testResult, setTestResult] = useState(null);

    const fileInputRef = useRef(null);
    const { showDanger } = useConfirm();

    const load = useCallback(async () => {
        try {
            const [docsRes, statsRes] = await Promise.all([
                api.get('/knowledge-base/documents'),
                api.get('/knowledge-base/stats')
            ]);
            setDocuments(docsRes.data.documents || []);
            setStats(statsRes.data.stats || null);
            setError('');
        } catch (err) {
            setError(err.response?.data?.message || 'Failed to load the knowledge base');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Indexing runs in the background on the server, so the list has to be
    // pulled again while anything is still working. Polling stops the moment
    // nothing is in flight — an idle knowledge base makes no requests.
    useEffect(() => {
        const busy = documents.some(d => d.status === 'queued' || d.status === 'processing');
        if (!busy) return;
        const timer = setInterval(load, 3000);
        return () => clearInterval(timer);
    }, [documents, load]);

    const handleUpload = async (file) => {
        if (!file) return;
        setError('');
        setNotice('');
        setUploading(true);
        setProgress(0);

        try {
            const form = new FormData();
            form.append('file', file);
            if (description.trim()) form.append('description', description.trim());

            await api.post('/knowledge-base/upload', form, {
                headers: { 'Content-Type': 'multipart/form-data' },
                onUploadProgress: (e) => {
                    if (e.total) setProgress(Math.round((e.loaded * 100) / e.total));
                }
            });

            setDescription('');
            setNotice(`"${file.name}" uploaded. Indexing has started — this can take a minute for a large file.`);
            await load();
        } catch (err) {
            setError(err.response?.data?.message || 'Upload failed');
        } finally {
            setUploading(false);
            setProgress(0);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleToggle = async (doc) => {
        try {
            await api.patch(`/knowledge-base/documents/${doc.id}/toggle`, { isActive: !doc.isActive });
            await load();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not update the document');
        }
    };

    const handleReprocess = async (doc) => {
        try {
            await api.post(`/knowledge-base/documents/${doc.id}/reprocess`);
            setNotice(`Re-indexing "${doc.originalName}".`);
            await load();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not re-index the document');
        }
    };

    const handleDelete = async (doc) => {
        const ok = await showDanger({
            title: 'Delete this document?',
            message: `"${doc.originalName}" and everything indexed from it will be removed. ` +
                     'The AI will immediately stop answering from it. This cannot be undone.',
            confirmText: 'Delete'
        });
        if (!ok) return;

        try {
            await api.delete(`/knowledge-base/documents/${doc.id}`);
            await load();
        } catch (err) {
            setError(err.response?.data?.message || 'Could not delete the document');
        }
    };

    const runTest = async (e) => {
        e?.preventDefault();
        if (!query.trim()) return;
        setTesting(true);
        setTestResult(null);
        setError('');
        try {
            const res = await api.post('/knowledge-base/test-query', { query: query.trim() });
            setTestResult(res.data);
        } catch (err) {
            setError(err.response?.data?.message || 'Test query failed');
        } finally {
            setTesting(false);
        }
    };

    const downloadSample = (sample) => {
        const blob = new Blob([sample.body], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sample.file;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const onDrop = (e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleUpload(file);
    };

    const docLimitReached = stats && documents.length >= stats.limits.docLimit;
    const chunkPct = stats?.limits?.chunkLimit
        ? Math.min(100, Math.round((stats.chunks / stats.limits.chunkLimit) * 100))
        : 0;

    const VIEWS = [
        { id: 'documents', label: 'Documents', icon: 'fa-folder-open' },
        { id: 'test',      label: 'Test',      icon: 'fa-vial' },
        { id: 'samples',   label: 'Templates', icon: 'fa-download' }
    ];

    return (
        <div className="h-full overflow-y-auto bg-slate-50">
            <div className="p-6 border-b border-slate-100 bg-white">
                <h2 className="text-xl font-bold text-slate-800">AI Knowledge Base</h2>
                <p className="text-sm text-slate-500 mt-1">
                    Upload your price list, catalogue or FAQ and the AI chatbot will answer customers
                    using your real data instead of guessing.
                </p>
            </div>

            {/* Usage summary */}
            {stats && (
                <div className="px-6 pt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Documents</p>
                        <p className="text-2xl font-bold text-slate-800 mt-1">
                            {documents.length}
                            <span className="text-sm font-medium text-slate-400"> / {stats.limits.docLimit}</span>
                        </p>
                    </div>
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Indexed sections</p>
                        <p className="text-2xl font-bold text-slate-800 mt-1">
                            {stats.chunks}
                            <span className="text-sm font-medium text-slate-400"> / {stats.limits.chunkLimit}</span>
                        </p>
                        <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                            <div
                                className={`h-full rounded-full ${chunkPct > 90 ? 'bg-red-500' : 'bg-[#008069]'}`}
                                style={{ width: `${chunkPct}%` }}
                            />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl p-4 border border-slate-200">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bot status</p>
                        <p className={`text-sm font-bold mt-2 flex items-center gap-2 ${stats.retrievalReady ? 'text-emerald-600' : 'text-slate-400'}`}>
                            <i className={`fa-solid ${stats.retrievalReady ? 'fa-circle-check' : 'fa-circle-minus'}`} />
                            {stats.retrievalReady ? 'Answering from your data' : 'No active documents'}
                        </p>
                    </div>
                </div>
            )}

            {/* View switcher */}
            <div className="flex items-center gap-2 px-6 pt-5">
                {VIEWS.map(v => (
                    <button
                        key={v.id}
                        onClick={() => setView(v.id)}
                        className={`px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 transition-all ${
                            view === v.id
                                ? 'bg-[#008069] text-white shadow'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                    >
                        <i className={`fa-solid ${v.icon}`} />
                        {v.label}
                    </button>
                ))}
            </div>

            <div className="p-6">
                {error && (
                    <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2">
                        <i className="fa-solid fa-circle-exclamation mt-0.5" />
                        <span className="flex-1">{error}</span>
                        <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">
                            <i className="fa-solid fa-xmark" />
                        </button>
                    </div>
                )}
                {notice && (
                    <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-start gap-2">
                        <i className="fa-solid fa-circle-info mt-0.5" />
                        <span className="flex-1">{notice}</span>
                        <button onClick={() => setNotice('')} className="text-emerald-400 hover:text-emerald-600">
                            <i className="fa-solid fa-xmark" />
                        </button>
                    </div>
                )}

                {/* ── Documents ─────────────────────────────────────────── */}
                {view === 'documents' && (
                    <>
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                            onDragLeave={() => setDragging(false)}
                            onDrop={onDrop}
                            className={`rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                                dragging ? 'border-[#008069] bg-emerald-50' : 'border-slate-300 bg-white'
                            } ${docLimitReached ? 'opacity-60' : ''}`}
                        >
                            <i className="fa-solid fa-cloud-arrow-up text-3xl text-slate-400" />
                            <p className="mt-3 font-semibold text-slate-700">
                                {docLimitReached
                                    ? 'Document limit reached — delete one to upload another'
                                    : 'Drop a file here, or choose one'}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">
                                Excel (.xlsx), CSV, PDF, Word (.docx) or text
                                {stats && ` · up to ${stats.maxFileMb} MB`}
                            </p>

                            <input
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="Optional note, e.g. “Price list January 2026”"
                                maxLength={500}
                                className="mt-4 w-full max-w-md mx-auto block px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008069]/30"
                            />

                            <input
                                ref={fileInputRef}
                                type="file"
                                accept={ACCEPT}
                                className="hidden"
                                onChange={(e) => handleUpload(e.target.files?.[0])}
                            />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading || docLimitReached}
                                className="mt-4 px-5 py-2.5 rounded-lg bg-[#008069] text-white font-semibold text-sm hover:bg-[#006e5a] disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {uploading ? `Uploading ${progress}%` : 'Choose file'}
                            </button>

                            {uploading && (
                                <div className="h-1.5 bg-slate-100 rounded-full mt-4 max-w-md mx-auto overflow-hidden">
                                    <div className="h-full bg-[#008069] rounded-full transition-all" style={{ width: `${progress}%` }} />
                                </div>
                            )}
                        </div>

                        <div className="mt-6 space-y-3">
                            {loading && <p className="text-sm text-slate-400 text-center py-8">Loading…</p>}

                            {!loading && !documents.length && (
                                <div className="text-center py-12 text-slate-400">
                                    <i className="fa-solid fa-book-open text-4xl" />
                                    <p className="mt-3 font-medium">No documents yet</p>
                                    <p className="text-sm mt-1">
                                        Upload a price list to get started, or grab a sample from the Templates tab.
                                    </p>
                                </div>
                            )}

                            {documents.map(doc => {
                                const status = STATUS[doc.status] || STATUS.queued;
                                return (
                                    <div key={doc.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-4">
                                        <i className={`fa-solid ${FILE_ICON[doc.fileType] || 'fa-file'} text-2xl text-slate-400 mt-1`} />

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="font-semibold text-slate-800 truncate">{doc.originalName}</p>
                                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 ${status.cls}`}>
                                                    <i className={`fa-solid ${status.icon}`} />
                                                    {status.label}
                                                </span>
                                                {!doc.isActive && doc.status === 'ready' && (
                                                    <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-500">
                                                        Disabled
                                                    </span>
                                                )}
                                            </div>

                                            {doc.description && (
                                                <p className="text-xs text-slate-500 mt-1">{doc.description}</p>
                                            )}

                                            <p className="text-xs text-slate-400 mt-1">
                                                {formatBytes(doc.size)}
                                                {doc.status === 'ready' && ` · ${doc.totalChunks} sections indexed`}
                                                {doc.creditsCharged > 0 && ` · ${doc.creditsCharged} credits`}
                                                {' · '}
                                                {new Date(doc.createdAt).toLocaleDateString()}
                                            </p>

                                            {doc.errorMessage && (
                                                <p className="text-xs text-red-600 mt-2 bg-red-50 rounded-md px-2 py-1.5">
                                                    {doc.errorMessage}
                                                </p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0">
                                            {doc.status === 'ready' && (
                                                <button
                                                    onClick={() => handleToggle(doc)}
                                                    title={doc.isActive ? 'Stop using this document' : 'Use this document'}
                                                    className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                                                        doc.isActive
                                                            ? 'text-emerald-600 hover:bg-emerald-50'
                                                            : 'text-slate-400 hover:bg-slate-100'
                                                    }`}
                                                >
                                                    <i className={`fa-solid ${doc.isActive ? 'fa-toggle-on' : 'fa-toggle-off'} text-lg`} />
                                                </button>
                                            )}
                                            {(doc.status === 'error' || doc.status === 'stale') && (
                                                <button
                                                    onClick={() => handleReprocess(doc)}
                                                    title="Try indexing again"
                                                    className="w-9 h-9 rounded-lg flex items-center justify-center text-blue-600 hover:bg-blue-50"
                                                >
                                                    <i className="fa-solid fa-rotate" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(doc)}
                                                title="Delete"
                                                className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50"
                                            >
                                                <i className="fa-solid fa-trash" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* ── Test ──────────────────────────────────────────────── */}
                {view === 'test' && (
                    <div className="max-w-3xl">
                        <div className="bg-white rounded-xl border border-slate-200 p-5">
                            <p className="text-sm text-slate-600 mb-3">
                                Ask a question the way a customer would. This shows exactly which parts of
                                your documents the AI would find — and what it would be given to answer with.
                            </p>
                            <form onSubmit={runTest} className="flex gap-2">
                                <input
                                    type="text"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="e.g. What is the price of a Creta SX?"
                                    maxLength={1000}
                                    className="flex-1 px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#008069]/30"
                                />
                                <button
                                    type="submit"
                                    disabled={testing || !query.trim()}
                                    className="px-5 py-2.5 rounded-lg bg-[#008069] text-white font-semibold text-sm hover:bg-[#006e5a] disabled:opacity-50"
                                >
                                    {testing ? 'Searching…' : 'Search'}
                                </button>
                            </form>
                        </div>

                        {testResult && (
                            <div className="mt-5">
                                {!testResult.results.length ? (
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800">
                                        <p className="font-semibold">Nothing matched this question.</p>
                                        <p className="mt-1">
                                            The AI would tell the customer it needs to check with your team, rather than
                                            guessing. If you expected a match, the wording in your document may be quite
                                            different from the question — or the document may be disabled or still indexing.
                                        </p>
                                    </div>
                                ) : (
                                    <>
                                        <p className="text-sm font-semibold text-slate-700 mb-3">
                                            {testResult.results.length} matching section{testResult.results.length > 1 ? 's' : ''}
                                        </p>
                                        <div className="space-y-2">
                                            {testResult.results.map((r, i) => (
                                                <div key={i} className="bg-white rounded-xl border border-slate-200 p-4">
                                                    <div className="flex items-center justify-between gap-3 mb-2">
                                                        <span className="text-xs font-semibold text-slate-500">
                                                            {r.metadata?.source}
                                                            {r.metadata?.sheet && ` · sheet ${r.metadata.sheet}`}
                                                            {r.metadata?.row && ` · row ${r.metadata.row}`}
                                                            {r.metadata?.page && ` · page ${r.metadata.page}`}
                                                        </span>
                                                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                                            r.score > 0.7 ? 'bg-emerald-50 text-emerald-700'
                                                            : r.score > 0.5 ? 'bg-blue-50 text-blue-700'
                                                            : 'bg-slate-100 text-slate-600'
                                                        }`}>
                                                            {Math.round(r.score * 100)}% match
                                                        </span>
                                                    </div>
                                                    <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{r.content}</p>
                                                </div>
                                            ))}
                                        </div>

                                        <details className="mt-4 bg-slate-900 rounded-xl overflow-hidden">
                                            <summary className="px-4 py-3 text-sm font-semibold text-slate-200 cursor-pointer select-none">
                                                What the AI actually receives
                                            </summary>
                                            <pre className="px-4 pb-4 text-xs text-slate-300 whitespace-pre-wrap break-words overflow-x-auto">
                                                {testResult.promptPreview}
                                            </pre>
                                        </details>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Templates ─────────────────────────────────────────── */}
                {view === 'samples' && (
                    <div className="max-w-3xl">
                        <p className="text-sm text-slate-600 mb-4">
                            Start from one of these, replace the rows with your own, and upload it.
                            Keep the first row as column headings — that is what lets the AI tell a
                            price from a model name.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {SAMPLES.map(sample => (
                                <button
                                    key={sample.id}
                                    onClick={() => downloadSample(sample)}
                                    className="bg-white rounded-xl border border-slate-200 p-4 text-left hover:border-[#008069] hover:shadow-sm transition-all flex items-center gap-4"
                                >
                                    <div className="w-11 h-11 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                                        <i className={`fa-solid ${sample.icon} text-[#008069]`} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-slate-800 text-sm">{sample.name}</p>
                                        <p className="text-xs text-slate-500 truncate">{sample.file}</p>
                                    </div>
                                    <i className="fa-solid fa-download text-slate-300 ml-auto" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
