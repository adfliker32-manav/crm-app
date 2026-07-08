const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');

// ─────────────────────────────────────────────────────────────────────────────
// WEAK #2 FIX: Field key allowlist
// Previously there was no restriction on which field keys could be written.
// A malicious workflow admin could set fieldKey to 'userId', 'createdAt',
// '__v', or other system fields to corrupt lead data.
//
// ALLOWED PREFIXES: Only these key prefixes are permitted.
//   - customData.* — user-defined custom fields
//   - notes         — lead notes text
//   - dealValue     — monetary deal value
//   - source        — lead source string
//   - name          — lead name
//   - phone / email — contact info (use with care)
//   - tags          — array of tags (use AddTagNode instead for atomic adds)
//
// BLOCKED: userId, tenantId, createdAt, updatedAt, __v, _id, history, score,
//          status (use UpdateStageNode), assignedTo (use AssignUserNode), etc.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_FIELD_PREFIXES = [
    'customData.',
    'notes',
    'dealValue',
    'source',
    'name',
    'phone',
    'email',
    'address',
    'company',
    'website',
    'leadValue',
    'budget',
    'closingDate',
    'referredBy',
    'industry',
    'jobTitle',
    'department',
    'timezone',
    'language',
    'priority'
];

// Fields that must NEVER be written via workflow (protect system integrity)
const BLOCKED_EXACT_FIELDS = new Set([
    '_id', 'id', 'userId', 'tenantId', '__v', 'createdAt', 'updatedAt',
    'status', 'assignedTo', 'tags', 'history', 'score', 'deletedAt',
    'isDeleted', 'lastActivityAt'
]);

/**
 * Validate a field key before writing it.
 * @param {string} fieldKey
 * @returns {{ valid: boolean, reason?: string }}
 */
const isFieldKeyAllowed = (fieldKey) => {
    const key = fieldKey.trim();
    if (BLOCKED_EXACT_FIELDS.has(key)) {
        return { valid: false, reason: `Field "${key}" is a protected system field and cannot be modified by a workflow.` };
    }
    const isAllowed = ALLOWED_FIELD_PREFIXES.some(prefix =>
        key === prefix || key.startsWith(prefix + '.')
    );
    if (!isAllowed) {
        return { valid: false, reason: `Field key "${key}" is not in the allowed field list. Use "customData.*" for custom fields.` };
    }
    return { valid: true };
};

const UpdateCustomFieldNode = {
    type: 'update_custom_field',
    meta: () => ({
        type: 'update_custom_field', name: 'Update Field', icon: 'fa-solid fa-pen-to-square',
        category: 'crm', color: '#06B6D4',
        description: 'Update a custom field or lead property'
    }),
    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [{ id: 'output', label: 'Done' }, { id: 'error', label: 'Blocked' }]
    }),
    schema: () => ({
        fields: [
            {
                key: 'fieldKey', label: 'Field Key', type: 'text', required: true,
                placeholder: 'e.g. customData.Product or dealValue',
                description: `Allowed: customData.*, name, phone, email, dealValue, source, address, company, etc. System fields (userId, status, assignedTo) are blocked.`
            },
            {
                key: 'value', label: 'Value', type: 'text', required: true,
                placeholder: 'e.g. Premium Plan or {{lead.name}}'
            }
        ]
    }),
    validate: (data) => {
        const errors = [];
        if (!data.fieldKey?.trim()) {
            errors.push('Field key is required');
        } else {
            const check = isFieldKeyAllowed(data.fieldKey.trim());
            if (!check.valid) errors.push(check.reason);
        }
        return { valid: errors.length === 0, errors };
    },
    execute: async (context, data) => {
        const lead = context.getLead();
        if (!lead) return { nextPort: 'output', output: {} };

        const updateKey = data.fieldKey?.trim();

        // WEAK #2 FIX: Runtime field key check (defense in depth — validation
        // also runs at publish time, but runtime check protects against
        // dynamically-resolved keys from variable interpolation)
        const check = isFieldKeyAllowed(updateKey);
        if (!check.valid) {
            console.warn(`[UpdateCustomFieldNode] Blocked field write: ${check.reason}`);
            return {
                nextPort: 'error',
                output: { 'field.blocked': true, 'field.reason': check.reason }
            };
        }

        // Resolve value from variables if it contains {{...}}
        let value = data.value || '';
        const vars = context.getAll();
        value = value.replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');

        await Lead.findByIdAndUpdate(lead._id, { $set: { [updateKey]: value } });
        return { nextPort: 'output', output: { [`field.${updateKey}`]: value } };
    }
};

NodeRegistry.register(UpdateCustomFieldNode);
module.exports = UpdateCustomFieldNode;
