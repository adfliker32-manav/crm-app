/**
 * Partner App Admin Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * SuperAdmin endpoints for managing partner CRM apps.
 * Mounted under /api/superadmin/partner-apps/*
 */

const crypto = require('crypto');
const PartnerApp = require('../models/PartnerApp');
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const { clearCacheForPartner } = require('../services/partnerWebhookService');

const generatePartnerKey = () => `partner_${crypto.randomBytes(24).toString('hex')}`;

// ═══════════════════════════════════════════════════════════════════════════
// PARTNER CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/superadmin/partner-apps
 * Create a new partner app. Returns the API key once.
 */
exports.createPartner = async (req, res) => {
    try {
        const {
            appName, contactPerson, contactEmail, contactPhone,
            pricePerAccount, currency,
            allowedModules, maxAccounts, accountDefaults,
            rateLimit, allowDirectLogin, showPoweredBy
        } = req.body;

        if (!appName) {
            return res.status(400).json({ success: false, message: 'appName is required.' });
        }

        const apiKey = generatePartnerKey();
        const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

        const partner = await PartnerApp.create({
            appName: appName.trim(),
            contactPerson: contactPerson || null,
            contactEmail: contactEmail || null,
            contactPhone: contactPhone || null,
            apiKey,
            pricePerAccount: pricePerAccount || 0,
            currency: currency || 'INR',
            allowedModules: allowedModules || undefined, // use schema default
            maxAccounts: maxAccounts || 100,
            accountDefaults: accountDefaults || undefined,
            rateLimit: rateLimit || undefined,
            allowDirectLogin: allowDirectLogin || false,
            showPoweredBy: showPoweredBy !== false,
            webhookSecret,
            createdBy: req.user.userId || req.user.id,
            isActive: true
        });

        res.status(201).json({
            success: true,
            data: {
                id: partner._id,
                appName: partner.appName,
                // Return full key ONCE — never shown again
                apiKey,
                webhookSecret,
                message: 'Copy the API key now — it will not be shown in full again.'
            }
        });
    } catch (err) {
        console.error('[PartnerAdmin] createPartner error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create partner.' });
    }
};

/**
 * GET /api/superadmin/partner-apps
 * List all partners with stats.
 */
exports.listPartners = async (req, res) => {
    try {
        const partners = await PartnerApp.find()
            .select('appName contactPerson contactEmail apiKey pricePerAccount currency allowedModules maxAccounts accountIds isActive createdAt apiUsage')
            .sort({ createdAt: -1 })
            .lean();

        const data = partners.map(p => {
            // Count active accounts
            const totalAccounts = p.accountIds?.length || 0;
            // Monthly revenue estimate
            const monthlyRevenue = totalAccounts * (p.pricePerAccount || 0);

            // Today's API calls
            const today = new Date().toISOString().slice(0, 10);
            const todayUsage = p.apiUsage?.find(u => u.date === today)?.count || 0;

            return {
                id: p._id,
                appName: p.appName,
                contactPerson: p.contactPerson,
                contactEmail: p.contactEmail,
                maskedKey: p.apiKey ? `${p.apiKey.slice(0, 12)}${'•'.repeat(20)}` : null,
                pricePerAccount: p.pricePerAccount,
                currency: p.currency,
                totalAccounts,
                monthlyRevenue,
                isActive: p.isActive,
                apiCallsToday: todayUsage,
                createdAt: p.createdAt
            };
        });

        // Aggregate stats
        const stats = {
            totalPartners: partners.length,
            activePartners: partners.filter(p => p.isActive).length,
            totalAccounts: partners.reduce((sum, p) => sum + (p.accountIds?.length || 0), 0),
            monthlyRevenue: data.reduce((sum, d) => sum + d.monthlyRevenue, 0)
        };

        res.json({ success: true, data, stats });
    } catch (err) {
        console.error('[PartnerAdmin] listPartners error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to list partners.' });
    }
};

/**
 * GET /api/superadmin/partner-apps/:id
 * Get partner details with accounts.
 */
