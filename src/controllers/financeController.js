const Payment = require('../models/Payment');
const Expense = require('../models/Expense');
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const Plan = require('../models/Plan');
const auditLogger = require('../services/auditLogger');
const mongoose = require('mongoose');

const GRACE_DAYS = 7;        // Buffer after planExpiryDate before access is denied.
const DEFAULT_TRIAL_DAYS = 14; // Default free-trial length for new accounts.

/**
 * Add `months` to a date, preserving end-of-month behaviour.
 * (Native JS Date.setMonth handles overflow, e.g. Jan 31 + 1 month → Mar 3.
 * That's acceptable for billing purposes — caller can still see the exact end date.)
 */
const addMonths = (date, months) => {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
};

// ============================================================
// 💰 RECORD PAYMENT
// ============================================================
// POST /api/superadmin/finance/payments
// Body: { clientId, amount, durationMonths, paymentDate, paymentMethod, reference, notes }
//
// Stacking: if the client's current `planExpiryDate` is in the future, the new period
// starts from that expiry (so renewals extend instead of resetting). Otherwise the
// period starts from `paymentDate` (treats lapsed renewals as fresh activations).
const recordPayment = async (req, res) => {
    try {
        const { clientId, amount, durationMonths, paymentDate, paymentMethod, reference, notes, planCode } = req.body;

        if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
            return res.status(400).json({ message: 'Valid clientId is required.' });
        }
        if (amount === undefined || amount === null || Number(amount) < 0) {
            return res.status(400).json({ message: 'Amount must be a non-negative number.' });
        }
        const months = parseInt(durationMonths, 10);
        if (!months || months < 1 || months > 60) {
            return res.status(400).json({ message: 'Duration must be between 1 and 60 months.' });
        }

        // Only managers (agency sub-clients + direct clients) are billable.
        // Agencies are forever-free distribution partners and cannot be charged.
        const client = await User.findOne({ _id: clientId, role: 'manager' });
        if (!client) {
            const exists = await User.findById(clientId).select('role').lean();
            if (exists?.role === 'agency') {
                return res.status(400).json({ message: 'Agencies have lifetime-free access and cannot be charged. Record the payment against one of their sub-clients instead.' });
            }
            return res.status(404).json({ message: 'Billable client not found.' });
        }

        const Subscription = require('../models/Subscription');
        const [workspace, existingSub] = await Promise.all([
            WorkspaceSettings.findOne({ userId: clientId }),
            Subscription.findOne({ clientId, status: 'pending_auth' }).select('status').lean()
        ]);
        const now = new Date();
        const payDate = paymentDate ? new Date(paymentDate) : now;

        // Stacking logic: extend from existing expiry if it's still in the future.
        const currentExpiry = workspace?.planExpiryDate ? new Date(workspace.planExpiryDate) : null;
        const baselineForStart = currentExpiry && currentExpiry > now ? currentExpiry : payDate;
        const activationStart = baselineForStart;
        const activationEnd = addMonths(activationStart, months);

        const payment = await Payment.create({
            clientId,
            clientName: client.companyName || client.name || '',
            clientEmail: client.email,
            clientRole: client.role,
            amount: Number(amount),
            currency: 'INR',
            paymentDate: payDate,
            durationMonths: months,
            activationStart,
            activationEnd,
            paymentMethod: paymentMethod || 'bank_transfer',
            reference: reference || '',
            notes: notes || '',
            recordedBy: req.user?.id || req.user?.userId || null
        });

        // Build the workspace update. Status flips to 'active' so the lapse check
        // (and frontend banners) reflect the paid state — restoring full access
        // instantly for a previously read-only (lapsed) account.
        // Exception: if the client has an open Razorpay mandate awaiting authorization
        // (pending_auth), keep that status so the UI shows the correct pending state;
        // the expiry extension still takes effect immediately.
        const workspaceSet = {
            planExpiryDate: activationEnd,
            lastPaymentDate: payDate,
            ...(!existingSub ? { subscriptionStatus: 'active' } : {})
        };

        // Optional: assign a plan tier with this cash/manual payment. Copies the
        // tier's modules + feature flags + limits onto the workspace so a cash
        // payer gets the same access an autodebit subscriber would (e.g. "cash for
        // Pro, 1 year"). Without planCode, only the date/status change (legacy).
        let appliedPlan = null;
        if (planCode) {
            appliedPlan = await Plan.findOne({ code: String(planCode).toLowerCase() });
            if (!appliedPlan) {
                return res.status(400).json({ message: `Plan "${planCode}" not found.` });
            }
            workspaceSet.currentPlanCode = appliedPlan.code;
            workspaceSet.subscriptionPlan = appliedPlan.name;
            workspaceSet.activeModules = appliedPlan.activeModules || ['leads', 'team', 'reports'];
            workspaceSet.planFeatures = {
                ...(appliedPlan.planFeatures || {}),
                leadLimit: appliedPlan.planFeatures?.leadLimit ?? 100,
                agentLimit: appliedPlan.planFeatures?.agentLimit ?? 5
            };
            workspaceSet.agentLimit = appliedPlan.planFeatures?.agentLimit ?? 5;
        }

        await WorkspaceSettings.findOneAndUpdate(
            { userId: clientId },
            { $set: workspaceSet },
            { upsert: true, setDefaultsOnInsert: true }
        );

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'PAYMENT_RECORDED',
            targetType: 'User',
            targetId: client._id,
            targetName: client.companyName || client.name,
            details: {
                amount: Number(amount),
                durationMonths: months,
                activationStart,
                activationEnd,
                paymentMethod
            },
            req
        });

        res.status(201).json({
            success: true,
            message: `₹${Number(amount).toLocaleString()} recorded for ${client.companyName || client.name}. Active until ${activationEnd.toLocaleDateString('en-IN')}.`,
            payment,
            newExpiryDate: activationEnd
        });
    } catch (err) {
        console.error('Record Payment Error:', err);
        res.status(500).json({ message: 'Failed to record payment.' });
    }
};

