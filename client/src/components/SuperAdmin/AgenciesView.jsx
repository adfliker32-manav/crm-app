/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import { usePrompt } from '../../context/PromptContext';
import EditCompanyModal from './EditCompanyModal';
import CreateCompanyModal from './CreateCompanyModal';
import ChangePasswordModal from './ChangePasswordModal';
import ViewAgencyClientsModal from './ViewAgencyClientsModal';
import ManageAgencyLimitsModal from './ManageAgencyLimitsModal';
import ManageAgencyModal from './ManageAgencyModal';
import ManagePermissionsModal from './ManagePermissionsModal';
import PermissionManagerModal from './PermissionManagerModal';
import AiLedgerModal from './AiLedgerModal';

const AgenciesView = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const { showPrompt } = usePrompt();
    const fmt = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
    const [companies, setCompanies] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [selectedCompany, setSelectedCompany] = useState(null);

    // Modal states
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
    const [isViewClientsModalOpen, setIsViewClientsModalOpen] = useState(false);
    const [isManageLimitsModalOpen, setIsManageLimitsModalOpen] = useState(false);
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [isManagePermissionsModalOpen, setIsManagePermissionsModalOpen] = useState(false);
    const [isModulePermsModalOpen, setIsModulePermsModalOpen] = useState(false);
    const [isAiLedgerModalOpen, setIsAiLedgerModalOpen] = useState(false);

    useEffect(() => {
        fetchCompanies();
    }, []);

    const agencies = useMemo(() => {
        return companies.filter(company => company.role === 'agency');
    }, [companies]);

    const filteredAgencies = useMemo(() => {
        const lowerSearch = searchTerm.toLowerCase();
        return agencies.filter(company =>
            company.companyName?.toLowerCase().includes(lowerSearch) ||
            company.email?.toLowerCase().includes(lowerSearch) ||
            company.contactPerson?.toLowerCase().includes(lowerSearch)
        );
    }, [searchTerm, agencies]);

    const stats = useMemo(() => {
        const total = agencies.length;
        const suspended = agencies.filter(c => c.isSuspended).length;
        const frozen = agencies.filter(c => c.isFrozen && !c.isSuspended).length;
        const active = total - suspended - frozen;
        return { total, active, frozen, suspended, restricted: frozen + suspended };
    }, [agencies]);

    const fetchCompanies = async () => {
        setLoading(true);
        try {
            const res = await api.get('/superadmin/companies');
            const companiesData = res.data.companies || res.data;
            setCompanies(companiesData);
        } catch (error) {
            console.error('Error fetching companies:', error);
            showError('Failed to load companies');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteCompany = async (companyId) => {
        const confirmed = await showDanger(
            'This will permanently delete the AGENCY along with EVERY sub-client account it owns, all their agents, and ALL associated data (leads, templates, settings, integrations). This cascade is irreversible.',
            'Delete Agency + All Sub-Clients?'
        );

        if (!confirmed) return;

        try {
            const res = await api.delete(`/superadmin/companies/${companyId}`);
            showSuccess(res.data?.message || 'Agency and sub-clients deleted successfully');
            fetchCompanies();
            setIsManageModalOpen(false);
        } catch (error) {
            console.error('Error deleting company:', error);
            showError(error.response?.data?.message || 'Failed to delete company');
        }
    };

    const handleImpersonate = async (company) => {
        const confirmed = await showDanger(
            `You are about to login as "${company.companyName}". You will be logged out of Super Admin.`,
            'Login as User?'
        );

        if (!confirmed) return;

        try {
            const res = await api.post('/superadmin/impersonate', { userId: company._id });
            const { token, user } = res.data;

            localStorage.removeItem('token');
            localStorage.removeItem('user');
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));

            showSuccess(`Logged in as ${user.name}`);
            setTimeout(() => { window.location.href = '/'; }, 1000);

        } catch (error) {
            console.error('Impersonation failed:', error);
            showError(error.response?.data?.message || 'Failed to login as user');
        }
    };

    const handleFreezeCompany = async (company) => {
        // "Needs resume" = frozen OR deactivated (is_active === false). Resume restores both.
        const needsResume = company.isFrozen || company.is_active === false;
        const action = needsResume ? 'resume' : 'freeze';
        const confirmed = await showDanger(
            `Are you sure you want to ${action} this company and all its agents? ${action === 'freeze' ? 'They will instantly lose access to the platform.' : 'They will regain access immediately.'}`,
            `${action === 'freeze' ? 'Freeze' : 'Resume'} Company?`
        );

        if (!confirmed) return;

        try {
            // isFrozen=false on Resume triggers backend to also flip is_active back to true.
            await api.put(`/superadmin/companies/${company._id}/freeze`, { isFrozen: !needsResume });
            showSuccess(`Company ${action}d successfully`);
            fetchCompanies();
        } catch (error) {
            console.error(`Error ${action}ing company:`, error);
            showError(error.response?.data?.message || `Failed to ${action} company`);
        }
    };

    // Modal Triggers
    const openManageModal = (company) => {
        setSelectedCompany(company);
        setIsManageModalOpen(true);
    };

    const handleAddAiCredits = async (company) => {
        const amountStr = await showPrompt('Top Up AI Credits', 'Enter the amount of AI Credits to add:');
        if (!amountStr) return;
        
        const amount = parseInt(amountStr, 10);
        if (isNaN(amount) || amount <= 0) {
            showError('Please enter a valid positive number');
            return;
        }

        try {
            const res = await api.post(`/superadmin/accounts/${company._id}/add-ai-credits`, { amount });
            showSuccess(`Added ${amount} credits. New balance: ${res.data.aiCreditsBalance}`);
            fetchCompanies();
        } catch (error) {
            console.error('Error adding credits:', error);
            showError(error.response?.data?.message || 'Failed to add AI credits');
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
                <p className="text-slate-400 font-medium">Synchronizing resale network...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in-up pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Agency Partners</h1>
                    <p className="text-slate-500 font-medium text-lg mt-1">Manage and provision your global reseller network.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 active:scale-95"
                    >
                        <i className="fa-solid fa-plus"></i>
                        Register New Agency
                    </button>
                    <button
                        onClick={fetchCompanies}
                        className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 p-3 rounded-2xl transition shadow-sm active:scale-95"
                    >
                        <i className={`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>
            </div>

            {/* Stats Row - Matching Dashboard Style */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                    title="Resale Partners" 
                    value={stats.total} 
                    icon="fa-building" 
                    gradient="from-purple-500 to-purple-600" 
                    iconBg="bg-purple-100 text-purple-600"
                />
                <StatCard 
                    title="Active Network" 
                    value={stats.active} 
                    icon="fa-check-double" 
                    gradient="from-emerald-500 to-emerald-600" 
                    iconBg="bg-emerald-100 text-emerald-600"
                />
                <StatCard
                    title={stats.suspended > 0 ? "Restricted (Frozen + Suspended)" : "Frozen Accounts"}
                    value={stats.restricted}
                    icon={stats.suspended > 0 ? "fa-ban" : "fa-snowflake"}
                    gradient={stats.suspended > 0 ? "from-red-500 to-red-600" : "from-blue-500 to-blue-600"}
                    iconBg={stats.suspended > 0 ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}
                />
            </div>

            {/* Unified Table Container */}
            <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50/30">
                    <div className="relative w-full md:w-96">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input
                            type="text"
                            placeholder="Find agency by name or email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-medium"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50">
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Agency</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Primary Contact</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Network &amp; Earnings</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Wallet Balance</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Account status</th>
                                <th className="px-8 py-5 text-right text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Control</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredAgencies.length > 0 ? (
                                filteredAgencies.map((company) => (
                                    <tr key={company._id} className="group hover:bg-slate-50/80 transition-all duration-300">
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-md ${
                                                    company.isFrozen ? 'bg-slate-400' : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                                                }`}>
                                                    {company.companyName?.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-slate-900 leading-tight">{company.companyName}</p>
                                                    <p className="text-slate-400 text-xs mt-0.5">{company.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <p className="font-semibold text-slate-700 text-sm">{company.contactPerson || company.email}</p>
                                            <p className="text-slate-400 text-xs mt-0.5">{company.phone || 'No Phone'}</p>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex flex-col gap-1.5">
                                                <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 text-[10px] font-black rounded-lg border border-indigo-100 inline-flex items-center gap-1.5 w-fit">
                                                    <i className="fa-solid fa-users text-[9px]" />
                                                    {company.registeredClients || 0} SUB-CLIENTS
                                                </span>
                                                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-black rounded-lg border border-emerald-100 inline-flex items-center gap-1.5 w-fit">
                                                    <i className="fa-solid fa-coins text-[9px]" />
                                                    {fmt(company.totalCommissionEarned || 0)} EARNED
                                                </span>
                                                <span className={`px-2.5 py-1 text-[10px] font-black rounded-lg border inline-flex items-center gap-1.5 w-fit ${
                                                    (company.aiCreditsBalance || 0) <= 0
                                                        ? 'bg-rose-50 text-rose-600 border-rose-100'
                                                        : 'bg-indigo-50 text-indigo-700 border-indigo-100'
                                                }`}>
                                                    <i className="fa-solid fa-robot text-[9px]" />
                                                    {(company.aiCreditsBalance || 0).toLocaleString()} AI CREDITS
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-100/50">
                                                    <i className="fa-solid fa-wallet text-xs"></i>
                                                </div>
                                                <span className="font-bold text-slate-700">{fmt(company.commissionBalance || 0)}</span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            {company.isSuspended ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-red-700 text-[10px] font-black uppercase rounded-full border border-red-200">
                                                    <i className="fa-solid fa-ban"></i> Suspended
                                                </span>
                                            ) : company.isFrozen ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-600 text-[10px] font-black uppercase rounded-full border border-blue-100">
                                                    <i className="fa-solid fa-snowflake"></i> Frozen
                                                </span>
                                            ) : company.is_active === false ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 text-amber-700 text-[10px] font-black uppercase rounded-full border border-amber-200">
                                                    <i className="fa-solid fa-power-off"></i> Deactivated
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase rounded-full border border-emerald-100">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Operational
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-8 py-6 text-right">
                                            <button
                                                onClick={() => openManageModal(company)}
                                                className="bg-white hover:bg-slate-900 hover:text-white text-slate-900 border border-slate-200 px-5 py-2.5 rounded-xl font-black text-xs tracking-widest uppercase transition-all shadow-sm active:scale-95 flex items-center gap-2 ml-auto"
                                            >
                                                <i className="fa-solid fa-sliders-h text-[10px]"></i>
                                                Manage
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6" className="px-8 py-20 text-center text-slate-400 italic">No agencies found matching your search.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Centralized Control Window */}
            <ManageAgencyModal 
                isOpen={isManageModalOpen} 
                onClose={() => setIsManageModalOpen(false)} 
                company={selectedCompany} 
                actions={[
                    { label: 'Login as Affiliate', icon: 'fa-right-to-bracket', onClick: () => handleImpersonate(selectedCompany) },
                    { label: 'Sub-Clients', icon: 'fa-users-rectangle', onClick: () => { setSelectedCompany(selectedCompany); setIsViewClientsModalOpen(true); } },
                    { label: 'Manage Permission Overrides', icon: 'fa-lock', onClick: () => { setSelectedCompany(selectedCompany); setIsManagePermissionsModalOpen(true); } },
                    { label: 'Module Permissions', icon: 'fa-sitemap', onClick: () => { setSelectedCompany(selectedCompany); setIsModulePermsModalOpen(true); } },
                    { label: 'Add AI Credits', icon: 'fa-coins', onClick: () => handleAddAiCredits(selectedCompany) },
                    { label: 'View AI Ledger', icon: 'fa-receipt', onClick: () => { setSelectedCompany(selectedCompany); setIsAiLedgerModalOpen(true); } },
                    { label: 'Reseller Limits & Controls', icon: 'fa-shield-halved', onClick: () => { setSelectedCompany(selectedCompany); setIsManageLimitsModalOpen(true); } },
                    { label: 'Change Password', icon: 'fa-key', onClick: () => { setSelectedCompany(selectedCompany); setIsChangePasswordModalOpen(true); } },
                    { label: 'Edit Profile', icon: 'fa-edit', onClick: () => { setSelectedCompany(selectedCompany); setIsEditModalOpen(true); } },
                    {
                        label: (selectedCompany?.isFrozen || selectedCompany?.is_active === false) ? 'Resume Account' : 'Freeze Account',
                        icon: (selectedCompany?.isFrozen || selectedCompany?.is_active === false) ? 'fa-fire-flame-curved' : 'fa-snowflake',
                        onClick: () => handleFreezeCompany(selectedCompany),
                        variant: (selectedCompany?.isFrozen || selectedCompany?.is_active === false) ? 'default' : 'danger'
                    },
                    { label: 'Delete Company', icon: 'fa-trash', onClick: () => handleDeleteCompany(selectedCompany._id), variant: 'danger' }
                ]}
            />

            <AiLedgerModal isOpen={isAiLedgerModalOpen} onClose={() => setIsAiLedgerModalOpen(false)} company={selectedCompany} />

            {/* Original Modals for logic - Hidden, triggered from Management Window */}
            <CreateCompanyModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} onSuccess={fetchCompanies} />
            <EditCompanyModal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} company={selectedCompany} onSuccess={fetchCompanies} isAgency={true} />
            <ChangePasswordModal isOpen={isChangePasswordModalOpen} onClose={() => setIsChangePasswordModalOpen(false)} company={selectedCompany} />
            <ViewAgencyClientsModal isOpen={isViewClientsModalOpen} onClose={() => setIsViewClientsModalOpen(false)} agency={selectedCompany} />
            <ManageAgencyLimitsModal isOpen={isManageLimitsModalOpen} onClose={() => setIsManageLimitsModalOpen(false)} agency={selectedCompany} onSuccess={fetchCompanies} />
            <ManagePermissionsModal isOpen={isManagePermissionsModalOpen} onClose={() => setIsManagePermissionsModalOpen(false)} company={selectedCompany} onSuccess={fetchCompanies} />
            <PermissionManagerModal isOpen={isModulePermsModalOpen} onClose={() => setIsModulePermsModalOpen(false)} company={selectedCompany} onSuccess={fetchCompanies} />
        </div>
    );
};

const StatCard = ({ title, value, icon, gradient, iconBg }) => (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm relative overflow-hidden group">
        <div className={`absolute -right-4 -top-4 p-4 opacity-[0.03] transform group-hover:scale-110 transition duration-500`}>
            <i className={`${icon} text-8xl text-slate-900`} />
        </div>
        <div className="flex items-center gap-3 mb-3 relative z-10">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
                <i className={`${icon} text-lg`} />
            </div>
            <p className="text-sm font-bold tracking-wider uppercase text-slate-500">{title}</p>
        </div>
        <h3 className={`text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r relative z-10 ${gradient}`}>{value}</h3>
    </div>
);

export default AgenciesView;
