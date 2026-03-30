const SystemSetting = require('../models/SystemSetting');

// Simple in-memory cache to prevent database hammering on every API/System call
let configCache = {};
let lastFetchTime = 0;
const CACHE_TTL = 30000; // 30 seconds

/**
 * Checks if a global feature switch is enabled.
 * Fetches from cache if within TTL, otherwise queries the database.
 * @param {string} key - e.g., 'DISABLE_WHATSAPP'
 * @returns {Promise<boolean>}
 */
const isFeatureDisabled = async (key) => {
    try {
        const now = Date.now();
        
        // Return cache hit
        if (now - lastFetchTime < CACHE_TTL && configCache[key] !== undefined) {
            return configCache[key] === true;
        }

        // Cache miss/expired: Refresh all system settings safely
        const settings = await SystemSetting.find().lean();
        configCache = {}; // Reset
        
        settings.forEach(setting => {
            configCache[setting.key] = setting.value;
        });
        
        lastFetchTime = now;
        
        // If not found in DB, default to false (enabled)
        return configCache[key] === true;
        
    } catch (error) {
        console.error(`🚨 System Config Error (Key: ${key}):`, error);
        // Fail open: don't accidentally block production features if DB flickers
        return false; 
    }
};

/**
 * Force clear the memory cache, useful right after the Super Admin updates settings.
 */
const invalidateConfigCache = () => {
    configCache = {};
    lastFetchTime = 0;
    console.log("🧹 System config cache visually invalidated.");
};

module.exports = {
    isFeatureDisabled,
    invalidateConfigCache
};
