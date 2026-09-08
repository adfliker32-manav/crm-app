/**
 * Partner API Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoints consumed by third-party CRM partners via the Partner API.
 * All routes require x-partner-key; account-scoped routes also require
 * x-account-id (validated by partnerApiAuthMiddleware).
 *
 * Routes mounted at /api/partner/v1/*
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const PartnerApp = require('../models/PartnerApp');
const EmbedToken = require('../models/EmbedToken');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage: sendTemplateMessage } = require('../services/whatsappService');
const { forwardIfPartnerAccount, clearCacheForTenant, clearCacheForPartner } = require('../services/partnerWebhookService');
const { validateOutboundUrl } = require('../utils/ssrfGuard');
const { clearTokenVersionCache } = require('../middleware/authMiddleware');
const { PARTNER_WEBHOOK_EVENTS: WEBHOOK_EVENTS } = require('../constants/partnerWebhookEvents');

// ── Helpers ─────────────────────────────────────────────────────────────────

const generatePassword = () => crypto.randomBytes(16).toString('hex');
const generateEmbedToken = () => `emb_${crypto.randomBytes(24).toString('hex')}`;

/**
 * Freezing or deleting an account must kill its live sessions, not just block
 * the next login (PA-M10). Bumping tokenVersion invalidates every JWT already
 * issued to the account; clearing the auth cache makes that take effect now
 * rather than after the 60s tokenVersionCache TTL.
 */
const revokeAccountSessions = async (accountId) => {
    await User.updateOne({ _id: accountId }, { $inc: { tokenVersion: 1 } });
    clearTokenVersionCache(accountId.toString());
};

/**
 * Validate a partner-supplied webhook URL before we ever POST to it (PA-H5).
 * Returns an error string, or null when the URL is acceptable.
 * An empty string is treated as "disable webhooks" and is allowed through.
 */
const checkWebhookUrl = async (url) => {
    if (url === null || url === undefined || url === '') return null;
    if (typeof url !== 'string') return 'webhookUrl must be a string.';
    if (!/^https:\/\//i.test(url.trim())) {
        return 'webhookUrl must be an absolute https:// URL.';
    }
    try {
        await validateOutboundUrl(url.trim());
        return null;
    } catch (err) {
        // Strip the internal "[SSRF Guard] " prefix from the partner-facing message.
        return err.message.replace(/^\[SSRF Guard\]\s*/, '');
    }
};

/**
 * Turn the partner's `allowedModules` grant into the planFeatures that actually
 * enforce it.
 *
 * ⚠️ Two DIFFERENT vocabularies gate the WhatsApp module, and provisioning only
 * ever spoke the first one:
 *
 *   1. `allowedModules` (whatsapp_chatbot, whatsapp_broadcasts, …) — decides
 *      which TABS the embed draws, and is clamped into activeModules server-side.
 *   2. `planFeatures` — what the feature registry reads for every node stored as
 *      `{ type: 'feature' }`: whatsapp.chatbot.ai → aiChatbot,
 *      whatsapp.chatbot.knowledgeBase → knowledgeBase, whatsapp.broadcast →
 *      campaigns. These are enforced:true, so requireFeature 403s without them.
 *
 * Provisioning wrote only leadLimit/agentLimit, leaving the rest to the
 * WorkspaceSettings schema defaults — and `knowledgeBase` defaults to FALSE.
 * The result: a partner sold the whole WhatsApp module got an account whose
 * Chatbot tab rendered but whose Knowledge Base was permanently an upsell wall,
 * with nothing in the SuperAdmin UI able to fix it. Granting whatsapp_chatbot
 * now grants the AI layer and its knowledge base together, because the RAG
 * store is useless without the AI that reads it.
 */
const whatsappPlanFeatures = (partner) => {
    const granted = Array.isArray(partner.allowedModules) ? partner.allowedModules : [];
    const chatbot = granted.includes('whatsapp_chatbot');

    return {
        // The AI layer and its knowledge base travel together (registry nests
        // knowledgeBase under whatsapp.chatbot.ai for exactly this reason).
        aiChatbot:     chatbot,
        knowledgeBase: chatbot,
        // whatsapp.broadcast reads planFeatures.campaigns, not the module key.
        campaigns:     granted.includes('whatsapp_broadcasts'),
        advancedAnalytics: granted.includes('whatsapp_analytics')
    };
};

