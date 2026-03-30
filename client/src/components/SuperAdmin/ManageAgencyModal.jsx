import React from 'react';

const ManageAgencyModal = ({ isOpen, onClose, company, actions }) => {
    if (!isOpen || !company) return null;

    // Filter out dividers for the grid
    const gridActions = actions.filter(action => !action.divider);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="bg-white w-full max-w-2xl rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-300">
                {/* Header Section */}
                <div className="p-8 bg-gradient-to-r from-slate-900 to-slate-800 text-white relative">
                    <button 
                        onClick={onClose}
                        className="absolute right-6 top-6 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-all active:scale-95"
                    >
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                    
                    <div className="flex items-center gap-6">
                        <div className="w-20 h-20 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-3xl flex items-center justify-center text-3xl font-black shadow-xl shadow-purple-500/20">
                            {company.companyName?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <p className="text-purple-400 font-bold uppercase tracking-widest text-[10px]">
                                {company.role === 'agency' ? 'Agency' : 'Merchant'} Control Center
                            </p>
                            <h2 className="text-3xl font-black tracking-tight mt-1">{company.companyName}</h2>
                            <p className="text-slate-400 font-medium">{company.email}</p>
                        </div>
                    </div>
                </div>

                {/* Body - Action Grid */}
                <div className="p-8 bg-slate-50/30">
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {gridActions.map((action, index) => (
                            <button
                                key={index}
                                onClick={() => {
                                    action.onClick();
                                    if (action.label !== 'Delete Company') onClose();
                                }}
                                className={`group p-6 rounded-[1.5rem] bg-white border border-slate-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 text-left flex flex-col gap-4 active:scale-95 ${
                                    action.variant === 'danger' ? 'border-red-50 hover:border-red-200' : 'hover:border-purple-200'
                                }`}
                            >
                                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors shadow-sm ${
                                    action.variant === 'danger' 
                                    ? 'bg-red-50 text-red-600 group-hover:bg-red-600 group-hover:text-white' 
                                    : 'bg-slate-50 text-slate-500 group-hover:bg-purple-600 group-hover:text-white'
                                }`}>
                                    <i className={`fa-solid ${action.icon} text-lg`}></i>
                                </div>
                                <div>
                                    <p className={`font-black text-sm tracking-tight ${
                                        action.variant === 'danger' ? 'text-red-600' : 'text-slate-900'
                                    }`}>
                                        {action.label}
                                    </p>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                        Click to execute
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Footer Info */}
                <div className="px-8 py-5 border-t border-slate-50 flex justify-between items-center bg-white text-slate-400">
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                        <i className="fa-solid fa-clock"></i>
                        Joined {new Date(company.createdAt).toLocaleDateString()}
                    </div>
                    <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                        company.isFrozen ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100'
                    }`}>
                        {company.isFrozen ? 'Frozen' : (company.role === 'agency' ? 'Active Partner' : 'Active Merchant')}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageAgencyModal;
