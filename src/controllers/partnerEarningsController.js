const User = require('../models/User');
const CommissionLog = require('../models/CommissionLog');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const SystemSetting = require('../models/SystemSetting');
const mongoose = require('mongoose');
const auditLogger = require('../services/auditLogger');

// Single source of truth — imported from the model to avoid drift (L-4 fix)
const MIN_WITHDRAWAL = WithdrawalRequest.MIN_WITHDRAWAL || 5000;
const MAX_WITHDRAWAL = 500000; // ₹5 lakh per request ceiling (M-1)

// IFSC: 4 alpha + 0 + 6 alphanumeric (RBI format)
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/agency/partner/earnings
// Returns KPIs + commission history + withdrawal history for the agency
// ─────────────────────────────────────────────────────────────────────────────
const getPartnerEarnings = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 30); // M-3: paginated

        // Agency record — balance / totals
        const agency = await User.findById(agencyId)
            .select('commissionBalance totalCommissionEarned bankDetails companyName name')
            .lean();
        if (!agency) return res.status(404).json({ message: 'Agency not found.' });

        // Count referred + active subscribed clients
        const [totalReferred, activeSubscribed] = await Promise.all([
            User.countDocuments({ parentId: new mongoose.Types.ObjectId(agencyId), role: 'manager' }),
            User.countDocuments({
                parentId: new mongoose.Types.ObjectId(agencyId),
                role: 'manager',
                is_active: true,
                approved_by_admin: true
            })
        ]);

        // Earnings this calendar month (sum of CommissionLog.amount)
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const earningsThisMonthAgg = await CommissionLog.aggregate([
            {
                $match: {
                    agencyId: new mongoose.Types.ObjectId(agencyId),
                    createdAt: { $gte: monthStart }
                }
            },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);
        const earningsThisMonth = earningsThisMonthAgg[0]?.total || 0;

        // Current commission tier (for the "Your Tier" widget)
        const tierSetting = await SystemSetting.findOne({ key: 'AGENCY_COMMISSION_TIERS' }).lean();
        const tiers = Array.isArray(tierSetting?.value) ? tierSetting.value : [];
        const sortedTiers = [...tiers].sort((a, b) => a.minClients - b.minClients);
        const currentTier = [...sortedTiers].reverse().find(t => activeSubscribed >= t.minClients) || null;
        const nextTier = currentTier
            ? sortedTiers.find(t => t.minClients > (currentTier?.minClients ?? 0)) || null
            : sortedTiers[0] || null;

        // Commission history — paginated (M-3)
        const skip = (page - 1) * limit;
        const [commissionHistory, commissionTotal] = await Promise.all([
            CommissionLog.find({ agencyId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('clientName subscriptionAmount commissionRateApplied amount createdAt billingCycle')
                .lean(),
            CommissionLog.countDocuments({ agencyId })
        ]);

        // Withdrawal history — paginated (M-3)
        const [withdrawals, withdrawalTotal] = await Promise.all([
            WithdrawalRequest.find({ agencyId })
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .select('amount status createdAt processedAt transactionRef rejectionReason bankDetailsSnapshot')
                .lean(),
            WithdrawalRequest.countDocuments({ agencyId })
        ]);

        // Is there already a pending request? (M-2 info for UI)
        const hasPendingRequest = await WithdrawalRequest.exists({ agencyId, status: 'pending' });

        return res.json({
            success: true,
            kpi: {
                totalReferred,
                activeSubscribed,
                earningsThisMonth,
                availableBalance: agency.commissionBalance,
                totalEarned: agency.totalCommissionEarned
            },
            tier: {
                current: currentTier,
                next: nextTier,
                activeClients: activeSubscribed,
                allTiers: sortedTiers
            },
            commissionHistory,
            commissionTotal,
            withdrawals,
            withdrawalTotal,
            bankDetails: agency.bankDetails || {},
            minWithdrawal: MIN_WITHDRAWAL,
            maxWithdrawal: MAX_WITHDRAWAL,
            hasPendingRequest: !!hasPendingRequest,
            page,
            limit
        });
    } catch (err) {
        console.error('getPartnerEarnings error:', err);
        res.status(500).json({ message: 'Failed to fetch partner earnings.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/agency/partner/bank-details
// Update the agency's bank details for payouts
// ─────────────────────────────────────────────────────────────────────────────
const updateBankDetails = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;
        const { accountName, accountNumber, ifscCode, bankName, upiId } = req.body;

        if (!accountName && !accountNumber && !ifscCode && !bankName && !upiId) {
            return res.status(400).json({ message: 'At least one bank detail field is required.' });
        }

        // M-6: Format validation
        if (ifscCode) {
            const code = ifscCode.trim().toUpperCase();
            if (!IFSC_REGEX.test(code)) {
                return res.status(400).json({ message: 'Invalid IFSC code format. Expected: 4 letters + 0 + 6 alphanumeric (e.g. HDFC0001234).' });
            }
        }
        if (accountNumber) {
            const acc = accountNumber.trim();
            if (!/^\d{9,18}$/.test(acc)) {
                return res.status(400).json({ message: 'Account number must be 9–18 digits with no spaces or letters.' });
            }
        }
        if (upiId) {
            const upi = upiId.trim();
            if (!/^[\w.\-]+@[\w]+$/.test(upi)) {
                return res.status(400).json({ message: 'Invalid UPI ID format (e.g. name@upi).' });
            }
        }

        const update = {};
        if (accountName   !== undefined) update['bankDetails.accountName']   = accountName.trim();
        if (accountNumber !== undefined) update['bankDetails.accountNumber'] = accountNumber.trim();
        if (ifscCode      !== undefined) update['bankDetails.ifscCode']      = ifscCode.trim().toUpperCase();
        if (bankName      !== undefined) update['bankDetails.bankName']      = bankName.trim();
        if (upiId         !== undefined) update['bankDetails.upiId']         = upiId.trim();

        await User.findByIdAndUpdate(agencyId, { $set: update });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'AGENCY_MANAGEMENT',
            action: 'AGENCY_BANK_DETAILS_UPDATED',
            targetType: 'User',
            targetId: agencyId,
            details: { fields: Object.keys(update) },
            req
        });

        return res.json({ success: true, message: 'Bank details updated successfully.' });
    } catch (err) {
        console.error('updateBankDetails error:', err);
        res.status(500).json({ message: 'Failed to update bank details.' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/agency/partner/withdraw
//
// IMPORTANT — Manual payout model:
// This endpoint ONLY records the withdrawal request. No balance is deducted here.
// The Adfliker team manually transfers money from their bank account and then
// the super admin enters the transaction reference and marks it as completed.
// The commissionBalance is only deducted when the admin marks it "completed".
//
// Rules enforced:
//   • Amount must be a whole number (integer rupees, no paise)
//   • Minimum ₹5,000 · Maximum ₹5,00,000 per request
//   • Bank or UPI details must be saved first
//   • Only one pending request allowed at a time (prevents spam / confusion)
//   • Balance must be >= requested amount (sanity check for accounting accuracy)
// ─────────────────────────────────────────────────────────────────────────────
const requestWithdrawal = async (req, res) => {
    try {
        const agencyId = req.user.userId || req.user.id;

        // H-3: Enforce whole-rupee integer amounts
        const amount = Math.floor(Number(req.body.amount));

        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ message: 'A valid withdrawal amount is required.' });
        }
        if (amount < MIN_WITHDRAWAL) {
            return res.status(400).json({
                message: `Minimum withdrawal amount is ₹${MIN_WITHDRAWAL.toLocaleString('en-IN')}.`
            });
        }
        if (amount > MAX_WITHDRAWAL) {
            return res.status(400).json({
                message: `Maximum single withdrawal is ₹${MAX_WITHDRAWAL.toLocaleString('en-IN')}. Contact support for larger payouts.`
            });
        }

        // H-2: Fetch agency to validate bank details BEFORE touching any balance
        const agency = await User.findById(agencyId)
            .select('companyName name bankDetails commissionBalance')
            .lean();
        if (!agency) return res.status(404).json({ message: 'Agency not found.' });

        // H-2: Validate bank details first
        const bd = agency.bankDetails;
        if (!bd?.accountNumber && !bd?.upiId) {
            return res.status(400).json({
                message: 'Please add your bank account or UPI details before requesting a withdrawal.'
            });
        }

        // Sanity check: balance should cover the request (accounting accuracy)
        if ((agency.commissionBalance || 0) < amount) {
            return res.status(400).json({
                message: `Insufficient balance. Available: ₹${(agency.commissionBalance || 0).toLocaleString('en-IN')}.`
            });
        }

        // M-2: Block if a pending request already exists
        const existingPending = await WithdrawalRequest.exists({ agencyId, status: 'pending' });
        if (existingPending) {
            return res.status(429).json({
                message: 'You already have a pending withdrawal request. Please wait for it to be processed before submitting a new one.'
            });
        }

        // Record the request — NO balance deduction here.
        // Balance will only be deducted when the super admin marks it as "completed"
        // after confirming the manual bank transfer has been done.
        const withdrawal = await WithdrawalRequest.create({
            agencyId,
            agencyName: agency.companyName || agency.name || '',
            amount,
            status: 'pending',
            bankDetailsSnapshot: {
                accountName:   bd.accountName   || '',
                accountNumber: bd.accountNumber || '',
                ifscCode:      bd.ifscCode      || '',
                bankName:      bd.bankName      || '',
                upiId:         bd.upiId         || ''
            }
        });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'AGENCY_MANAGEMENT',
            action: 'AGENCY_WITHDRAWAL_REQUESTED',
            targetType: 'WithdrawalRequest',
            targetId: withdrawal._id,
            details: { amount, currentBalance: agency.commissionBalance },
            req
        });

        return res.status(201).json({
            success: true,
            message: `Withdrawal request for ₹${amount.toLocaleString('en-IN')} submitted. The Adfliker team will process it and notify you once done.`,
            withdrawal: {
                _id: withdrawal._id,
                amount: withdrawal.amount,
                status: withdrawal.status,
                createdAt: withdrawal.createdAt
            }
        });
    } catch (err) {
        console.error('requestWithdrawal error:', err);
        res.status(500).json({ message: 'Failed to submit withdrawal request.' });
    }
};

module.exports = {
    getPartnerEarnings,
    updateBankDetails,
    requestWithdrawal
};
