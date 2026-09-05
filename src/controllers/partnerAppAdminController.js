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
const PartnerWebhookDelivery = require('../models/PartnerWebhookDelivery');
const {
    clearCacheForPartner,
    clearCacheForTenant,
    forwardIfPartnerAccount
} = require('../services/partnerWebhookService');
const { hashPartnerKey } = require('../middleware/partnerApiAuthMiddleware');
const { clearFramingCache, normaliseOrigin } = require('../services/embedFramingService');
const { deleteOwnedRecords } = require('../services/accountCleanupService');
const { clearTokenVersionCache } = require('../middleware/authMiddleware');
const { validateOutboundUrl } = require('../utils/ssrfGuard');
const { PARTNER_WEBHOOK_EVENTS } = require('../constants/partnerWebhookEvents');
const auditLogger = require('../services/auditLogger');

const generatePartnerKey = () => `partner_${crypto.randomBytes(24).toString('hex')}`;

/**
 * Build the display mask from the stored prefix. The full key no longer exists
 * anywhere after creation (PA-M11), so this is the only representation the
 * admin UI can ever show.
 */
const maskKey = (partner) => {
    const prefix = partner.apiKeyPrefix || (partner.apiKey ? partner.apiKey.slice(0, 12) : null);
    return prefix ? `${prefix}${'•'.repeat(20)}` : null;
};

