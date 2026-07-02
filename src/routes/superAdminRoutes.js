const express = require('express');
const validateObjectId = require('../middleware/validateObjectId');
const router = express.Router();
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');
const {
    getSaaSAnalytics,
    getAllCompanies,
    getCompanyById,
    updateCompany,
    deleteCompany,
    freezeTenant,
    getCompanyLeads,
    changeCompanyPassword,
    getCompanyAgents,
    getAgencySubClients,
    createCompanyAgent,
    updateCompanyAgent,
    deleteCompanyAgent,
    updateAgentLimit,
    getDashboardStats,
    getRecentSignups,
    getGrowthData,
    createCompany,
    // Phase 2
    getSettings,
    updateSettings,
    getSystemSettings,
    updateSystemSettings,
    getSystemHealth,
    impersonateUser,
    getCloudUsage,
    getAuditLogs,
    getAgencyLimits,
    updateAgencyLimits,
    getWorkspaceAnalytics,
    // ✅ Approval-Based Access Control
    getPendingRequests,
    getActiveAccounts,
    getRejectedAccounts,
    approveAccount,
    rejectAccount,
    deactivateAccount,
    // 🧹 Maintenance
    cleanupOrphanedAccounts
} = require('../controllers/superAdminController');


// Analytics Routes
router.get('/analytics', authMiddleware, requireSuperAdmin, getSaaSAnalytics);
router.get('/stats', authMiddleware, requireSuperAdmin, getDashboardStats);
router.get('/recent-signups', authMiddleware, requireSuperAdmin, getRecentSignups);
router.get('/growth-data', authMiddleware, requireSuperAdmin, getGrowthData);
router.get('/cloud-usage', authMiddleware, requireSuperAdmin, getCloudUsage);

