// ─────────────────────────────────────────────────────────────────────────────
// operators.js  — SHARED LOGIC FOR ConditionNode & SwitchNode
// ─────────────────────────────────────────────────────────────────────────────
// FIX: Previously this logic was copy-pasted in both ConditionNode.js and
// SwitchNode.js (WEAK #6). Now it lives here — one source of truth.
// Adding a new operator or fixing a bug only requires a change in this file.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper to safely convert values to string, mapping null/undefined to empty string
 * instead of returning "null" or "undefined".
 */
const safeString = (val) => {
    if (val === null || val === undefined) return '';
    return String(val);
};

/**
 * Safely parse a value for numeric/date comparison.
 * Returns Number if the value looks numeric, Date if it looks like a date,
 * otherwise lowercased string.
 */
// M-C1 FIX: `!isNaN(val)` was far too permissive as a "looks numeric" test — it is
// true for '0x1A' (→26), '1e5' (→100000), 'Infinity', '.5' and, most damagingly,
// for phone numbers like '+919876543210', so a greater_than on a phone field
// compared numerically. Require a plain decimal number instead.
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;

const parseValue = (val) => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean') return val ? 1 : 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
        const trimmed = val.trim();
        if (NUMERIC_RE.test(trimmed)) return Number(trimmed);
        // ISO-ish dates compare as timestamps. Anything else falls through to a
        // lower-cased string compare (see M-C2 in the audit: other date formats
        // silently compare lexicographically — use explicit date operators instead).
        if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
            const d = new Date(trimmed);
            if (!isNaN(d.getTime())) return d.getTime();
        }
    }
    return String(val).toLowerCase();
};

/**
 * All supported comparison operators.
 * Key: operator string used in the workflow config.
 * Value: evaluation function (a, b) => boolean
 */
/**
 * Compare two values for the ordering operators, returning -1 / 0 / 1.
 *
 * M-C1 FIX (second half): parseValue alone was not enough. It correctly refuses to
 * treat '+919876543210' as numeric and returns a STRING — but parseValue('5')
 * returns a NUMBER, and JavaScript's relational operators coerce the string operand
 * back to a number, so `'+919876543210' > 5` was still true. A mixed-type comparison
 * silently undid the fix. Ordering is therefore numeric only when BOTH sides parse
 * numerically; otherwise both are compared as strings.
 */
const compareValues = (a, b) => {
    const pa = parseValue(a);
    const pb = parseValue(b);
    if (typeof pa === 'number' && typeof pb === 'number') {
        return pa === pb ? 0 : (pa < pb ? -1 : 1);
    }
    const sa = safeString(pa).toLowerCase();
    const sb = safeString(pb).toLowerCase();
    return sa === sb ? 0 : (sa < sb ? -1 : 1);
};

/**
 * M-C2 FIX: explicit date parsing for the date operators.
 * `parseValue` only treats ISO-prefixed strings as dates, so '30/07/2026',
 * 'Jul 30 2026' and similar fell through to a LOWER-CASED STRING compare — which
 * looks like a working date comparison until the year rolls over and lexicographic
 * order stops matching chronological order. These operators are unambiguous.
 */
const parseDate = (val) => {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val.getTime();
    if (typeof val === 'number') return val;
    const s = String(val).trim();
    // dd/mm/yyyy and dd-mm-yyyy are ambiguous to Date(); parse them explicitly as
    // day-first, which is the convention in this product's locale (₹/IST).
    const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
        const d = new Date(Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])));
        return isNaN(d.getTime()) ? null : d.getTime();
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.getTime();
};

