import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import EditCompanyModal from './EditCompanyModal';
import CreateCompanyModal from './CreateCompanyModal';
import ViewLeadsModal from './ViewLeadsModal';
import ManageAgentsModal from './ManageAgentsModal';
import ChangePasswordModal from './ChangePasswordModal';
import ManageAgencyModal from './ManageAgencyModal';

const DirectClientsView = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [companies, setCompanies] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [selectedCompany, setSelectedCompany] = useState(null);

    // Modal states
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isViewLeadsModalOpen, setIsViewLeadsModalOpen] = useState(false);
    const [isManageAgentsModalOpen, setIsManageAgentsModalOpen] = useState(false);
    const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);

    useEffect(() => {
        fetchCompanies();
    }, []);

    const directClients = useMemo(() => {
        // Direct clients are managers who do not have a parentId (Agency association)
        return companies.filter(c => c.role === 'manager' && !c.parentId);
    }, [companies]);

    const filteredCompanies = useMemo(() => {
        const lowerSearch = searchTerm.toLowerCase();
        return directClients.filter(company =>
            company.companyName?.toLowerCase().includes(lowerSearch) ||
            company.email?.toLowerCase().includes(lowerSearch) ||
            company.contactPerson?.toLowerCase().includes(lowerSearch)
        );
    }, [searchTerm, directClients]);

    const stats = useMemo(() => {
        const total = directClients.length;
        const active = directClients.filter(c => !c.isFrozen).length;
        const frozen = total - active;
        return { total, active, frozen };
    }, [directClients]);

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
            'This will permanently delete the company and ALL associated data (leads, agents, templates, etc.). This action cannot be undone.',
            'Delete Company?'
        );

        if (!confirmed) return;

        try {
            await api.delete(`/superadmin/companies/${companyId}`);
            showSuccess('Company deleted successfully');
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
        const action = company.isFrozen ? 'unfreeze' : 'freeze';
        const confirmed = await showDanger(
            `Are you sure you want to ${action} this company and all its agents? ${action === 'freeze' ? 'They will instantly lose access to the platform.' : ''}`,
            `${action === 'freeze' ? 'Freeze' : 'Unfreeze'} Company?`
        );

        if (!confirmed) return;

        try {
            await api.put(`/superadmin/companies/${company._id}/freeze`, { isFrozen: !company.isFrozen });
            showSuccess(`Company ${action}d successfully`);
            fetchCompanies();
        } catch (error) {
            console.error(`Error ${action}ing company:`, error);
            showError(error.response?.data?.message || `Failed to ${action} company`);
        }
    };

    const openManageModal = (company) => {
        setSelectedCompany(company);
        setIsManageModalOpen(true);
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
                <div className="w-12 h-12 border-4 border-slate-200 border-t-purple-600 rounded-full animate-spin" />
                <p className="text-slate-400 font-medium">Loading direct merchants...</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in-up pb-20">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Direct Merchants</h1>
                    <p className="text-slate-500 font-medium text-lg mt-1">Manage standard accounts registered directly on platform.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-purple-500/20 flex items-center gap-2 active:scale-95"
                    >
                        <i className="fa-solid fa-plus"></i>
                        Register Merchant
                    </button>
                    <button
                        onClick={fetchCompanies}
                        className="bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 p-3 rounded-2xl transition shadow-sm active:scale-95"
                    >
                        <i className={`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`}></i>
                    </button>
                </div>
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard 
                    title="Total Merchants" 
                    value={stats.total} 
                    icon="fa-shop" 
                    gradient="from-purple-500 to-purple-600" 
                    iconBg="bg-purple-100 text-purple-600"
                />
                <StatCard 
                    title="Active Subscriptions" 
                    value={stats.active} 
                    icon="fa-user-check" 
                    gradient="from-indigo-500 to-indigo-600" 
                    iconBg="bg-indigo-100 text-indigo-600"
                />
                <StatCard 
                    title="Frozen / Risky" 
                    value={stats.frozen} 
                    icon="fa-snowflake" 
                    gradient="from-slate-700 to-slate-800" 
                    iconBg="bg-slate-100 text-slate-600"
                />
            </div>

            {/* Unified Table Container */}
            <div className="bg-white rounded-[2rem] shadow-xl shadow-slate-200/60 border border-slate-100 overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50/30">
                    <div className="relative w-full md:w-96">
                        <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                        <input
                            type="text"
                            placeholder="Find merchant by name or email..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-purple-500/10 focus:border-purple-500 transition-all font-medium"
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50">
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Merchant</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Contact</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Engagement</th>
                                <th className="px-8 py-5 text-left text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Status</th>
                                <th className="px-8 py-5 text-right text-[11px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Command</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {filteredCompanies.length > 0 ? (
                                filteredCompanies.map((company) => (
                                    <tr key={company._id} className="group hover:bg-slate-50/80 transition-all duration-300">
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-md ${
                                                    company.isFrozen ? 'bg-slate-400' : 'bg-gradient-to-br from-purple-500 to-purple-600'
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
                                            <p className="font-semibold text-slate-700 text-sm">{company.contactPerson || 'N/A'}</p>
                                            <p className="text-slate-400 text-xs mt-0.5">{company.phone || 'No Phone'}</p>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex gap-2">
                                                <span className="px-2 py-0.5 bg-purple-50 text-purple-700 text-[10px] font-black rounded-lg border border-purple-100">
                                                    {company.leadsCount || 0} LEADS
                                                </span>
                                                <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-black rounded-lg border border-indigo-100">
                                                    {company.agentsCount || 0} AGENTS
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            {company.isFrozen ? (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-600 text-[10px] font-black uppercase rounded-full border border-slate-200">
                                                    <i className="fa-solid fa-snowflake"></i> Frozen
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase rounded-full border border-emerald-100">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Active
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
                                    <td colSpan="5" className="px-8 py-20 text-center text-slate-400 italic">No merchants found matching your search.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Merchant Control Window */}
            <ManageAgencyModal 
                isOpen={isManageModalOpen} 
                onClose={() => setIsManageModalOpen(false)} 
                company={selectedCompany} 
                actions={[
                    { label: 'Login as Merchant', icon: 'fa-right-to-bracket', onClick: () => handleImpersonate(selectedCompany) },
                    { label: 'Leads Database', icon: 'fa-users', onClick: () => { setSelectedCompany(selectedCompany); setIsViewLeadsModalOpen(true); } },
                    { label: 'Manage Agents', icon: 'fa-user-tie', onClick: () => { setSelectedCompany(selectedCompany); setIsManageAgentsModalOpen(true); } },
                    { label: 'Change Password', icon: 'fa-key', onClick: () => { setSelectedCompany(selectedCompany); setIsChangePasswordModalOpen(true); } },
                    { label: 'Edit Profile', icon: 'fa-edit', onClick: () => { setSelectedCompany(selectedCompany); setIsEditModalOpen(true); } },
                    { 
                        label: selectedCompany?.isFrozen ? 'Resume Account' : 'Freeze Account', 
                        icon: selectedCompany?.isFrozen ? 'fa-fire-flame-curved' : 'fa-snowflake', 
                        onClick: () => handleFreezeCompany(selectedCompany),
                        variant: selectedCompany?.isFrozen ? 'default' : 'danger' 
                    },
                    { label: 'Delete Merchant', icon: 'fa-trash', onClick: () => handleDeleteCompany(selectedCompany._id), variant: 'danger' }
                ]}
            />

            {/* Utility Modals */}
            <CreateCompanyModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} onSuccess={fetchCompanies} />
            <EditCompanyModal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} company={selectedCompany} onSuccess={fetchCompanies} />
            <ViewLeadsModal isOpen={isViewLeadsModalOpen} onClose={() => setIsViewLeadsModalOpen(false)} company={selectedCompany} />
            <ManageAgentsModal isOpen={isManageAgentsModalOpen} onClose={() => setIsManageAgentsModalOpen(false)} company={selectedCompany} onSuccess={fetchCompanies} />
            <ChangePasswordModal isOpen={isChangePasswordModalOpen} onClose={() => setIsChangePasswordModalOpen(false)} company={selectedCompany} />
        </div>
    );
};

const StatCard = ({ title, value, icon, gradient, iconBg }) => (
    <div className={`bg-gradient-to-br ${gradient} p-8 rounded-[2rem] shadow-xl text-white group hover:-translate-y-1 transition-all duration-300`}>
        <div className="flex justify-between items-center">
            <div>
                <p className="text-white/70 text-xs font-black uppercase tracking-widest mb-1">{title}</p>
                <h3 className="text-4xl font-black tracking-tighter">{value.toLocaleString()}</h3>
            </div>
            <div className={`${iconBg} w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform group-hover:rotate-12`}>
                <i className={`fa-solid ${icon} text-2xl`}></i>
            </div>
        </div>
    </div>
);

export default DirectClientsView;
