import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const DuplicateLeadsModal = ({ isOpen, onClose, onSuccess }) => {
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isOpen) {
            fetchDuplicates();
        }
    }, [isOpen]);

    const fetchDuplicates = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await api.get('/leads/duplicates');
            setData(res.data);
        } catch (err) {
            setError('Failed to scan for duplicates');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleAutoDelete = async () => {
        if (!data || data.totalDuplicates === 0) return;
        setDeleting(true);
        try {
            const res = await api.post('/leads/duplicates/auto-delete');
            setData({ totalGroups: 0, totalDuplicates: 0, groups: [] });
            onSuccess?.();
            // Show brief success then close
            setError(null);
            alert(`✅ ${res.data.deletedCount} duplicate leads deleted!`);
            onClose();
        } catch (err) {
            setError('Failed to delete duplicates');
            console.error(err);
        } finally {
            setDeleting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-[680px] max-h-[85vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-gradient-to-r from-orange-500 to-red-500 px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
                            <i className="fa-solid fa-copy text-white text-lg"></i>
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-white">Duplicate Lead Scanner</h3>
                            <p className="text-white/70 text-xs">Find and remove duplicate leads automatically</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/70 hover:text-white transition-colors">
                        <i className="fa-solid fa-times text-xl"></i>
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin mb-4"></div>
                            <p className="text-slate-500 font-medium">Scanning for duplicates...</p>
                        </div>
                    ) : error ? (
                        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm">
                            <i className="fa-solid fa-exclamation-circle mr-2"></i>{error}
                        </div>
                    ) : data && data.totalDuplicates === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16">
                            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
                                <i className="fa-solid fa-check text-green-500 text-2xl"></i>
                            </div>
                            <h4 className="text-lg font-bold text-slate-700 mb-1">No Duplicates Found!</h4>
                            <p className="text-slate-400 text-sm">Your lead database is clean. No duplicate entries detected.</p>
                        </div>
                    ) : data ? (
                        <>
                            {/* Stats Bar */}
                            <div className="bg-gradient-to-r from-orange-50 to-red-50 border border-orange-200 rounded-xl p-4 mb-5 flex items-center justify-between">
                                <div className="flex items-center gap-6">
                                    <div>
                                        <p className="text-2xl font-black text-orange-600">{data.totalDuplicates}</p>
                                        <p className="text-xs text-slate-500 font-medium">Duplicates Found</p>
                                    </div>
                                    <div className="w-px h-10 bg-orange-200"></div>
                                    <div>
                                        <p className="text-2xl font-black text-slate-700">{data.totalGroups}</p>
                                        <p className="text-xs text-slate-500 font-medium">Groups</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleAutoDelete}
                                    disabled={deleting}
                                    className="bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-red-500/30 flex items-center gap-2"
                                >
                                    <i className={`fa-solid ${deleting ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
                                    {deleting ? 'Deleting...' : 'Auto-Delete All'}
                                </button>
                            </div>

                            {/* Duplicate Groups */}
                            <div className="space-y-4">
                                {data.groups.map((group, idx) => (
                                    <div key={group.groupId} className="border border-slate-200 rounded-xl overflow-hidden">
                                        {/* Group Header */}
                                        <div className="bg-slate-50 px-4 py-2.5 flex items-center justify-between border-b border-slate-200">
                                            <div className="flex items-center gap-2">
                                                <span className="bg-orange-100 text-orange-600 text-xs font-bold px-2 py-0.5 rounded-lg">
                                                    Group {idx + 1}
                                                </span>
                                                <span className="text-xs text-slate-400 font-medium">{group.matchReason}</span>
                                            </div>
                                            <span className="text-xs text-slate-400">{group.totalCount} leads</span>
                                        </div>

                                        {/* Keep Lead */}
                                        <div className="px-4 py-3 bg-green-50/50 flex items-center gap-3 border-b border-slate-100">
                                            <span className="bg-green-100 text-green-600 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Keep</span>
                                            <div className="flex-1 min-w-0">
                                                <span className="font-bold text-slate-700 text-sm">{group.keep.name}</span>
                                                <span className="text-slate-400 text-xs ml-3">{group.keep.phone}</span>
                                                {group.keep.email && <span className="text-slate-400 text-xs ml-2">• {group.keep.email}</span>}
                                            </div>
                                            <span className="text-[10px] text-slate-400">
                                                {new Date(group.keep.createdAt).toLocaleDateString()}
                                            </span>
                                        </div>

                                        {/* Duplicate Leads to Delete */}
                                        {group.duplicates.map((dup) => (
                                            <div key={dup._id} className="px-4 py-3 bg-red-50/30 flex items-center gap-3 border-b border-slate-50 last:border-0">
                                                <span className="bg-red-100 text-red-500 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">Delete</span>
                                                <div className="flex-1 min-w-0">
                                                    <span className="font-medium text-slate-600 text-sm">{dup.name}</span>
                                                    <span className="text-slate-400 text-xs ml-3">{dup.phone}</span>
                                                    {dup.email && <span className="text-slate-400 text-xs ml-2">• {dup.email}</span>}
                                                </div>
                                                <span className="text-[10px] text-slate-400">
                                                    {new Date(dup.createdAt).toLocaleDateString()}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                    <p className="text-xs text-slate-400">
                        <i className="fa-solid fa-info-circle mr-1"></i>
                        Auto-delete keeps the oldest lead and removes newer duplicates
                    </p>
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-100 transition"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DuplicateLeadsModal;
