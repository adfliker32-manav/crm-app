import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';
import EditCompanyModal from './EditCompanyModal';
import CreateCompanyModal from './CreateCompanyModal';
import ViewLeadsModal from './ViewLeadsModal';
import ManageAgentsModal from './ManageAgentsModal';
import ChangePasswordModal from './ChangePasswordModal';

const CompaniesView = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [companies, setCompanies] = useState([]);
    const [filteredCompanies, setFilteredCompanies] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [selectedCompany, setSelectedCompany] = useState(null);

    // Modal states
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isViewLeadsModalOpen, setIsViewLeadsModalOpen] = useState(false);
    const [isManageAgentsModalOpen, setIsManageAgentsModalOpen] = useState(false);
    const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

    useEffect(() => {
        fetchCompanies();
    }, []);

    useEffect(() => {
        const filtered = companies.filter(company =>
            company.companyName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            company.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            company.contactPerson?.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setFilteredCompanies(filtered);
    }, [searchTerm, companies]);

    const fetchCompanies = async () => {
        setLoading(true);
        try {
            const res = await api.get('/superadmin/companies');
            const companiesData = res.data.companies || res.data;
            setCompanies(companiesData);
            setFilteredCompanies(companiesData);
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
        } catch (error) {
            console.error('Error deleting company:', error);
            showError(error.response?.data?.message || 'Failed to delete company');
        }
    };

    const handleEditCompany = (company) => {
        setSelectedCompany(company);
        setIsEditModalOpen(true);
    };

    const handleViewLeads = (company) => {
        setSelectedCompany(company);
        setIsViewLeadsModalOpen(true);
    };

    const handleManageAgents = (company) => {
        setSelectedCompany(company);
        setIsManageAgentsModalOpen(true);
    };

    const handleChangePassword = (company) => {
        setSelectedCompany(company);
        setIsChangePasswordModalOpen(true);
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

            // Clear current session
            localStorage.removeItem('token');
            localStorage.removeItem('user');

            // Set new session (Impersonated)
            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));

            showSuccess(`Logged in as ${user.name}`);

            // Hard redirect to refresh app with new permissions
            setTimeout(() => {
                window.location.href = '/';
            }, 1000);

        } catch (error) {
            console.error('Impersonation failed:', error);
            showError(error.response?.data?.message || 'Failed to login as user');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400"></i>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800">Company Management</h1>
                    <p className="text-slate-500 mt-1">Manage all registered companies</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={() => setIsCreateModalOpen(true)}
                        className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium transition shadow-md flex items-center gap-2"
                    >
                        <i className="fa-solid fa-plus"></i>
                        Create Company
                    </button>
                    <button
                        onClick={fetchCompanies}
                        className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition shadow-md flex items-center gap-2"
                    >
                        <i className="fa-solid fa-rotate"></i>
                        Refresh
                    </button>
                </div>
            </div>

            {/* Search Bar */}
            <div className="bg-white rounded-xl shadow-lg p-4 border border-slate-200">
                <div className="relative">
                    <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                    <input
                        type="text"
                        placeholder="Search companies by name, email, or contact person..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                    />
                </div>
            </div>

            {/* Companies Table */}
            <div className="bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Company
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Contact
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Stats
                                </th>
                                <th className="px-6 py-4 text-left text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Joined
                                </th>
                                <th className="px-6 py-4 text-right text-xs font-bold text-slate-600 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                            {filteredCompanies.length > 0 ? (
                                filteredCompanies.map((company) => (
                                    <tr key={company._id} className="hover:bg-slate-50 transition">
                                        <td className="px-6 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg flex items-center justify-center text-white font-bold shadow-md">
                                                    {company.companyName?.charAt(0).toUpperCase() || 'C'}
                                                </div>
                                                <div>
                                                    <p className="font-bold text-slate-800">{company.companyName}</p>
                                                    <p className="text-sm text-slate-500">{company.email}</p>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm text-slate-800">{company.contactPerson || '-'}</p>
                                            <p className="text-xs text-slate-500">{company.phone || '-'}</p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex gap-3">
                                                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                                                    {company.leadsCount || 0} Leads
                                                </span>
                                                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full font-medium">
                                                    {company.agentsCount || 0} Agents
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-6 py-4">
                                            <p className="text-sm text-slate-600">
                                                {new Date(company.createdAt).toLocaleDateString()}
                                            </p>
                                        </td>
                                        <td className="px-6 py-4">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleImpersonate(company)}
                                                    className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition"
                                                    title="Login as User"
                                                >
                                                    <i className="fa-solid fa-right-to-bracket"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleViewLeads(company)}
                                                    className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                                                    title="View Leads"
                                                >
                                                    <i className="fa-solid fa-users"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleManageAgents(company)}
                                                    className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition"
                                                    title="Manage Agents"
                                                >
                                                    <i className="fa-solid fa-user-tie"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleEditCompany(company)}
                                                    className="p-2 text-purple-600 hover:bg-purple-50 rounded-lg transition"
                                                    title="Edit Company"
                                                >
                                                    <i className="fa-solid fa-edit"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleChangePassword(company)}
                                                    className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition"
                                                    title="Change Password"
                                                >
                                                    <i className="fa-solid fa-key"></i>
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteCompany(company._id)}
                                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                                                    title="Delete Company"
                                                >
                                                    <i className="fa-solid fa-trash"></i>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center">
                                        <i className="fa-regular fa-building text-5xl text-slate-300 mb-3"></i>
                                        <p className="text-slate-400">
                                            {searchTerm ? 'No companies found matching your search' : 'No companies registered yet'}
                                        </p>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Modals */}
            <CreateCompanyModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSuccess={fetchCompanies}
            />
            <EditCompanyModal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                company={selectedCompany}
                onSuccess={fetchCompanies}
            />
            <ViewLeadsModal
                isOpen={isViewLeadsModalOpen}
                onClose={() => setIsViewLeadsModalOpen(false)}
                company={selectedCompany}
            />
            <ManageAgentsModal
                isOpen={isManageAgentsModalOpen}
                onClose={() => setIsManageAgentsModalOpen(false)}
                company={selectedCompany}
                onSuccess={fetchCompanies}
            />
            <ChangePasswordModal
                isOpen={isChangePasswordModalOpen}
                onClose={() => setIsChangePasswordModalOpen(false)}
                company={selectedCompany}
            />
        </div>
    );
};

export default CompaniesView;
