const Lead = require('../models/Lead');
const WorkspaceSettings = require('../models/WorkspaceSettings');
const {
    isOptionType,
    validateFieldDefinition
} = require('../utils/customFieldValidation');

// Generate slug from label
const generateKey = (label) => {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
};

// A field's KEY is permanent — it is the property name under Lead.customData, so
// changing it would orphan every lead already carrying data. When a new label
// slugs down to a key that is taken, suffix it instead of colliding.
const generateUniqueKey = (label, takenKeys) => {
    const base = generateKey(label) || 'field';
    if (!takenKeys.has(base)) return base;
    let n = 2;
    while (takenKeys.has(`${base}_${n}`)) n += 1;
    return `${base}_${n}`;
};

const canEditFields = (user) =>
    ['superadmin', 'manager'].includes(user.role) || user.permissions?.accessSettings === true;

const FORBIDDEN = { message: 'Agents without settings permission cannot modify custom field settings' };

/**
 * Count leads whose stored value for `key` is no longer in `options`.
 * Used to warn an admin BEFORE they drop an option that live data depends on.
 * Those leads are never rewritten — the value stays and still round-trips on
 * edit; this is purely so the admin knows what they are about to orphan.
 *
 * Advisory only, and deliberately cheap. For a multiselect the value is an
 * ARRAY, and Mongo's $nin on an array field excludes a document if ANY element
 * matches — so a lead holding ['SEO', 'Retired'] is not counted. The number can
 * therefore under-report for multiselect fields; it never blocks the save.
 */
const countLeadsWithRetiredValues = async (ownerId, key, options) => {
    try {
        return await Lead.countDocuments({
            userId: ownerId,
            [`customData.${key}`]: { $exists: true, $nin: ['', null, ...options] }
        });
    } catch (err) {
        console.error('Custom field impact count failed:', err.message);
        return 0;
    }
};

// Get custom field definitions for current user
exports.getCustomFields = async (req, res) => {
    try {
        const ownerId = req.tenantId; // req.tenantId handles parentId for agents already in authMiddleware

        const settings = await WorkspaceSettings.findOne({ userId: ownerId }).select('customFieldDefinitions').lean();

        if (!settings) {
            // Provision empty settings if not found (fallback)
            return res.json([]);
        }

        const fields = (settings.customFieldDefinitions || [])
            .slice()
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

        res.json(fields);
    } catch (error) {
        console.error('Error fetching custom fields:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Save custom field definitions (full replace)
exports.saveCustomFields = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        // Agent cannot modify fields
        if (!canEditFields(req.user)) return res.status(403).json(FORBIDDEN);

        const { fields } = req.body;

        if (!Array.isArray(fields)) {
            return res.status(400).json({ message: 'Fields must be an array' });
        }

        // Validate and process fields. Existing keys are preserved verbatim so a
        // full-replace save never re-slugs a key out from under stored lead data.
        const takenKeys = new Set();
        const processedFields = [];
        for (let index = 0; index < fields.length; index += 1) {
            const field = fields[index];
            const label = String(field?.label ?? '').trim();
            if (!label) {
                return res.status(400).json({ message: 'All custom fields must have a valid label' });
            }
            const key = field.key || generateUniqueKey(label, takenKeys);
            if (takenKeys.has(key)) {
                return res.status(400).json({ message: 'Duplicate field keys detected' });
            }
            takenKeys.add(key);

            const result = validateFieldDefinition(field, {
                key,
                order: field.order !== undefined ? field.order : index
            });
            if (!result.valid) return res.status(400).json({ message: result.error });
            processedFields.push(result.field);
        }

        const settings = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { customFieldDefinitions: processedFields },
            { returnDocument: 'after', upsert: true }
        ).select('customFieldDefinitions');

        res.json({
            success: true,
            message: 'Custom fields saved successfully',
            fields: settings.customFieldDefinitions
        });
    } catch (error) {
        console.error('Error saving custom fields:', error);
        res.status(500).json({ message: 'Error saving custom fields', error: 'Server error' });
    }
};

// Add single custom field
exports.addCustomField = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        if (!canEditFields(req.user)) return res.status(403).json(FORBIDDEN);

        const { label } = req.body;

        if (!label || !String(label).trim()) {
            return res.status(400).json({ message: 'Field label is required' });
        }

        // Upsert so a workspace that was never provisioned can still add its first
        // field (the old code 404'd here while saveCustomFields upserted — the two
        // write paths disagreed about whether settings had to pre-exist).
        const settings = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { $setOnInsert: { customFieldDefinitions: [] } },
            { returnDocument: 'after', upsert: true }
        ).select('customFieldDefinitions');

        const existing = settings.customFieldDefinitions || [];
        const takenKeys = new Set(existing.map(f => f.key));

        const trimmedLabel = String(label).trim();
        if (existing.some(f => f.label.toLowerCase() === trimmedLabel.toLowerCase())) {
            return res.status(400).json({ message: 'A field with this name already exists' });
        }

        const result = validateFieldDefinition(req.body, {
            key: generateUniqueKey(trimmedLabel, takenKeys),
            order: existing.length
        });
        if (!result.valid) return res.status(400).json({ message: result.error });

        const updated = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { $push: { customFieldDefinitions: result.field } },
            { returnDocument: 'after' }
        ).select('customFieldDefinitions');

        res.json({
            success: true,
            message: 'Custom field added',
            field: result.field,
            fields: updated.customFieldDefinitions
        });
    } catch (error) {
        console.error('Error adding custom field:', error);
        res.status(500).json({ message: 'Error adding custom field', error: 'Server error' });
    }
};

