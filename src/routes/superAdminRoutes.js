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
    updateCompanyBilling
} = require('../controllers/superAdminController');

// Analytics Route
router.get('/analytics', authMiddleware, requireSuperAdmin, getSaaSAnalytics);

// Company Management Routes
router.get('/companies', authMiddleware, requireSuperAdmin, getAllCompanies);
router.get('/companies/:id', authMiddleware, requireSuperAdmin, getCompanyById);
router.put('/companies/:id', authMiddleware, requireSuperAdmin, updateCompany);
router.delete('/companies/:id', authMiddleware, requireSuperAdmin, deleteCompany);

// Company Leads
router.get('/companies/:id/leads', authMiddleware, requireSuperAdmin, getCompanyLeads);

// Company Password
router.put('/companies/:id/password', authMiddleware, requireSuperAdmin, changeCompanyPassword);

// Company Agents
router.get('/companies/:id/agents', authMiddleware, requireSuperAdmin, getCompanyAgents);
router.post('/companies/:id/agents', authMiddleware, requireSuperAdmin, createCompanyAgent);
router.put('/companies/:id/agents/:agentId', authMiddleware, requireSuperAdmin, updateCompanyAgent);
router.delete('/companies/:id/agents/:agentId', authMiddleware, requireSuperAdmin, deleteCompanyAgent);

// Agent Limit
router.put('/companies/:id/agent-limit', authMiddleware, requireSuperAdmin, updateAgentLimit);

// Billing & Revenue
router.get('/billing', authMiddleware, requireSuperAdmin, getBillingData);
router.put('/companies/:id/billing', authMiddleware, requireSuperAdmin, updateCompanyBilling);

module.exports = router;