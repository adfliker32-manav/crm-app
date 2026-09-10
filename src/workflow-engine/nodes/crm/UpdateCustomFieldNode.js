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
//
// M-S2 FIX: this list previously claimed `tags` was allowed. It is not — `tags` is
// in BLOCKED_EXACT_FIELDS below and is absent from ALLOWED_FIELD_PREFIXES. Use
// AddTagNode, which adds atomically via $addToSet and fires TAG_ADDED.
//
// BLOCKED: userId, tenantId, createdAt, updatedAt, __v, _id, history, score,
//          status (use UpdateStageNode), assignedTo (use AssignUserNode), etc.
// ─────────────────────────────────────────────────────────────────────────────

// M-S1 FIX: `email` and `phone` are the CONTACT channel, not ordinary data. Allowing
// a workflow to overwrite them from an interpolated value ({{webhook.*}}) creates an
// exfiltration chain: a public webhook sets the lead's email to an attacker address,
// and the next send_email node delivers tenant data there. They now require an
// explicit opt-in AND the written value must look like a real email/phone.
const CONTACT_FIELDS = new Set(['email', 'phone']);
const CONTACT_WRITES_ENABLED = process.env.WORKFLOW_ALLOW_CONTACT_FIELD_WRITES === 'true';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+?[0-9][0-9\s\-()]{6,19}$/;

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
    // M-S1 FIX: rewriting the contact channel is off unless deliberately enabled.
    if (CONTACT_FIELDS.has(key) && !CONTACT_WRITES_ENABLED) {
        return {
            valid: false,
            reason: `Field "${key}" changes where messages are delivered and cannot be set by a workflow. ` +
                    `Set WORKFLOW_ALLOW_CONTACT_FIELD_WRITES=true to permit it.`
        };
    }
    // BUGFIX (found while testing M-S1): entries in ALLOWED_FIELD_PREFIXES that
    // already END with a dot — i.e. 'customData.', the single most important one —
    // were tested as key.startsWith('customData' + '.' + '.') === 'customData..',
    // which never matches. So EVERY customData write was rejected as "not in the
    // allowed field list", and this node could never do the thing its own schema
    // description tells users to do. Handle both prefix forms explicitly.
    const isAllowed = ALLOWED_FIELD_PREFIXES.some(prefix =>
        prefix.endsWith('.')
            // Namespace prefix: require at least one character after the dot, so a
            // bare 'customData.' is still rejected.
            ? (key.startsWith(prefix) && key.length > prefix.length)
            // Exact field, optionally with a sub-path (e.g. 'notes', 'address.city').
            : (key === prefix || key.startsWith(prefix + '.'))
    );
    if (!isAllowed) {
        return { valid: false, reason: `Field key "${key}" is not in the allowed field list. Use "customData.*" for custom fields.` };
    }
    return { valid: true };
};

const UpdateCustomFieldNode = {
    type: 'update_custom_field',
    sideEffect: true, // L4/L5: mutates the lead — dry-run in Test Mode, idempotent on retry
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
                // custom_field_select renders a picker of the workspace's defined
                // custom fields (plus the built-in lead properties), with a
                // free-text escape hatch — the allowlist below is still the
                // authority, the picker just stops people guessing key names.
                key: 'fieldKey', label: 'Field', type: 'custom_field_select', required: true,
                placeholder: 'e.g. customData.product or dealValue',
                description: `Allowed: customData.*, name, phone, email, dealValue, source, address, company, etc. System fields (userId, status, assignedTo) are blocked.`
            },
            {
                // Renders as a dropdown of that field's options when the selected
                // field is a dropdown/multi-select, otherwise a plain text box.
                key: 'value', label: 'Value', type: 'custom_field_value', required: true,
                dependsOn: 'fieldKey',
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
        // AUDIT BUG-16 FIX: record the no-contact skip instead of reporting a silent
        // success. See the note in UpdateStageNode for why this stays on 'output'.
        if (!lead) {
            console.warn(`[UpdateCustomFieldNode] No contact on execution ${context.executionId} — field not written.`);
            return {
                nextPort: 'output',
                output: { 'field.skipped': true, 'field.skipReason': 'no_contact_in_execution' }
            };
        }

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

        // M-S1 FIX: if contact writes are enabled, the VALUE must still be well-formed.
        // The value is interpolated from execution variables, which on a webhook path
        // are attacker-controlled — an unvalidated write silently redirects delivery.
        if (CONTACT_FIELDS.has(updateKey)) {
            const re = updateKey === 'email' ? EMAIL_RE : PHONE_RE;
            if (!re.test(String(value).trim())) {
                console.warn(`[UpdateCustomFieldNode] Refusing to set ${updateKey} to a malformed value.`);
                return {
                    nextPort: 'error',
                    output: { 'field.blocked': true, 'field.reason': `Malformed ${updateKey} value` }
                };
            }
        }

        await Lead.findByIdAndUpdate(lead._id, { $set: { [updateKey]: value } });

        // ── AUDIT BUG-17 FIX: a workflow-driven field write is a lead update ──────
        // See AssignUserNode for the reasoning. `changedFields` carries the key the
        // author actually configured, so a LEAD_UPDATED filter on that field matches.
        const { runInBackground } = require('../../../utils/controllerHelpers');
        runInBackground('Workflow Engine Error (LEAD_UPDATED):', async () => {
            const WorkflowEngine = require('../../WorkflowEngine');
            const updated = await Lead.findById(lead._id).lean();
            if (!updated) return;
            return WorkflowEngine.fireTrigger('LEAD_UPDATED', {
                lead: updated,
                changedFields: [updateKey],
                _depth: context.getTriggerDepth() + 1,
                _chain: [...context.getTriggerChain(), `${context.workflowId}:field=${updateKey}`]
            });
        });

        return { nextPort: 'output', output: { [`field.${updateKey}`]: value } };
    }
};

NodeRegistry.register(UpdateCustomFieldNode);
module.exports = UpdateCustomFieldNode;
