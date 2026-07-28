import React, { useState, useMemo } from 'react';
import Papa from 'papaparse';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ExportCSVModal = ({ isOpen, onClose, leads = [], stages = [], userTags = [], selectedIds = null }) => {
    const { showError, showSuccess } = useNotification();
    const [selectedStage, setSelectedStage] = useState('All');
    const [selectedSource, setSelectedSource] = useState('All');
    const [selectedTag, setSelectedTag] = useState('All');
    const [exporting, setExporting] = useState(false);

    // Source options are just for the dropdown; the actual export data always
    // comes fresh from the server so it is owner-verified and audit-logged.
    const sources = useMemo(() => {
        const unique = [...new Set(leads.map(lead => lead.source || 'Manual'))];
        return ['All', ...unique];
    }, [leads]);

    const handleExport = async () => {
        if (exporting) return;
        setExporting(true);
        try {
            // Fetch through the audited, owner-only backend endpoint. The server
            // records who exported how many rows before returning any data.
            const res = await api.post('/leads/export', {
                stage: selectedStage,
                source: selectedSource,
                tag: selectedTag,
                // When exporting an explicitly selected subset, restrict to those IDs.
                ...(Array.isArray(selectedIds) && selectedIds.length > 0 ? { ids: selectedIds } : {})
            });

            const filtered = res.data?.leads || [];
            if (filtered.length === 0) {
                setExporting(false);
                return showError("No leads match these filters.");
            }

            const dataToExport = filtered.map(lead => ({
                Name: lead.name || '',
                Phone: lead.phone || '',
                Email: lead.email || '',
                Source: lead.source || 'Manual',
                Status: lead.status || 'New',
                Tags: lead.tags && lead.tags.length > 0 ? lead.tags.join(', ') : '',
                CreatedAt: new Date(lead.createdAt || lead.date).toLocaleString(),
                Notes: lead.notes?.length || 0,
                CustomFields: Object.keys(lead.customData || {}).length > 0 ? JSON.stringify(lead.customData) : ''
            }));

            const csv = Papa.unparse(dataToExport);
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Filtered_Leads_Export_${new Date().toISOString().split('T')[0]}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            showSuccess(`Exported ${filtered.length} leads successfully!`);
            onClose();
        } catch (err) {
            const status = err.response?.status;
            if (status === 403) {
                showError("Only the account owner can export leads.");
            } else if (status === 429) {
                showError("Too many exports in a short time. Please wait a few minutes and try again.");
            } else {
                showError(err.response?.data?.message || "Failed to export leads.");
            }
        } finally {
            setExporting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-[100] animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-green-600">
                            <i className="fa-solid fa-file-export text-xl"></i>
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Export Leads</h2>
                            <p className="text-sm text-slate-500">Filter before exporting to CSV</p>
                        </div>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Filter by Stage</label>
                        <select 
                            value={selectedStage} 
                            onChange={(e) => setSelectedStage(e.target.value)}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-green-500 transition"
                        >
                            <option value="All">All Stages</option>
                            {stages.map(stage => (
                                <option key={stage._id} value={stage.name}>{stage.name}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Filter by Source</label>
                        <select 
                            value={selectedSource} 
                            onChange={(e) => setSelectedSource(e.target.value)}
                            className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-green-500 transition"
                        >
                            {sources.map(source => (
                                <option key={source} value={source}>{source}</option>
                            ))}
                        </select>
                    </div>

                    {userTags && userTags.length > 0 && (
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Filter by Tag</label>
                            <select 
                                value={selectedTag} 
                                onChange={(e) => setSelectedTag(e.target.value)}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 outline-none focus:ring-2 focus:ring-green-500 transition"
                            >
                                <option value="All">All Tags</option>
                                {userTags.map(tag => (
                                    <option key={tag._id} value={tag.name}>{tag.name}</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button onClick={onClose} disabled={exporting} className="px-5 py-2.5 text-slate-600 font-semibold hover:bg-slate-200 bg-slate-100 rounded-xl transition disabled:opacity-60">
                        Cancel
                    </button>
                    <button onClick={handleExport} disabled={exporting} className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg shadow-green-600/30 flex items-center gap-2 transition disabled:opacity-70 disabled:cursor-wait">
                        {exporting ? (
                            <><i className="fa-solid fa-spinner fa-spin"></i> Exporting...</>
                        ) : (
                            <><i className="fa-solid fa-download"></i> Download CSV</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExportCSVModal;
