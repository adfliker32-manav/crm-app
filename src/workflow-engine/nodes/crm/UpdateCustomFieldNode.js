const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');

const UpdateCustomFieldNode = {
    type: 'update_custom_field',
    meta: () => ({
        type: 'update_custom_field', name: 'Update Field', icon: 'fa-solid fa-pen-to-square',
        category: 'crm', color: '#06B6D4',
        description: 'Update a custom field or lead property'
    }),
    ports: () => ({ inputs: [{ id: 'input', label: 'In' }], outputs: [{ id: 'output', label: 'Done' }] }),
    schema: () => ({
        fields: [
            { key: 'fieldKey', label: 'Field Key',  type: 'text', required: true, placeholder: 'e.g. customData.Product' },
            { key: 'value',    label: 'Value',       type: 'text', required: true, placeholder: 'e.g. Premium Plan or {{lead.name}}' }
        ]
    }),
    validate: (data) => {
        const errors = [];
        if (!data.fieldKey?.trim()) errors.push('Field key is required');
        return { valid: errors.length === 0, errors };
    },
    execute: async (context, data) => {
        const lead = context.getLead();
        if (!lead) return { nextPort: 'output', output: {} };
        // Resolve value from variables if it contains {{...}}
        let value = data.value || '';
        const vars = context.getAll();
        value = value.replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');
        const updateKey = data.fieldKey.trim();
        await Lead.findByIdAndUpdate(lead._id, { $set: { [updateKey]: value } });
        return { nextPort: 'output', output: { [`field.${updateKey}`]: value } };
    }
};

NodeRegistry.register(UpdateCustomFieldNode);
module.exports = UpdateCustomFieldNode;
