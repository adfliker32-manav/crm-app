const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');

const AddTagNode = {
    type: 'add_tag',
    sideEffect: true, // L4/L5: mutates the lead + fires TAG_ADDED — dry-run in Test Mode, idempotent on retry
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
        // Only fire TAG_ADDED when the tag is genuinely new — re-adding an existing
        // tag is a no-op and must not re-trigger tag-based workflows (loop guard).
        if (!(lead.tags || []).includes(tag)) {
            await Lead.findByIdAndUpdate(lead._id, { $addToSet: { tags: tag } });
            // L3 FIX: fire TAG_ADDED so tag-triggered workflows run for tags added
            // by automations too. Lazy require avoids the engine↔node circular dep.
            const { runInBackground } = require('../../../utils/controllerHelpers');
            runInBackground('Workflow Engine Error (TAG_ADDED):', () => {
                const WorkflowEngine = require('../../WorkflowEngine');
                return WorkflowEngine.fireTrigger('TAG_ADDED', {
                    lead: { ...lead, tags: [...(lead.tags || []), tag] },
                    addedTags: [tag]
                });
            });
        }
        return { nextPort: 'output', output: { 'lead.lastTagAdded': tag } };
    }
};

NodeRegistry.register(AddTagNode);
module.exports = AddTagNode;