/** Superadmin-facing webhook URL validation — same rules as the partner API. */
const checkWebhookUrl = async (url) => {
    if (url === null || url === undefined || url === '') return null;
    if (typeof url !== 'string') return 'webhookUrl must be a string.';
    if (!/^https:\/\//i.test(url.trim())) return 'Webhook URL must be an absolute https:// URL.';
    try {
        await validateOutboundUrl(url.trim());
        return null;
    } catch (err) {
        return err.message.replace(/^\[SSRF Guard\]\s*/, '');
    }
};

/**
 * ONE definition of "an account that counts" (PA-M3).
 *
 * The list view used to bill on total accounts, the detail view on active ones,
 * and generateBill on a third query — so the same partner showed different
 * revenue on two screens and was invoiced for neither figure. Every revenue
 * number in this controller now goes through this.
 */
const ACTIVE_ACCOUNT_FILTER = { is_active: true, accountStatus: { $ne: 'Frozen' } };

const countActiveAccounts = async (accountIds) => {
    if (!accountIds?.length) return 0;
    return User.countDocuments({ _id: { $in: accountIds }, ...ACTIVE_ACCOUNT_FILTER });
};

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
            rateLimit, allowDirectLogin, showPoweredBy, allowedOrigins
        } = req.body;

        if (!appName) {
            return res.status(400).json({ success: false, message: 'appName is required.' });
        }

        // Reject unusable origins at the door rather than silently dropping them
        // later and leaving the admin wondering why the iframe stays blank.
        const origins = [];
        for (const raw of (allowedOrigins || [])) {
            const norm = normaliseOrigin(raw);
            if (!norm) {
                return res.status(400).json({
                    success: false,
                    message: `"${raw}" is not a valid embed origin. Use an exact scheme://host[:port], e.g. https://crm.partner.com — no paths, no wildcards.`
                });
            }
            origins.push(norm);
        }

        const apiKey = generatePartnerKey();
        const webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

        const partner = await PartnerApp.create({
            appName: appName.trim(),
            contactPerson: contactPerson || null,
            contactEmail: contactEmail || null,
            contactPhone: contactPhone || null,
            // Only the hash is persisted (PA-M11) — the plaintext below is
            // returned in this response and then unrecoverable, by design.
            apiKeyHash: hashPartnerKey(apiKey),
            apiKeyPrefix: apiKey.slice(0, 12),
            pricePerAccount: pricePerAccount || 0,
            currency: currency || 'INR',
            allowedModules: allowedModules || undefined, // use schema default
            maxAccounts: maxAccounts || 100,
            accountDefaults: accountDefaults || undefined,
            rateLimit: rateLimit || undefined,
            allowDirectLogin: allowDirectLogin || false,
            showPoweredBy: showPoweredBy !== false,
            allowedOrigins: origins,
            webhookSecret,
            createdBy: req.user.userId || req.user.id,
            isActive: true
        });

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'PARTNER_APP_CREATED',
            targetType: 'PartnerApp',
            targetId: partner._id,
            targetName: partner.appName,
            details: { pricePerAccount: partner.pricePerAccount, maxAccounts: partner.maxAccounts },
            req
        });

        res.status(201).json({
            success: true,
            data: {
                id: partner._id,
                appName: partner.appName,
                // Returned ONCE — only the hash is stored, so this is genuinely
                // the last time this value exists anywhere.
                apiKey,
                webhookSecret,
                message: 'Copy the API key and webhook secret now — neither can be retrieved again.'
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
            .select('appName contactPerson contactEmail apiKey apiKeyPrefix pricePerAccount currency allowedModules maxAccounts accountIds isActive createdAt apiUsage')
            .sort({ createdAt: -1 })
            .lean();

        // ── Active-account counts, one query for all partners (PA-M3) ──────────
        // This list used to bill on p.accountIds.length — every provisioned
        // account including frozen ones — while the detail view billed on active
        // accounts only. Same partner, two screens, two revenue figures, and the
        // generated invoice matched neither. Both now use ACTIVE_ACCOUNT_FILTER.
        const allAccountIds = partners.flatMap(p => p.accountIds || []);
        const activeIds = allAccountIds.length
            ? new Set(
                (await User.find({ _id: { $in: allAccountIds }, ...ACTIVE_ACCOUNT_FILTER })
                    .select('_id').lean()
                ).map(u => u._id.toString())
              )
            : new Set();

        const today = new Date().toISOString().slice(0, 10);

        const data = partners.map(p => {
            const totalAccounts  = p.accountIds?.length || 0;
            const activeAccounts = (p.accountIds || []).filter(id => activeIds.has(id.toString())).length;
            // Revenue is billed on ACTIVE accounts — matching what generateBill
            // will actually invoice.
            const monthlyRevenue = activeAccounts * (p.pricePerAccount || 0);

            const todayUsage = p.apiUsage?.find(u => u.date === today)?.count || 0;

            return {
                id: p._id,
                appName: p.appName,
                contactPerson: p.contactPerson,
                contactEmail: p.contactEmail,
                maskedKey: maskKey(p),
                pricePerAccount: p.pricePerAccount,
                currency: p.currency,
                totalAccounts,
                activeAccounts,
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
            totalAccounts: data.reduce((sum, d) => sum + d.totalAccounts, 0),
            activeAccounts: data.reduce((sum, d) => sum + d.activeAccounts, 0),
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

        // Counted through the shared filter, NOT by string-matching the display
        // status above. Those two disagree on states like 'Suspended'
        // (is_active true, accountStatus not 'Frozen'), which is exactly the
        // kind of drift PA-M3 was about.
        const activeAccountCount = await countActiveAccounts(partner.accountIds);

        // Only the prefix survives — the secret half is not stored (PA-M11).
        const maskedKey = maskKey(partner);

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

        // Webhook delivery health, for the Webhook tab.
        const [webhookPending, webhookFailed] = await Promise.all([
            PartnerWebhookDelivery.countDocuments({ partnerId: partner._id, status: 'pending' }),
            PartnerWebhookDelivery.countDocuments({
                partnerId: partner._id,
                status: 'failed',
                createdAt: { $gte: monthStart }
            })
        ]);

        // Never ship secret material to the browser. The response used to spread
        // the whole document, which included the raw webhookSecret (and, once
        // hashing landed, would have included apiKeyHash too).
        const { apiKeyHash, apiKey, webhookSecret, ...safePartner } = partner;

        res.json({
            success: true,
            data: {
                ...safePartner,
                apiKey: maskedKey,
                hasWebhookSecret: !!webhookSecret,
                accounts,
                activeAccountCount,
                messagesThisMonth,
                webhookPending,
                webhookFailed,
                // Same formula as the list view and the generated invoice (PA-M3).
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
            'webhookUrl', 'webhookEvents', 'isActive', 'allowedOrigins'
        ];

        const update = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                update[field] = req.body[field];
            }
        }

        // ── Validation ────────────────────────────────────────────────────────
        // Every one of these used to be written straight through unchecked.
        if (update.webhookUrl !== undefined) {
            const urlError = await checkWebhookUrl(update.webhookUrl);   // PA-H5
            if (urlError) {
                return res.status(400).json({ success: false, message: urlError });
            }
            // PA-M8: blank means "disabled", and the resolver only treats null
            // as disabled — an empty string kept webhooks nominally configured
            // and failed on every inbound message.
            update.webhookUrl = update.webhookUrl ? update.webhookUrl.trim() : null;
        }

        if (update.webhookEvents !== undefined) {
            if (!Array.isArray(update.webhookEvents)) {
                return res.status(400).json({ success: false, message: 'webhookEvents must be an array.' });
            }
            const unknown = update.webhookEvents.filter(e => !PARTNER_WEBHOOK_EVENTS.includes(e));
            if (unknown.length) {
                return res.status(400).json({
                    success: false,
                    message: `Unknown webhook event(s): ${unknown.join(', ')}.`
                });
            }
        }

        if (update.allowedOrigins !== undefined) {
            if (!Array.isArray(update.allowedOrigins)) {
                return res.status(400).json({ success: false, message: 'allowedOrigins must be an array.' });
            }
            const origins = [];
            for (const raw of update.allowedOrigins) {
                const norm = normaliseOrigin(raw);
                if (!norm) {
                    return res.status(400).json({
                        success: false,
                        message: `"${raw}" is not a valid embed origin. Use an exact scheme://host[:port], e.g. https://crm.partner.com — no paths, no wildcards.`
                    });
                }
                origins.push(norm);
            }
            update.allowedOrigins = [...new Set(origins)];
        }

        if (update.maxAccounts !== undefined) {
            const n = Number(update.maxAccounts);
            if (!Number.isFinite(n) || n < 1) {
                return res.status(400).json({ success: false, message: 'maxAccounts must be at least 1.' });
            }
            update.maxAccounts = Math.floor(n);
        }

        if (update.pricePerAccount !== undefined) {
            const n = Number(update.pricePerAccount);
            if (!Number.isFinite(n) || n < 0) {
                return res.status(400).json({ success: false, message: 'pricePerAccount cannot be negative.' });
            }
            update.pricePerAccount = n;
        }

        if (update.rateLimit !== undefined) {
            for (const k of ['perAccountPerMinute', 'perAccountPerDay', 'floor']) {
                if (update.rateLimit[k] !== undefined) {
                    const n = Number(update.rateLimit[k]);
                    if (!Number.isFinite(n) || n < 1) {
                        return res.status(400).json({
                            success: false,
                            message: `rateLimit.${k} must be at least 1.`
                        });
                    }
                    update.rateLimit[k] = Math.floor(n);
                }
            }
        }

        const before = await PartnerApp.findById(req.params.id).select('isActive appName').lean();
        if (!before) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        const partner = await PartnerApp.findByIdAndUpdate(
            req.params.id,
            { $set: update },
            { new: true }
        ).lean();

        // Clear webhook cache whenever ANY cached field changed. It caches
        // webhookUrl, webhookSecret AND webhookEvents, so the previous
        // url/isActive-only condition left an events change stale for 5 minutes
        // (PA-M9).
        if (update.webhookUrl !== undefined || update.isActive !== undefined || update.webhookEvents !== undefined) {
            await clearCacheForPartner(partner._id);
        }
        // Origin changes must take effect on the next iframe load, not after the
        // framing cache TTL.
        if (update.allowedOrigins !== undefined || update.isActive !== undefined) {
            clearFramingCache();
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: before.isActive !== partner.isActive
                ? (partner.isActive ? 'PARTNER_APP_ACTIVATED' : 'PARTNER_APP_DEACTIVATED')
                : 'PARTNER_APP_UPDATED',
            targetType: 'PartnerApp',
            targetId: partner._id,
            targetName: partner.appName,
            details: { fields: Object.keys(update) },
            req
        });

        const { apiKeyHash, apiKey, webhookSecret, ...safePartner } = partner;
        res.json({ success: true, data: { ...safePartner, apiKey: maskKey(partner), hasWebhookSecret: !!webhookSecret } });
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
        // Existence check: this used to report success for any id at all,
        // including a typo'd one, so an admin could believe they had cut off a
        // partner who was still fully live.
        const partner = await PartnerApp.findById(req.params.id).select('appName isActive accountIds').lean();
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        await PartnerApp.updateOne(
            { _id: req.params.id },
            { $set: { isActive: false } }
        );

        await clearCacheForPartner(req.params.id);
        // Stop honouring this partner's frame-ancestors grant immediately.
        clearFramingCache();

        // Deactivation now genuinely stops embed access. exchangeEmbedToken
        // refuses tokens for an inactive partner (PA-H3), and revoking the
        // accounts' sessions kills the 8-hour JWTs already handed out — without
        // this, the Settings tab's promise that "embed iframes will stop
        // working" stayed false for the rest of the working day.
        const accountIds = partner.accountIds || [];
        if (accountIds.length) {
            await User.updateMany({ _id: { $in: accountIds } }, { $inc: { tokenVersion: 1 } });
            accountIds.forEach(id => clearTokenVersionCache(id.toString()));
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'PARTNER_APP_DEACTIVATED',
            targetType: 'PartnerApp',
            targetId: partner._id,
            targetName: partner.appName,
            details: { sessionsRevoked: accountIds.length },
            req
        });

        res.json({
            success: true,
            message: `Partner deactivated. API access is blocked and ${accountIds.length} embed session(s) were revoked.`
        });
    } catch (err) {
        console.error('[PartnerAdmin] deactivatePartner error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to deactivate partner.' });
    }
};

/**
 * POST /api/superadmin/partner-apps/:id/regenerate-key
 * Generate a new API key (invalidates the old one).
 */
exports.regenerateKey = async (req, res) => {
    try {
        const partner = await PartnerApp.findById(req.params.id).select('appName').lean();
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        const newKey = generatePartnerKey();
        await PartnerApp.updateOne(
            { _id: req.params.id },
            {
                $set: {
                    apiKeyHash: hashPartnerKey(newKey),
                    apiKeyPrefix: newKey.slice(0, 12),
                    apiKeyRotatedAt: new Date()
                },
                // Drop any legacy plaintext copy at the same time, so rotation
                // doubles as the migration off the old column.
                $unset: { apiKey: '' }
            }
        );

        await clearCacheForPartner(req.params.id);

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'PARTNER_APP_KEY_ROTATED',
            targetType: 'PartnerApp',
            targetId: req.params.id,
            targetName: partner.appName,
            req
        });

        res.json({
            success: true,
            apiKey: newKey,
            message: 'New API key generated. The old key is now invalid. Copy this key — it will not be shown again.'
        });
    } catch (err) {
        console.error('[PartnerAdmin] regenerateKey error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to regenerate key.' });
    }
};