// ============================================================
// 📋 LIST PAYMENTS
// ============================================================
// GET /api/superadmin/finance/payments?clientId=&from=&to=&method=&page=&limit=
const listPayments = async (req, res) => {
    try {
        const { clientId, from, to, method, page = 1, limit = 50 } = req.query;
        const query = {};

        if (clientId && mongoose.Types.ObjectId.isValid(clientId)) query.clientId = clientId;
        if (method) query.paymentMethod = method;
        if (from || to) {
            query.paymentDate = {};
            if (from) query.paymentDate.$gte = new Date(from);
            if (to)   query.paymentDate.$lte = new Date(to);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [payments, total] = await Promise.all([
            Payment.find(query).sort({ paymentDate: -1 }).skip(skip).limit(parseInt(limit)).lean(),
            Payment.countDocuments(query)
        ]);

        res.json({ success: true, payments, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        console.error('List Payments Error:', err);
        res.status(500).json({ message: 'Failed to fetch payments.' });
    }
};

// ============================================================
// 🗑️ DELETE PAYMENT
// ============================================================
// DELETE /api/superadmin/finance/payments/:id
//
// Deleting a payment ROLLS BACK the access it granted. We recompute the client's
// paid-through date from the REMAINING payments (each stores its own activationEnd,
// which already encodes the stacking that was applied when it was recorded). If no
// payments remain, we fall back to the deleted payment's activationStart — the
// expiry that existed BEFORE this payment was applied. We only ever move the expiry
// EARLIER, and only when this payment was actually governing the current expiry, so
// deleting an old/superseded payment leaves a still-valid window untouched.
const deletePayment = async (req, res) => {
    try {
        const { id } = req.params;
        const payment = await Payment.findById(id);
        if (!payment) return res.status(404).json({ message: 'Payment not found.' });

        const clientId = payment.clientId;
        const deletedActivationStart = payment.activationStart ? new Date(payment.activationStart) : null;

        await Payment.findByIdAndDelete(id);

        const now = new Date();
        let rolledBack = false;
        let newExpiry = null;

        const ws = await WorkspaceSettings.findOne({ userId: clientId })
            .select('planExpiryDate subscriptionStatus').lean();

        if (ws) {
            // Remaining payments for this client (manual + autodebit). Each row's
            // activationEnd is the period it paid through; the latest = paid-through.
            const remaining = await Payment.find({ clientId })
                .select('activationEnd paymentDate').lean();

            const maxEnd = remaining.reduce((max, p) => {
                const e = p.activationEnd ? new Date(p.activationEnd) : null;
                return e && (!max || e > max) ? e : max;
            }, null);
            newExpiry = maxEnd || deletedActivationStart;

            const current = ws.planExpiryDate ? new Date(ws.planExpiryDate) : null;
            // Only roll back when this deletion actually shortens the paid window.
            if (newExpiry && current && newExpiry < current) {
                const set = { planExpiryDate: newExpiry };

                const latestPayDate = remaining.reduce((max, p) => {
                    const d = p.paymentDate ? new Date(p.paymentDate) : null;
                    return d && (!max || d > max) ? d : max;
                }, null);
                if (latestPayDate) set.lastPaymentDate = latestPayDate;

                // If the rolled-back window is already in the past, drop the account
                // to read-only. Don't touch a pending mandate's status.
                if (newExpiry <= now && ws.subscriptionStatus !== 'pending_auth') {
                    set.subscriptionStatus = 'expired';
                }

                await WorkspaceSettings.updateOne({ userId: clientId }, { $set: set });

                // updateOne bypasses the per-doc cache-clear hook — clear explicitly so
                // the access change is live on the client's next request.
                try {
                    const { clearTenantCache } = require('../middleware/authMiddleware');
                    clearTenantCache(clientId);
                } catch { /* cache module optional */ }

                rolledBack = true;
            }
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'PAYMENT_DELETED',
            targetType: 'User',
            targetId: payment.clientId,
            targetName: payment.clientName,
            details: {
                amount: payment.amount,
                paymentDate: payment.paymentDate,
                rolledBack,
                ...(rolledBack ? { newExpiry } : {})
            },
            req
        });

        const nowExpired = rolledBack && newExpiry <= now;
        res.json({
            success: true,
            rolledBack,
            newExpiryDate: rolledBack ? newExpiry : (ws?.planExpiryDate || null),
            message: rolledBack
                ? `Payment removed and plan rolled back — client paid through ${new Date(newExpiry).toLocaleDateString('en-IN')}${nowExpired ? ' (already passed → account is now read-only)' : ''}.`
                : 'Payment record removed. Client expiry unchanged (this payment was already superseded by a later one).'
        });
    } catch (err) {
        console.error('Delete Payment Error:', err);
        res.status(500).json({ message: 'Failed to delete payment.' });
    }
};

// ============================================================
// 💸 EXPENSES — CRUD
// ============================================================
const recordExpense = async (req, res) => {
    try {
        const { category, description, vendor, amount, date, paymentMethod, reference, notes } = req.body;
        if (!description || amount === undefined || Number(amount) <= 0) {
            return res.status(400).json({ message: 'Description and a non-negative amount are required.' });
        }

        const expense = await Expense.create({
            category: category || 'other',
            description,
            vendor: vendor || '',
            amount: Number(amount),
            currency: 'INR',
            date: date ? new Date(date) : new Date(),
            paymentMethod: paymentMethod || 'bank_transfer',
            reference: reference || '',
            notes: notes || '',
            recordedBy: req.user?.id || req.user?.userId || null
        });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'EXPENSE_RECORDED',
            details: { category: expense.category, amount: expense.amount, description: expense.description },
            req
        });

        res.status(201).json({ success: true, expense });
    } catch (err) {
        console.error('Record Expense Error:', err);
        res.status(500).json({ message: 'Failed to record expense.' });
    }
};

