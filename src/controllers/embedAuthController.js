/**
 * Embed Auth Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Exchanges a short-lived embed token (emb_xxx) for a real JWT session.
 * Called by the embedded WhatsApp iframe on load.
 *
 * Route: GET /api/embed/auth?token=emb_xxx
 */

const jwt = require('jsonwebtoken');
const EmbedToken = require('../models/EmbedToken');
const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const PartnerApp = require('../models/PartnerApp');
const { resolveValues } = require('../constants/featureRegistry');

const TOKEN_EXPIRY = '8h'; // Embed sessions are shorter-lived than normal sessions

/**
 * GET /api/embed/auth?token=emb_xxx
 * Exchange embed token for JWT + user data.
 */
exports.exchangeEmbedToken = async (req, res) => {
    try {
        const { token } = req.query;

        if (!token || !token.startsWith('emb_')) {
            return res.status(400).json({
                success: false,
                error: 'invalid_token',
                message: 'Missing or invalid embed token.'
            });
        }

        // Atomic find and update: only match if not yet used
        const embedToken = await EmbedToken.findOneAndUpdate(
            { token, usedAt: null },
            { $set: { usedAt: new Date() } },
            { new: false } // return old doc to check if it existed/was unused
        );

        if (!embedToken) {
            // Either the token doesn't exist, has expired (TTL), or was already used
            return res.status(401).json({
                success: false,
                error: 'invalid_or_used_token',
                message: 'Embed token is invalid, expired, or has already been used.'
            });
        }

        // ── Partner state gate (PA-H3) ─────────────────────────────────────────
        // Deactivating a partner blocks the x-partner-key path but did nothing
        // here, so tokens minted in the preceding 5 minutes still exchanged
        // successfully — despite the admin UI promising "Embed iframes will stop
        // working". Load the partner BEFORE issuing anything.
        const partner = await PartnerApp.findById(embedToken.partnerId)
            .select('allowedModules showPoweredBy appName isActive accountIds')
            .lean();

        if (!partner || !partner.isActive) {
            return res.status(403).json({
                success: false,
                error: 'partner_deactivated',
                message: 'This integration has been deactivated. Contact your CRM provider.'
            });
        }

        // ── Membership re-check (PA-C1 defence in depth) ───────────────────────
        // The mint path is now the authoritative gate, but this endpoint trades a
        // token for a JWT carrying the target user's role and permissions — far
        // too much authority to grant on the strength of one upstream check. If
        // the token's subject is not (still) one of this partner's accounts, the
        // token is not honoured, whether that is an exploit attempt or simply an
        // account that was removed from the partner after the token was minted.
        const belongsToPartner = (partner.accountIds || []).some(
            id => id.toString() === embedToken.userId.toString()
        );
        if (!belongsToPartner) {
            console.warn(
                `[EmbedAuth] REJECTED: token ${embedToken._id} targets user ${embedToken.userId} ` +
                `which is not an account of partner ${embedToken.partnerId}.`
            );
            return res.status(403).json({
                success: false,
                error: 'account_not_found',
                message: 'This account is not available through this integration.'
            });
        }

        // Load user and workspace
        const user = await User.findById(embedToken.userId);
        if (!user || !user.is_active) {
            return res.status(403).json({
                success: false,
                error: 'account_inactive',
                message: 'Account is inactive or not found.'
            });
        }

        const workspace = await WorkspaceSettings.findOne({ userId: user._id });

        // The modules this partner is actually entitled to resell. Carried in the
        // JWT so authMiddleware can clamp the session server-side (PA-H2) without
        // a PartnerApp lookup on every request. Signed, so the embed page cannot
        // widen its own grant by editing what it was handed.
        const allowedModules = Array.isArray(partner.allowedModules) ? partner.allowedModules : [];

        // Sign JWT — same format as normal auth so all existing APIs work
        const jwtPayload = {
            userId: user._id,
            role: user.role,
            name: user.name,
            permissions: user.permissions,
            tenantId: user._id, // managers are their own tenant
            tv: user.tokenVersion || 0,
            embed: true, // Flag to identify embed sessions
            embedModules: allowedModules,
            // Hard ceiling matching the token's own lifetime. Embed sessions are
            // never renewed, so this is belt-and-braces — but it means an embed
            // JWT can never outlive its window even if a future change starts
            // re-issuing them on /auth/me the way rememberMe sessions are.
            absExp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
        };

        const jwtToken = jwt.sign(jwtPayload, process.env.JWT_SECRET, {
            expiresIn: TOKEN_EXPIRY
        });

        res.json({
            success: true,
            token: jwtToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                permissions: user.permissions,
                isOnboarded: user.isOnboarded,
                // Narrowed to the partner's grant so the embed UI renders exactly
                // what the API will actually serve — the two used to disagree
                // completely, with the UI showing everything.
                activeModules: (workspace?.activeModules || []).filter(m => allowedModules.includes(m)),
                planFeatures: workspace?.planFeatures || {},
                entitlements: workspace ? resolveValues(workspace) : {},
                // Embed-specific data
                embed: true,
                allowedModules,
                showPoweredBy: partner?.showPoweredBy ?? true,
                partnerName: partner?.appName || null
            }
        });
    } catch (err) {
        console.error('[EmbedAuth] exchangeEmbedToken error:', err.message);
        res.status(500).json({ success: false, message: 'Authentication failed.' });
    }
};