/**
 * POST /api/superadmin/partner-apps/:id/rotate-webhook-secret
 * Issue a new webhook signing secret and return it once.
 *
 * Previously the secret was generated at partner creation, discarded by the
 * create modal, and shown only as a 10-character stub in Settings — so a
 * superadmin had no way to give a partner the secret their signature
 * verification needs, and no way to rotate it if it leaked.
 */
exports.rotateWebhookSecret = async (req, res) => {
    try {
        const partner = await PartnerApp.findById(req.params.id).select('appName').lean();
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }

        const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
        await PartnerApp.updateOne({ _id: req.params.id }, { $set: { webhookSecret: secret } });
        await clearCacheForPartner(req.params.id);

        auditLogger.log({
            actor: req.user,
            actionCategory: 'SUPERADMIN_ACTION',
            action: 'PARTNER_WEBHOOK_SECRET_ROTATED',
            targetType: 'PartnerApp',
            targetId: req.params.id,
            targetName: partner.appName,
            req
        });

        res.json({
            success: true,
            secret,
            message: 'New signing secret generated. Send it to the partner now — it is not shown again. Deliveries are signed with it from this moment.'
        });
    } catch (err) {
        console.error('[PartnerAdmin] rotateWebhookSecret error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to rotate webhook secret.' });
    }
};

