const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');

// ─────────────────────────────────────────────────────────────────────────────
// UpdateStageNode
// Moves the lead to a different pipeline stage.
// ─────────────────────────────────────────────────────────────────────────────
const UpdateStageNode = {
    type: 'update_stage',

    meta: () => ({
        type:     'update_stage',
        name:     'Update Stage',
        icon:     'fa-solid fa-right-left',
        category: 'crm',
        color:    '#8B5CF6',
        description: 'Move the lead to a different pipeline stage'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [{ id: 'output', label: 'Done' }]
    }),

    schema: () => ({
        fields: [
            {
                key:      'stageName',
                label:    'Destination Stage',
                type:     'stage_select',
                required: true,
                description: 'Select which stage to move the lead to'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.stageName?.trim()) errors.push('Stage name is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead = context.getLead();
        if (!lead) return { nextPort: 'output', output: {} };

        const stageName = data.stageName;

        // Only update if the stage is actually changing
        if (lead.status !== stageName) {
            await Lead.findByIdAndUpdate(lead._id, {
                $set:  { status: stageName, stageEnteredAt: new Date() },
                $push: {
                    history: {
                        $each:  [{ type: 'System', subType: 'WorkflowEngine', content: `Stage changed to "${stageName}" by Workflow`, date: new Date() }],
                        $slice: -100
                    }
                }
            });
        }

        return {
            nextPort: 'output',
            output: {
                'lead.status':         stageName,
                'lead.stageChangedAt': new Date().toISOString()
            }
        };
    }
};

NodeRegistry.register(UpdateStageNode);
module.exports = UpdateStageNode;
