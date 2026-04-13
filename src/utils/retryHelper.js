// src/utils/retryHelper.js
// Exponential backoff retry utility for external API calls (WhatsApp, Meta, Email, etc.)
// Prevents silent failures on transient network errors.

/**
 * Retries an async function with exponential backoff.
 * 
 * @param {Function} fn - The async function to execute
 * @param {Object} options - Retry configuration
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelayMs - Base delay in milliseconds (default: 1000)
 * @param {number} options.maxDelayMs - Maximum delay cap (default: 10000)
 * @param {string} options.label - Label for logging (default: 'retry')
 * @param {Function} options.shouldRetry - Custom function to decide if error is retryable (default: retries on network/5xx errors)
 * @returns {Promise<*>} - The result of the function call
 */
const retryWithBackoff = async (fn, options = {}) => {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        maxDelayMs = 10000,
        label = 'retry',
        shouldRetry = defaultShouldRetry
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            if (attempt >= maxRetries || !shouldRetry(error)) {
                throw error;
            }

            // Exponential backoff with jitter: delay = baseDelay * 2^attempt + random(0, baseDelay/2)
            const delay = Math.min(
                (baseDelayMs * Math.pow(2, attempt)) + Math.floor(Math.random() * baseDelayMs / 2),
                maxDelayMs
            );

            console.warn(`⚠️ [${label}] Attempt ${attempt + 1}/${maxRetries} failed: ${error.message}. Retrying in ${delay}ms...`);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
};

/**
 * Default retry decision function.
 * Retries on:
 * - Network errors (no response received — timeout, DNS, connection refused)
 * - 5xx server errors (Meta/WhatsApp infra issues)
 * - 429 Rate Limit errors (with backoff)
 * 
 * Does NOT retry on:
 * - 4xx client errors (invalid request, bad auth — retrying won't help)
 */
const defaultShouldRetry = (error) => {
    // Network-level errors (ECONNREFUSED, ECONNRESET, ETIMEDOUT, etc.)
    if (!error.response) {
        return true;
    }

    const status = error.response?.status;

    // 5xx = server-side issue, safe to retry
    if (status >= 500) {
        return true;
    }

    // 429 = rate limited, retry with backoff
    if (status === 429) {
        return true;
    }

    // 4xx = client error, retrying won't help
    return false;
};

module.exports = {
    retryWithBackoff,
    defaultShouldRetry
};