exports.getPartner = async (req, res) => {
    try {
        const partner = await PartnerApp.findById(req.params.id).lean();
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        // Load accounts info
        let accounts = [];
        if (partner.accountIds?.length) {
            const users = await User.find(
                { _id: { $in: partner.accountIds } },
                'name email companyName phone is_active accountStatus createdAt'
            ).lean();

            const configs = await IntegrationConfig.find(
                { userId: { $in: partner.accountIds } },
                'userId whatsapp.waPhoneNumberId whatsapp.displayPhone'
            ).lean();

            const configMap = {};
            configs.forEach(c => {
                configMap[c.userId.toString()] = {
                    connected: !!(c.whatsapp?.waPhoneNumberId),
                    displayPhone: c.whatsapp?.displayPhone || null
                };
            });

            accounts = users.map(u => ({
                accountId: u._id,
                name: u.name,
                email: u.email,
                companyName: u.companyName,
                phone: u.phone,
                status: u.accountStatus || (u.is_active ? 'Active' : 'Frozen'),
                whatsapp: configMap[u._id.toString()] || { connected: false },
                createdAt: u.createdAt
            }));
        }

        const activeAccountCount = accounts.filter(a => a.status === 'Active').length;

        // Mask API key
        const maskedKey = partner.apiKey
            ? `${partner.apiKey.slice(0, 12)}${'•'.repeat(20)}`
            : null;

        // Messages this month (across all partner accounts)
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        let messagesThisMonth = 0;
        if (partner.accountIds?.length) {
            messagesThisMonth = await WhatsAppMessage.countDocuments({
                userId: { $in: partner.accountIds },
                timestamp: { $gte: monthStart }
            });
        }

        res.json({
            success: true,
            data: {
                ...partner,
                apiKey: maskedKey,
                accounts,
                activeAccountCount,
                messagesThisMonth,
                monthlyRevenue: activeAccountCount * (partner.pricePerAccount || 0)
            }
        });
    } catch (err) {
        console.error('[PartnerAdmin] getPartner error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to get partner.' });
    }
};

/**
 * PUT /api/superadmin/partner-apps/:id
 * Update partner settings.
 */
exports.updatePartner = async (req, res) => {
    try {
        const allowedFields = [
            'appName', 'contactPerson', 'contactEmail', 'contactPhone',
            'pricePerAccount', 'currency', 'allowedModules', 'maxAccounts',
            'accountDefaults', 'rateLimit', 'allowDirectLogin', 'showPoweredBy',
            'webhookUrl', 'webhookEvents', 'isActive'
        ];

        const update = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                update[field] = req.body[field];
            }
        }

        const partner = await PartnerApp.findByIdAndUpdate(
            req.params.id,
            { $set: update },
            { new: true }
        ).lean();

        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        // Clear webhook cache if webhook config or active status changed
        if (update.webhookUrl !== undefined || update.isActive !== undefined) {
            await clearCacheForPartner(partner._id);
        }

        res.json({ success: true, data: partner });
    } catch (err) {
        console.error('[PartnerAdmin] updatePartner error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update partner.' });
    }
};

/**
 * DELETE /api/superadmin/partner-apps/:id
 * Deactivate a partner (soft delete — stops all API access).
 */
exports.deactivatePartner = async (req, res) => {
    try {
        await PartnerApp.updateOne(
            { _id: req.params.id },
            { $set: { isActive: false } }
        );
        
        await clearCacheForPartner(req.params.id);

        res.json({ success: true, message: 'Partner deactivated. All API access is now blocked.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to deactivate partner.' });
    }
};

/**
 * POST /api/superadmin/partner-apps/:id/regenerate-key
 * Generate a new API key (invalidates the old one).
 */