// ═══════════════════════════════════════════════════════════════════════════
// ACCOUNT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/partner/v1/accounts
 * Provision a new account for a partner's customer.
 */
exports.createAccount = async (req, res) => {
    try {
        const partner = req.partner;
        const { name, email, phone, companyName } = req.body;

        if (!name || !email) {
            return res.status(400).json({
                success: false,
                message: 'name and email are required.'
            });
        }

        // Fast-path limit check (the authoritative one is the conditional $push
        // below — this only avoids doing work we know will be rejected).
        const maxAccounts = Number(partner.maxAccounts) || 0;
        if (maxAccounts < 1 || partner.accountIds.length >= maxAccounts) {
            return res.status(403).json({
                success: false,
                error: 'account_limit_reached',
                message: `Maximum ${maxAccounts} accounts allowed for this partner.`
            });
        }

        // Check if email already exists
        const normalizedEmail = email.trim().toLowerCase();
        const existing = await User.findOne({ email: normalizedEmail });
        if (existing) {
            return res.status(409).json({
                success: false,
                error: 'email_exists',
                message: 'An account with this email already exists.'
            });
        }

        // Generate password (random — customer never sees it unless allowDirectLogin)
        const rawPassword = generatePassword();

        // ── Reserve the slot FIRST, atomically (PA-H6) ─────────────────────────
        // The length check above reads a document loaded back in the auth
        // middleware, so two concurrent provisioning calls both saw the old
        // count and both passed. This $push is conditional on the CURRENT array
        // size in the database, so exactly one of them can win the last slot.
        //
        // A placeholder id is pushed and swapped for the real one once the user
        // exists — reserving with the real id is impossible before User.create.
        const reservationId = new mongoose.Types.ObjectId();
        const reserved = await PartnerApp.updateOne(
            {
                _id: partner._id,
                // "the slot at index maxAccounts-1 is still empty" — i.e. the
                // array currently holds fewer than maxAccounts entries.
                [`accountIds.${maxAccounts - 1}`]: { $exists: false }
            },
            { $push: { accountIds: reservationId } }
        );

        if (reserved.modifiedCount === 0) {
            return res.status(403).json({
                success: false,
                error: 'account_limit_reached',
                message: `Maximum ${partner.maxAccounts} accounts allowed for this partner.`
            });
        }

        // ── Provision (PA-H6) ──────────────────────────────────────────────────
        // Four writes with no transaction previously left an orphaned User on
        // any mid-sequence failure: invisible to the partner (listAccounts reads
        // accountIds) AND to SuperAdmin, but holding the email hostage so every
        // retry returned email_exists with no recovery path in the UI.
        //
        // Compensating rollback rather than a Mongo transaction, because this
        // must also work on a standalone mongod (dev) where transactions are
        // unavailable — see aiCreditService for the same constraint.
        let newUser = null;
        try {
            newUser = await User.create({
                name: name.trim(),
                companyName: companyName || name.trim(),
                email: normalizedEmail,
                password: rawPassword, // hashed by User model pre('save') hook
                phone: phone || null,
                role: 'manager',
                isOnboarded: true,
                accountStatus: 'Active',
                is_active: true,
                approved_by_admin: true,
                status: 'approved'
            });

            // Create WorkspaceSettings — NO planExpiryDate = bypasses all billing checks
            const defaults = partner.accountDefaults || {};
            await WorkspaceSettings.create({
                userId: newUser._id,
                // Hard-cap instance…
                agentLimit: defaults.agentLimit ?? 3,
                activeModules: defaults.activeModules?.length ? defaults.activeModules : ['leads', 'whatsapp'],
                // …and the planFeatures mirror, which is what the enforcement
                // paths actually read (PA-M1). leadController checks
                // planFeatures.leadLimit; writing only accountDefaults.leadLimit
                // meant every partner account silently kept the schema default
                // of 100 leads no matter what the admin configured.
                planFeatures: {
                    leadLimit:  defaults.leadLimit  ?? 500,
                    agentLimit: defaults.agentLimit ?? 3,
                    ...whatsappPlanFeatures(partner)
                },
                subscriptionPlan: 'Partner',
                subscriptionStatus: 'active',
                billingType: 'paid_by_agency',
                planExpiryDate: null  // ← KEY: no expiry = bypasses all billing
            });

            // Create IntegrationConfig (empty, ready for WhatsApp setup)
            await IntegrationConfig.create({ userId: newUser._id });

            // Swap the reservation placeholder for the real account id.
            const claimed = await PartnerApp.updateOne(
                { _id: partner._id, accountIds: reservationId },
                { $set: { 'accountIds.$': newUser._id } }
            );
            if (claimed.modifiedCount === 0) {
                throw new Error('Reservation slot vanished before it could be claimed.');
            }
        } catch (err) {
            // Roll everything back so a retry with the same email succeeds.
            await Promise.allSettled([
                PartnerApp.updateOne({ _id: partner._id }, { $pull: { accountIds: reservationId } }),
                newUser ? User.deleteOne({ _id: newUser._id }) : Promise.resolve(),
                newUser ? WorkspaceSettings.deleteOne({ userId: newUser._id }) : Promise.resolve(),
                newUser ? IntegrationConfig.deleteOne({ userId: newUser._id }) : Promise.resolve()
            ]);
            throw err;
        }

        // The tenant→partner webhook resolver caches misses, and this tenant was
        // a miss until a moment ago. Without this, the partner's own webhook
        // would silently drop this account's events for up to 5 minutes.
        clearCacheForTenant(newUser._id);

        // PA-M7: account.created is advertised in the Settings tab; emit it.
        forwardIfPartnerAccount(newUser._id, 'account.created', {
            accountId: newUser._id.toString(),
            name: newUser.name,
            email: newUser.email,
            companyName: newUser.companyName
        }).catch(() => {});

        const response = {
            success: true,
            data: {
                accountId: newUser._id,
                name: newUser.name,
                email: newUser.email,
                companyName: newUser.companyName
            }
        };

        // If direct login is allowed, include credentials
        if (partner.allowDirectLogin) {
            response.data.password = rawPassword;
            response.data.loginUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/login`;
        }

        res.status(201).json(response);
    } catch (err) {
        console.error('[PartnerAPI] createAccount error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create account.' });
    }
};

/**
 * GET /api/partner/v1/accounts
 * List all provisioned accounts for this partner.
 */
exports.listAccounts = async (req, res) => {
    try {
        const partner = req.partner;

        // Paginated (PA-L): a partner at maxAccounts=100 was tolerable, but the
        // cap is admin-configurable and this endpoint returned every account
        // plus an IntegrationConfig lookup for each one in a single response.
        const page  = Math.max(1, parseInt(req.query.page)  || 1);
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const total = partner.accountIds.length;

        if (!total) {
            return res.json({ success: true, data: [], total: 0, page, pages: 0 });
        }

        // Slice the id list before querying so both lookups stay page-sized.
        const pageIds = partner.accountIds.slice((page - 1) * limit, page * limit);

        if (!pageIds.length) {
            return res.json({ success: true, data: [], total, page, pages: Math.ceil(total / limit) });
        }

        const users = await User.find(
            { _id: { $in: pageIds } },
            'name email companyName phone is_active accountStatus createdAt'
        ).lean();

        // Enrich with WhatsApp connection status
        const configs = await IntegrationConfig.find(
            { userId: { $in: pageIds } },
            'userId whatsapp.waPhoneNumberId whatsapp.embeddedSignupConnected'
        ).lean();

        const configMap = {};
        configs.forEach(c => {
            configMap[c.userId.toString()] = {
                whatsappConnected: !!(c.whatsapp?.waPhoneNumberId),
                embeddedSignup: !!c.whatsapp?.embeddedSignupConnected
            };
        });

        const data = users.map(u => ({
            accountId: u._id,
            name: u.name,
            email: u.email,
            companyName: u.companyName,
            phone: u.phone,
            status: u.accountStatus || (u.is_active ? 'Active' : 'Frozen'),
            whatsappConnected: configMap[u._id.toString()]?.whatsappConnected || false,
            createdAt: u.createdAt
        }));

        res.json({ success: true, data, total, page, pages: Math.ceil(total / limit) });
    } catch (err) {
        console.error('[PartnerAPI] listAccounts error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to list accounts.' });
    }
};

/**
 * GET /api/partner/v1/accounts/:accountId
 * Get single account details.
 */
exports.getAccount = async (req, res) => {
    try {
        // req.tenantId is set by requireAccountScope, which is the ONLY place
        // ownership is decided. Re-deriving it from params here is what created
        // the PA-C1 divergence on the embed-token route — don't reintroduce it.
        const accountId = req.tenantId;

        const user = await User.findById(accountId)
            .select('name email companyName phone is_active accountStatus createdAt')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }

        const config = await IntegrationConfig.findOne(
            { userId: accountId },
            'whatsapp.waPhoneNumberId whatsapp.displayPhone whatsapp.embeddedSignupConnected'
        ).lean();

        const ws = await WorkspaceSettings.findOne(
            { userId: accountId },
            'activeModules subscriptionStatus'
        ).lean();

        res.json({
            success: true,
            data: {
                accountId: user._id,
                name: user.name,
                email: user.email,
                companyName: user.companyName,
                phone: user.phone,
                status: user.accountStatus || (user.is_active ? 'Active' : 'Frozen'),
                whatsapp: {
                    connected: !!(config?.whatsapp?.waPhoneNumberId),
                    displayPhone: config?.whatsapp?.displayPhone || null,
                    embeddedSignup: !!config?.whatsapp?.embeddedSignupConnected
                },
                modules: ws?.activeModules || [],
                createdAt: user.createdAt
            }
        });
    } catch (err) {
        console.error('[PartnerAPI] getAccount error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to get account.' });
    }
};

/**
 * PUT /api/partner/v1/accounts/:accountId/freeze
 */
exports.freezeAccount = async (req, res) => {
    try {
        const accountId = req.tenantId;   // authorised by requireAccountScope

        await User.updateOne(
            { _id: accountId },
            { $set: { accountStatus: 'Frozen', is_active: false } }
        );
        // Setting is_active:false only blocks the NEXT auth cache miss — the
        // frozen account kept working for up to 60s. Kill live sessions now.
        await revokeAccountSessions(accountId);

        forwardIfPartnerAccount(accountId, 'account.frozen', {
            accountId: accountId.toString(),
            status: 'Frozen'
        }).catch(() => {});

        res.json({ success: true, message: 'Account frozen.' });
    } catch (err) {
        console.error('[PartnerAPI] freezeAccount error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to freeze account.' });
    }
};

/**
 * PUT /api/partner/v1/accounts/:accountId/unfreeze
 */
exports.unfreezeAccount = async (req, res) => {
    try {
        const accountId = req.tenantId;   // authorised by requireAccountScope

        await User.updateOne(
            { _id: accountId },
            { $set: { accountStatus: 'Active', is_active: true } }
        );
        // Drop the cached is_active:false so access is restored immediately
        // instead of after the auth cache TTL.
        clearTokenVersionCache(accountId.toString());

        forwardIfPartnerAccount(accountId, 'account.frozen', {
            accountId: accountId.toString(),
            status: 'Active'
        }).catch(() => {});

        res.json({ success: true, message: 'Account unfrozen.' });
    } catch (err) {
        console.error('[PartnerAPI] unfreezeAccount error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to unfreeze account.' });
    }
};

/**
 * PATCH /api/partner/v1/accounts/:accountId
 * Update a provisioned account's profile fields.
 *
 * Previously there was no way at all to correct a name, phone or company on a
 * provisioned account — the only remedy was delete-and-recreate. Email is
 * deliberately NOT editable here: it is the login identity and is uniqueness-
 * constrained platform-wide, so changing it belongs behind the same
 * verification flow a normal user goes through.
 */
exports.updateAccount = async (req, res) => {
    try {
        const accountId = req.tenantId;   // authorised by requireAccountScope
        const { name, phone, companyName } = req.body;

        const update = {};
        if (name !== undefined) {
            if (!String(name).trim()) {
                return res.status(400).json({ success: false, message: 'name cannot be empty.' });
            }
            update.name = String(name).trim();
        }
        if (phone !== undefined)       update.phone = phone || null;
        if (companyName !== undefined) update.companyName = companyName || null;

        if (!Object.keys(update).length) {
            return res.status(400).json({
                success: false,
                message: 'Provide at least one of: name, phone, companyName.'
            });
        }

        const user = await User.findByIdAndUpdate(accountId, { $set: update }, { new: true })
            .select('name email companyName phone accountStatus')
            .lean();

        if (!user) {
            return res.status(404).json({ success: false, message: 'Account not found.' });
        }

        res.json({
            success: true,
            data: {
                accountId: user._id,
                name: user.name,
                email: user.email,
                companyName: user.companyName,
                phone: user.phone
            }
        });
    } catch (err) {
        console.error('[PartnerAPI] updateAccount error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update account.' });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// EMBED TOKEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/partner/v1/accounts/:accountId/embed-token
 * Generate a short-lived, single-use embed token for iframe authentication.
 */
exports.generateEmbedToken = async (req, res) => {
    try {
        const partner = req.partner;

        // ⚠️ PA-C1 — read the id requireAccountScope AUTHORISED, never req.params.
        //
        // This line used to be `const { accountId } = req.params` while the
        // guard validated `headers['x-account-id'] || params.accountId`. Sending
        // a header you own alongside any victim userId in the path passed the
        // ownership check and then minted an embed token for the victim, which
        // exchanges into a full JWT carrying THEIR role and permissions. Aimed
        // at a superadmin that was total platform compromise.
        //
        // The guard now treats the route param as authoritative and rejects a
        // conflicting header, and this reads its verdict rather than re-deriving.
        const accountId = req.tenantId;

        const token = generateEmbedToken();

        await EmbedToken.create({
            token,
            userId: accountId,
            partnerId: partner._id
        });

        const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

        res.json({
            success: true,
            embedToken: token,
            embedUrl: `${frontendUrl}/embed/whatsapp?token=${token}`,
            expiresIn: 300 // 5 minutes
        });
    } catch (err) {
        console.error('[PartnerAPI] generateEmbedToken error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to generate embed token.' });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/partner/v1/whatsapp/connect
 * Connect WhatsApp credentials for a partner's account.
 */
exports.connectWhatsApp = async (req, res) => {
    try {
        const { wabaId, phoneNumberId, accessToken, businessId, appId, appSecret } = req.body;

        if (!phoneNumberId || !accessToken) {
            return res.status(400).json({
                success: false,
                message: 'phoneNumberId and accessToken are required.'
            });
        }

        await IntegrationConfig.findOneAndUpdate(
            { userId: req.tenantId },
            {
                $set: {
                    'whatsapp.wabaId': wabaId || null,
                    'whatsapp.waPhoneNumberId': phoneNumberId,
                    'whatsapp.waAccessToken': accessToken,
                    'whatsapp.waBusinessId': businessId || null,
                    'whatsapp.waAppId': appId || null,
                    'whatsapp.waAppSecret': appSecret || null,
                    'whatsapp.embeddedSignupConnected': false
                }
            },
            { upsert: true }
        );

        res.json({ success: true, message: 'WhatsApp credentials connected.' });
    } catch (err) {
        console.error('[PartnerAPI] connectWhatsApp error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to connect WhatsApp.' });
    }
};

/**
 * GET /api/partner/v1/whatsapp/config
 * Get WhatsApp connection status for the scoped account.
 */
exports.getWhatsAppConfig = async (req, res) => {
    try {
        const config = await IntegrationConfig.findOne(
            { userId: req.tenantId },
            'whatsapp.waPhoneNumberId whatsapp.displayPhone whatsapp.verifiedName whatsapp.embeddedSignupConnected'
        ).lean();

        res.json({
            success: true,
            data: {
                connected: !!(config?.whatsapp?.waPhoneNumberId),
                displayPhone: config?.whatsapp?.displayPhone || null,
                verifiedName: config?.whatsapp?.verifiedName || null,
                embeddedSignup: !!config?.whatsapp?.embeddedSignupConnected
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get WhatsApp config.' });
    }
};

/**
 * DELETE /api/partner/v1/whatsapp/disconnect
 */
exports.disconnectWhatsApp = async (req, res) => {
    try {
        await IntegrationConfig.findOneAndUpdate(
            { userId: req.tenantId },
            {
                $set: {
                    'whatsapp.wabaId': null,
                    'whatsapp.waPhoneNumberId': null,
                    'whatsapp.waAccessToken': null,
                    'whatsapp.waBusinessId': null,
                    'whatsapp.waAppId': null,
                    'whatsapp.waAppSecret': null,
                    'whatsapp.displayPhone': null,
                    'whatsapp.verifiedName': null,
                    'whatsapp.embeddedSignupConnected': false
                }
            }
        );
        res.json({ success: true, message: 'WhatsApp disconnected.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to disconnect WhatsApp.' });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP MESSAGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/partner/v1/whatsapp/send
 * Send a text WhatsApp message via the partner API.
 */
exports.sendWhatsApp = async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ success: false, message: 'phone and message are required.' });
        }

        const result = await sendWhatsAppTextMessage(phone, message, req.tenantId);
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[PartnerAPI] sendWhatsApp error:', err.message);
        res.status(500).json({ success: false, message: err.message || 'Failed to send message.' });
    }
};

/**
 * POST /api/partner/v1/whatsapp/template
 * Send a WhatsApp template message.
 */
exports.sendTemplate = async (req, res) => {
    try {
        const { phone, templateName, languageCode, variables } = req.body;
        if (!phone || !templateName) {
            return res.status(400).json({ success: false, message: 'phone and templateName are required.' });
        }

        const result = await sendTemplateMessage(
            phone, templateName, languageCode || 'en', variables || [], req.tenantId
        );
        res.json({ success: true, data: result });
    } catch (err) {
        console.error('[PartnerAPI] sendTemplate error:', err.message);
        res.status(500).json({ success: false, message: err.message || 'Failed to send template.' });
    }
};

/**
 * GET /api/partner/v1/whatsapp/templates
 * List WhatsApp templates for the scoped account.
 *
 * Returns EVERY status (APPROVED / PENDING / REJECTED) so a partner can show
 * their customer why a template isn't sendable yet. Pass ?status=APPROVED to
 * get only the ones that can actually be sent.
 */
exports.listTemplates = async (req, res) => {
    try {
        const query = { userId: req.tenantId };
        if (req.query.status) query.status = String(req.query.status).toUpperCase();

        const templates = await WhatsAppTemplate.find(query)
            .select('name language status category components')
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, data: templates, total: templates.length });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to list templates.' });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP CONVERSATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/partner/v1/whatsapp/conversations
 * List conversations for the scoped account.
 */
exports.listConversations = async (req, res) => {
    try {
        const { status = 'active', page = 1, limit = 50 } = req.query;
        const query = { userId: req.tenantId };
        if (status && status !== 'all') query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [conversations, total] = await Promise.all([
            WhatsAppConversation.find(query)
                .populate('leadId', 'name email status')
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            WhatsAppConversation.countDocuments(query)
        ]);

        res.json({
            success: true,
            data: conversations,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit))
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to list conversations.' });
    }
};

/**
 * GET /api/partner/v1/whatsapp/conversations/:conversationId/messages
 */
exports.getConversationMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { page = 1, limit = 50 } = req.query;

        // Verify conversation belongs to this tenant
        const conv = await WhatsAppConversation.findOne({
            _id: conversationId,
            userId: req.tenantId
        }).lean();

        if (!conv) {
            return res.status(404).json({ success: false, message: 'Conversation not found.' });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [messages, total] = await Promise.all([
            WhatsAppMessage.find({ conversationId })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            WhatsAppMessage.countDocuments({ conversationId })
        ]);

        res.json({
            success: true,
            data: messages.reverse(), // oldest first for chat display
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit))
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get messages.' });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/partner/v1/webhook
 */
exports.getWebhookConfig = async (req, res) => {
    try {
        const partner = req.partner;
        res.json({
            success: true,
            data: {
                url: partner.webhookUrl,
                events: partner.webhookEvents,
                hasSecret: !!partner.webhookSecret
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get webhook config.' });
    }
};

/**
 * PUT /api/partner/v1/webhook
 */
exports.updateWebhookConfig = async (req, res) => {
    try {
        const { url, events } = req.body;
        const update = {};

        if (url !== undefined) {
            // PA-H5: the server will POST signed JSON to whatever lands here on
            // every inbound message. Unvalidated, that is an SSRF primitive
            // pointed at cloud metadata and internal services.
            const urlError = await checkWebhookUrl(url);
            if (urlError) {
                return res.status(400).json({
                    success: false,
                    error: 'invalid_webhook_url',
                    message: urlError
                });
            }
            // PA-M8: the resolver filters on `webhookUrl: { $ne: null }`, which
            // an empty string satisfies — clearing the URL in the UI used to
            // leave webhooks "configured" and log an axios failure on every
            // single inbound message forever. Normalise blank to null.
            update.webhookUrl = url ? url.trim() : null;
        }

        if (events !== undefined) {
            if (!Array.isArray(events)) {
                return res.status(400).json({ success: false, message: 'events must be an array.' });
            }
            const unknown = events.filter(e => !WEBHOOK_EVENTS.includes(e));
            if (unknown.length) {
                return res.status(400).json({
                    success: false,
                    error: 'unknown_webhook_event',
                    message: `Unknown event(s): ${unknown.join(', ')}. Supported: ${WEBHOOK_EVENTS.join(', ')}.`
                });
            }
            update.webhookEvents = events;
        }

        // Generate webhook secret if setting URL for the first time
        const isFirstSecret = update.webhookUrl && !req.partner.webhookSecret;
        if (isFirstSecret) {
            update.webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
        }

        await PartnerApp.updateOne({ _id: req.partner._id }, { $set: update });

        // PA-M9: the tenant→partner cache holds webhookEvents and webhookSecret,
        // so an events change without this stayed stale for up to 5 minutes.
        await clearCacheForPartner(req.partner._id);

        const updated = await PartnerApp.findById(req.partner._id)
            .select('webhookUrl webhookEvents webhookSecret')
            .lean();

        const data = {
            url: updated.webhookUrl,
            events: updated.webhookEvents,
            hasSecret: !!updated.webhookSecret
        };

        // The secret is returned ONLY on the call that created it. It used to be
        // echoed in full on every update, which turned a routine "change my
        // subscribed events" request into a credential disclosure. Rotation is
        // an explicit action (POST /webhook/rotate-secret).
        if (isFirstSecret) {
            data.secret = updated.webhookSecret;
            data.message = 'Store this signing secret now — it is not returned again.';
        }

        res.json({ success: true, data });
    } catch (err) {
        console.error('[PartnerAPI] updateWebhookConfig error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to update webhook.' });
    }
};

/**
 * POST /api/partner/v1/webhook/rotate-secret
 * Issue a new signing secret. Returned once; the previous secret stops
 * validating immediately.
 */
exports.rotateWebhookSecret = async (req, res) => {
    try {
        const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
        await PartnerApp.updateOne({ _id: req.partner._id }, { $set: { webhookSecret: secret } });
        await clearCacheForPartner(req.partner._id);

        res.json({
            success: true,
            data: {
                secret,
                message: 'Store this signing secret now — it is not returned again. The previous secret is no longer used to sign deliveries.'
            }
        });
    } catch (err) {
        console.error('[PartnerAPI] rotateWebhookSecret error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to rotate webhook secret.' });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/partner/v1/analytics/whatsapp
 * WhatsApp message stats for a scoped account.
 */
exports.getWhatsAppAnalytics = async (req, res) => {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        const [totalConversations, totalMessages, recentMessages] = await Promise.all([
            WhatsAppConversation.countDocuments({ userId: req.tenantId }),
            WhatsAppMessage.countDocuments({ userId: req.tenantId }),
            WhatsAppMessage.countDocuments({
                userId: req.tenantId,
                timestamp: { $gte: thirtyDaysAgo }
            })
        ]);

        res.json({
            success: true,
            data: {
                totalConversations,
                totalMessages,
                messagesLast30Days: recentMessages
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to get analytics.' });
    }
};

// Shared with scripts/setup_partner_test.js so the provisioning mapping and any
// backfill can never drift apart.
exports._whatsappPlanFeatures = whatsappPlanFeatures;
