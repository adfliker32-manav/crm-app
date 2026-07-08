const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');

const AddTagNode = {
    type: 'add_tag',
    meta: () => ({
        type: 'add_tag', name: 'Add Tag', icon: 'fa-solid fa-tag',
        category: 'crm', color: '#10B981',
        description: 'Add a tag to the lead'
    }),
    ports: () => ({ inputs: [{ id: 'input', label: 'In' }], outputs: [{ id: 'output', label: 'Done' }] }),
    schema: () => ({
        fields: [
            { key: 'tag', label: 'Tag', type: 'text', required: true, placeholder: 'e.g. hot-lead' }
        ]
    }),
    validate: (data) => {
        const errors = [];
        if (!data.tag?.trim()) errors.push('Tag is required');
        return { valid: errors.length === 0, errors };
    },
    execute: async (context, data) => {
        const lead = context.getLead();
        if (!lead) return { nextPort: 'output', output: {} };
        const tag = data.tag.trim();
        if (!(lead.tags || []).includes(tag)) {
            await Lead.findByIdAndUpdate(lead._id, { $addToSet: { tags: tag } });
        }
        return { nextPort: 'output', output: { 'lead.lastTagAdded': tag } };
    }
};

NodeRegistry.register(AddTagNode);
module.exports = AddTagNode;