/**
 * GET /api/superadmin/partner-apps/:id/webhook-deliveries
 * Delivery log for the Webhook tab — what was sent, what failed, and why.
 */
exports.getWebhookDeliveries = async (req, res) => {
    try {
        const { status } = req.query;
        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));

        const query = { partnerId: req.params.id };
        if (status && ['pending', 'delivered', 'failed'].includes(status)) {
            query.status = status;
        }

        const [deliveries, total] = await Promise.all([
            PartnerWebhookDelivery.find(query)
                .select('event status attempts lastError lastStatusCode deliveredAt nextRetryAt targetUrl deliveryId createdAt')
                .sort({ createdAt: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            PartnerWebhookDelivery.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: deliveries,
            total,
            page,
            pages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('[PartnerAdmin] getWebhookDeliveries error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load webhook deliveries.' });
    }
};

/**
 * POST /api/superadmin/partner-apps/:id/webhook-deliveries/:deliveryId/retry
 * Requeue one failed delivery for immediate redelivery.
 */
exports.retryWebhookDelivery = async (req, res) => {
    try {
        const result = await PartnerWebhookDelivery.updateOne(
            { _id: req.params.deliveryId, partnerId: req.params.id },
            {
                $set: {
                    status: 'pending',
                    attempts: 0,
                    nextRetryAt: new Date(),
                    lastError: null
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Delivery not found for this partner.' });
        }

        res.json({ success: true, message: 'Delivery requeued — it will be retried within a minute.' });
    } catch (err) {
        console.error('[PartnerAdmin] retryWebhookDelivery error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to requeue delivery.' });
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

        // ── Month sanity (PA-M4) ──────────────────────────────────────────────
        // Any month at all used to be accepted and then billed with TODAY's
        // account state, so "2026-03" generated in September invoiced the
        // September roster under a March heading.
        const [yearStr, monthStr] = month.split('-');
        const monthIndex = Number(monthStr) - 1;
        if (monthIndex < 0 || monthIndex > 11) {
            return res.status(400).json({ success: false, message: 'month must be between 01 and 12.' });
        }

        const periodStart = new Date(Date.UTC(Number(yearStr), monthIndex, 1));
        const periodEnd   = new Date(Date.UTC(Number(yearStr), monthIndex + 1, 1));
        const now = new Date();

        if (periodStart > now) {
            return res.status(400).json({
                success: false,
                message: 'Cannot bill a future month — there is nothing to measure yet.'
            });
        }

        // Check if bill already exists for this month
        const existing = partner.billingHistory.find(b => b.month === month);
        if (existing) {
            return res.status(409).json({
                success: false,
                message: `Bill for ${month} already exists (${existing.invoiceNumber || 'no invoice number'}). Amount: ${existing.currency || partner.currency} ${existing.amount}`
            });
        }

        // ── Count accounts billable FOR THAT MONTH ────────────────────────────
        // An account is billable for the period if it existed before the period
        // ended and is currently in a chargeable state. Accounts provisioned
        // AFTER the period closed are excluded — previously they were silently
        // folded into back-dated invoices.
        //
        // (A full history model would track per-account state transitions and
        // prorate. This is deliberately the simpler rule the manual billing flow
        // was designed around; it is now at least consistent and time-bounded.)
        let activeCount = 0;
        if (partner.accountIds?.length) {
            activeCount = await User.countDocuments({
                _id: { $in: partner.accountIds },
                createdAt: { $lt: periodEnd },
                ...ACTIVE_ACCOUNT_FILTER
            });
        }

        const rate = partner.pricePerAccount || 0;
        const amount = activeCount * rate;

        // Sequential per-partner invoice number so a bill can be referenced in
        // an email or a bank transfer note.
        const seq = String((partner.billingHistory?.length || 0) + 1).padStart(4, '0');
        const invoiceNumber = `INV-${month}-${seq}`;

        const billEntry = {
            month,
            activeAccounts: activeCount,
            rate,
            // Frozen so a later currency switch cannot restate history.
            currency: partner.currency || 'INR',
            amount,
            status: 'due',
            invoiceNumber,
            generatedBy: req.user.userId || req.user.id,
            generatedAt: new Date()
        };

        await PartnerApp.updateOne(
            { _id: partner._id },
            { $push: { billingHistory: billEntry } }
        );

        auditLogger.log({
            actor: req.user,
            actionCategory: 'BILLING',
            action: 'PARTNER_BILL_GENERATED',
            targetType: 'PartnerApp',
            targetId: partner._id,
            targetName: partner.appName,
            details: { month, invoiceNumber, activeAccounts: activeCount, rate, amount },
            req
        });

        res.json({
            success: true,
            data: billEntry,
            message: `${invoiceNumber}: ${activeCount} active accounts × ${billEntry.currency} ${rate} = ${billEntry.currency} ${amount}`
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
                    // Who recorded the payment — a money-touching action that
                    // previously left no trace of who performed it.
                    'billingHistory.$.paidBy': req.user.userId || req.user.id,
                    'billingHistory.$.paidByName': req.user.name || null,
                    'billingHistory.$.notes': notes || ''
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Bill not found.' });
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'BILLING',
            action: 'PARTNER_BILL_MARKED_PAID',
            targetType: 'PartnerApp',
            targetId: id,
            details: { billId, notes: notes || null },
            req
        });

        res.json({ success: true, message: 'Bill marked as paid.' });
    } catch (err) {
        console.error('[PartnerAdmin] markBillPaid error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to mark bill as paid.' });
    }
};

/**
 * PUT /api/superadmin/partner-apps/:id/billing/:billId/mark-due
 * Reverse a mark-as-paid. Marking paid was a one-way door, so a mis-click on
 * the wrong row could only be undone in the database.
 */
exports.markBillDue = async (req, res) => {
    try {
        const { id, billId } = req.params;

        const result = await PartnerApp.updateOne(
            { _id: id, 'billingHistory._id': billId },
            {
                $set: {
                    'billingHistory.$.status': 'due',
                    'billingHistory.$.paidAt': null,
                    'billingHistory.$.paidBy': null,
                    'billingHistory.$.paidByName': null
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Bill not found.' });
        }

        auditLogger.log({
            actor: req.user,
            actionCategory: 'BILLING',
            action: 'PARTNER_BILL_REOPENED',
            targetType: 'PartnerApp',
            targetId: id,
            details: { billId },
            req
        });

        res.json({ success: true, message: 'Bill reopened as due.' });
    } catch (err) {
        console.error('[PartnerAdmin] markBillDue error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to reopen bill.' });
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
        const partner = await PartnerApp.findById(id).select('accountIds appName').lean();
        if (!partner?.accountIds?.some(a => a.toString() === accountId)) {
            return res.status(404).json({ success: false, message: 'Account not found under this partner.' });
        }

        await User.updateOne(
            { _id: accountId },
            { $set: { accountStatus: 'Frozen', is_active: false } }
        );
        // PA-M10: is_active alone leaves live sessions working until the auth
        // cache expires. Bump the session generation so every issued JWT dies now.
        await User.updateOne({ _id: accountId }, { $inc: { tokenVersion: 1 } });
        clearTokenVersionCache(accountId.toString());

        forwardIfPartnerAccount(accountId, 'account.frozen', {
            accountId, status: 'Frozen', frozenBy: 'platform'
        }).catch(() => {});

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'PARTNER_ACCOUNT_FROZEN',
            targetType: 'User',
            targetId: accountId,
            details: { partnerId: id, partnerName: partner.appName },
            req
        });

        res.json({ success: true, message: 'Account frozen.' });
    } catch (err) {
        console.error('[PartnerAdmin] freezePartnerAccount error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to freeze account.' });
    }
};

