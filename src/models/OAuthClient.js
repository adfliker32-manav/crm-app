const mongoose = require('mongoose');

// ── OAuth Client (Dynamic Client Registration — RFC 7591) ────────────────────
// Each time Claude.ai's browser connector connects, it registers itself as a
// new client. Records auto-expire after 90 days of inactivity.
const oauthClientSchema = new mongoose.Schema({
    clientId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    clientSecret: {
        type: String,
        required: true
    },
    clientName: {
        type: String,
        default: 'Claude.ai Connector'
    },
    redirectUris: {
        type: [String],
        default: []
    },
    grantTypes: {
        type: [String],
        default: ['authorization_code']
    },
    responseTypes: {
        type: [String],
        default: ['code']
    },
    tokenEndpointAuthMethod: {
        type: String,
        default: 'client_secret_post'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Auto-delete clients after 90 days — prevents unbounded growth from
// repeated Dynamic Client Registration calls.
oauthClientSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

// ── Authorization Code (short-lived, PKCE-protected) ─────────────────────────
// Generated when the user submits their MCP API key on the authorize page.
// Exchanged for an access_token via POST /oauth/token.
const oauthAuthCodeSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    clientId: {
        type: String,
        required: true
    },
    // The actual MCP API key — returned as access_token after code exchange
    mcpApiKey: {
        type: String,
        required: true
    },
    redirectUri: {
        type: String,
        required: true
    },
    // PKCE (RFC 7636) — required by OAuth 2.1
    codeChallenge: {
        type: String,
        required: true
    },
    codeChallengeMethod: {
        type: String,
        enum: ['S256'],
        default: 'S256'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Auth codes expire in 10 minutes — standard OAuth best practice
oauthAuthCodeSchema.index({ createdAt: 1 }, { expireAfterSeconds: 600 });

const OAuthClient = mongoose.model('OAuthClient', oauthClientSchema);
const OAuthAuthCode = mongoose.model('OAuthAuthCode', oauthAuthCodeSchema);

module.exports = { OAuthClient, OAuthAuthCode };
