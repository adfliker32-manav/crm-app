const User = require('../models/User');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const CommissionLog = require('../models/CommissionLog');
const SystemSetting = require('../models/SystemSetting');
const mongoose = require('mongoose');
const auditLogger = require('../services/auditLogger');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/partner/withdrawals
// List all withdrawal requests — most recent first, filterable by status
// ─────────────────────────────────────────────────────────────────────────────
const listWithdrawals = async (req, res) => {
    try {
        const { status, page = 1, limit = 30 } = req.query;
        const filter = {};
        if (status && ['pending', 'completed', 'rejected'].includes(status)) {
            filter.status = status;
        }

        const skip = (Number(page) - 1) * Number(limit);
        const [withdrawals, total] = await Promise.all([
            WithdrawalRequest.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(Number(limit))
                .populate('agencyId', 'name companyName email')
                .populate('processedBy', 'name email')
                .lean(),
            WithdrawalRequest.countDocuments(filter)
        ]);

        // Pending count for badge
        const pendingCount = await WithdrawalRequest.countDocuments({ status: 'pending' });

        return res.json({ success: true, withdrawals, total, pendingCount });
    } catch (err) {
        console.error('listWithdrawals error:', err);
        res.status(500).json({ message: 'Failed to fetch withdrawal requests.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/superadmin/partner/withdrawals/:id/process
// Mark a withdrawal as completed or rejected.
// On rejection: refund the balance back to the agency.
// ─────────────────────────────────────────────────────────────────────────────
const processWithdrawal = async (req, res) => {
    try {
        const { id } = req.params;
        const { action, transactionRef, rejectionReason, adminNotes } = req.body;
        const adminId = req.user.userId || req.user.id;

        if (!['completed', 'rejected'].includes(action)) {
            return res.status(400).json({ message: 'Action must be "completed" or "rejected".' });
        }

        // Atomically claim the pending withdrawal in one DB round-trip.
        // If already processed, the status !== 'pending' guard fires here — not after.
        const withdrawal = await WithdrawalRequest.findOneAndUpdate(
            { _id: id, status: 'pending' },
            {
                $set: {
                    status:      action,
                    processedAt: new Date(),
                    processedBy: adminId,
                    ...(transactionRef  && { transactionRef }),
                    ...(rejectionReason && { rejectionReason }),
                    ...(adminNotes      && { adminNotes })
                }
            },
            { new: true }
        );

        if (!withdrawal) {
            // Could not find a *pending* withdrawal with this ID → already processed
            const existing = await WithdrawalRequest.findById(id).lean();
            if (!existing) return res.status(404).json({ message: 'Withdrawal request not found.' });
            return res.status(409).json({
                message: `This request has already been ${existing.status}. No changes made.`
            });
        }

        // On completion: deduct commissionBalance now (manual transfer has been confirmed)
        // On rejection: do nothing — nothing was deducted when the request was submitted
        if (action === 'completed') {
            await User.findByIdAndUpdate(withdrawal.agencyId, {
                $inc: { commissionBalance: -withdrawal.amount }
            });
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'FINANCE',
            action: action === 'completed' ? 'WITHDRAWAL_COMPLETED' : 'WITHDRAWAL_REJECTED',
            targetType: 'WithdrawalRequest',
            targetId: withdrawal._id,
            details: {
                agencyId: withdrawal.agencyId,
                amount: withdrawal.amount,
                transactionRef,
                rejectionReason
            },
            req
        });

        return res.json({
            success: true,
            message: `Withdrawal ${action} successfully.`,
            withdrawal: {
                _id:            withdrawal._id,
                status:         withdrawal.status,
                processedAt:    withdrawal.processedAt,
                transactionRef: withdrawal.transactionRef
            }
        });
    } catch (err) {
        console.error('processWithdrawal error:', err);
        res.status(500).json({ message: 'Failed to process withdrawal.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/partner/commission-tiers
// Return current tier configuration
// ─────────────────────────────────────────────────────────────────────────────
const getCommissionTiers = async (req, res) => {
    try {
        const setting = await SystemSetting.findOne({ key: 'AGENCY_COMMISSION_TIERS' }).lean();
        const tiers = Array.isArray(setting?.value) ? setting.value : [];
        return res.json({ success: true, tiers });
    } catch (err) {
        console.error('getCommissionTiers error:', err);
        res.status(500).json({ message: 'Failed to fetch commission tiers.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/superadmin/partner/commission-tiers
// Upsert the global commission tier rules.
// Body: { tiers: [{ minClients, maxClients, percentage, label }] }
// ─────────────────────────────────────────────────────────────────────────────
const updateCommissionTiers = async (req, res) => {
    try {
        const { tiers } = req.body;
        if (!Array.isArray(tiers) || tiers.length === 0) {
            return res.status(400).json({ message: 'tiers must be a non-empty array.' });
        }

        // Validate each tier
        for (const t of tiers) {
            if (typeof t.minClients !== 'number' || typeof t.percentage !== 'number') {
                return res.status(400).json({ message: 'Each tier must have numeric minClients and percentage.' });
            }
            if (t.percentage < 0 || t.percentage > 100) {
                return res.status(400).json({ message: 'percentage must be between 0 and 100.' });
            }
        }

        const adminId = req.user.userId || req.user.id;

        await SystemSetting.findOneAndUpdate(
            { key: 'AGENCY_COMMISSION_TIERS' },
            {
                $set: {
                    value: tiers,
                    description: 'Dynamic agency partner commission tiers by active client count',
                    updatedBy: adminId,
                    updatedAt: new Date()
                }
            },
            { upsert: true }
        );

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SYSTEM',
            action: 'COMMISSION_TIERS_UPDATED',
            targetType: 'SystemSetting',
            details: { tiers },
            req
        });

        return res.json({ success: true, message: 'Commission tiers updated.', tiers });
    } catch (err) {
        console.error('updateCommissionTiers error:', err);
        res.status(500).json({ message: 'Failed to update commission tiers.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/partner/agencies
// List all agencies with their commission stats
// ─────────────────────────────────────────────────────────────────────────────
const listAgencyPartnerStats = async (req, res) => {
    try {
        const agencies = await User.find({ role: 'agency' })
            .select('name companyName email commissionBalance totalCommissionEarned bankDetails createdAt')
            .sort({ totalCommissionEarned: -1 })
            .lean();

        // Enrich each agency with client counts and pending withdrawal info
        const agencyIds = agencies.map(a => a._id);

        const [clientCounts, pendingWithdrawals] = await Promise.all([
            User.aggregate([
                { $match: { parentId: { $in: agencyIds }, role: 'manager' } },
                { $group: { _id: '$parentId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$is_active', true] }, 1, 0] } } } }
            ]),
            WithdrawalRequest.aggregate([
                { $match: { agencyId: { $in: agencyIds }, status: 'pending' } },
                { $group: { _id: '$agencyId', pendingAmount: { $sum: '$amount' }, count: { $sum: 1 } } }
            ])
        ]);

        const clientMap = {};
        clientCounts.forEach(c => { clientMap[c._id.toString()] = { total: c.total, active: c.active }; });
        const withdrawalMap = {};
        pendingWithdrawals.forEach(w => { withdrawalMap[w._id.toString()] = { pendingAmount: w.pendingAmount, count: w.count }; });

        const enriched = agencies.map(a => ({
            ...a,
            // H-4: Mask account numbers — never send full numbers even to super admin in list view
            bankDetails: a.bankDetails ? {
                bankName:      a.bankDetails.bankName      || '',
                accountNumber: a.bankDetails.accountNumber
                    ? `•••${String(a.bankDetails.accountNumber).slice(-4)}`
                    : '',
                upiId:         a.bankDetails.upiId         || ''
            } : {},
            clients:           clientMap[a._id.toString()]      || { total: 0, active: 0 },
            pendingWithdrawals: withdrawalMap[a._id.toString()] || { pendingAmount: 0, count: 0 }
        }));

        return res.json({ success: true, agencies: enriched });
    } catch (err) {
        console.error('listAgencyPartnerStats error:', err);
        res.status(500).json({ message: 'Failed to fetch agency partner stats.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/superadmin/partner/analytics
// Super Admin financial liability and payout analytics
// ─────────────────────────────────────────────────────────────────────────────
const getAgencyManagementAnalytics = async (req, res) => {
    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

        // 1. Unclaimed Liability (Sum of all agency commission balances)
        // 2. Agency Growth Stats
        const agencies = await User.find({ role: 'agency' })
            .select('commissionBalance isFrozen is_active isSuspended createdAt')
            .lean();

        let unclaimedLiability = 0;
        let activeAgencies = 0;
        let frozenAgencies = 0;
        let newThisMonth = 0;

        agencies.forEach(a => {
            unclaimedLiability += (a.commissionBalance || 0);
            if (a.isFrozen || a.isSuspended || a.is_active === false) frozenAgencies++;
            else activeAgencies++;
            if (a.createdAt && new Date(a.createdAt) >= monthStart) newThisMonth++;
        });

        // 3. Payout Analytics (Pending / Paid This Month / Lifetime)
        const [pendingAgg, monthPaidAgg, lifetimePaidAgg] = await Promise.all([
            WithdrawalRequest.aggregate([
                { $match: { status: 'pending' } },
                { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]),
            WithdrawalRequest.aggregate([
                { $match: { status: 'completed', processedAt: { $gte: monthStart } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            WithdrawalRequest.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ])
        ]);

        return res.json({
            success: true,
            analytics: {
                unclaimedLiability,
                pendingLiability: pendingAgg[0]?.total || 0,
                pendingRequests: pendingAgg[0]?.count || 0,
                paidThisMonth: monthPaidAgg[0]?.total || 0,
                lifetimePaid: lifetimePaidAgg[0]?.total || 0,
                agencyGrowth: {
                    total: agencies.length,
                    active: activeAgencies,
                    frozen: frozenAgencies,
                    newThisMonth
                }
            }
        });

    } catch (err) {
        console.error('getAgencyManagementAnalytics error:', err);
        res.status(500).json({ message: 'Failed to fetch agency management analytics.' });
    }
};

module.exports = {
    listWithdrawals,
    processWithdrawal,
    getCommissionTiers,
    updateCommissionTiers,
    listAgencyPartnerStats,
    getAgencyManagementAnalytics
};
