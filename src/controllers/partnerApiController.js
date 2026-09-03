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
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const IntegrationConfig = require('../models/IntegrationConfig');
const PartnerApp = require('../models/PartnerApp');
const EmbedToken = require('../models/EmbedToken');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage: sendTemplateMessage } = require('../services/whatsappService');

// ── Helpers ─────────────────────────────────────────────────────────────────

const generatePassword = () => crypto.randomBytes(16).toString('hex');
const generateEmbedToken = () => `emb_${crypto.randomBytes(24).toString('hex')}`;

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

        // Check account limit
        if (partner.accountIds.length >= partner.maxAccounts) {
            return res.status(403).json({
                success: false,
                error: 'account_limit_reached',
                message: `Maximum ${partner.maxAccounts} accounts allowed for this partner.`
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

        // Create User
        const newUser = await User.create({
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
            agentLimit: defaults.agentLimit || 3,
            activeModules: defaults.activeModules || ['leads', 'whatsapp'],
            subscriptionPlan: 'Partner',
            subscriptionStatus: 'active',
            billingType: 'paid_by_agency',
            planExpiryDate: null  // ← KEY: no expiry = bypasses all billing
        });

        // Create IntegrationConfig (empty, ready for WhatsApp setup)
        await IntegrationConfig.create({ userId: newUser._id });

        // Add account to partner's list
        await PartnerApp.updateOne(
            { _id: partner._id },
            { $push: { accountIds: newUser._id } }
        );

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

        if (!partner.accountIds.length) {
            return res.json({ success: true, data: [], total: 0 });
        }

        const users = await User.find(
            { _id: { $in: partner.accountIds } },
            'name email companyName phone is_active accountStatus createdAt'
        ).lean();

        // Enrich with WhatsApp connection status
        const configs = await IntegrationConfig.find(
            { userId: { $in: partner.accountIds } },
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

        res.json({ success: true, data, total: data.length });
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
        const { accountId } = req.params;
        
        // Verify account belongs to this partner
        if (!req.partner.accountIds.some(id => id.toString() === accountId)) {
            return res.status(403).json({ success: false, message: 'Account does not belong to this partner.' });
        }

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
        const { accountId } = req.params;

        // Verify account belongs to this partner
        if (!req.partner.accountIds.some(id => id.toString() === accountId)) {
            return res.status(403).json({ success: false, message: 'Account does not belong to this partner.' });
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
 * PUT /api/partner/v1/accounts/:accountId/unfreeze
 */
exports.unfreezeAccount = async (req, res) => {
    try {
        const { accountId } = req.params;

        // Verify account belongs to this partner
        if (!req.partner.accountIds.some(id => id.toString() === accountId)) {
            return res.status(403).json({ success: false, message: 'Account does not belong to this partner.' });
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

// ═══════════════════════════════════════════════════════════════════════════
// EMBED TOKEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/partner/v1/accounts/:accountId/embed-token
 * Generate a short-lived, single-use embed token for iframe authentication.
 */
exports.generateEmbedToken = async (req, res) => {
    try {
        const { accountId } = req.params;
        const partner = req.partner;

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
 * List approved WhatsApp templates for the scoped account.
 */
exports.listTemplates = async (req, res) => {
    try {
        const templates = await WhatsAppTemplate.find({ userId: req.tenantId })
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
        if (url !== undefined) update.webhookUrl = url;
        if (events !== undefined) update.webhookEvents = events;

        // Generate webhook secret if setting URL for the first time
        if (url && !req.partner.webhookSecret) {
            update.webhookSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
        }

        await PartnerApp.updateOne({ _id: req.partner._id }, { $set: update });

        const updated = await PartnerApp.findById(req.partner._id)
            .select('webhookUrl webhookEvents webhookSecret')
            .lean();

        res.json({
            success: true,
            data: {
                url: updated.webhookUrl,
                events: updated.webhookEvents,
                secret: updated.webhookSecret // shown once after setting
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Failed to update webhook.' });
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
