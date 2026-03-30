const express = require('express');
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
    updateAgencyLimits,
    getWorkspaceAnalytics,
    // ✅ Approval-Based Access Control
    getPendingRequests,
    getActiveAccounts,
    getRejectedAccounts,
    approveAccount,
    rejectAccount,
    deactivateAccount
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
router.get('/companies/:id', authMiddleware, requireSuperAdmin, getCompanyById);
router.put('/companies/:id', authMiddleware, requireSuperAdmin, updateCompany);
router.delete('/companies/:id', authMiddleware, requireSuperAdmin, deleteCompany);
router.put('/companies/:id/freeze', authMiddleware, requireSuperAdmin, freezeTenant);

// Company Leads
router.get('/companies/:id/leads', authMiddleware, requireSuperAdmin, getCompanyLeads);

// Agency Resource Limits (Controlled Autonomy)
router.put('/companies/:id/limits', authMiddleware, requireSuperAdmin, updateAgencyLimits);

// Company Password
router.put('/companies/:id/change-password', authMiddleware, requireSuperAdmin, changeCompanyPassword);

// Company Agents
router.get('/companies/:id/agents', authMiddleware, requireSuperAdmin, getCompanyAgents);
router.post('/companies/:id/agents', authMiddleware, requireSuperAdmin, createCompanyAgent);
router.put('/companies/:id/agents/:agentId', authMiddleware, requireSuperAdmin, updateCompanyAgent);
router.delete('/agents/:agentId', authMiddleware, requireSuperAdmin, deleteCompanyAgent);

// Agent Limit
router.put('/companies/:id/agent-limit', authMiddleware, requireSuperAdmin, updateAgentLimit);

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
router.put('/accounts/:id/approve', authMiddleware, requireSuperAdmin, approveAccount);
router.put('/accounts/:id/reject', authMiddleware, requireSuperAdmin, rejectAccount);
router.put('/accounts/:id/deactivate', authMiddleware, requireSuperAdmin, deactivateAccount);

module.exports = router;