const listExpenses = async (req, res) => {
    try {
        const { category, from, to, page = 1, limit = 50 } = req.query;
        const query = {};
        if (category) query.category = category;
        if (from || to) {
            query.date = {};
            if (from) query.date.$gte = new Date(from);
            if (to)   query.date.$lte = new Date(to);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [expenses, total] = await Promise.all([
            Expense.find(query).sort({ date: -1 }).skip(skip).limit(parseInt(limit)).lean(),
            Expense.countDocuments(query)
        ]);

        res.json({ success: true, expenses, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (err) {
        console.error('List Expenses Error:', err);
        res.status(500).json({ message: 'Failed to fetch expenses.' });
    }
};

const deleteExpense = async (req, res) => {
    try {
        const { id } = req.params;
        const expense = await Expense.findByIdAndDelete(id);
        if (!expense) return res.status(404).json({ message: 'Expense not found.' });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'EXPENSE_DELETED',
            details: { category: expense.category, amount: expense.amount },
            req
        });

        res.json({ success: true, message: 'Expense removed.' });
    } catch (err) {
        console.error('Delete Expense Error:', err);
        res.status(500).json({ message: 'Failed to delete expense.' });
    }
};

// ============================================================
// 📊 FINANCE SUMMARY — dashboard aggregator
// ============================================================
// GET /api/superadmin/finance/summary
const getFinanceSummary = async (req, res) => {
    try {
        const now = new Date();
        const startOfThisMonth  = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const startOfSixMonths  = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const renewalWindowEnd  = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const graceEndIfExpired = new Date(now.getTime() - GRACE_DAYS * 24 * 60 * 60 * 1000);

        const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const [
            lifetimeRevenueAgg,
            thisMonthRevenueAgg,
            lastMonthRevenueAgg,
            sixMonthRevenueAgg,
            lifetimeExpenseAgg,
            thisMonthExpenseAgg,
            payingClientsAgg,
            renewalsDueSoon,
            topClientsAgg,
            revenueByMonth,
            expensesByMonth,
            paymentMethodBreakdown,
            expenseCategoryBreakdown,
            trialsActiveAgg,
            trialsExpiringSoonAgg
        ] = await Promise.all([
            Payment.aggregate([{ $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
            Payment.aggregate([
                { $match: { paymentDate: { $gte: startOfThisMonth } } },
                { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]),
            Payment.aggregate([
                { $match: { paymentDate: { $gte: startOfLastMonth, $lt: startOfThisMonth } } },
                { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]),
            Payment.aggregate([
                { $match: { paymentDate: { $gte: startOfSixMonths } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Expense.aggregate([{ $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
            Expense.aggregate([
                { $match: { date: { $gte: startOfThisMonth } } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            // Currently paying = activationEnd is in the future for at least one payment
            Payment.aggregate([
                { $match: { activationEnd: { $gte: now } } },
                { $group: { _id: '$clientId' } },
                { $count: 'count' }
            ]),
            // Renewals due in next 30 days — group per client and pick max activationEnd
            Payment.aggregate([
                { $group: { _id: '$clientId', clientName: { $last: '$clientName' }, clientEmail: { $last: '$clientEmail' }, latestExpiry: { $max: '$activationEnd' } } },
                { $match: { latestExpiry: { $gte: graceEndIfExpired, $lte: renewalWindowEnd } } },
                { $sort: { latestExpiry: 1 } },
                { $limit: 20 }
            ]),
            Payment.aggregate([
                { $group: { _id: '$clientId', clientName: { $last: '$clientName' }, clientEmail: { $last: '$clientEmail' }, total: { $sum: '$amount' }, payments: { $sum: 1 } } },
                { $sort: { total: -1 } },
                { $limit: 5 }
            ]),
            // 12-month revenue series
            Payment.aggregate([
                { $match: { paymentDate: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } } },
                {
                    $group: {
                        _id: { y: { $year: '$paymentDate' }, m: { $month: '$paymentDate' } },
                        total: { $sum: '$amount' }
                    }
                },
                { $sort: { '_id.y': 1, '_id.m': 1 } }
            ]),
            // 12-month expense series
            Expense.aggregate([
                { $match: { date: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } } },
                {
                    $group: {
                        _id: { y: { $year: '$date' }, m: { $month: '$date' } },
                        total: { $sum: '$amount' }
                    }
                },
                { $sort: { '_id.y': 1, '_id.m': 1 } }
            ]),
            Payment.aggregate([
                { $group: { _id: '$paymentMethod', total: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]),
            Expense.aggregate([
                { $group: { _id: '$category', total: { $sum: '$amount' }, count: { $sum: 1 } } }
            ]),
            // Active trials — workspaces marked as 'trial' that haven't expired yet
            // AND belong to a manager (agencies have lifetime-free access, never trial).
            WorkspaceSettings.aggregate([
                { $match: { subscriptionStatus: 'trial', planExpiryDate: { $gte: now } } },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                { $match: { 'user.role': 'manager' } },
                { $count: 'count' }
            ]),
            // Trials about to expire in the next 7 days — managers only.
            WorkspaceSettings.aggregate([
                { $match: { subscriptionStatus: 'trial', planExpiryDate: { $gte: now, $lte: sevenDays } } },
                {
                    $lookup: {
                        from: 'users',
                        localField: 'userId',
                        foreignField: '_id',
                        as: 'user'
                    }
                },
                { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
                { $match: { 'user.role': 'manager' } },
                { $sort: { planExpiryDate: 1 } },
                { $limit: 20 },
                {
                    $project: {
                        _id: '$userId',
                        clientName: { $ifNull: ['$user.companyName', '$user.name'] },
                        clientEmail: '$user.email',
                        trialExpiresAt: '$planExpiryDate'
                    }
                }
            ])
        ]);

        const lifetimeRevenue = lifetimeRevenueAgg[0]?.total || 0;
        const lifetimePaymentsCount = lifetimeRevenueAgg[0]?.count || 0;
        const thisMonthRevenue = thisMonthRevenueAgg[0]?.total || 0;
        const lastMonthRevenue = lastMonthRevenueAgg[0]?.total || 0;
        const sixMonthRevenue  = sixMonthRevenueAgg[0]?.total || 0;
        const avgMonthlyRevenue = Math.round(sixMonthRevenue / 6);

        const lifetimeExpense = lifetimeExpenseAgg[0]?.total || 0;
        const thisMonthExpense = thisMonthExpenseAgg[0]?.total || 0;
        const netProfit = lifetimeRevenue - lifetimeExpense;
        const thisMonthProfit = thisMonthRevenue - thisMonthExpense;

        const payingClients = payingClientsAgg[0]?.count || 0;
        const arpu = payingClients > 0 ? Math.round(thisMonthRevenue / payingClients) : 0;

        // Build 12-month label series
        const months = [];
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({ y: d.getFullYear(), m: d.getMonth() + 1, label: d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) });
        }
        const revenueMap = {};
        revenueByMonth.forEach(r => { revenueMap[`${r._id.y}-${r._id.m}`] = r.total; });
        const expenseMap = {};
        expensesByMonth.forEach(e => { expenseMap[`${e._id.y}-${e._id.m}`] = e.total; });

        const chart = {
            labels:  months.map(x => x.label),
            revenue: months.map(x => revenueMap[`${x.y}-${x.m}`] || 0),
            expense: months.map(x => expenseMap[`${x.y}-${x.m}`] || 0)
        };
        chart.profit = chart.revenue.map((r, i) => r - chart.expense[i]);

        const lastMonthDelta = lastMonthRevenue > 0
            ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
            : (thisMonthRevenue > 0 ? 100 : 0);

        const trialsActive = trialsActiveAgg[0]?.count || 0;

        res.json({
            success: true,
            currency: 'INR',
            trialDays: DEFAULT_TRIAL_DAYS,
            summary: {
                lifetimeRevenue,
                lifetimePaymentsCount,
                thisMonthRevenue,
                lastMonthRevenue,
                lastMonthDelta, // % change month-over-month
                avgMonthlyRevenue,
                lifetimeExpense,
                thisMonthExpense,
                netProfit,
                thisMonthProfit,
                payingClients,
                arpu,
                trialsActive
            },
            trialsExpiringSoon: trialsExpiringSoonAgg,
            renewalsDueSoon,
            topClients: topClientsAgg,
            chart,
            paymentMethodBreakdown,
            expenseCategoryBreakdown
        });
    } catch (err) {
        console.error('Finance Summary Error:', err);
        res.status(500).json({ message: 'Failed to compute finance summary.' });
    }
};

// ============================================================
// 👥 BILLABLE CLIENTS — list of users the SuperAdmin can charge.
// Used by the "Record Payment" modal client selector.
// ============================================================
const listBillableClients = async (req, res) => {
    try {
        const clients = await User.aggregate([
            // Only managers are billable — agencies have lifetime-free access.
            { $match: { role: 'manager' } },
            {
                $lookup: {
                    from: 'workspacesettings',
                    localField: '_id',
                    foreignField: 'userId',
                    as: 'workspace'
                }
            },
            { $unwind: { path: '$workspace', preserveNullAndEmptyArrays: true } },
            { $sort: { companyName: 1, name: 1 } },
            {
                $project: {
                    _id: 1,
                    companyName: 1,
                    name: 1,
                    email: 1,
                    role: 1,
                    parentId: 1,
                    planExpiryDate: '$workspace.planExpiryDate',
                    subscriptionStatus: '$workspace.subscriptionStatus',
                    isTrial: { $eq: ['$workspace.subscriptionStatus', 'trial'] }
                }
            }
        ]);
        res.json({ success: true, clients });
    } catch (err) {
        console.error('List Billable Clients Error:', err);
        res.status(500).json({ message: 'Failed to fetch clients.' });
    }
};

module.exports = {
    recordPayment,
    listPayments,
    deletePayment,
    recordExpense,
    listExpenses,
    deleteExpense,
    getFinanceSummary,
    listBillableClients,
    GRACE_DAYS
};
