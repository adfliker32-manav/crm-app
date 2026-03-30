import React from 'react';

const ViewAgencyClientsModal = ({ isOpen, onClose, agency, allCompanies }) => {
    if (!isOpen || !agency) return null;

    // Filter from the previously fetched global companies list
    // where role is 'manager' and parentId matches the selected agency
    const agencyClients = allCompanies.filter(c => 
        c.role === 'manager' && c.parentId === agency._id
    );

    return (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-purple-500/10 to-transparent rounded-bl-full pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-1">
                            <i className="fa-solid fa-network-wired text-purple-600 text-xl"></i>
                            <h2 className="text-xl font-bold text-slate-800">
                                {agency.companyName}'s Sub-Clients
                            </h2>
                        </div>
                        <p className="text-sm text-slate-500">
                            Viewing all {agencyClients.length} sub-tenants managed by this reseller agency.
                        </p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 hover:bg-slate-200 w-10 h-10 rounded-full flex items-center justify-center transition"
                    >
                        <i className="fa-solid fa-times text-lg"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                    {agencyClients.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {agencyClients.map(client => (
                                <div key={client._id} className="bg-white border text-left border-slate-200 rounded-xl p-5 hover:shadow-md transition">
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <h4 className="font-bold text-slate-800 text-lg">{client.companyName}</h4>
                                            <p className="text-sm text-slate-500">{client.email}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {client.accountStatus === 'Suspended' ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-red-100 text-red-600">Suspended</span>
                                            ) : client.is_active ? (
                                                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-100 text-emerald-600">Live</span>
                                            ) : (
                                                <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-100 text-amber-600">Pending</span>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-xs block mb-1">Contact</span>
                                            <span className="font-medium text-slate-700">{client.contactPerson || '-'}</span>
                                        </div>
                                        <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                                            <span className="text-slate-500 text-xs block mb-1">Created Agent/Seats</span>
                                            <span className="font-medium text-slate-700">
                                                {client.agentsCount || 0} / {client.agentLimit || 5}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <div className="w-16 h-16 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i className="fa-solid fa-ghost text-2xl"></i>
                            </div>
                            <h3 className="text-lg font-bold text-slate-800">No Clients Found</h3>
                            <p className="text-slate-500 max-w-sm mx-auto mt-2">
                                This Agency has not provisioned any sub-tenants yet. Sub-tenants will appear here once they complete checkout.
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 bg-white">
                    <button
                        onClick={onClose}
                        className="w-full bg-slate-100 text-slate-700 font-medium py-3 rounded-xl hover:bg-slate-200 transition"
                    >
                        Close Window
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ViewAgencyClientsModal;