const OPERATORS = {
    equals:         (a, b) => safeString(a).toLowerCase() === safeString(b).toLowerCase(),
    not_equals:     (a, b) => safeString(a).toLowerCase() !== safeString(b).toLowerCase(),
    // M-C3 FIX: `equals` is deliberately case-insensitive (stage/tag names are
    // user-entered and inconsistently cased). These give authors the exact,
    // type-preserving comparison when that is what they actually mean.
    equals_exact:     (a, b) => safeString(a) === safeString(b),
    not_equals_exact: (a, b) => safeString(a) !== safeString(b),
    // M-C2 FIX: unambiguous chronological comparison. Returns false when either side
    // is not a parseable date, rather than silently comparing strings.
    date_before:    (a, b) => { const x = parseDate(a), y = parseDate(b); return x !== null && y !== null && x < y; },
    date_after:     (a, b) => { const x = parseDate(a), y = parseDate(b); return x !== null && y !== null && x > y; },
    date_on:        (a, b) => {
        const x = parseDate(a), y = parseDate(b);
        if (x === null || y === null) return false;
        const dayOf = (t) => Math.floor(t / 86400000);
        return dayOf(x) === dayOf(y);
    },
    contains:       (a, b) => safeString(a).toLowerCase().includes(safeString(b).toLowerCase()),
    not_contains:   (a, b) => !safeString(a).toLowerCase().includes(safeString(b).toLowerCase()),
    starts_with:    (a, b) => safeString(a).toLowerCase().startsWith(safeString(b).toLowerCase()),
    ends_with:      (a, b) => safeString(a).toLowerCase().endsWith(safeString(b).toLowerCase()),
    greater_than:   (a, b) => compareValues(a, b) > 0,
    less_than:      (a, b) => compareValues(a, b) < 0,
    greater_equal:  (a, b) => compareValues(a, b) >= 0,
    less_equal:     (a, b) => compareValues(a, b) <= 0,
    is_empty:       (a)    => a === null || a === undefined || safeString(a).trim() === '',
    is_not_empty:   (a)    => a !== null && a !== undefined && safeString(a).trim() !== ''
};

/**
 * Resolve a condition value — supports variable references like {{lead.name}}
 * or direct context variable keys (e.g. "lead.email", "webhook.status").
 */
// M-C6 FIX: the bare-prefix list omitted http., ai., whatsapp., email., voice.,
// switch., condition., field., tenant. and payload. — so comparing against
// `http.status` WITHOUT braces compared the literal string 'http.status' while the
// {{http.status}} form worked. One canonical list, derived from the namespaces the
// engine and nodes actually write.
const VARIABLE_NAMESPACES = [
    'lead.', 'tenant.', 'webhook.', 'signal.', 'payload.',
    // WF-H1: the trigger's own payload — the inbound WhatsApp message, the booked
    // appointment, the voice call log, the changed stage, the tags that were added.
    // Without this namespace publish-time validation rejected every reference to it.
    'trigger.',
    'http.', 'ai.', 'whatsapp.', 'email.', 'voice.', 'wait.',
    'switch.', 'condition.', 'field.', 'notification.', 'assign.', 'test.',
    // Row 27: iteration-local values, readable via context.get()/{{loop.item}}.
    'loop.', 'merge.'
];

const resolveCompareValue = (compareValue, context) => {
    if (typeof compareValue !== 'string') return compareValue;
    // Direct variable key reference (no braces)
    if (VARIABLE_NAMESPACES.some(p => compareValue.startsWith(p))) {
        return context.get(compareValue) ?? compareValue;
    }
    // Inline variable template {{variable}}
    return compareValue.replace(/\{\{([^}]+)\}\}/g, (_, key) => context.get(key.trim()) ?? '');
};

/**
 * Evaluate a single condition object against the execution context.
 * @param {{ variable: string, operator: string, value: string }} cond
 * @param {ExecutionContext} context
 * @returns {boolean}
 */
const evaluateCondition = (cond, context) => {
    const variableValue = context.get(cond.variable) ?? '';
    const compareValue  = resolveCompareValue(cond.value ?? '', context);
    const evalFn        = OPERATORS[cond.operator];
    if (!evalFn) {
        console.warn(`[operators] Unknown operator: "${cond.operator}"`);
        return false;
    }
    return evalFn(variableValue, compareValue);
};

// M-C5 FIX: an unknown operator makes evaluateCondition return false, which in a
// matchType:'ALL' condition sends every lead down the 'false' branch — a workflow
// that looks like it works but always takes one path. Exported so publish-time
// validation can reject the operator instead of discovering it at runtime.
const isKnownOperator = (op) => Object.prototype.hasOwnProperty.call(OPERATORS, op);

module.exports = {
    parseValue, parseDate, compareValues, OPERATORS,
    resolveCompareValue, evaluateCondition, isKnownOperator,
    VARIABLE_NAMESPACES
};
