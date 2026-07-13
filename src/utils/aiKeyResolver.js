// ─────────────────────────────────────────────────────────────────────────────
// aiKeyResolver.js — Single source of truth for the platform-wide AI API key
// ─────────────────────────────────────────────────────────────────────────────
// FIX (split-brain keys): Previously some call sites read the key from the DB
// (GlobalSetting `global_openai_api_key` / `global_gemini_api_key`, set via the
// Super-Admin UI) while others read `process.env.OPENAI_API_KEY`. If an admin
// only configured the key in the UI, the AI Classifier node and Voice smart-prompt
// silently produced nothing.
//
// Resolution order (per provider):
//   1. DB GlobalSetting (decrypted) — the value the Super-Admin UI writes.
//   2. Environment variable fallback — OPENAI_API_KEY / GEMINI_API_KEY.
// ─────────────────────────────────────────────────────────────────────────────

const GlobalSetting = require('../models/GlobalSetting');
const { decryptToken } = require('./encryptionUtils');

/**
 * Resolve the platform AI API key for a provider.
 * @param {'openai'|'gemini'} provider
 * @returns {Promise<string|null>}
 */
const getGlobalAIKey = async (provider) => {
    const settingKey  = provider === 'openai' ? 'global_openai_api_key' : 'global_gemini_api_key';
    const envFallback = provider === 'openai' ? process.env.OPENAI_API_KEY : process.env.GEMINI_API_KEY;

    try {
        const setting = await GlobalSetting.findOne({ key: settingKey }).lean();
        const dbKey = setting?.value ? decryptToken(setting.value) : null;
        return dbKey || envFallback || null;
    } catch (err) {
        console.warn(`[aiKeyResolver] Failed to read ${settingKey} from DB, using env fallback: ${err.message}`);
        return envFallback || null;
    }
};

module.exports = { getGlobalAIKey };
