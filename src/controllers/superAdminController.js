const User = require('../models/User');
const Lead = require('../models/Lead');
const bcrypt = require('bcryptjs');

const getSaaSAnalytics = async (req, res) => {
    try {
        // Optimized: Use Promise.all to run queries in parallel instead of sequentially
        // This reduces total query time significantly
        const [totalCompanies, totalAgents, totalLeads, recentUsers] = await Promise.all([
            User.countDocuments({ role: 'manager' }),
            User.countDocuments({ role: 'agent' }),
            Lead.countDocuments(),
            User.find({ role: 'manager' })
                .select('name email createdAt')
                .sort({ createdAt: -1 })
                .limit(5)
                .lean() // Use lean() for better performance
        ]);

        res.json({
            success: true,
            totalCompanies,
            totalAgents,
            totalLeads,
            recentUsers
        });

    } catch (error) {
        console.error("Analytics Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get all companies (managers)
const getAllCompanies = async (req, res) => {
    try {
        const companies = await User.find({ role: 'manager' })
            .select('-password')
            .populate('parentId', 'name email')
            .sort({ createdAt: -1 });

        // Get additional stats for each company
        const companiesWithStats = await Promise.all(
            companies.map(async (company) => {
                const agentsCount = await User.countDocuments({ parentId: company._id, role: 'agent' });
                const leadsCount = await Lead.countDocuments({ userId: company._id });

                return {
                    ...company.toObject(),
                    agentsCount,
                    leadsCount
                };
            })
        );

        res.json({
            success: true,
            companies: companiesWithStats
        });
    } catch (error) {
        console.error("Get Companies Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get single company details
const getCompanyById = async (req, res) => {
    try {
        const { id } = req.params;

        const company = await User.findOne({ _id: id, role: 'manager' })
            .select('-password')
            .populate('parentId', 'name email');

        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        // Get company stats
        const agentsCount = await User.countDocuments({ parentId: id, role: 'agent' });
        const leadsCount = await Lead.countDocuments({ userId: id });
        const agents = await User.find({ parentId: id, role: 'agent' })
            .select('name email createdAt');

        res.json({
            success: true,
            company: {
                ...company.toObject(),
                agentsCount,
                leadsCount,
                agents
            }
        });
    } catch (error) {
        console.error("Get Company Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Update company
const updateCompany = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, companyName, contactPerson, phone } = req.body;

        // Check if company exists
        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        // Check if email is being changed and if it's already taken
        if (email && email !== company.email) {
            const existingUser = await User.findOne({ email, _id: { $ne: id } });
            if (existingUser) {
                return res.status(400).json({ message: "Email already in use" });
            }
        }

        // Update company
        const updatedCompany = await User.findByIdAndUpdate(
            id,
            {
                ...(name && { name }),
                ...(email && { email: email.toLowerCase() }),
                ...(companyName !== undefined && { companyName }),
                ...(contactPerson !== undefined && { contactPerson }),
                ...(phone !== undefined && { phone })
            },
            { new: true, runValidators: true }
        ).select('-password');

        res.json({
            success: true,
            message: "Company updated successfully",
            company: updatedCompany
        });
    } catch (error) {
        console.error("Update Company Error:", error);
        res.status(500).json({ message: error.message || "Server Error" });
    }
};

// Delete company (and all its agents and leads)
const deleteCompany = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if company exists
        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        // Delete all agents of this company
        await User.deleteMany({ parentId: id, role: 'agent' });

        // Delete all leads of this company
        await Lead.deleteMany({ userId: id });

        // Delete the company
        await User.findByIdAndDelete(id);

        res.json({
            success: true,
            message: "Company and all associated data deleted successfully"
        });
    } catch (error) {
        console.error("Delete Company Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get company leads
const getCompanyLeads = async (req, res) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 50 } = req.query;

        // Check if company exists
        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const leads = await Lead.find({ userId: id })
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(skip);

        const totalLeads = await Lead.countDocuments({ userId: id });

        res.json({
            success: true,
            leads,
            totalLeads,
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalLeads / parseInt(limit))
        });
    } catch (error) {
        console.error("Get Company Leads Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Change company password
const changeCompanyPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ message: "Password must be at least 6 characters" });
        }

        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(id, { password: hashedPassword });

        res.json({
            success: true,
            message: "Password updated successfully"
        });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get company agents
const getCompanyAgents = async (req, res) => {
    try {
        const { id } = req.params;

        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const agents = await User.find({ parentId: id, role: 'agent' })
            .select('-password')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            agents,
            agentLimit: company.agentLimit || 5,
            currentAgentsCount: agents.length
        });
    } catch (error) {
        console.error("Get Company Agents Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Create agent for company
const createCompanyAgent = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ message: "Name, email, and password are required" });
        }

        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        // Check agent limit
        const currentAgentsCount = await User.countDocuments({ parentId: id, role: 'agent' });
        const agentLimit = company.agentLimit || 5;

        if (currentAgentsCount >= agentLimit) {
            return res.status(400).json({
                message: `Agent limit reached. Current limit: ${agentLimit}. Please upgrade plan or contact admin.`
            });
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ message: "Email already in use" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newAgent = await User.create({
            name,
            email: email.toLowerCase(),
            password: hashedPassword,
            role: 'agent',
            parentId: id
        });

        res.json({
            success: true,
            message: "Agent created successfully",
            agent: {
                _id: newAgent._id,
                name: newAgent.name,
                email: newAgent.email,
                createdAt: newAgent.createdAt
            }
        });
    } catch (error) {
        console.error("Create Agent Error:", error);
        res.status(500).json({ message: error.message || "Server Error" });
    }
};

