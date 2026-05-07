const WorkspaceSettings = require('../models/WorkspaceSettings');

/**
 * Extract country code from Meta's display_phone_number.
 * Meta always returns numbers like "+971 50 123 4567" or "+1 212-555-1234".
 * The digits between + and the first space are the country code.
 *
 * @param {string} displayPhone - e.g. "+971 50 123 4567"
 * @returns {string|null} - e.g. "971", "1", "44", "91" — or null if cannot detect
 */
function extractCountryCodeFromDisplayPhone(displayPhone) {
    if (!displayPhone) return null;
    const trimmed = displayPhone.trim();
    if (!trimmed.startsWith('+')) return null;
    // Take everything after + up to the first space or end
    const withoutPlus = trimmed.slice(1);
    const firstSpace = withoutPlus.indexOf(' ');
    const code = firstSpace !== -1 ? withoutPlus.slice(0, firstSpace) : withoutPlus;
    // Must be 1–3 digits
    return /^\d{1,3}$/.test(code) ? code : null;
}

/**
 * Normalize a raw phone number to WhatsApp international format (digits only, with country code).
 *
 * Rules (applied in order):
 *  1. Strip all non-digit characters (+, -, spaces, brackets)
 *  2. 12+ digits → already international format, return as-is (971501234567, 12125551234)
 *  3. Starts with 0 — local format with STD 0 (UAE 0501234567 → 971501234567)
 *     Strip the leading 0, prepend countryCode
 *  4. Short number where length matches expected local length for this country code
 *     (e.g. 9 digits for UAE, 10 digits for India) → prepend countryCode
 *  5. Everything else → return as-is (can't safely guess the country)
 *     Meta Lead Ads always provides full international format for other countries.
 *
 * @param {string} rawPhone
 * @param {string|null} countryCode - workspace's detected country code (e.g. "971", "1", "91")
 * @returns {string|null}
 */
function normalizePhoneForWhatsApp(rawPhone, countryCode = null) {
    if (!rawPhone) return null;
    const digits = rawPhone.replace(/[^0-9]/g, '');
    if (!digits) return null;

    // Already international (12+ digits)
    if (digits.length >= 12) return digits;

    // If no country code is set, we can't safely normalize — return as-is
    if (!countryCode) return digits;

    const cc = countryCode.toString();

    // Local format with leading 0 (UAE 0501234567 → 971501234567, UK 07911123456 → 447911123456)
    if (digits.startsWith('0')) {
        return cc + digits.slice(1);
    }

    // Expected local number length = total digits − country code digits
    // e.g. UAE 971 (3 digits) → local = 9 digits → full = 12
    // e.g. India 91 (2 digits) → local = 10 digits → full = 12
    // e.g. US 1 (1 digit) → local = 10 digits → full = 11
    const expectedLocalLength = digits.length;
    const fullLength = cc.length + expectedLocalLength;

    // Sanity: only prepend if result looks like a valid international number (10–15 digits total)
    if (fullLength >= 10 && fullLength <= 15) {
        return cc + digits;
    }

    return digits;
}

/**
 * Fetch the workspace's defaultCountryCode from DB.
 * Returns null if not set (no assumption made).
 */
async function getWorkspaceCountryCode(userId) {
    try {
        const ws = await WorkspaceSettings.findOne({ userId }).select('defaultCountryCode').lean();
        return ws?.defaultCountryCode || null;
    } catch {
        return null;
    }
}

module.exports = { normalizePhoneForWhatsApp, getWorkspaceCountryCode, extractCountryCodeFromDisplayPhone };
