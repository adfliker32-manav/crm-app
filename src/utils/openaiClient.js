// ─────────────────────────────────────────────────────────────────────────────
// openaiClient.js — Singleton OpenAI Client Factory
// ─────────────────────────────────────────────────────────────────────────────
// FIX WEAK #1: AiClassifierNode was creating a new OpenAI instance on every
// single execution, wasting memory and preventing connection pooling.
//
// This module provides:
//   1. getGlobalOpenAIClient() — global singleton using the env API key
//   2. getTenantOpenAIClient(tenantId) — future support for per-tenant keys
// ─────────────────────────────────────────────────────────────────────────────

const OpenAI = require('openai');

// Global singleton — one client for all executions using the platform key
let _globalClient = null;

/**
 * Returns the shared OpenAI client instance for the global (platform) API key.
 * Client is created lazily on first call and reused thereafter.
 *
 * @returns {OpenAI|null} — null if OPENAI_API_KEY is not configured
 */
const getGlobalOpenAIClient = () => {
    if (!process.env.OPENAI_API_KEY) return null;

    if (!_globalClient) {
        _globalClient = new OpenAI({
            apiKey:  process.env.OPENAI_API_KEY,
            timeout: 30000,  // 30-second global timeout per request
            maxRetries: 2    // Built-in retry on transient errors
        });
        console.log('[OpenAIClient] Global singleton client initialised.');
    }
    return _globalClient;
};

/**
 * Reset the global client (useful for testing or key rotation).
 */
const resetGlobalClient = () => {
    _globalClient = null;
};

// Per-tenant client cache (future: store per-tenant keys in DB)
const _tenantClients = new Map();
const TENANT_CLIENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Returns an OpenAI client for a specific tenant.
 * Falls back to the global client if no tenant-specific key is configured.
 *
 * @param {string} tenantId
 * @param {string|null} tenantApiKey — the tenant's own OpenAI API key, if configured
 * @returns {OpenAI|null}
 */
const getTenantOpenAIClient = (tenantId, tenantApiKey = null) => {
    if (!tenantApiKey) {
        // No tenant-specific key — use global
        return getGlobalOpenAIClient();
    }

    const cached = _tenantClients.get(tenantId);
    if (cached && Date.now() - cached.createdAt < TENANT_CLIENT_TTL_MS) {
        return cached.client;
    }

    const client = new OpenAI({
        apiKey:     tenantApiKey,
        timeout:    30000,
        maxRetries: 2
    });
    _tenantClients.set(tenantId, { client, createdAt: Date.now() });
    return client;
};

module.exports = { getGlobalOpenAIClient, getTenantOpenAIClient, resetGlobalClient };
