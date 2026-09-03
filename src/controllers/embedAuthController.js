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

        // Load partner config to determine allowed modules and branding
        const partner = await PartnerApp.findById(embedToken.partnerId)
            .select('allowedModules showPoweredBy appName')
            .lean();

        // Sign JWT — same format as normal auth so all existing APIs work
        const jwtPayload = {
            userId: user._id,
            role: user.role,
            name: user.name,
            permissions: user.permissions,
            tenantId: user._id, // managers are their own tenant
            tv: user.tokenVersion || 0,
            embed: true // Flag to identify embed sessions
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
                activeModules: workspace?.activeModules || [],
                planFeatures: workspace?.planFeatures || {},
                entitlements: workspace ? resolveValues(workspace) : {},
                // Embed-specific data
                embed: true,
                allowedModules: partner?.allowedModules || [],
                showPoweredBy: partner?.showPoweredBy ?? true,
                partnerName: partner?.appName || null
            }
        });
    } catch (err) {
        console.error('[EmbedAuth] exchangeEmbedToken error:', err.message);
        res.status(500).json({ success: false, message: 'Authentication failed.' });
    }
};