// Update agent
const updateCompanyAgent = async (req, res) => {
    try {
        const { id, agentId } = req.params;
        const { name, email, password } = req.body;

        // Verify agent belongs to company
        const agent = await User.findOne({ _id: agentId, parentId: id, role: 'agent' });
        if (!agent) {
            return res.status(404).json({ message: "Agent not found" });
        }

        const updateData = {};
        if (name) updateData.name = name;
        if (email && email !== agent.email) {
            const existingUser = await User.findOne({ email: email.toLowerCase(), _id: { $ne: agentId } });
            if (existingUser) {
                return res.status(400).json({ message: "Email already in use" });
            }
            updateData.email = email.toLowerCase();
        }
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ message: "Password must be at least 6 characters" });
            }
            updateData.password = await bcrypt.hash(password, 10);
        }

        const updatedAgent = await User.findByIdAndUpdate(agentId, updateData, { new: true })
            .select('-password');

        res.json({
            success: true,
            message: "Agent updated successfully",
            agent: updatedAgent
        });
    } catch (error) {
        console.error("Update Agent Error:", error);
        res.status(500).json({ message: error.message || "Server Error" });
    }
};

// Delete agent
const deleteCompanyAgent = async (req, res) => {
    try {
        const { id, agentId } = req.params;

        // Verify agent belongs to company
        const agent = await User.findOne({ _id: agentId, parentId: id, role: 'agent' });
        if (!agent) {
            return res.status(404).json({ message: "Agent not found" });
        }

        // Delete agent's leads
        await Lead.deleteMany({ userId: agentId });

        // Delete agent
        await User.findByIdAndDelete(agentId);

        res.json({
            success: true,
            message: "Agent deleted successfully"
        });
    } catch (error) {
        console.error("Delete Agent Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Update company agent limit
const updateAgentLimit = async (req, res) => {
    try {
        const { id } = req.params;
        const { agentLimit } = req.body;

        if (!agentLimit || agentLimit < 0) {
            return res.status(400).json({ message: "Valid agent limit is required" });
        }

        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const updatedCompany = await User.findByIdAndUpdate(
            id,
            { agentLimit: parseInt(agentLimit) },
            { new: true }
        ).select('-password');

        res.json({
            success: true,
            message: "Agent limit updated successfully",
            company: updatedCompany
        });
    } catch (error) {
        console.error("Update Agent Limit Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get billing/revenue data
const getBillingData = async (req, res) => {
    try {
        // Get all companies with billing info
        const companies = await User.find({ role: 'manager' })
            .select('name email companyName subscriptionPlan subscriptionStatus planExpiryDate lastPaymentDate monthlyRevenue createdAt')
            .sort({ createdAt: -1 });

        // Calculate total monthly revenue
        const totalMonthlyRevenue = companies.reduce((sum, company) => {
            return sum + (company.monthlyRevenue || 0);
        }, 0);

        // Get current month revenue (companies that paid this month)
        const currentMonth = new Date();
        currentMonth.setDate(1);
        currentMonth.setHours(0, 0, 0, 0);

        const currentMonthRevenue = companies
            .filter(c => c.lastPaymentDate && new Date(c.lastPaymentDate) >= currentMonth)
            .reduce((sum, company) => sum + (company.monthlyRevenue || 0), 0);

        // Count by status
        const activeSubscriptions = companies.filter(c => c.subscriptionStatus === 'active').length;
        const expiredSubscriptions = companies.filter(c => c.subscriptionStatus === 'expired').length;
        const trialSubscriptions = companies.filter(c => c.subscriptionStatus === 'trial').length;

        // Get expiring soon (within 7 days)
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        const expiringSoon = companies.filter(c => {
            if (!c.planExpiryDate) return false;
            const expiry = new Date(c.planExpiryDate);
            return expiry <= sevenDaysFromNow && expiry >= new Date() && c.subscriptionStatus === 'active';
        });

        res.json({
            success: true,
            companies,
            totalMonthlyRevenue,
            currentMonthRevenue,
            stats: {
                activeSubscriptions,
                expiredSubscriptions,
                trialSubscriptions,
                expiringSoon: expiringSoon.length
            },
            expiringSoon: expiringSoon.map(c => ({
                _id: c._id,
                name: c.name,
                companyName: c.companyName,
                email: c.email,
                planExpiryDate: c.planExpiryDate,
                subscriptionPlan: c.subscriptionPlan
            }))
        });
    } catch (error) {
        console.error("Get Billing Data Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Update company billing/subscription
const updateCompanyBilling = async (req, res) => {
    try {
        const { id } = req.params;
        const { subscriptionPlan, subscriptionStatus, planExpiryDate, monthlyRevenue, lastPaymentDate } = req.body;

        const company = await User.findOne({ _id: id, role: 'manager' });
        if (!company) {
            return res.status(404).json({ message: "Company not found" });
        }

        const updateData = {};
        if (subscriptionPlan) updateData.subscriptionPlan = subscriptionPlan;
        if (subscriptionStatus) updateData.subscriptionStatus = subscriptionStatus;
        if (planExpiryDate) updateData.planExpiryDate = new Date(planExpiryDate);
        if (monthlyRevenue !== undefined) updateData.monthlyRevenue = parseFloat(monthlyRevenue);
        if (lastPaymentDate) updateData.lastPaymentDate = new Date(lastPaymentDate);

        const updatedCompany = await User.findByIdAndUpdate(id, updateData, { new: true })
            .select('-password');

        res.json({
            success: true,
            message: "Billing information updated successfully",
            company: updatedCompany
        });
    } catch (error) {
        console.error("Update Billing Error:", error);
        res.status(500).json({ message: error.message || "Server Error" });
    }
};

// Get dashboard stats (for frontend dashboard)
const getDashboardStats = async (req, res) => {
    try {
        const [totalCompanies, totalLeads, totalAgents] = await Promise.all([
            User.countDocuments({ role: 'manager' }),
            Lead.countDocuments(),
            User.countDocuments({ role: 'agent' })
        ]);

        const activeSubscriptions = await User.countDocuments({
            role: 'manager',
            subscriptionStatus: 'active'
        });

        res.json({
            totalCompanies,
            totalLeads,
            totalAgents,
            activeSubscriptions
        });
    } catch (error) {
        console.error("Dashboard Stats Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get recent signups
const getRecentSignups = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;

        const recentCompanies = await User.find({ role: 'manager' })
            .select('companyName email createdAt')
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        res.json(recentCompanies);
    } catch (error) {
        console.error("Recent Signups Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get growth data for charts (last 30 days)
const getGrowthData = async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get daily company signups
        const companies = await User.find({
            role: 'manager',
            createdAt: { $gte: startDate, $lte: endDate }
        }).select('createdAt').lean();

        // Get daily lead creation
        const leads = await Lead.find({
            createdAt: { $gte: startDate, $lte: endDate }
        }).select('createdAt').lean();

        // Create date labels and count data
        const labels = [];
        const companyCounts = [];
        const leadCounts = [];

        for (let i = days - 1; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            labels.push(dateStr);

            // Count companies created on this day
            const dayStart = new Date(date);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(date);
            dayEnd.setHours(23, 59, 59, 999);

            const companyCount = companies.filter(c => {
                const created = new Date(c.createdAt);
                return created >= dayStart && created <= dayEnd;
            }).length;

            const leadCount = leads.filter(l => {
                const created = new Date(l.createdAt);
                return created >= dayStart && created <= dayEnd;
            }).length;

            companyCounts.push(companyCount);
            leadCounts.push(leadCount);
        }

        res.json({
            labels,
            companies: companyCounts,
            leads: leadCounts
        });
    } catch (error) {
        console.error("Growth Data Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get billing stats (separate from full billing data)
const getBillingStats = async (req, res) => {
    try {
        const companies = await User.find({ role: 'manager' })
            .select('monthlyRevenue subscriptionStatus planExpiryDate lastPaymentDate')
            .lean();

        const totalMonthlyRevenue = companies.reduce((sum, c) => sum + (c.monthlyRevenue || 0), 0);

        const currentMonth = new Date();
        currentMonth.setDate(1);
        currentMonth.setHours(0, 0, 0, 0);

        const currentMonthRevenue = companies
            .filter(c => c.lastPaymentDate && new Date(c.lastPaymentDate) >= currentMonth)
            .reduce((sum, c) => sum + (c.monthlyRevenue || 0), 0);

        const activeSubscriptions = companies.filter(c => c.subscriptionStatus === 'active').length;

        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        const expiringSoon = companies.filter(c => {
            if (!c.planExpiryDate) return false;
            const expiry = new Date(c.planExpiryDate);
            return expiry <= sevenDaysFromNow && expiry >= new Date() && c.subscriptionStatus === 'active';
        }).length;

        res.json({
            totalMonthlyRevenue,
            currentMonthRevenue,
            activeSubscriptions,
            expiringSoon
        });
    } catch (error) {
        console.error("Billing Stats Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

// Get all subscriptions (for billing view table)
const getSubscriptions = async (req, res) => {
    try {
        const companies = await User.find({ role: 'manager' })
            .select('companyName email subscriptionPlan subscriptionStatus monthlyRevenue planExpiryDate lastPaymentDate createdAt')
            .sort({ createdAt: -1 })
            .lean();

        // Map to match frontend expectations
        const subscriptions = companies.map(c => ({
            _id: c._id,
            companyName: c.companyName || c.email,
            email: c.email,
            plan: c.subscriptionPlan ? c.subscriptionPlan.charAt(0).toUpperCase() + c.subscriptionPlan.slice(1) : 'Free',
            billingStatus: c.subscriptionStatus ? c.subscriptionStatus.charAt(0).toUpperCase() + c.subscriptionStatus.slice(1) : 'Trial',
            monthlyRevenue: c.monthlyRevenue || 0,
            expiryDate: c.planExpiryDate,
            lastPaymentDate: c.lastPaymentDate
        }));

        res.json(subscriptions);
    } catch (error) {
        console.error("Get Subscriptions Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

module.exports = {
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
    // New endpoints for frontend
    getDashboardStats,
    getRecentSignups,
    getGrowthData,
    getBillingStats,
    getSubscriptions
};