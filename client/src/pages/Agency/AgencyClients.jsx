import React, { useState, useEffect } from 'react';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';
import api from '../../services/api';
import EditSubClientModal from '../../components/Agency/EditSubClientModal';
import CreateSubClientModal from '../../components/Agency/CreateSubClientModal';

// ✅ Status badge — no approval gate, accounts are live immediately
const getStatusBadge = (client) => {
    if (client.accountStatus === 'Suspended') return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 w-fit animate-pulse">
            <i className="fa-solid fa-ban" />Suspended
        </span>
    );
    if (client.accountStatus === 'Frozen') return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-blue-100 text-blue-700 border border-blue-200 flex items-center gap-1 w-fit">
            <i className="fa-solid fa-snowflake" />Frozen
        </span>
    );
    if (client.status === 'rejected') return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 w-fit">
            <i className="fa-solid fa-circle-xmark" />Rejected
        </span>
    );
    if (client.is_active) return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center gap-1 w-fit">
            <i className="fa-solid fa-circle-check" />Live
        </span>
    );
    return (
        <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase bg-slate-100 text-slate-600 border border-slate-200 flex items-center gap-1 w-fit">
            <i className="fa-solid fa-circle-pause" />Inactive
        </span>
    );
};

const AgencyClients = () => {
    const { showDanger } = useConfirm();
    const { user, loginWithToken } = useAuth();
    const { showSuccess, showError } = useNotification();

    const [clients, setClients] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');

    // Agency's own workspace config — used by Create modal to enforce module inheritance
    const [agencyWorkspace, setAgencyWorkspace] = useState({ activeModules: [], planFeatures: {}, agentLimit: 50 });

    // Create client modal
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    // Edit client modal
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState(null);

    useEffect(() => {
        fetchClients();
        fetchAgencyWorkspace();
    }, []);

    const fetchClients = async () => {
        try {
            const response = await api.get('/agency/clients');
            if (response.data?.success) setClients(response.data.clients);
        } catch (error) { console.error("Failed to load agency clients:", error); }
        finally { setIsLoading(false); }
    };

    const fetchAgencyWorkspace = async () => {
        try {
            const response = await api.get('/agency/analytics');
            if (response.data?.success && response.data.agencyWorkspace) {
                setAgencyWorkspace(response.data.agencyWorkspace);
            }
        } catch (error) { console.error('Failed to load agency workspace:', error); }
    };

    const handleImpersonate = async (clientId, companyName) => {
        const confirmed = await showDanger(
            `You are about to securely access ${companyName}'s CRM. This action is logged.`,
            "Impersonate Client"
        );
        if (confirmed) {
            try {
                const response = await api.get(`/agency/impersonate/${clientId}`);
                if (response.data?.success) loginWithToken(response.data.token, response.data.user);
            } catch (error) {
                showError("Impersonation failed: " + (error.response?.data?.message || error.message));
            }
        }
    };

    const handleToggleFreeze = async (clientId, companyName, currentAccountStatus) => {
        if (currentAccountStatus === 'Suspended') {
            showError("This account was suspended by Platform Administration. Contact support.");
            return;
        }
        const isFrozen = currentAccountStatus === 'Frozen';
        const action = isFrozen ? 'unfreeze' : 'freeze';
        const confirmed = await showDanger(
            `Are you sure you want to ${action} "${companyName}"? ${!isFrozen ? 'Their CRM will be locked immediately.' : 'They will regain full access.'}`,
            `${action.charAt(0).toUpperCase() + action.slice(1)} Client`
        );
        if (confirmed) {
            try {
                const response = await api.put(`/agency/clients/${clientId}/freeze`, { freeze: !isFrozen });
                if (response.data?.success) {
                    setClients(prev => prev.map(c =>
                        c._id === clientId ? { ...c, accountStatus: response.data.accountStatus } : c
                    ));
                    showSuccess(`Client ${action}d successfully.`);
                }
            } catch (error) { showError(error.response?.data?.message || "Failed to update client."); }
        }
    };

    const handleEditClient = (client) => {
        setSelectedClient(client);
        setIsEditModalOpen(true);
    };

    const filteredClients = clients.filter(c => {
        const matchSearch = !searchTerm ||
            c.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            c.email?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus =
            statusFilter === 'All' ||
            (statusFilter === 'Live'   && c.is_active) ||
            (statusFilter === 'Frozen' && c.accountStatus === 'Frozen');
        return matchSearch && matchStatus;
    });

    const stats = {
        total: clients.length,
        live:  clients.filter(c => c.is_active).length,
    };

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-7xl mx-auto pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 pb-6 border-b border-slate-200/60">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight">Client Hub</h1>
                    <p className="text-slate-500 font-medium mt-2">Create and manage client workspaces. Accounts go live immediately with a 14-day free trial.</p>
                </div>
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="mt-4 md:mt-0 px-6 py-2.5 rounded-xl font-bold shadow-lg transition-all transform active:scale-95 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20"
                >
                    <i className="fa-solid fa-user-plus" />
                    Create Client Account
                </button>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                {[
                    { label: 'Total Clients',  value: stats.total, icon: 'fa-buildings',    color: 'text-slate-700' },
                    { label: 'Live Accounts',  value: stats.live,  icon: 'fa-circle-check', color: 'text-emerald-600' },
                ].map(stat => (
                    <div key={stat.label} className="bg-white border border-slate-200 rounded-2xl p-4">
                        <div className={`text-2xl font-black ${stat.color}`}>{stat.value}</div>
                        <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                            <i className={`fa-solid ${stat.icon} ${stat.color} text-xs`} />
                            {stat.label}
                        </div>
                    </div>
                ))}
            </div>

            {/* Filters */}
            <div className="bg-white border border-slate-200/60 shadow-sm rounded-2xl p-4 mb-4 flex flex-wrap gap-4 items-center justify-between">
                <div className="relative w-full md:w-80">
                    <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" placeholder="Search companies or emails..."
                        value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-11 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                </div>
                <div className="flex gap-2">
                    {['All', 'Live', 'Frozen'].map(s => (
                        <button key={s} onClick={() => setStatusFilter(s)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${statusFilter === s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table */}
            <div className="bg-white border border-slate-200/60 shadow-xl rounded-3xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-white text-xs uppercase tracking-widest text-slate-400 border-b border-slate-100">
                                <th className="p-5 font-bold">Workspace</th>
                                <th className="p-5 font-bold">Account Owner</th>
                                <th className="p-5 font-bold">Created</th>
                                <th className="p-5 font-bold">Status</th>
                                <th className="p-5 font-bold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading ? (
                                Array(3).fill(0).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        {Array(5).fill(0).map((_, j) => (
                                            <td key={j} className="p-5"><div className="h-6 bg-slate-100 rounded-lg" /></td>
                                        ))}
                                    </tr>
                                ))
                            ) : filteredClients.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-20 text-center">
                                        <div className="flex flex-col items-center">
                                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-3 border border-slate-100">
                                                <i className="fa-solid fa-folder-open text-2xl text-slate-300" />
                                            </div>
                                            <p className="font-bold text-slate-700">{searchTerm ? 'No results found' : 'No clients yet'}</p>
                                            <p className="text-slate-400 text-sm mt-1">
                                                {searchTerm ? 'Try a different search term' : 'Create a client account to get started'}
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredClients.map(client => (
                                    <tr key={client._id} className={`hover:bg-blue-50/20 transition-colors group ${client.accountStatus === 'Frozen' ? 'opacity-60' : ''} ${client.accountStatus === 'Suspended' ? 'bg-red-50/30' : ''}`}>
                                        <td className="p-5">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex justify-center items-center font-bold text-sm shadow-md ${
                                                    client.accountStatus === 'Suspended' ? 'bg-gradient-to-br from-red-600 to-red-900 text-white' :
                                                    client.accountStatus === 'Frozen' ? 'bg-gradient-to-br from-blue-400 to-blue-700 text-white' :
                                                    client.is_active ? 'bg-gradient-to-br from-indigo-600 to-purple-700 text-white' :
                                                    'bg-gradient-to-br from-slate-400 to-slate-600 text-white'
                                                }`}>
                                                    {client.companyName.charAt(0)}
                                                </div>
                                                <div>
                                                    <span className="font-bold text-slate-900 block">{client.companyName}</span>
                                                    <span className="text-xs text-slate-400 font-medium">{client._id.substring(0, 8)}...</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-5">
                                            <span className="font-semibold text-slate-700 block">{client.name}</span>
                                            <span className="text-xs text-blue-600 font-medium">{client.email}</span>
                                        </td>
                                        <td className="p-5">
                                            <span className="text-sm text-slate-600">
                                                {new Date(client.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </span>
                                        </td>
                                        <td className="p-5">{getStatusBadge(client)}</td>
                                        <td className="p-5 text-right">
                                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {/* Edit — Always available if client exists */}
                                                <button onClick={() => handleEditClient(client)}
                                                    className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-blue-600 hover:bg-blue-50 outline-none flex items-center justify-center transition-all shadow-sm"
                                                    title="Account Settings">
                                                    <i className="fa-solid fa-edit text-xs" />
                                                </button>

                                                {/* Freeze — only for approved accounts */}
                                                {client.is_active && client.accountStatus !== 'Suspended' && (
                                                    <button onClick={() => handleToggleFreeze(client._id, client.companyName, client.accountStatus)}
                                                        className={`w-8 h-8 rounded-full border outline-none flex items-center justify-center transition-all shadow-sm ${
                                                            client.accountStatus === 'Frozen'
                                                                ? 'bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100'
                                                                : 'bg-white border-slate-200 text-slate-400 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-600'
                                                        }`} title={client.accountStatus === 'Frozen' ? 'Unfreeze' : 'Freeze'}>
                                                        <i className={`fa-solid ${client.accountStatus === 'Frozen' ? 'fa-fire-flame-simple' : 'fa-snowflake'} text-xs`} />
                                                    </button>
                                                )}

                                                {/* Impersonate — only for live accounts */}
                                                {client.is_active && (
                                                    <button onClick={() => handleImpersonate(client._id, client.companyName)}
                                                        className="w-8 h-8 rounded-full bg-white border border-slate-200 text-blue-600 hover:bg-blue-50 outline-none flex items-center justify-center transition-all shadow-sm"
                                                        title="Login As Client">
                                                        <i className="fa-solid fa-right-to-bracket text-xs" />
                                                    </button>
                                                )}

                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ============================================
                EDIT CLIENT MODAL (Role-based inheritance)
            ============================================ */}
            <EditSubClientModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                client={selectedClient}
                agencyModules={user?.activeModules || []}
                onSuccess={fetchClients}
            />

            {/* ============================================
                CREATE CLIENT MODAL
                ============================================ */}
            <CreateSubClientModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                agencyWorkspace={agencyWorkspace}
                onSuccess={fetchClients}
            />
        </div>
    );
};

export default AgencyClients;
