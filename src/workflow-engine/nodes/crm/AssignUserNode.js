const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');
const { emitToUser } = require('../../../services/socketService');

const AssignUserNode = {
    type: 'assign_user',

    meta: () => ({
        type: 'assign_user', name: 'Assign User', icon: 'fa-solid fa-user-tag',
        category: 'crm', color: '#EC4899',
        description: 'Assign the lead to a team member'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [{ id: 'output', label: 'Done' }]
    }),

    schema: () => ({
        fields: [
            { key: 'userId', label: 'Assign To', type: 'user_select', required: true }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.userId) errors.push('User is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead = context.getLead();
        if (!lead) return { nextPort: 'output', output: {} };

        if (lead.assignedTo?.toString() !== data.userId?.toString()) {
            await Lead.findByIdAndUpdate(lead._id, {
                $set:  { assignedTo: data.userId },
                $push: {
                    history: {
                        $each:  [{ type: 'System', subType: 'WorkflowEngine', content: `Lead assigned by Workflow`, date: new Date() }],
                        $slice: -100
                    }
                }
            });

            setImmediate(() => {
                emitToUser(data.userId.toString(), 'lead:assigned', {
                    leadId: lead._id, leadName: lead.name,
                    message: `You have been assigned lead: ${lead.name}`, timestamp: new Date()
                });
            });
        }

        return { nextPort: 'output', output: { 'lead.assignedTo': data.userId } };
    }
};

NodeRegistry.register(AssignUserNode);
module.exports = AssignUserNode;
