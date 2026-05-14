/**
 * Web-to-Lead Controller
 * ─────────────────────────────────────────────────────────────────────────────
 * Allows any landing page to POST lead data directly into the CRM using a
 * per-tenant API key (no JWT required — public endpoint).
 *
 * Design goals:
 *   ✅ Zero extra database queries per lead (API key resolved in one lookup)
 *   ✅ Rate-limited per API key (not by IP) to resist distributed abuse
 *   ✅ CORS: accepts any origin so customer landing pages on any domain work
 *   ✅ Deduplicates by phone/email to avoid spam from page reloads
 *   ✅ Fires the same AutomationService hook as the Meta webhook
 *
 * Security layers (ordered — cheapest checks first):
 *   1. Express IP rate limit (route-level, 60/min/IP)
 *   2. Body size — Express default 100KB cap
 *   3. API key format check (must start with "wl_", must be ≤52 chars)
 *   4. Invalid-key rejection cache (blocks DB lookups for known-bad keys)
 *   5. Per-key rate limit (30/min per workspace)
 *   6. Per-key daily cap (500 leads/day per workspace)
 *   7. Dedup by phone/email
 *   8. Payload size caps (customData max 20 keys, field length limits)
 */

const crypto = require('crypto');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const Lead = require('../models/Lead');
const { evaluateLead } = require('../services/AutomationService');
const { clearTenantCache } = require('../middleware/authMiddleware');

// ═════════════════════════════════════════════════════════════════════════════
// RATE LIMITER — per API key (in-memory, no Redis)
// ═════════════════════════════════════════════════════════════════════════════
const WINDOW_MS      = 60 * 1000; // 1 minute
const MAX_PER_WINDOW  = 30;        // 30 leads/minute per workspace
const DAILY_CAP       = 500;       // 500 leads/day per workspace — prevents DB flood

const _rateLimitMap = new Map(); // apiKey → { count, resetAt }
const _dailyCapMap  = new Map(); // apiKey → { count, resetAt }

function _checkRateLimit(apiKey) {
    const now = Date.now();

    // ── Per-minute check ─────────────────────────────────────────
    let entry = _rateLimitMap.get(apiKey);
    if (!entry || now > entry.resetAt) {
        entry = { count: 1, resetAt: now + WINDOW_MS };
        _rateLimitMap.set(apiKey, entry);
    } else {
        if (entry.count >= MAX_PER_WINDOW) return { ok: false, reason: 'minute' };
        entry.count++;
    }

    // ── Per-day check ────────────────────────────────────────────
    const ONE_DAY = 24 * 60 * 60 * 1000;
    let daily = _dailyCapMap.get(apiKey);
    if (!daily || now > daily.resetAt) {
        daily = { count: 1, resetAt: now + ONE_DAY };
        _dailyCapMap.set(apiKey, daily);
    } else {
        if (daily.count >= DAILY_CAP) return { ok: false, reason: 'daily' };
        daily.count++;
    }

    return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════════════
// INVALID-KEY REJECTION CACHE
// ─────────────────────────────────────────────────────────────────────────────
// When an attacker brute-forces random API keys, every miss hits MongoDB.
// This cache remembers "this key doesn't exist" for 60 seconds, so repeated
// attempts with the same fake key cost ZERO DB queries.
// ═════════════════════════════════════════════════════════════════════════════
const INVALID_KEY_TTL = 60 * 1000; // remember a bad key for 60 seconds
const _invalidKeyCache = new Map(); // apiKey → expireAt timestamp

function _isKnownInvalidKey(apiKey) {
    const expiry = _invalidKeyCache.get(apiKey);
    if (!expiry) return false;
    if (Date.now() > expiry) { _invalidKeyCache.delete(apiKey); return false; }
    return true;
}

function _markKeyInvalid(apiKey) {
    _invalidKeyCache.set(apiKey, Date.now() + INVALID_KEY_TTL);
}

// ── Periodic cleanup of all in-memory maps (prevent memory leak) ─────────────
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of _rateLimitMap.entries()) {
        if (now > val.resetAt) _rateLimitMap.delete(key);
    }
    for (const [key, val] of _dailyCapMap.entries()) {
        if (now > val.resetAt) _dailyCapMap.delete(key);
    }
    for (const [key, expiry] of _invalidKeyCache.entries()) {
        if (now > expiry) _invalidKeyCache.delete(key);
    }
}, 5 * 60 * 1000); // every 5 minutes

// ── Generate a secure API key for a workspace ────────────────────────────────
const generateApiKey = () => `wl_${crypto.randomBytes(24).toString('hex')}`;

// ═════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED ENDPOINTS (CRM Settings UI)
// ═════════════════════════════════════════════════════════════════════════════

