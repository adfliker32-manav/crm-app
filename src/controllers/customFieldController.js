const User = require('../models/User');
const WorkspaceSettings = require('../models/WorkspaceSettings');

// Generate slug from label
const generateKey = (label) => {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
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

        res.json(settings.customFieldDefinitions || []);
    } catch (error) {
        console.error('Error fetching custom fields:', error);
        res.status(500).json({ message: 'Error fetching custom fields', error: error.message });
    }
};

// Save custom field definitions
exports.saveCustomFields = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        // Agent cannot modify fields
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) {
            return res.status(403).json({ message: 'Agents without settings permission cannot modify custom field settings' });
        }

        const { fields } = req.body;

        if (!Array.isArray(fields)) {
            return res.status(400).json({ message: 'Fields must be an array' });
        }

        // Validate and process fields
        const processedFields = fields.map((field, index) => ({
            key: field.key || generateKey(field.label),
            label: field.label,
            type: field.type || 'text',
            options: field.type === 'dropdown' ? (field.options || []) : [],
            required: field.required || false,
            order: field.order !== undefined ? field.order : index
        }));

        // Check for duplicate keys
        const keys = processedFields.map(f => f.key);
        const uniqueKeys = new Set(keys);
        if (keys.length !== uniqueKeys.size) {
            return res.status(400).json({ message: 'Duplicate field keys detected' });
        }

        const settings = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { customFieldDefinitions: processedFields },
            { new: true, upsert: true }
        ).select('customFieldDefinitions');

        res.json({
            success: true,
            message: 'Custom fields saved successfully',
            fields: settings.customFieldDefinitions
        });
    } catch (error) {
        console.error('Error saving custom fields:', error);
        res.status(500).json({ message: 'Error saving custom fields', error: error.message });
    }
};

// Add single custom field
exports.addCustomField = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) {
            return res.status(403).json({ message: 'Agents without settings permission cannot modify custom field settings' });
        }

        const { label, type, options, required } = req.body;

        if (!label || !label.trim()) {
            return res.status(400).json({ message: 'Field label is required' });
        }

        const key = generateKey(label);

        // Check if key already exists
        const settings = await WorkspaceSettings.findOne({ userId: ownerId }).select('customFieldDefinitions');
        if (!settings) return res.status(404).json({ message: 'Workspace settings not found' });

        const existingField = settings.customFieldDefinitions?.find(f => f.key === key);
        if (existingField) {
            return res.status(400).json({ message: 'A field with this name already exists' });
        }

        const newField = {
            key,
            label: label.trim(),
            type: type || 'text',
            options: type === 'dropdown' ? (options || []) : [],
            required: required || false,
            order: (settings.customFieldDefinitions?.length || 0)
        };

        const updated = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { $push: { customFieldDefinitions: newField } },
            { new: true }
        ).select('customFieldDefinitions');

        res.json({
            success: true,
            message: 'Custom field added',
            field: newField,
            fields: updated.customFieldDefinitions
        });
    } catch (error) {
        console.error('Error adding custom field:', error);
        res.status(500).json({ message: 'Error adding custom field', error: error.message });
    }
};

// Delete custom field
exports.deleteCustomField = async (req, res) => {
    try {
        const ownerId = req.tenantId;

        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) {
            return res.status(403).json({ message: 'Agents without settings permission cannot modify custom field settings' });
        }

        const { key } = req.params;

        const updated = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { $pull: { customFieldDefinitions: { key: key } } },
            { new: true }
        ).select('customFieldDefinitions');

        res.json({
            success: true,
            message: 'Custom field deleted',
            fields: updated.customFieldDefinitions
        });
    } catch (error) {
        console.error('Error deleting custom field:', error);
        res.status(500).json({ message: 'Error deleting custom field', error: error.message });
    }
};
