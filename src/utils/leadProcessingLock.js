const LeadProcessingLock = require('../models/LeadProcessingLock');

/**
 * Attempts to acquire a processing lock for a specific Meta leadgen_id.
 * Uses a unique database index to guarantee process/thread safety.
 *
 * @param {string} leadgenId - The unique ID of the Meta lead.
 * @returns {Promise<boolean>} - True if lock was acquired, false if it's already locked.
 */
async function acquire(leadgenId) {
    if (!leadgenId) return false;
    try {
        await LeadProcessingLock.create({ leadgenId });
        return true;
    } catch (err) {
        // Code 11000 is Mongo's duplicate key error
        if (err.code === 11000) {
            console.log(`🔒 [LeadProcessingLock] Lock already held for leadgenId: ${leadgenId}`);
            return false;
        }
        console.error(`❌ [LeadProcessingLock] Error acquiring lock for ${leadgenId}:`, err.message);
        throw err;
    }
}

/**
 * Releases the processing lock for a specific Meta leadgen_id.
 *
 * @param {string} leadgenId - The unique ID of the Meta lead.
 * @returns {Promise<void>}
 */
async function release(leadgenId) {
    if (!leadgenId) return;
    try {
        await LeadProcessingLock.deleteOne({ leadgenId });
        console.log(`🔓 [LeadProcessingLock] Released lock for leadgenId: ${leadgenId}`);
    } catch (err) {
        console.error(`❌ [LeadProcessingLock] Error releasing lock for ${leadgenId}:`, err.message);
    }
}

module.exports = {
    acquire,
    release
};
