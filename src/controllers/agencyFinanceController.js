const AgencyClient = require('../models/AgencyClient');
const AgencyPayment = require('../models/AgencyPayment');
const GlobalSetting = require('../models/GlobalSetting');

// ─── AGENCY BRANDING HELPER ────────────────────────────────────────────────────
// Fetches agency branding from GlobalSetting collection.
// Keys: agency_name, agency_address, agency_gst, agency_logo_url
const fetchAgencyBranding = async () => {
    const keys = ['agency_name', 'agency_address', 'agency_gst', 'agency_logo_url'];
    const settings = await GlobalSetting.find({ key: { $in: keys } }).lean();
    const map = {};
    settings.forEach(s => { map[s.key] = s.value || ''; });
    return {
        agencyName:    map.agency_name    || '',
        agencyAddress: map.agency_address || '',
        agencyGst:     map.agency_gst     || '',
        agencyLogo:    map.agency_logo_url || ''
    };
};

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
        const {
            name, email, phone, company, serviceType, monthlyFee,
            requirements, startDate, status, notes,
            billingAddress, gstNumber, billingDay, billingStartDate
        } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Client name is required.' });
        if (monthlyFee == null || isNaN(monthlyFee)) return res.status(400).json({ success: false, message: 'Monthly fee is required.' });

        const client = await AgencyClient.create({
            name: name.trim(), email, phone, company, serviceType,
            monthlyFee: Number(monthlyFee), requirements,
            startDate: startDate ? new Date(startDate) : undefined,
            status, notes,
            billingAddress:   billingAddress   || '',
            gstNumber:        gstNumber        || '',
            billingDay:       billingDay       ? Number(billingDay) : 1,
            billingStartDate: billingStartDate ? new Date(billingStartDate) : null
        });
        res.status(201).json({ success: true, client, message: 'Client added.' });
    } catch (err) {
        console.error('[AgencyFinance] createClient:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updateClient = async (req, res) => {
    try {
        const updateData = { ...req.body };
        if (updateData.startDate === '') {
            updateData.startDate = undefined;
        } else if (updateData.startDate) {
            updateData.startDate = new Date(updateData.startDate);
        }

        if (updateData.billingStartDate === '') {
            updateData.billingStartDate = null;
        } else if (updateData.billingStartDate) {
            updateData.billingStartDate = new Date(updateData.billingStartDate);
        }

        const client = await AgencyClient.findByIdAndUpdate(
            req.params.id,
            { $set: updateData },
            { new: true, runValidators: true }
        );
        if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });

        // If billing address or GST changed, refresh snapshots on all PENDING payments
        // so the next invoice download reflects the updated address immediately.
        if (req.body.billingAddress !== undefined || req.body.gstNumber !== undefined) {
            const updateFields = {};
            if (req.body.billingAddress !== undefined) updateFields.billingAddressSnapshot = client.billingAddress || '';
            if (req.body.gstNumber      !== undefined) updateFields.gstNumberSnapshot      = client.gstNumber      || '';
            await AgencyPayment.updateMany(
                { agencyClientId: client._id, status: 'pending' },
                { $set: updateFields }
            );
        }

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

        // Cancel all pending follow-up Agenda jobs before removing payments
        const pendingPayments = await AgencyPayment.find({
            agencyClientId: req.params.id,
            followUpJobs: { $exists: true, $ne: [] }
        }).select('followUpJobs').lean();

        if (pendingPayments.length > 0) {
            const { cancelAgencyBillFollowups } = require('../services/agencyBillingQueue');
            for (const p of pendingPayments) {
                await cancelAgencyBillFollowups(p);
            }
        }

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
        if (month) filter.billingMonth = Number(month);
        if (year) filter.billingYear = Number(year);
        if (status) filter.status = status;

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

// GET /superadmin/agency-finance/payments/:id  — single payment (fresh from DB)
// Self-heals old payments missing invoiceNumber, billingAddressSnapshot, serviceType, or agencyNameSnapshot.
exports.getPayment = async (req, res) => {
    try {
        const payment = await AgencyPayment.findById(req.params.id).lean();
        if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

        const needsFix = !payment.billingAddressSnapshot || !payment.invoiceNumber || !payment.clientServiceType || !payment.agencyNameSnapshot;
        const fixSet = {};

        if (needsFix) {
            const client = await AgencyClient.findById(payment.agencyClientId)
                .select('billingAddress gstNumber serviceType name')
                .lean();

            if (client) {
                // Fix billing address snapshot
                if (!payment.billingAddressSnapshot) {
                    payment.billingAddressSnapshot = client.billingAddress || '';
                    fixSet.billingAddressSnapshot  = payment.billingAddressSnapshot;
                }
                // Fix GST snapshot
                if (!payment.gstNumberSnapshot) {
                    payment.gstNumberSnapshot = client.gstNumber || '';
                    fixSet.gstNumberSnapshot  = payment.gstNumberSnapshot;
                }
                // Fix service type snapshot — only if field is truly missing (not if client chose 'other')
                if (!payment.clientServiceType) {
                    payment.clientServiceType = client.serviceType || 'other';
                    fixSet.clientServiceType  = payment.clientServiceType;
                }
            }

            // Fix agency branding snapshot if missing
            if (!payment.agencyNameSnapshot) {
                const branding = await fetchAgencyBranding();
                payment.agencyNameSnapshot = branding.agencyName;
                payment.agencyAddressSnapshot = branding.agencyAddress;
                payment.agencyGstSnapshot = branding.agencyGst;
                payment.agencyLogoSnapshot = branding.agencyLogo;

                fixSet.agencyNameSnapshot = branding.agencyName;
                fixSet.agencyAddressSnapshot = branding.agencyAddress;
                fixSet.agencyGstSnapshot = branding.agencyGst;
                fixSet.agencyLogoSnapshot = branding.agencyLogo;
            }

            // Auto-generate invoiceNumber if missing (for old payments)
            if (!payment.invoiceNumber) {
                const m   = String(payment.billingMonth).padStart(2, '0');
                const cnt = await AgencyPayment.countDocuments({
                    billingYear: payment.billingYear,
                    billingMonth: payment.billingMonth,
                    _id: { $lte: payment._id }
                });
                payment.invoiceNumber = `INV-${payment.billingYear}-${m}-${String(cnt).padStart(4, '0')}`;
                fixSet.invoiceNumber  = payment.invoiceNumber;
            }

            // Persist all fixes once — future downloads use correct data instantly
            if (Object.keys(fixSet).length > 0) {
                await AgencyPayment.updateOne({ _id: payment._id }, { $set: fixSet });
            }
        }

        res.json({ success: true, payment });
    } catch (err) {
        console.error('[AgencyFinance] getPayment:', err);
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

        // Generate unique Invoice Number
        const yearStr = billingYear;
        const monthStr = String(billingMonth).padStart(2, '0');
        const count = await AgencyPayment.countDocuments({ billingYear, billingMonth });
        const seq = String(count + 1).padStart(4, '0');
        const invoiceNumber = `INV-${yearStr}-${monthStr}-${seq}`;

        // Auto due date: today + 5 days if not provided
        let resolvedDueDate = dueDate || null;
        if (!resolvedDueDate) {
            const d = new Date();
            d.setDate(d.getDate() + 5);
            resolvedDueDate = d;
        }

        // Fetch agency branding for invoice "From" block
        const branding = await fetchAgencyBranding();

        const payment = await AgencyPayment.create({
            agencyClientId,
            clientName:        client.name,
            clientCompany:     client.company,
            clientServiceType: client.serviceType || 'other',
            amount: Number(amount),
            billingMonth: Number(billingMonth),
            billingYear:  Number(billingYear),
            dueDate:      resolvedDueDate,
            status: status || 'pending',
            receivedDate: status === 'received' ? (receivedDate || new Date()) : null,
            receivedAmount: status === 'partial' ? Number(receivedAmount || 0) : null,
            paymentMethod, reference, notes,
            invoiceNumber,
            billingAddressSnapshot: client.billingAddress || '',
            gstNumberSnapshot:      client.gstNumber      || '',
            agencyNameSnapshot:     branding.agencyName,
            agencyAddressSnapshot:  branding.agencyAddress,
            agencyGstSnapshot:      branding.agencyGst,
            agencyLogoSnapshot:     branding.agencyLogo,
            recordedBy: req.user?._id || null
        });

        // Trigger Automated Reminders if status is pending
        if (payment.status === 'pending') {
            const { scheduleAgencyBillFollowups } = require('../services/agencyBillingQueue');
            const jobIds = await scheduleAgencyBillFollowups(payment);
            payment.followUpJobs = jobIds;
            await payment.save();
        }

        res.status(201).json({ success: true, payment, message: 'Payment recorded.' });
    } catch (err) {
        console.error('[AgencyFinance] createPayment:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

exports.updatePayment = async (req, res) => {
    try {
        const prevPayment = await AgencyPayment.findById(req.params.id).select('status agencyClientId').lean();
        const update = { ...req.body };

        // Auto-set receivedDate if marking as received
        if (update.status === 'received' && !update.receivedDate) {
            update.receivedDate = new Date();
        }
        if (update.status === 'pending') {
            update.receivedDate = null;
            update.receivedAmount = null;
        }

        const payment = await AgencyPayment.findByIdAndUpdate(
            req.params.id,
            { $set: update },
            { new: true, runValidators: true }
        );
        if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

        // If status is changed to received or partial, cancel pending followup jobs
        if (['received', 'partial'].includes(payment.status)) {
            const { cancelAgencyBillFollowups } = require('../services/agencyBillingQueue');
            await cancelAgencyBillFollowups(payment);
        }

        // ── Send Payment Receipt when status transitions TO 'received' ──────────
        // Only fires if this is a real status change (not already received before).
        // Runs non-blocking so API responds instantly.
        if (payment.status === 'received' && prevPayment?.status !== 'received') {
            const client = await AgencyClient.findById(payment.agencyClientId).lean();
            if (client) {
                const callerUserId = req.user.userId || req.user.id;
                const { sendPaymentReceipt } = require('../services/agencyBillingQueue');
                sendPaymentReceipt(payment.toObject(), client, callerUserId).catch(err =>
                    console.error('[updatePayment] Receipt send failed silently:', err.message)
                );
            }
        }

        res.json({ success: true, payment, message: 'Payment updated.' });
    } catch (err) {
        console.error('[AgencyFinance] updatePayment:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};


exports.deletePayment = async (req, res) => {
    try {
        const payment = await AgencyPayment.findById(req.params.id);
        if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

        // Cancel pending followup jobs
        const { cancelAgencyBillFollowups } = require('../services/agencyBillingQueue');
        await cancelAgencyBillFollowups(payment);

        await AgencyPayment.deleteOne({ _id: req.params.id });
        res.json({ success: true, message: 'Payment deleted.' });
    } catch (err) {
        console.error('[AgencyFinance] deletePayment:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── MANUAL SEND BILL ──────────────────────────────────────────────────────────
// POST /superadmin/agency-finance/payments/:id/send-bill
// Immediately sends the billing email + WhatsApp reminder for a specific payment.
// Uses the same logic as agencyBillingQueue's Day 0 step.

exports.sendBillManually = async (req, res) => {
    try {
        const payment = await AgencyPayment.findById(req.params.id).lean();
        if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

        const client = await AgencyClient.findById(payment.agencyClientId).lean();
        if (!client) return res.status(404).json({ success: false, message: 'Client not found.' });

        // Use the logged-in superadmin's credentials directly.
        // The route is protected by requireSuperAdmin, so req.user IS the superadmin
        // who configured email/whatsapp in the Communication module.
        const superAdminId = req.user.userId || req.user.id;

        // ── Send Email ────────────────────────────────────────────────────────────
        if (client.email) {
            try {
                const { buildBillingEmail } = require('../services/agencyBillingQueue');
                const { subject, html, text } = buildBillingEmail(payment, client, 'day0');
                const { sendEmail } = require('../services/emailService');
                await sendEmail({
                    to:            client.email,
                    subject,
                    html,
                    text,
                    userId:        superAdminId,
                    transactional: true
                });
                console.log(`📧 [ManualBill] Email sent to ${client.email} for invoice ${payment.invoiceNumber}`);
            } catch (emailErr) {
                console.error(`❌ [ManualBill] Email failed:`, emailErr.message);
            }
        }

        // ── Send WhatsApp (template if configured, else skip) ─────────────────────
        if (client.phone) {
            try {
                const BillingReminderConfig = require('../models/BillingReminderConfig');
                const config = await BillingReminderConfig.findOne().lean();
                const templateName = config?.day0TemplateName;
                const langCode     = config?.day0LanguageCode || 'en';

                if (templateName) {
                    const { sendWhatsAppTemplateMessage } = require('../services/whatsappService');
                    await sendWhatsAppTemplateMessage(
                        client.phone, templateName, langCode, [], superAdminId,
                        { isAutomated: false, triggerType: 'billing_reminder' }
                    );
                    console.log(`💬 [ManualBill] WA template '${templateName}' sent to ${client.phone}`);
                } else {
                    console.warn(`⚠️ [ManualBill] No Day 0 WA template configured — WA skipped.`);
                }
            } catch (waErr) {
                console.error(`❌ [ManualBill] WhatsApp failed:`, waErr.message);
            }
        }

        res.json({
            success: true,
            message: `Invoice ${payment.invoiceNumber} sent${client.email ? ' via Email' : ''}${client.phone ? ' & WhatsApp' : ''}.`
        });
    } catch (err) {
        console.error('[AgencyFinance] sendBillManually:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};


// ─── SUMMARY ───────────────────────────────────────────────────────────────────

exports.getSummary = async (req, res) => {
    try {
        const { month: monthStr, year: yearStr } = req.query;
        const now = new Date();
        const month = monthStr ? Number(monthStr) : now.getMonth() + 1;
        const year = yearStr ? Number(yearStr) : now.getFullYear();

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
                {
                    $group: {
                        _id: null,
                        total: {
                            $sum: {
                                $cond: [{ $eq: ['$status', 'partial'] }, '$receivedAmount', '$amount']
                            }
                        }
                    }
                }
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
                            {
                                $match: {
                                    $expr: {
                                        $and: [
                                            { $eq: ['$agencyClientId', '$$cid'] },
                                            { $eq: ['$billingMonth', month] },
                                            { $eq: ['$billingYear', year] }
                                        ]
                                    }
                                }
                            },
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
        const expectedMonthly = activeClientList.reduce((s, c) => s + (c.monthlyFee || 0), 0);

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
                periodPending: periodPending + periodPartial,
                allTimeReceived: allTimeReceived[0]?.total || 0,
                allTimePending: allTimePending[0]?.total || 0,
                collectionRate: expectedMonthly > 0
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

// ─── AGENCY BRANDING ─────────────────────────────────────────────────────────
// GET /superadmin/agency-finance/branding
// Returns current agency branding from GlobalSetting for invoice preview/download.

exports.getAgencyBranding = async (req, res) => {
    try {
        const branding = await fetchAgencyBranding();
        res.json({ success: true, branding });
    } catch (err) {
        console.error('[AgencyFinance] getAgencyBranding:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};
