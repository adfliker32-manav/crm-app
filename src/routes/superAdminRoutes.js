const express = require('express');
const router = express.Router();
const { authMiddleware, requireSuperAdmin } = require('../middleware/authMiddleware');
const {
    getSaaSAnalytics,
    getAllCompanies,
    getCompanyById,
    updateCompany,
    deleteCompany,
    getCompanyLeads,
    changeCompanyPassword,
    getCompanyAgents,
    createCompanyAgent,
    updateCompanyAgent,
    deleteCompanyAgent,
    updateAgentLimit,
    getBillingData,
    updateCompanyBilling,
    getDashboardStats,
    getRecentSignups,
    getGrowthData,
    getBillingStats,
    getSubscriptions,
    createCompany,
    // Phase 2
    getSettings,
    updateSettings,
    impersonateUser,
    // Plan Management
    getAllPlans,
    createPlan,
    updatePlan,
    deletePlan
} = require('../controllers/superAdminController');


// Analytics Routes
router.get('/analytics', authMiddleware, requireSuperAdmin, getSaaSAnalytics);
router.get('/stats', authMiddleware, requireSuperAdmin, getDashboardStats);
router.get('/recent-signups', authMiddleware, requireSuperAdmin, getRecentSignups);
router.get('/growth-data', authMiddleware, requireSuperAdmin, getGrowthData);

// Company Management Routes
router.post('/companies', authMiddleware, requireSuperAdmin, createCompany);
router.get('/companies', authMiddleware, requireSuperAdmin, getAllCompanies);
router.get('/companies/:id', authMiddleware, requireSuperAdmin, getCompanyById);
router.put('/companies/:id', authMiddleware, requireSuperAdmin, updateCompany);
router.delete('/companies/:id', authMiddleware, requireSuperAdmin, deleteCompany);

// Company Leads
router.get('/companies/:id/leads', authMiddleware, requireSuperAdmin, getCompanyLeads);

// Company Password
router.put('/companies/:id/change-password', authMiddleware, requireSuperAdmin, changeCompanyPassword);

// Company Agents
router.get('/companies/:id/agents', authMiddleware, requireSuperAdmin, getCompanyAgents);
router.post('/companies/:id/agents', authMiddleware, requireSuperAdmin, createCompanyAgent);
router.put('/companies/:id/agents/:agentId', authMiddleware, requireSuperAdmin, updateCompanyAgent);
router.delete('/agents/:agentId', authMiddleware, requireSuperAdmin, deleteCompanyAgent);

// Agent Limit
router.put('/companies/:id/agent-limit', authMiddleware, requireSuperAdmin, updateAgentLimit);

// Billing & Revenue
router.get('/billing', authMiddleware, requireSuperAdmin, getBillingData);
router.get('/billing-stats', authMiddleware, requireSuperAdmin, getBillingStats);
router.get('/subscriptions', authMiddleware, requireSuperAdmin, getSubscriptions);
router.put('/companies/:id/billing', authMiddleware, requireSuperAdmin, updateCompanyBilling);

// Phase 2: Core Platform Features
router.get('/settings', authMiddleware, requireSuperAdmin, getSettings);
router.put('/settings', authMiddleware, requireSuperAdmin, updateSettings);
router.post('/impersonate', authMiddleware, requireSuperAdmin, impersonateUser);

// Subscription Plan Management
router.get('/plans', authMiddleware, requireSuperAdmin, getAllPlans);
router.post('/plans', authMiddleware, requireSuperAdmin, createPlan);
router.put('/plans/:id', authMiddleware, requireSuperAdmin, updatePlan);
router.delete('/plans/:id', authMiddleware, requireSuperAdmin, deletePlan);

module.exports = router;