// Company Management Routes
router.post('/companies', authMiddleware, requireSuperAdmin, createCompany);
router.get('/companies', authMiddleware, requireSuperAdmin, getAllCompanies);
router.get('/companies/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, getCompanyById);
router.put('/companies/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, updateCompany);
router.delete('/companies/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, deleteCompany);
router.put('/companies/:id/freeze', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, freezeTenant);

// Company Leads
router.get('/companies/:id/leads', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, getCompanyLeads);

// Agency Sub-Clients
router.get('/companies/:id/sub-clients', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, getAgencySubClients);

// Agency Resource Limits (Controlled Autonomy)
router.get('/companies/:id/limits', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, getAgencyLimits);
router.put('/companies/:id/limits', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, updateAgencyLimits);

// Company Password
router.put('/companies/:id/change-password', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, changeCompanyPassword);

// Company Agents
router.get('/companies/:id/agents', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, getCompanyAgents);
router.post('/companies/:id/agents', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, createCompanyAgent);
router.put('/companies/:id/agents/:agentId', validateObjectId({ params: ['id', 'agentId'] }), authMiddleware, requireSuperAdmin, updateCompanyAgent);
router.delete('/agents/:agentId', validateObjectId({ params: ['agentId'] }), authMiddleware, requireSuperAdmin, deleteCompanyAgent);

// Agent Limit
router.put('/companies/:id/agent-limit', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, updateAgentLimit);

// Billing removed
// Phase 2: Core Platform Features
router.get('/settings', authMiddleware, requireSuperAdmin, getSettings);
router.put('/settings', authMiddleware, requireSuperAdmin, updateSettings);
router.post('/impersonate', authMiddleware, requireSuperAdmin, impersonateUser);

// Emergency System Controls (Kill Switches)
router.get('/system-settings', authMiddleware, requireSuperAdmin, getSystemSettings);
router.put('/system-settings', authMiddleware, requireSuperAdmin, updateSystemSettings);

// System Health Telemetry
router.get('/system-health', authMiddleware, requireSuperAdmin, getSystemHealth);

// Audit Logs (Command Center)
router.get('/audit-logs', authMiddleware, requireSuperAdmin, getAuditLogs);

// 🔭 SaaS Workspace Analytics Cockpit
router.get('/workspace-analytics', authMiddleware, requireSuperAdmin, getWorkspaceAnalytics);

// Plan Management routes removed

// ✅ APPROVAL-BASED ACCESS CONTROL ROUTES
// The core system — Super Admin controls all account access
router.get('/accounts/pending', authMiddleware, requireSuperAdmin, getPendingRequests);
router.get('/accounts/active', authMiddleware, requireSuperAdmin, getActiveAccounts);
router.get('/accounts/rejected', authMiddleware, requireSuperAdmin, getRejectedAccounts);
router.put('/accounts/:id/approve', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, approveAccount);
router.put('/accounts/:id/reject', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, rejectAccount);
router.put('/accounts/:id/deactivate', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, deactivateAccount);

// 🧹 Cleanup orphan sub-clients (managers whose parent agency was deleted)
router.post('/cleanup/orphans', authMiddleware, requireSuperAdmin, cleanupOrphanedAccounts);

// 💰 FINANCE MANAGER — payments, expenses, summary
const {
    recordPayment,
    listPayments,
    deletePayment,
    recordExpense,
    listExpenses,
    deleteExpense,
    getFinanceSummary,
    listBillableClients
} = require('../controllers/financeController');

router.get('/finance/summary', authMiddleware, requireSuperAdmin, getFinanceSummary);
router.get('/finance/clients', authMiddleware, requireSuperAdmin, listBillableClients);

router.get('/finance/payments', authMiddleware, requireSuperAdmin, listPayments);
router.post('/finance/payments', authMiddleware, requireSuperAdmin, recordPayment);
router.delete('/finance/payments/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, deletePayment);

router.get('/finance/expenses', authMiddleware, requireSuperAdmin, listExpenses);
router.post('/finance/expenses', authMiddleware, requireSuperAdmin, recordExpense);
router.delete('/finance/expenses/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, deleteExpense);

// 🏢 AGENCY FINANCE — independent agency client & payment management
const {
    getSummary: agencySummary,
    listClients: agencyListClients,
    createClient: agencyCreateClient,
    updateClient: agencyUpdateClient,
    deleteClient: agencyDeleteClient,
    listPayments: agencyListPayments,
    getPayment:   agencyGetPayment,
    createPayment: agencyCreatePayment,
    updatePayment: agencyUpdatePayment,
    deletePayment: agencyDeletePayment,
    sendBillManually: agencySendBillManually,
    getAgencyBranding: agencyGetBranding,
} = require('../controllers/agencyFinanceController');

router.get('/agency-finance/summary', authMiddleware, requireSuperAdmin, agencySummary);
router.get('/agency-finance/branding', authMiddleware, requireSuperAdmin, agencyGetBranding);

router.get('/agency-finance/clients', authMiddleware, requireSuperAdmin, agencyListClients);
router.post('/agency-finance/clients', authMiddleware, requireSuperAdmin, agencyCreateClient);
router.put('/agency-finance/clients/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, agencyUpdateClient);
router.delete('/agency-finance/clients/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, agencyDeleteClient);

router.get('/agency-finance/payments', authMiddleware, requireSuperAdmin, agencyListPayments);
router.get('/agency-finance/payments/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, agencyGetPayment);
router.post('/agency-finance/payments', authMiddleware, requireSuperAdmin, agencyCreatePayment);
router.post('/agency-finance/payments/:id/send-bill', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, agencySendBillManually);
router.put('/agency-finance/payments/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, agencyUpdatePayment);
router.delete('/agency-finance/payments/:id', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, agencyDeletePayment);

// 🔔 BILLING REMINDER TEMPLATE CONFIG — one-time Super Admin setup
const {
    getConfig: getBillingReminderConfig,
    saveConfig: saveBillingReminderConfig,
    getAvailableTemplates: getBillingReminderTemplates
} = require('../controllers/billingReminderConfigController');

router.get('/billing-reminder-config',           authMiddleware, requireSuperAdmin, getBillingReminderConfig);
router.put('/billing-reminder-config',           authMiddleware, requireSuperAdmin, saveBillingReminderConfig);
router.get('/billing-reminder-config/templates', authMiddleware, requireSuperAdmin, getBillingReminderTemplates);

// 🤝 PARTNER REVENUE SHARING — Withdrawals & Commission Tier Management
const {
    listWithdrawals,
    processWithdrawal,
    getCommissionTiers,
    updateCommissionTiers,
    listAgencyPartnerStats,
    getAgencyManagementAnalytics
} = require('../controllers/partnerAdminController');

// Agency Management Analytics
router.get('/partner/analytics', authMiddleware, requireSuperAdmin, getAgencyManagementAnalytics);

// Commission tier configuration
router.get('/partner/commission-tiers', authMiddleware, requireSuperAdmin, getCommissionTiers);
router.put('/partner/commission-tiers', authMiddleware, requireSuperAdmin, updateCommissionTiers);

// Agency overview with partner stats
router.get('/partner/agencies', authMiddleware, requireSuperAdmin, listAgencyPartnerStats);

// Withdrawal request management
router.get('/partner/withdrawals', authMiddleware, requireSuperAdmin, listWithdrawals);
router.put('/partner/withdrawals/:id/process', validateObjectId({ params: ['id'] }), authMiddleware, requireSuperAdmin, processWithdrawal);

module.exports = router;