exports.regenerateKey = async (req, res) => {
    try {
        const newKey = generatePartnerKey();
        await PartnerApp.updateOne(
            { _id: req.params.id },
            { $set: { apiKey: newKey } }
        );

        res.json({
            success: true,
            apiKey: newKey,
            message: 'New API key generated. The old key is now invalid. Copy this key — it will not be shown again.'
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to regenerate key.' });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// BILLING — Manual "Generate Bill" approach
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/superadmin/partner-apps/:id/generate-bill
 * Snapshot the current month's billing (active accounts × price).
 */
exports.generateBill = async (req, res) => {
    try {
        const partner = await PartnerApp.findById(req.params.id);
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        const { month } = req.body; // "2026-09"
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, message: 'month is required in YYYY-MM format.' });
        }

        // Check if bill already exists for this month
        const existing = partner.billingHistory.find(b => b.month === month);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: `Bill for ${month} already exists. Amount: ${partner.currency} ${existing.amount}`
            });
        }

        // Count active accounts
        let activeCount = 0;
        if (partner.accountIds?.length) {
            activeCount = await User.countDocuments({
                _id: { $in: partner.accountIds },
                is_active: true,
                accountStatus: { $ne: 'Frozen' }
            });
        }

        const rate = partner.pricePerAccount || 0;
        const amount = activeCount * rate;

        const billEntry = {
            month,
            activeAccounts: activeCount,
            rate,
            amount,
            status: 'due',
            generatedAt: new Date()
        };

        await PartnerApp.updateOne(
            { _id: partner._id },
            { $push: { billingHistory: billEntry } }
        );

        res.json({
            success: true,
            data: billEntry,
            message: `Bill generated: ${activeCount} active accounts × ${partner.currency} ${rate} = ${partner.currency} ${amount}`
        });
    } catch (err) {
        console.error('[PartnerAdmin] generateBill error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to generate bill.' });
    }
};

/**
 * PUT /api/superadmin/partner-apps/:id/billing/:billId/mark-paid
 * Mark a billing entry as paid.
 */
exports.markBillPaid = async (req, res) => {
    try {
        const { id, billId } = req.params;
        const { notes } = req.body;

        const result = await PartnerApp.updateOne(
            { _id: id, 'billingHistory._id': billId },
            {
                $set: {
                    'billingHistory.$.status': 'paid',
                    'billingHistory.$.paidAt': new Date(),
                    'billingHistory.$.notes': notes || ''
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Bill not found.' });
        }

        res.json({ success: true, message: 'Bill marked as paid.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to mark bill as paid.' });
    }
};

/**
 * GET /api/superadmin/partner-apps/:id/api-usage
 * Get API usage stats (last 30 days) for the API Key tab chart.
 */
exports.getApiUsage = async (req, res) => {
    try {
        const partner = await PartnerApp.findById(req.params.id)
            .select('apiUsage')
            .lean();

        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        res.json({
            success: true,
            data: (partner.apiUsage || []).sort((a, b) => b.date.localeCompare(a.date))
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get API usage.' });
    }
};

/**
 * PUT /api/superadmin/partner-apps/:id/accounts/:accountId/freeze
 */
exports.freezePartnerAccount = async (req, res) => {
    try {
        const { id, accountId } = req.params;

        // Verify account belongs to this partner
        const partner = await PartnerApp.findById(id).select('accountIds').lean();
        if (!partner?.accountIds?.some(a => a.toString() === accountId)) {
            return res.status(404).json({ success: false, message: 'Account not found under this partner.' });
        }

        await User.updateOne(
            { _id: accountId },
            { $set: { accountStatus: 'Frozen', is_active: false } }
        );

        res.json({ success: true, message: 'Account frozen.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to freeze account.' });
    }
};

/**
 * PUT /api/superadmin/partner-apps/:id/accounts/:accountId/unfreeze
 */
exports.unfreezePartnerAccount = async (req, res) => {
    try {
        const { id, accountId } = req.params;

        const partner = await PartnerApp.findById(id).select('accountIds').lean();
        if (!partner?.accountIds?.some(a => a.toString() === accountId)) {
            return res.status(404).json({ success: false, message: 'Account not found under this partner.' });
        }

        await User.updateOne(
            { _id: accountId },
            { $set: { accountStatus: 'Active', is_active: true } }
        );

        res.json({ success: true, message: 'Account unfrozen.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to unfreeze account.' });
    }
};

/**
 * DELETE /api/superadmin/partner-apps/:id/accounts/:accountId
 * Delete a partner's account (removes user + workspace + config).
 */
exports.deletePartnerAccount = async (req, res) => {
    try {
        const { id, accountId } = req.params;

        // Remove from partner's account list
        await PartnerApp.updateOne(
            { _id: id },
            { $pull: { accountIds: accountId } }
        );

        // Delete user and related data
        await Promise.all([
            User.deleteOne({ _id: accountId }),
            WorkspaceSettings.deleteOne({ userId: accountId }),
            IntegrationConfig.deleteOne({ userId: accountId })
        ]);

        // We could call clearCacheForTenant here, but clearCacheForPartner is safe
        await clearCacheForPartner(id);

        res.json({ success: true, message: 'Account deleted.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to delete account.' });
    }
};
