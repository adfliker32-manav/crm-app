/**
 * Currency formatting helpers.
 *
 * PartnerApp.currency stores an ISO CODE ('INR'), but the billing UI rendered
 * it as if it were a symbol — `{partner.currency || '₹'}{amount}` produced
 * "INR500" — while sibling totals on the same screen hardcoded '₹'. So the same
 * page showed two different currencies for one number (PA-M5).
 */

const SYMBOLS = {
    INR: '₹',
    USD: '$',
    EUR: '€',
    GBP: '£',
    AED: 'د.إ'
};

const LOCALES = {
    INR: 'en-IN',
    USD: 'en-US',
    EUR: 'de-DE',
    GBP: 'en-GB',
    AED: 'en-AE'
};

export const CURRENCY_CODES = Object.keys(SYMBOLS);

/** Symbol for a currency code. Unknown codes fall back to the code itself. */
export const currencySymbol = (code) => SYMBOLS[code] || code || '₹';

/**
 * Format an amount with its currency symbol and locale-appropriate grouping.
 * formatMoney(500, 'INR') → "₹500"   formatMoney(1234567, 'INR') → "₹12,34,567"
 */
export const formatMoney = (amount, code = 'INR') => {
    const n = Number(amount) || 0;
    return `${currencySymbol(code)}${n.toLocaleString(LOCALES[code] || 'en-IN')}`;
};
