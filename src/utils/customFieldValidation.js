// ─────────────────────────────────────────────────────────────────────────────
// Custom field definition + value handling — the ONE place that knows what a
// custom field option list means.
//
// Two field types carry an option list:
//   dropdown    — agent picks exactly one option        → stored as a String
//   multiselect — agent picks zero or more options      → stored as an Array
//
// Everything that writes into Lead.customData funnels through here so a value
// can never diverge from the option list an admin defined in Settings.
//
// Two modes, deliberately different, because the cost of a bad value differs:
//
//   'strict' — a HUMAN is typing into a form we control (manual add/edit lead).
//              An out-of-list value is a bug or an API caller poking around, so
//              we reject with a 400 and a field-level message.
//
//   'coerce' — a MACHINE handed us text we do not control (Meta Lead Ads answer,
//              Google Sheet cell, CSV row). Rejecting here would DROP THE LEAD,
//              which is worse than an untidy value. So we snap the value onto a
//              matching option when we can and keep the raw text when we cannot,
//              reporting it in `unmapped` so the admin can see and fix it.
//              coerceCustomData() never throws and never omits a lead.
// ─────────────────────────────────────────────────────────────────────────────

const OPTION_TYPES = new Set(['dropdown', 'multiselect']);

const MAX_OPTIONS_PER_FIELD = 100;
const MAX_OPTION_LENGTH = 100;
const MAX_LABEL_LENGTH = 60;
const MAX_VALUE_LENGTH = 500;
const MAX_MULTISELECT_SELECTIONS = 50;

const FIELD_TYPES = ['text', 'number', 'date', 'dropdown', 'email', 'phone', 'multiselect'];

const isOptionType = (type) => OPTION_TYPES.has(type);

/**
 * Lead.customData is a Mongoose Map, so a hydrated document hands us a Map —
 * not a plain object — and `map[key]` is silently undefined. Every read of
 * stored custom data goes through here.
 */
const toPlainObject = (value) => {
    if (!value) return {};
    if (value instanceof Map) return Object.fromEntries(value);
    if (typeof value.toObject === 'function') return value.toObject();
    if (typeof value === 'object' && !Array.isArray(value)) return value;
    return {};
};

/**
 * Loose comparison key for matching a machine-supplied value to an option.
 * Ignores case, surrounding/duplicate whitespace and punctuation, so a Meta
 * answer of "50 000 - 1 lakh" still lands on the option "50,000-1 Lakh".
 */
