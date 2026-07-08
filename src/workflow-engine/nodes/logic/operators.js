// ─────────────────────────────────────────────────────────────────────────────
// operators.js  — SHARED LOGIC FOR ConditionNode & SwitchNode
// ─────────────────────────────────────────────────────────────────────────────
// FIX: Previously this logic was copy-pasted in both ConditionNode.js and
// SwitchNode.js (WEAK #6). Now it lives here — one source of truth.
// Adding a new operator or fixing a bug only requires a change in this file.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely parse a value for numeric/date comparison.
 * Returns Number if the value looks numeric, Date if it looks like a date,
 * otherwise lowercased string.
 */
const parseValue = (val) => {
    if (val === null || val === undefined) return '';
    if (!isNaN(val) && String(val).trim() !== '') return Number(val);
    const d = new Date(val);
    if (!isNaN(d.getTime()) && String(val).match(/^\d{4}-\d{2}-\d{2}/)) return d.getTime();
    return String(val).toLowerCase();
};

/**
 * All supported comparison operators.
 * Key: operator string used in the workflow config.
 * Value: evaluation function (a, b) => boolean
 */
const OPERATORS = {
    equals:         (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
    not_equals:     (a, b) => String(a).toLowerCase() !== String(b).toLowerCase(),
    contains:       (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
    not_contains:   (a, b) => !String(a).toLowerCase().includes(String(b).toLowerCase()),
    starts_with:    (a, b) => String(a).toLowerCase().startsWith(String(b).toLowerCase()),
    ends_with:      (a, b) => String(a).toLowerCase().endsWith(String(b).toLowerCase()),
    greater_than:   (a, b) => parseValue(a) > parseValue(b),
    less_than:      (a, b) => parseValue(a) < parseValue(b),
    greater_equal:  (a, b) => parseValue(a) >= parseValue(b),
    less_equal:     (a, b) => parseValue(a) <= parseValue(b),
    is_empty:       (a)    => !a || String(a).trim() === '',
    is_not_empty:   (a)    => !!a && String(a).trim() !== ''
};

/**
 * Resolve a condition value — supports variable references like {{lead.name}}
 * or direct context variable keys (e.g. "lead.email", "webhook.status").
 */
const resolveCompareValue = (compareValue, context) => {
    if (typeof compareValue !== 'string') return compareValue;
    // Direct variable key reference (no braces)
    if (compareValue.startsWith('lead.') || compareValue.startsWith('webhook.') || compareValue.startsWith('signal.')) {
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

module.exports = { parseValue, OPERATORS, resolveCompareValue, evaluateCondition };
