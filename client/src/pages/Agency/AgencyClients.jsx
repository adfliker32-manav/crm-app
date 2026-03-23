import React, { useState, useEffect } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';

const AgencyClients = () => {
    const { showDanger } = useConfirm();
    const { user, loginWithToken } = useAuth();
    
    const [clients, setClients] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isProvisioning, setIsProvisioning] = useState(false);

    // Mock Form State
    const [formData, setFormData] = useState({
        companyName: '',
        adminName: '',
        adminEmail: '',
        planTier: 'Trial'
    });

    useEffect(() => {
        // Mock API Fetch
        setTimeout(() => {
            setClients([
                { _id: 'c1', companyName: 'Nexus Innovations', name: 'Alice Smith', email: 'alice@nexus.io', status: 'Active', plan: 'Premium', users: 3, createdAt: '2026-03-10T10:00:00Z', mrr: 199 },
                { _id: 'c2', companyName: 'Starlight Retails', name: 'Bob Jones', email: 'bob@starlight.com', status: 'Trial', plan: 'Free', users: 1, createdAt: '2026-03-21T14:30:00Z', mrr: 0 },
                { _id: 'c3', companyName: 'Apex Financial', name: 'Charlie Davis', email: 'charlie@apex.fin', status: 'Suspended', plan: 'Basic', users: 5, createdAt: '2026-01-15T09:15:00Z', mrr: 49 },
            ]);
            setIsLoading(false);
        }, 800);
    }, []);

    const getStatusColor = (status) => {
        switch (status) {
            case 'Active': return 'bg-emerald-100 text-emerald-700 border-emerald-200';
            case 'Trial': return 'bg-blue-100 text-blue-700 border-blue-200';
            case 'Suspended': return 'bg-rose-100 text-rose-700 border-rose-200';
            default: return 'bg-slate-100 text-slate-700 border-slate-200';
        }
    };

    const handleImpersonate = async (clientId, companyName) => {
        const confirmed = await showDanger(
            `You are about to securely hijack the session for ${companyName}. You will have full access to their CRM. Continue?`, 
            "Impersonate Client Support"
        );
        if (confirmed) {
            try {
                const response = await api.get(`/agency/impersonate/${clientId}`);
                if (response.data?.success) {
                    loginWithToken(response.data.token, response.data.user);
                }
            } catch (error) {
                console.error(error);
                alert("Impersonation Handshake Failed: " + (error.response?.data?.message || error.message));
            }
        }
    };

    const handleProvisionClient = async () => {
        if (!formData.companyName || !formData.adminEmail) {
            return alert("Company Name and Admin Email are required.");
        }

        try {
            setIsProvisioning(true);
            const response = await api.post('/billing/checkout', formData);
            if (response.data?.success && response.data?.hostedUrl) {
                // Redirect Agency to Cashfree Gateway to complete payment
                window.location.href = response.data.hostedUrl;
            } else {
                alert("Failed to initialize billing session. Check API.");
                setIsProvisioning(false);
            }
        } catch(error) {
            console.error(error);
            alert("Error connecting to localized payment gateway.");
            setIsProvisioning(false);
        }
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-7xl mx-auto pb-20">
            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 pb-6 border-b border-slate-200/60">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight">Client Hub</h1>
                    <p className="text-slate-500 font-medium mt-2 text-lg">Provision and govern sub-tenant environments under your agency.</p>
                </div>
                <div className="mt-4 md:mt-0 flex gap-3">
                    <button className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold shadow-sm hover:bg-slate-50 transition-all flex items-center gap-2">
                        <i className="fa-solid fa-cloud-arrow-down"></i> Export
                    </button>
                    <button 
                        onClick={() => setIsCreateModalOpen(true)}
                        className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-lg shadow-blue-600/20 transition-all transform active:scale-95 flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus-circle"></i> Provision Client
                    </button>
                </div>
            </div>

            {/* Main DataGrid */}
            <div className="bg-white border border-slate-200/60 shadow-xl shadow-slate-200/20 rounded-3xl overflow-hidden relative">
                
                {/* Toolbar */}
                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-wrap gap-4 items-center justify-between">
                    <div className="relative w-full md:w-96">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input 
                            type="text" 
                            placeholder="Search companies, domains, or emails..."
                            className="w-full pl-11 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <select className="bg-white border border-slate-200 text-slate-600 text-sm font-semibold py-2.5 px-4 rounded-xl shadow-sm outline-none focus:ring-2 focus:ring-slate-100 cursor-pointer">
                            <option>All Statuses</option>
                            <option>Active</option>
                            <option>Trial</option>
                            <option>Suspended</option>
                        </select>
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white text-xs uppercase tracking-widest text-slate-400 border-b border-slate-100">
                                <th className="p-5 font-bold">Workspace</th>
                                <th className="p-5 font-bold">Account Owner</th>
                                <th className="p-5 font-bold">Status</th>
                                <th className="p-5 font-bold">Plan Details</th>
                                <th className="p-5 font-bold">Seats</th>
                                <th className="p-5 font-bold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading ? (
                                Array(3).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td className="p-5"><div className="h-10 bg-slate-100 rounded-lg w-48"></div></td>
                                        <td className="p-5"><div className="h-5 bg-slate-100 rounded w-32"></div></td>
                                        <td className="p-5"><div className="h-6 bg-slate-100 rounded-full w-20"></div></td>
                                        <td className="p-5"><div className="h-5 bg-slate-100 rounded w-24"></div></td>
                                        <td className="p-5"><div className="h-8 bg-slate-100 rounded-lg w-12"></div></td>
                                        <td className="p-5 text-right"><div className="h-8 bg-slate-100 rounded-full w-8 inline-block"></div></td>
                                    </tr>
                                ))
                            ) : (
                                clients.map((client) => (
                                    <tr key={client._id} className="hover:bg-blue-50/30 transition-colors group">
                                        <td className="p-5">
                                            <div className="flex items-center gap-4">
                                                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-800 to-black text-white flex justify-center items-center font-bold text-sm shadow-md">
                                                    {client.companyName.charAt(0)}
                                                </div>
                                                <div>
                                                    <span className="font-bold text-slate-900 block">{client.companyName}</span>
                                                    <span className="text-xs text-slate-400 font-medium">ID: {client._id.substring(0, 8)}...</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            <span className="font-semibold text-slate-700 block">{client.name}</span>
                                            <span className="text-xs text-blue-600 font-medium">{client.email}</span>
                                        </td>
                                        <td className="p-5">
                                            <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${getStatusColor(client.status)}`}>
                                                {client.status}
                                            </span>
                                        </td>
                                        <td className="p-5">
                                            <span className="font-bold text-slate-800 block">{client.plan}</span>
                                            <span className="text-xs text-slate-500 font-medium">${client.mrr}/mo</span>
                                        </td>
                                        <td className="p-5">
                                            <div className="inline-flex items-center gap-2 bg-slate-100 px-3 py-1 rounded-lg">
                                                <i className="fa-solid fa-users text-slate-400 text-xs"></i>
                                                <span className="text-slate-700 font-bold text-sm">{client.users}</span>
                                            </div>
                                        </td>
                                        <td className="p-5 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button 
                                                    onClick={() => handleImpersonate(client._id, client.companyName)}
                                                    className="w-8 h-8 rounded-full bg-white border border-slate-200 text-blue-600 hover:bg-blue-50 hover:border-blue-200 outline-none flex items-center justify-center transition-all shadow-sm"
                                                    title="Login As Client"
                                                >
                                                    <i className="fa-solid fa-right-to-bracket text-xs"></i>
                                                </button>
                                                <button className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 outline-none flex items-center justify-center transition-all shadow-sm">
                                                    <i className="fa-solid fa-ellipsis-vertical text-xs"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                
                {clients.length === 0 && !isLoading && (
                    <div className="p-20 text-center flex flex-col items-center">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                            <i className="fa-solid fa-folder-open text-3xl text-slate-300"></i>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800 mb-1">No clients found</h3>
                        <p className="text-slate-500 max-w-sm mb-6">You haven't provisioned any sub-tenants under your agency bucket yet.</p>
                        <button onClick={() => setIsCreateModalOpen(true)} className="text-blue-600 font-bold hover:underline">
                            Provision First Client →
                        </button>
                    </div>
                )}
            </div>

            {/* Create Client Modal */}
            {isCreateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsCreateModalOpen(false)}></div>
                    <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                            <div>
                                <h2 className="text-xl font-black text-slate-900">Provision New Sub-Tenant</h2>
                                <p className="text-xs text-slate-500 font-semibold mt-1 tracking-wider uppercase">Creates an isolated Reseller Client workspace</p>
                            </div>
                            <button onClick={() => setIsCreateModalOpen(false)} className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors">
                                <i className="fa-solid fa-times"></i>
                            </button>
                        </div>
                        
                        <div className="p-6 space-y-5">
                            <div className="grid grid-cols-2 gap-5">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Company Name</label>
                                    <input type="text" value={formData.companyName} onChange={e => setFormData({...formData, companyName: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-900" placeholder="e.g. Acme Corp" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Admin Name</label>
                                    <input type="text" value={formData.adminName} onChange={e => setFormData({...formData, adminName: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-900" placeholder="John Doe" />
                                </div>
                            </div>
                            
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Admin Email (Login ID)</label>
                                <input type="email" value={formData.adminEmail} onChange={e => setFormData({...formData, adminEmail: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-900" placeholder="admin@acme.com" />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Initial Plan Tier</label>
                                <select value={formData.planTier} onChange={e => setFormData({...formData, planTier: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-bold text-slate-900 cursor-pointer appearance-none">
                                    <option value="Trial">14-Day Free Trial</option>
                                    <option value="Basic">Basic ($49/mo)</option>
                                    <option value="Premium">Premium ($199/mo)</option>
                                </select>
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button onClick={() => setIsCreateModalOpen(false)} disabled={isProvisioning} className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50">
                                Cancel
                            </button>
                            <button onClick={handleProvisionClient} disabled={isProvisioning} className="px-6 py-2.5 bg-black flex items-center gap-2 hover:bg-slate-800 text-white rounded-xl font-bold transition-transform active:scale-95 shadow-lg shadow-black/10 disabled:opacity-75 disabled:active:scale-100">
                                {isProvisioning ? <><i className="fa-solid fa-spinner fa-spin"></i> Initializing Checkout...</> : "Proceed to Payment"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgencyClients;