const matchKey = (value) =>
    String(value ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();

/**
 * Clean an admin-supplied option list: trim, drop blanks, cap length, dedupe
 * case-insensitively (keeping the first spelling the admin typed), cap count.
 */
const normalizeOptions = (options) => {
    if (!Array.isArray(options)) return [];
    const seen = new Set();
    const cleaned = [];
    for (const raw of options) {
        if (raw === null || raw === undefined) continue;
        const value = String(raw).trim().slice(0, MAX_OPTION_LENGTH);
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        cleaned.push(value);
        if (cleaned.length >= MAX_OPTIONS_PER_FIELD) break;
    }
    return cleaned;
};

/**
 * Resolve one raw value against an option list.
 * @returns {{ matched: boolean, value: string }} `value` is the CANONICAL option
 *          spelling when matched, otherwise the trimmed raw input.
 */
const coerceOptionValue = (rawValue, options) => {
    const raw = String(rawValue ?? '').trim();
    if (!raw) return { matched: false, value: '' };
    if (!Array.isArray(options) || options.length === 0) return { matched: false, value: raw };

    // 1. Exact
    const exact = options.find(o => o === raw);
    if (exact !== undefined) return { matched: true, value: exact };

    // 2. Fuzzy (case / whitespace / punctuation insensitive)
    const key = matchKey(raw);
    if (key) {
        const fuzzy = options.find(o => matchKey(o) === key);
        if (fuzzy !== undefined) return { matched: true, value: fuzzy };
    }

    return { matched: false, value: raw };
};

/** Values a multiselect field may arrive as: array, JSON array string, or CSV string. */
const toSelectionArray = (rawValue) => {
    if (Array.isArray(rawValue)) return rawValue;
    if (rawValue === null || rawValue === undefined || rawValue === '') return [];
    const raw = String(rawValue).trim();
    if (raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch { /* fall through to CSV split */ }
    }
    return raw.split(',');
};

/**
 * STRICT validation — manual lead create/edit.
 *
 * @param {object} customData        incoming customData from the request
 * @param {Array}  definitions       WorkspaceSettings.customFieldDefinitions
 * @param {object} [opts]
 * @param {object} [opts.existingData] the lead's CURRENT customData. A value that
 *        is already stored but is no longer in the option list (because an admin
 *        removed that option later) is allowed through UNCHANGED, so editing an
 *        old lead never fails on a field the user did not touch.
 * @param {boolean} [opts.partial]  when true, a field absent from customData is
 *        left alone instead of being treated as an empty required field.
 * @returns {{ valid: boolean, errors: string[], cleaned: object }}
 */
const validateCustomData = (customData, definitions, opts = {}) => {
    const { partial = false } = opts;
    const existingData = toPlainObject(opts.existingData);
    const errors = [];

    // Callers replace Lead.customData wholesale with `cleaned`. In partial mode a
    // key the client did not send must therefore be CARRIED OVER, not dropped —
    // otherwise editing one field silently erases every other custom value.
    const cleaned = partial ? { ...existingData } : {};

    if (customData !== undefined && customData !== null && (typeof customData !== 'object' || Array.isArray(customData))) {
        return { valid: false, errors: ['customData must be an object'], cleaned: {} };
    }

    const incoming = customData || {};
    const defs = Array.isArray(definitions) ? definitions : [];
    const defByKey = new Map(defs.map(d => [d.key, d]));

    // Pass 1 — every DEFINED field.
    for (const def of defs) {
        const present = Object.prototype.hasOwnProperty.call(incoming, def.key);
        if (!present) {
            if (partial) continue;
            if (def.required) {
                const carriedOver = existingData?.[def.key];
                const hasCarried = Array.isArray(carriedOver) ? carriedOver.length > 0 : Boolean(carriedOver);
                if (!hasCarried) errors.push(`"${def.label}" is required`);
            }
            continue;
        }

        const raw = incoming[def.key];
        const previous = existingData?.[def.key];

        if (def.type === 'multiselect') {
            const selections = toSelectionArray(raw)
                .map(s => String(s ?? '').trim())
                .filter(Boolean)
                .slice(0, MAX_MULTISELECT_SELECTIONS);

            if (selections.length === 0) {
                if (def.required) errors.push(`"${def.label}" requires at least one selection`);
                cleaned[def.key] = [];
                continue;
            }

            const previousSet = new Set(Array.isArray(previous) ? previous : []);
            const accepted = [];
            for (const selection of selections) {
                const { matched, value } = coerceOptionValue(selection, def.options);
                if (matched) {
                    if (!accepted.includes(value)) accepted.push(value);
                } else if (previousSet.has(selection)) {
                    // Legacy value already on the lead — keep it rather than block the save.
                    if (!accepted.includes(selection)) accepted.push(selection);
                } else {
                    errors.push(`"${selection}" is not a valid option for "${def.label}"`);
                }
            }
            cleaned[def.key] = accepted;
            continue;
        }

        if (def.type === 'dropdown') {
            const value = String(raw ?? '').trim();
            if (!value) {
                if (def.required) errors.push(`"${def.label}" is required`);
                cleaned[def.key] = '';
                continue;
            }
            const { matched, value: resolved } = coerceOptionValue(value, def.options);
            if (matched) {
                cleaned[def.key] = resolved;
            } else if (previous !== undefined && String(previous) === value) {
                // Unchanged legacy value — an admin removed this option after the
                // lead was created. Blocking the save would strand the record.
                cleaned[def.key] = value;
            } else {
                errors.push(`"${value}" is not a valid option for "${def.label}"`);
            }
            continue;
        }

        // Non-option types: trim, length-cap, enforce required.
        const value = raw === null || raw === undefined ? '' : String(raw).trim().slice(0, MAX_VALUE_LENGTH);
        if (!value && def.required) errors.push(`"${def.label}" is required`);
        cleaned[def.key] = value;
    }

    // Pass 2 — keys with no definition (legacy data, Meta auto-captured answers).
    // Kept as-is so nothing silently disappears; only sanitised for size.
    for (const [key, raw] of Object.entries(incoming)) {
        if (defByKey.has(key)) continue;
        const safeKey = String(key).slice(0, 50);
        if (Array.isArray(raw)) {
            cleaned[safeKey] = raw.slice(0, MAX_MULTISELECT_SELECTIONS).map(v => String(v ?? '').slice(0, MAX_VALUE_LENGTH));
        } else if (raw === null || raw === undefined) {
            cleaned[safeKey] = '';
        } else if (typeof raw === 'object') {
            cleaned[safeKey] = JSON.stringify(raw).slice(0, MAX_VALUE_LENGTH);
        } else {
            cleaned[safeKey] = String(raw).slice(0, MAX_VALUE_LENGTH);
        }
    }

    return { valid: errors.length === 0, errors, cleaned };
};

/**
 * COERCE mode — Meta Lead Ads, Google Sheets, CSV import.
 *
 * Never throws, never drops a key, never drops a lead. Values that match an
 * option are rewritten to the canonical spelling so filters and reports group
 * correctly; values that do not match are kept verbatim and listed in `unmapped`
 * so the admin can add the missing option.
 *
 * @returns {{ cleaned: object, unmapped: Array<{key, label, value}> }}
 */
const coerceCustomData = (customData, definitions) => {
    const cleaned = {};
    const unmapped = [];

    if (!customData || typeof customData !== 'object' || Array.isArray(customData)) {
        return { cleaned, unmapped };
    }

    const defs = Array.isArray(definitions) ? definitions : [];
    const defByKey = new Map(defs.map(d => [d.key, d]));

    for (const [key, raw] of Object.entries(customData)) {
        const def = defByKey.get(key);

        if (!def || !isOptionType(def.type) || !Array.isArray(def.options) || def.options.length === 0) {
            if (Array.isArray(raw)) {
                cleaned[key] = raw.slice(0, MAX_MULTISELECT_SELECTIONS).map(v => String(v ?? '').slice(0, MAX_VALUE_LENGTH));
            } else {
                cleaned[key] = raw === null || raw === undefined ? '' : String(raw).slice(0, MAX_VALUE_LENGTH);
            }
            continue;
        }

        if (def.type === 'multiselect') {
            const selections = toSelectionArray(raw)
                .map(s => String(s ?? '').trim())
                .filter(Boolean)
                .slice(0, MAX_MULTISELECT_SELECTIONS);
            const accepted = [];
            for (const selection of selections) {
                const { matched, value } = coerceOptionValue(selection, def.options);
                if (!matched) unmapped.push({ key, label: def.label, value: selection });
                if (!accepted.includes(value)) accepted.push(value);
            }
            cleaned[key] = accepted;
            continue;
        }

        const { matched, value } = coerceOptionValue(raw, def.options);
        if (value && !matched) unmapped.push({ key, label: def.label, value });
        cleaned[key] = value;
    }

    return { cleaned, unmapped };
};

/**
 * Validate ONE admin-supplied field definition (Settings → Custom Fields).
 * @returns {{ valid: boolean, error?: string, field?: object }}
 */
const validateFieldDefinition = (field, { key, order }) => {
    const label = String(field?.label ?? '').trim();
    if (!label) return { valid: false, error: 'Field label is required' };
    if (label.length > MAX_LABEL_LENGTH) {
        return { valid: false, error: `Field label cannot exceed ${MAX_LABEL_LENGTH} characters` };
    }

    const type = FIELD_TYPES.includes(field?.type) ? field.type : 'text';
    const options = isOptionType(type) ? normalizeOptions(field?.options) : [];

    if (isOptionType(type) && options.length === 0) {
        const noun = type === 'multiselect' ? 'Multi-select' : 'Dropdown';
        return { valid: false, error: `${noun} field "${label}" needs at least one option` };
    }

    return {
        valid: true,
        field: {
            key,
            label: label.slice(0, MAX_LABEL_LENGTH),
            type,
            options,
            required: Boolean(field?.required),
            order,
            metaKey: field?.metaKey || null
        }
    };
};

module.exports = {
    FIELD_TYPES,
    OPTION_TYPES,
    toPlainObject,
    MAX_OPTIONS_PER_FIELD,
    MAX_OPTION_LENGTH,
    isOptionType,
    normalizeOptions,
    coerceOptionValue,
    toSelectionArray,
    validateCustomData,
    coerceCustomData,
    validateFieldDefinition
};