// Update a single custom field in place.
// The KEY is immutable — label, type, options, and required are all editable.
exports.updateCustomField = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        if (!canEditFields(req.user)) return res.status(403).json(FORBIDDEN);

        const { key } = req.params;

        const settings = await WorkspaceSettings.findOne({ userId: ownerId }).select('customFieldDefinitions');
        if (!settings) return res.status(404).json({ message: 'Workspace settings not found' });

        const existing = settings.customFieldDefinitions || [];
        const index = existing.findIndex(f => f.key === key);
        if (index === -1) return res.status(404).json({ message: 'Custom field not found' });

        const current = existing[index];
        const trimmedLabel = String(req.body?.label ?? current.label).trim();

        // Renaming onto another field's label would make the two indistinguishable
        // in every picker (Meta mapping, CSV auto-map, filters all match on label).
        const clash = existing.some((f, i) => i !== index && f.label.toLowerCase() === trimmedLabel.toLowerCase());
        if (clash) return res.status(400).json({ message: 'Another field already uses this name' });

        const result = validateFieldDefinition(
            {
                label: trimmedLabel,
                type: req.body?.type ?? current.type,
                options: req.body?.options ?? current.options,
                required: req.body?.required ?? current.required,
                metaKey: req.body?.metaKey !== undefined ? req.body.metaKey : current.metaKey
            },
            { key: current.key, order: current.order ?? index } // key + order preserved
        );
        if (!result.valid) return res.status(400).json({ message: result.error });

        // Tell the admin how many leads hold a value they just retired.
        let orphanedLeads = 0;
        if (isOptionType(result.field.type)) {
            orphanedLeads = await countLeadsWithRetiredValues(ownerId, current.key, result.field.options);
        }

        // Positional write scoped by key so a concurrent add/delete cannot shift
        // the index out from under us and overwrite a different field.
        const updated = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId, 'customFieldDefinitions.key': current.key },
            { $set: { 'customFieldDefinitions.$': result.field } },
            { returnDocument: 'after' }
        ).select('customFieldDefinitions');

        if (!updated) return res.status(404).json({ message: 'Custom field not found' });

        res.json({
            success: true,
            message: 'Custom field updated',
            field: result.field,
            fields: updated.customFieldDefinitions,
            // Non-blocking: those leads keep their old value and still save fine.
            ...(orphanedLeads > 0 ? {
                warning: `${orphanedLeads} lead${orphanedLeads === 1 ? '' : 's'} still hold a value that is no longer in the option list. Their data is unchanged and can still be saved.`,
                orphanedLeads
            } : {})
        });
    } catch (error) {
        console.error('Error updating custom field:', error);
        res.status(500).json({ message: 'Error updating custom field', error: 'Server error' });
    }
};

// Reorder fields — controls the order they render in the Add/Edit Lead form.
exports.reorderCustomFields = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        if (!canEditFields(req.user)) return res.status(403).json(FORBIDDEN);

        const { keys } = req.body;
        if (!Array.isArray(keys)) {
            return res.status(400).json({ message: 'keys must be an array of field keys' });
        }

        const settings = await WorkspaceSettings.findOne({ userId: ownerId }).select('customFieldDefinitions');
        if (!settings) return res.status(404).json({ message: 'Workspace settings not found' });

        const existing = settings.customFieldDefinitions || [];
        const position = new Map(keys.map((k, i) => [k, i]));

        // Any field missing from `keys` (added by a concurrent request) sorts to the
        // end rather than being dropped — reorder must never delete a definition.
        const reordered = existing
            .map(f => (f.toObject ? f.toObject() : { ...f }))
            .sort((a, b) => (position.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (position.get(b.key) ?? Number.MAX_SAFE_INTEGER))
            .map((f, i) => ({ ...f, order: i }));

        const updated = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { customFieldDefinitions: reordered },
            { returnDocument: 'after' }
        ).select('customFieldDefinitions');

        res.json({ success: true, message: 'Field order saved', fields: updated.customFieldDefinitions });
    } catch (error) {
        console.error('Error reordering custom fields:', error);
        res.status(500).json({ message: 'Error reordering custom fields', error: 'Server error' });
    }
};

// Delete custom field
exports.deleteCustomField = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        if (!canEditFields(req.user)) return res.status(403).json(FORBIDDEN);

        const { key } = req.params;

        const updated = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { $pull: { customFieldDefinitions: { key: key } } },
            { returnDocument: 'after' }
        ).select('customFieldDefinitions');

        res.json({
            success: true,
            message: 'Custom field deleted',
            fields: updated?.customFieldDefinitions || []
        });
    } catch (error) {
        console.error('Error deleting custom field:', error);
        res.status(500).json({ message: 'Error deleting custom field', error: 'Server error' });
    }
};

