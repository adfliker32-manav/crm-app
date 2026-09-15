const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// OAuth 2.1 storage for the MCP server (/mcp).
//
// Three collections:
//   OAuthClient    — an app that registered itself (Claude.ai, Claude Code,
//                    Claude Desktop…) via Dynamic Client Registration.
//   OAuthAuthCode  — a single-use, 10-minute, PKCE-bound authorization code.
//   OAuthGrant     — ONE row per connected app per user: the current access
//                    token + refresh token for that connection. This is what
//                    Settings → Claude AI lists as "Connected apps".
//
// ⚠️ Tokens and codes are stored as SHA-256 hashes only. A database dump must not
// hand anybody a working credential. The raw value exists exactly once: in the
// HTTP response that issued it.
// ─────────────────────────────────────────────────────────────────────────────

// ── OAuth Client (Dynamic Client Registration — RFC 7591) ────────────────────
const oauthClientSchema = new mongoose.Schema({
    clientId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // Only confidential clients (token_endpoint_auth_method != 'none') have a
    // secret. Legacy rows stored it in plain text; kept for compatibility.
    clientSecret: {
        type: String,
        default: null
    },
    clientName: {
        type: String,
        default: 'MCP Client'
    },
    redirectUris: {
        type: [String],
        default: []
    },
    grantTypes: {
        type: [String],
        default: ['authorization_code', 'refresh_token']
    },
    responseTypes: {
        type: [String],
        default: ['code']
    },
    tokenEndpointAuthMethod: {
        type: String,
        default: 'none'
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    // Refreshed whenever the client is used. The TTL keys off THIS, not
    // createdAt: expiring by creation date deleted clients that were still in
    // daily use, and their next refresh failed with `invalid_client`.
    lastUsedAt: {
        type: Date,
        default: Date.now
    }
});

// Unused clients disappear after 90 days — DCR is unauthenticated, so without a
// TTL the collection grows without bound.
oauthClientSchema.index({ lastUsedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// ── Authorization Code (short-lived, PKCE-protected) ─────────────────────────
const oauthAuthCodeSchema = new mongoose.Schema({
    codeHash: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    clientId: {
        type: String,
        required: true
    },
    // The CRM user who approved the request, and the workspace the resulting
    // tokens are locked to. Resolved server-side at login — never from input.
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    authMethod: {
        type: String,
        enum: ['password', 'api_key'],
        required: true
    },
    // User.tokenVersion at approval time — a password change between approval
    // and code exchange must still kill the grant.
    tokenVersion: {
        type: Number,
        default: 0
    },
    redirectUri: {
        type: String,
        required: true
    },
    resource: {
        type: String,
        required: true
    },
    scope: {
        type: String,
        default: 'mcp'
    },
    // PKCE (RFC 7636) — S256 only, as OAuth 2.1 requires
    codeChallenge: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

oauthAuthCodeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

// ── Grant (one connected app) ────────────────────────────────────────────────
const oauthGrantSchema = new mongoose.Schema({
    clientId: {
        type: String,
        required: true
    },
    clientName: {
        type: String,
        default: 'MCP Client'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    authMethod: {
        type: String,
        enum: ['password', 'api_key'],
        required: true
    },
    tokenVersion: {
        type: Number,
        default: 0
    },
    resource: {
        type: String,
        required: true
    },
    scope: {
        type: String,
        default: 'mcp'
    },

    accessTokenHash: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    accessExpiresAt: {
        type: Date,
        required: true
    },
    refreshTokenHash: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    refreshExpiresAt: {
        type: Date,
        required: true
    },
    // Refresh tokens rotate on every use (OAuth 2.1 §4.3.1). The one just
    // replaced is remembered so a REPLAY of it can be detected and the whole
    // grant revoked — that is the signal a refresh token was stolen.
    previousRefreshTokenHash: {
        type: String,
        default: null,
        index: true
    },
    rotatedAt: {
        type: Date,
        default: null
    },

    revokedAt: {
        type: Date,
        default: null
    },
    revokedReason: {
        type: String,
        default: null
    },
    lastUsedAt: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// A grant whose refresh token has lapsed can never be used again.
oauthGrantSchema.index({ refreshExpiresAt: 1 }, { expireAfterSeconds: 0 });

// ⚠️ EXPLICIT v2 COLLECTION NAMES — do not "tidy" these back to the defaults.
// The first OAuth implementation wrote to `oauthclients` / `oauthauthcodes`, and
// Mongoose never drops an index it no longer declares. Those collections still
// carry a UNIQUE index on `code` (every new code row has no `code`, so the second
// insert would die with E11000) and a TTL on `createdAt` that deletes clients 90
// days after registration regardless of use. Fresh collections avoid both
// without a migration anyone has to remember to run.
const OAuthClient = mongoose.model('OAuthClient', oauthClientSchema, 'mcp_oauth_clients');
const OAuthAuthCode = mongoose.model('OAuthAuthCode', oauthAuthCodeSchema, 'mcp_oauth_codes');
const OAuthGrant = mongoose.model('OAuthGrant', oauthGrantSchema, 'mcp_oauth_grants');

module.exports = { OAuthClient, OAuthAuthCode, OAuthGrant };