// ── GET /api/web-leads/config — fetch or auto-create API key ─────────────────
exports.getConfig = async (req, res) => {
    try {
        let settings = await WorkspaceSettings.findOne({ userId: req.tenantId }).lean();
        if (!settings) {
            return res.status(404).json({ success: false, message: 'Workspace settings not found' });
        }

        // Auto-create key if none exists
        if (!settings.webLeadApiKey) {
            const newKey = generateApiKey();
            await WorkspaceSettings.findOneAndUpdate(
                { userId: req.tenantId },
                { $set: { webLeadApiKey: newKey } }
            );
            clearTenantCache(req.tenantId);
            settings.webLeadApiKey = newKey;
        }

        res.json({
            success: true,
            apiKey: settings.webLeadApiKey,
            defaultStage: settings.webLeadDefaultStage || null,
            defaultTag: settings.webLeadDefaultTag || null,
        });
    } catch (err) {
        console.error('[WebLead] getConfig error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── POST /api/web-leads/regenerate — rotate the API key ─────────────────────
exports.regenerateKey = async (req, res) => {
    try {
        const newKey = generateApiKey();
        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { webLeadApiKey: newKey } }
        );
        clearTenantCache(req.tenantId);
        res.json({ success: true, apiKey: newKey });
    } catch (err) {
        console.error('[WebLead] regenerateKey error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ── PUT /api/web-leads/config — update default stage/tag ────────────────────
exports.updateConfig = async (req, res) => {
    try {
        const { defaultStage, defaultTag } = req.body;
        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { webLeadDefaultStage: defaultStage || null, webLeadDefaultTag: defaultTag || null } }
        );
        clearTenantCache(req.tenantId);
        res.json({ success: true });
    } catch (err) {
        console.error('[WebLead] updateConfig error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC CAPTURE ENDPOINT
// ═════════════════════════════════════════════════════════════════════════════

// Max allowed keys in customData (prevent CPU spike from huge objects)
const MAX_CUSTOM_KEYS = 20;

exports.captureLead = async (req, res) => {
    // CORS: allow any origin for the public capture endpoint
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

    if (req.method === 'OPTIONS') return res.status(204).end();

    // ── LAYER 1: API key format validation (zero cost) ───────────────────
    const apiKey = req.headers['x-api-key'] || req.body?.apiKey;
    if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('wl_') || apiKey.length > 52) {
        return res.status(401).json({ success: false, message: 'Missing or invalid API key' });
    }

    // ── LAYER 2: Reject known-invalid keys without hitting DB ────────────
    if (_isKnownInvalidKey(apiKey)) {
        return res.status(401).json({ success: false, message: 'Invalid API key' });
    }

    // ── LAYER 3: Per-key rate limit (minute + daily) ─────────────────────
    const rateLimitResult = _checkRateLimit(apiKey);
    if (!rateLimitResult.ok) {
        const msg = rateLimitResult.reason === 'daily'
            ? 'Daily lead capture limit reached. Try again tomorrow.'
            : 'Rate limit exceeded. Please slow down.';
        return res.status(429).json({ success: false, message: msg });
    }

    // ── LAYER 4: DB lookup (cached rejection for misses) ─────────────────
    let workspace;
    try {
        workspace = await WorkspaceSettings.findOne({ webLeadApiKey: apiKey })
                                           .select('userId webLeadDefaultStage webLeadDefaultTag')
                                           .lean();
    } catch (dbErr) {
        console.error('[WebLead] DB lookup error:', dbErr.message);
        return res.status(500).json({ success: false, message: 'Server error' });
    }

    if (!workspace) {
        _markKeyInvalid(apiKey); // cache the miss — next attempt skips DB
        return res.status(401).json({ success: false, message: 'Invalid API key' });
    }

    // ── LAYER 5: Input validation ────────────────────────────────────────
    const { name, phone, email, message, source, stage, tag, customData } = req.body;

    if (!name || typeof name !== 'string' || (!phone && !email)) {
        return res.status(400).json({
            success: false,
            message: 'name and at least one of phone or email are required'
        });
    }

    try {
        // ── LAYER 6: Deduplication ───────────────────────────────────────
        const dupQuery = { userId: workspace.userId };
        const orClauses = [];
        if (phone) orClauses.push({ phone: String(phone).trim() });
        if (email) orClauses.push({ email: String(email).trim().toLowerCase() });
        if (orClauses.length > 0) dupQuery.$or = orClauses;

        const existingLead = await Lead.findOne(dupQuery).select('_id').lean();
        if (existingLead) {
            // Return 200 OK so the form doesn't show an error to the visitor
            return res.json({ success: true, duplicate: true, message: 'Lead already exists' });
        }

        // ── LAYER 7: Build lead doc (with size caps) ─────────────────────
        const leadData = {
            userId: workspace.userId,
            name: String(name).trim().slice(0, 200),
            phone: phone ? String(phone).trim().slice(0, 30) : undefined,
            email: email ? String(email).trim().toLowerCase().slice(0, 200) : undefined,
            source: source ? String(source).slice(0, 100) : 'Landing Page',
            status: stage ? String(stage).slice(0, 50) : (workspace.webLeadDefaultStage || 'New'),
            tags: tag ? [String(tag).slice(0, 50)] : (workspace.webLeadDefaultTag ? [workspace.webLeadDefaultTag] : []),
            notes: message ? [{ text: String(message).trim().slice(0, 1000) }] : [],
            history: [{
                type: 'System',
                subType: 'Created',
                content: 'Lead captured from landing page via Web-to-Lead snippet.',
                date: new Date()
            }]
        };

        // Optional custom data fields — capped at MAX_CUSTOM_KEYS entries
        if (customData && typeof customData === 'object' && !Array.isArray(customData)) {
            const cleaned = {};
            let keyCount = 0;
            for (const [k, v] of Object.entries(customData)) {
                if (keyCount >= MAX_CUSTOM_KEYS) break;
                if (typeof k === 'string' && k.length < 100) {
                    cleaned[k] = String(v).slice(0, 500);
                    keyCount++;
                }
            }
            leadData.customData = cleaned;
        }

        const lead = new Lead(leadData);
        await lead.save();

        // Fire automations in background (non-blocking)
        evaluateLead(lead, 'lead_created').catch(e =>
            console.error('[WebLead] automation trigger error:', e.message)
        );

        // ✅ Don't expose MongoDB ObjectID to public callers
        res.status(201).json({ success: true });
    } catch (err) {
        console.error('[WebLead] captureLead error:', err);
        res.status(500).json({ success: false, message: 'Failed to save lead' });
    }
};
