// Client-side mirror of src/utils/customFieldValidation.js.
// The SERVER is the authority — this exists so the agent gets an instant,
// readable error instead of a round-trip 400.

// dropdown    → customData[key] is a String
// multiselect → customData[key] is an Array
export const OPTION_TYPES = ['dropdown', 'multiselect'];
export const isOptionType = (type) => OPTION_TYPES.includes(type);

/** A multiselect holds an array; everything else a string. */
export const emptyValueFor = (field) => (field.type === 'multiselect' ? [] : '');

/** Coerce whatever is stored on a lead into the shape its field type expects. */
export const normalizeStoredValue = (field, stored) => {
    if (field.type === 'multiselect') {
        if (Array.isArray(stored)) return stored;
        if (!stored) return [];
        return String(stored).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (stored === null || stored === undefined) return '';
    return Array.isArray(stored) ? stored.join(', ') : String(stored);
};

/** Seed the form state for a set of definitions from a lead's existing customData. */
export const initCustomData = (fields, existing = {}) => {
    const init = {};
    (fields || []).forEach(f => {
        init[f.key] = normalizeStoredValue(f, existing?.[f.key]);
    });
    return init;
};

/**
 * Options to show for a dropdown/multiselect, including any value the lead
 * ALREADY holds that an admin has since removed from the list. Without this the
 * old value would silently vanish from the form and be wiped on the next save.
 */
export const optionsForField = (field, currentValue) => {
    const defined = field.options || [];
    const held = field.type === 'multiselect'
        ? (Array.isArray(currentValue) ? currentValue : [])
        : (currentValue ? [currentValue] : []);
    const retired = held.filter(v => v && !defined.includes(v));
    return [
        ...defined.map(value => ({ value, retired: false })),
        ...retired.map(value => ({ value, retired: true }))
    ];
};

/** Returns the first validation error message, or null when everything passes. */
export const validateCustomFields = (fields, customData) => {
    for (const field of fields || []) {
        if (!field.required) continue;
        const value = customData?.[field.key];
        const empty = field.type === 'multiselect'
            ? !Array.isArray(value) || value.length === 0
            : !value || !String(value).trim();
        if (empty) {
            return field.type === 'multiselect'
                ? `${field.label} needs at least one selection`
                : `${field.label} is required`;
        }
    }
    return null;
};

/** Human-readable value for read-only views (lead details, tables, CSV). */
export const displayCustomValue = (value) =>
    Array.isArray(value) ? value.join(', ') : (value ?? '');
