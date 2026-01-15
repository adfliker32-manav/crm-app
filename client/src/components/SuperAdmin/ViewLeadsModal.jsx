import React, { useState, useEffect } from 'react';
import api from '../../services/api';

const ViewLeadsModal = ({ isOpen, onClose, company }) => {
    const [leads, setLeads] = useState([]);
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const leadsPerPage = 10;

    useEffect(() => {
        if (isOpen && company) {
            fetchLeads();
        }
    }, [isOpen, company, currentPage]);

    const fetchLeads = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/superadmin/companies/${company._id}/leads`, {
                params: { page: currentPage, limit: leadsPerPage }
            });
            setLeads(res.data.leads || res.data);
            setTotalPages(res.data.totalPages || 1);
        } catch (error) {
            console.error('Error fetching leads:', error);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen || !company) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 animate-fade-in-up p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
                <div className="p-6 border-b border-slate-200">
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="text-xl font-bold text-slate-800">Company Leads</h3>
                            <p className="text-sm text-slate-500 mt-1">{company.companyName}</p>
                        </div>
                        <button onClick={onClose} className="text-slate-400 hover:text-red-500 transition">
                            <i className="fa-solid fa-times text-xl"></i>
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center h-64">
                            <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400"></i>
                        </div>
                    ) : leads.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50 border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Name</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Contact</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Stage</th>
                                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Created</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                    {leads.map((lead) => (
                                        <tr key={lead._id} className="hover:bg-slate-50 transition">
                                            <td className="px-4 py-3">
                                                <p className="font-medium text-slate-800">{lead.name}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="text-sm text-slate-600">{lead.phone || '-'}</p>
                                                <p className="text-xs text-slate-500">{lead.email || '-'}</p>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                                                    {lead.stage || lead.status || 'New'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <p className="text-sm text-slate-600">
                                                    {new Date(lead.createdAt || lead.date).toLocaleDateString()}
                                                </p>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="text-center py-12 text-slate-400">
                            <i className="fa-regular fa-folder-open text-5xl mb-3"></i>
                            <p>No leads found for this company</p>
                        </div>
                    )}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="p-4 border-t border-slate-200 flex items-center justify-between">
                        <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <i className="fa-solid fa-chevron-left mr-2"></i>
                            Previous
                        </button>
                        <span className="text-sm text-slate-600">
                            Page {currentPage} of {totalPages}
                        </span>
                        <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Next
                            <i className="fa-solid fa-chevron-right ml-2"></i>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ViewLeadsModal;