/**
 * PUT /api/superadmin/partner-apps/:id/accounts/:accountId/unfreeze
 */
exports.unfreezePartnerAccount = async (req, res) => {
    try {
        const { id, accountId } = req.params;

        const partner = await PartnerApp.findById(id).select('accountIds appName').lean();
        if (!partner?.accountIds?.some(a => a.toString() === accountId)) {
            return res.status(404).json({ success: false, message: 'Account not found under this partner.' });
        }

        await User.updateOne(
            { _id: accountId },
            { $set: { accountStatus: 'Active', is_active: true } }
        );
        // Drop the cached is_active:false so access returns immediately.
        clearTokenVersionCache(accountId.toString());

        forwardIfPartnerAccount(accountId, 'account.frozen', {
            accountId, status: 'Active', frozenBy: 'platform'
        }).catch(() => {});

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'PARTNER_ACCOUNT_UNFROZEN',
            targetType: 'User',
            targetId: accountId,
            details: { partnerId: id, partnerName: partner.appName },
            req
        });

        res.json({ success: true, message: 'Account unfrozen.' });
    } catch (err) {
        console.error('[PartnerAdmin] unfreezePartnerAccount error:', err.message);
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

        // ⚠️ PA-C3 — OWNERSHIP CHECK. This was missing entirely.
        //
        // The $pull below is a silent no-op when the account isn't this
        // partner's, and the User.deleteOne then ran regardless — so
        // DELETE /partner-apps/<any-partner>/accounts/<any-user-id> destroyed
        // that user, partner account or not. Its freeze/unfreeze siblings above
        // always had this guard; only the destructive path went without one.
        const partner = await PartnerApp.findById(id).select('accountIds appName').lean();
        if (!partner) {
            return res.status(404).json({ success: false, message: 'Partner not found.' });
        }
        if (!partner.accountIds?.some(a => a.toString() === accountId)) {
            return res.status(404).json({ success: false, message: 'Account not found under this partner.' });
        }

        const account = await User.findById(accountId).select('name email').lean();

        // Notify the partner BEFORE the account disappears — the webhook
        // resolver works off partner.accountIds, so emitting after the $pull
        // would find no partner and drop the event.
        forwardIfPartnerAccount(accountId, 'account.deleted', {
            accountId,
            name: account?.name || null,
            email: account?.email || null
        }).catch(() => {});

        // Remove from partner's account list
        await PartnerApp.updateOne(
            { _id: id },
            { $pull: { accountIds: accountId } }
        );

        // ⚠️ PA-C3 — CASCADE. Deleting only User + WorkspaceSettings +
        // IntegrationConfig left every Lead, WhatsApp conversation/message/
        // template/broadcast/log, chatbot flow and session, stage, activity log,
        // automation, task and usage row behind with a dangling userId, forever.
        // Every other deletion path in this codebase (authController,
        // superAdminController) goes through deleteOwnedRecords; this one now
        // does too.
        await deleteOwnedRecords(accountId);

        await Promise.all([
            User.deleteOne({ _id: accountId }),
            WorkspaceSettings.deleteOne({ userId: accountId }),
            IntegrationConfig.deleteOne({ userId: accountId })
        ]);

        // Kill any session still holding this (now deleted) account's JWT.
        clearTokenVersionCache(accountId.toString());
        clearCacheForTenant(accountId);
        await clearCacheForPartner(id);

        auditLogger.log({
            actor: req.user,
            actionCategory: 'ACCOUNT_MANAGEMENT',
            action: 'PARTNER_ACCOUNT_DELETED',
            targetType: 'User',
            targetId: accountId,
            targetName: account?.email || accountId,
            details: { partnerId: id, partnerName: partner.appName },
            req
        });

        res.json({ success: true, message: 'Account and all associated data deleted.' });
    } catch (err) {
        console.error('[PartnerAdmin] deletePartnerAccount error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to delete account.' });
    }
};
