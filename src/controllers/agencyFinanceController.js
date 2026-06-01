const AgencyClient  = require('../models/AgencyClient');
const AgencyPayment = require('../models/AgencyPayment');

// ─── CLIENTS ───────────────────────────────────────────────────────────────────

exports.listClients = async (req, res) => {
    try {
        const { status } = req.query;
        const filter = {};
        if (status) filter.status = status;
        const clients = await AgencyClient.find(filter).sort({ createdAt: -1 }).lean();
        res.json({ success: true, clients });
    } catch (err) {
        console.error('[AgencyFinance] listClients:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.createClient = async (req, res) => {
    try {
        const { name, email, phone, company, serviceType, monthlyFee, requirements, startDate, status, notes } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Client name is required.' });
        if (monthlyFee == null || isNaN(monthlyFee)) return res.status(400).json({ success: false, message: 'Monthly fee is required.' });

        const client = await AgencyClient.create({
            name: name.trim(), email, phone, company, serviceType,
            monthlyFee: Number(monthlyFee), requirements, startDate, status, notes
        });
        res.status(201).json({ success: true, client, message: 'Client added.' });
    } catch (err) {
        console.error('[AgencyFinance] createClient:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateClient = async (req, res) => {
    try {
        const client = await AgencyClient.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true, runValidators: true }
        );
        if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });
        res.json({ success: true, client, message: 'Client updated.' });
    } catch (err) {
        console.error('[AgencyFinance] updateClient:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deleteClient = async (req, res) => {
    try {
        const client = await AgencyClient.findByIdAndDelete(req.params.id);
        if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });
        // Remove associated payments
        await AgencyPayment.deleteMany({ agencyClientId: req.params.id });
        res.json({ success: true, message: 'Client and related payments deleted.' });
    } catch (err) {
        console.error('[AgencyFinance] deleteClient:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── PAYMENTS ──────────────────────────────────────────────────────────────────

exports.listPayments = async (req, res) => {
    try {
        const { clientId, month, year, status, limit = 200, page = 1 } = req.query;
        const filter = {};
        if (clientId) filter.agencyClientId = clientId;
        if (month)    filter.billingMonth = Number(month);
        if (year)     filter.billingYear  = Number(year);
        if (status)   filter.status = status;

        const skip = (Number(page) - 1) * Number(limit);
        const payments = await AgencyPayment
            .find(filter)
            .sort({ billingYear: -1, billingMonth: -1, createdAt: -1 })
            .skip(skip).limit(Number(limit))
            .lean();

        const total = await AgencyPayment.countDocuments(filter);
        res.json({ success: true, payments, total });
    } catch (err) {
        console.error('[AgencyFinance] listPayments:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.createPayment = async (req, res) => {
    try {
        const {
            agencyClientId, amount, billingMonth, billingYear,
            dueDate, status, receivedDate, receivedAmount,
            paymentMethod, reference, notes
        } = req.body;

        if (!agencyClientId) return res.status(400).json({ success: false, message: 'Client is required.' });
        if (!amount || isNaN(amount)) return res.status(400).json({ success: false, message: 'Amount is required.' });
        if (!billingMonth || !billingYear) return res.status(400).json({ success: false, message: 'Billing month and year are required.' });

        const client = await AgencyClient.findById(agencyClientId).lean();
        if (!client) return res.status(404).json({ success: false, message: 'Agency client not found.' });

        const payment = await AgencyPayment.create({
            agencyClientId,
            clientName:    client.name,
            clientCompany: client.company,
            amount: Number(amount),
            billingMonth: Number(billingMonth),
            billingYear:  Number(billingYear),
            dueDate:       dueDate || null,
            status:        status || 'pending',
            receivedDate:  status === 'received' ? (receivedDate || new Date()) : null,
            receivedAmount: status === 'partial'  ? Number(receivedAmount || 0) : null,
            paymentMethod, reference, notes,
            recordedBy: req.user?._id || null
        });

        res.status(201).json({ success: true, payment, message: 'Payment recorded.' });
    } catch (err) {
        console.error('[AgencyFinance] createPayment:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updatePayment = async (req, res) => {
    try {
        const update = { ...req.body };

        // Auto-set receivedDate if marking as received
        if (update.status === 'received' && !update.receivedDate) {
            update.receivedDate = new Date();
        }
        if (update.status === 'pending') {
            update.receivedDate   = null;
            update.receivedAmount = null;
        }

        const payment = await AgencyPayment.findByIdAndUpdate(
            req.params.id,
            { $set: update },
            { new: true, runValidators: true }
        );
        if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
        res.json({ success: true, payment, message: 'Payment updated.' });
    } catch (err) {
        console.error('[AgencyFinance] updatePayment:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.deletePayment = async (req, res) => {
    try {
        const payment = await AgencyPayment.findByIdAndDelete(req.params.id);
        if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });
        res.json({ success: true, message: 'Payment deleted.' });
    } catch (err) {
        console.error('[AgencyFinance] deletePayment:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── SUMMARY ───────────────────────────────────────────────────────────────────

exports.getSummary = async (req, res) => {
    try {
        const { month: monthStr, year: yearStr } = req.query;
        const now   = new Date();
        const month = monthStr ? Number(monthStr) : now.getMonth() + 1;
        const year  = yearStr  ? Number(yearStr)  : now.getFullYear();

        const [
            activeClients,
            totalClients,
            periodPayments,
            allTimeReceived,
            allTimePending,
            clientBreakdown,
            recentPayments,
            monthlyTrend
        ] = await Promise.all([
            // Active client count
            AgencyClient.countDocuments({ status: 'active' }),

            // Total client count
            AgencyClient.countDocuments({}),

            // All payments for selected month/year
            AgencyPayment.find({ billingMonth: month, billingYear: year }).lean(),

            // All-time total received
            AgencyPayment.aggregate([
                { $match: { status: { $in: ['received', 'partial'] } } },
                { $group: {
                    _id: null,
                    total: { $sum: {
                        $cond: [{ $eq: ['$status', 'partial'] }, '$receivedAmount', '$amount']
                    }}
                }}
            ]),

            // All-time total pending
            AgencyPayment.aggregate([
                { $match: { status: 'pending' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),

            // Per-client breakdown for selected month
            AgencyClient.aggregate([
                {
                    $lookup: {
                        from: 'agencypayments',
                        let: { cid: '$_id' },
                        pipeline: [
                            { $match: { $expr: { $and: [
                                { $eq: ['$agencyClientId', '$$cid'] },
                                { $eq: ['$billingMonth', month] },
                                { $eq: ['$billingYear', year] }
                            ]}}},
                        ],
                        as: 'payments'
                    }
                },
                {
                    $addFields: {
                        periodReceived: {
                            $sum: {
                                $map: {
                                    input: { $filter: { input: '$payments', cond: { $in: ['$$this.status', ['received', 'partial']] } } },
                                    as: 'p',
                                    in: { $cond: [{ $eq: ['$$p.status', 'partial'] }, '$$p.receivedAmount', '$$p.amount'] }
                                }
                            }
                        },
                        periodPending: {
                            $sum: {
                                $map: {
                                    input: { $filter: { input: '$payments', cond: { $eq: ['$$this.status', 'pending'] } } },
                                    as: 'p',
                                    in: '$$p.amount'
                                }
                            }
                        },
                        hasPayment: { $gt: [{ $size: '$payments' }, 0] }
                    }
                },
                { $sort: { status: 1, name: 1 } }
            ]),

            // 5 most recent payments
            AgencyPayment.find({}).sort({ createdAt: -1 }).limit(5).lean(),

            // 6-month trend
            AgencyPayment.aggregate([
                {
                    $match: {
                        status: { $in: ['received', 'partial'] },
                        billingYear: { $gte: year - 1 }
                    }
                },
                {
                    $group: {
                        _id: { year: '$billingYear', month: '$billingMonth' },
                        received: {
                            $sum: { $cond: [{ $eq: ['$status', 'partial'] }, '$receivedAmount', '$amount'] }
                        }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1 } },
                { $limit: 12 }
            ])
        ]);

        // This period aggregation
        const periodReceived = periodPayments
            .filter(p => ['received', 'partial'].includes(p.status))
            .reduce((s, p) => s + (p.status === 'partial' ? (p.receivedAmount || 0) : p.amount), 0);

        const periodPending = periodPayments
            .filter(p => p.status === 'pending')
            .reduce((s, p) => s + p.amount, 0);

        const periodPartial = periodPayments
            .filter(p => p.status === 'partial')
            .reduce((s, p) => s + (p.amount - (p.receivedAmount || 0)), 0);

        // Monthly fee total for active clients (what we should be billing)
        const activeClientList = await AgencyClient.find({ status: 'active' }).select('monthlyFee').lean();
        const expectedMonthly  = activeClientList.reduce((s, c) => s + (c.monthlyFee || 0), 0);

        // Trend labels
        const trendLabels = monthlyTrend.map(m => {
            const d = new Date(m._id.year, m._id.month - 1, 1);
            return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
        });
        const trendData = monthlyTrend.map(m => m.received);

        res.json({
            success: true,
            period: { month, year },
            summary: {
                activeClients,
                totalClients,
                expectedMonthly,
                periodReceived,
                periodPending:  periodPending + periodPartial,
                allTimeReceived: allTimeReceived[0]?.total || 0,
                allTimePending:  allTimePending[0]?.total  || 0,
                collectionRate:  expectedMonthly > 0
                    ? Math.round((periodReceived / expectedMonthly) * 100)
                    : 0
            },
            clientBreakdown,
            recentPayments,
            trend: { labels: trendLabels, data: trendData }
        });
    } catch (err) {
        console.error('[AgencyFinance] getSummary:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
