const NodeRegistry = require('../../NodeRegistry');
const { emitToUser } = require('../../../services/socketService');
const User = require('../../../models/User');

// ─────────────────────────────────────────────────────────────────────────────
// InternalNotificationNode
// Sends a real-time notification to a team member via Socket.IO.
// ─────────────────────────────────────────────────────────────────────────────
const InternalNotificationNode = {
    type: 'internal_notification',
    sideEffect: true, // L4/L5: real notification — dry-run in Test Mode, idempotent on retry

    meta: () => ({
        type:     'internal_notification',
        name:     'Notify Team',
        icon:     'fa-solid fa-bell',
        category: 'communication',
        color:    '#F59E0B',
        description: 'Send a real-time notification to a team member'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [{ id: 'output', label: 'Sent' }]
    }),

    schema: () => ({
        fields: [
            {
                key:      'targetRole',
                label:    'Notify',
                type:     'select',
                required: true,
                options: [
                    { value: 'assigned_agent', label: 'Assigned Agent' },
                    { value: 'manager',        label: 'All Managers' },
                    { value: 'all',            label: 'Entire Team' }
                ]
            },
            {
                key:         'message',
                label:       'Message',
                type:        'text',
                required:    true,
                placeholder: 'New hot lead! {{lead.name}} is in Negotiation stage.'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.targetRole) errors.push('Target role is required');
        if (!data.message?.trim()) errors.push('Message is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead    = context.getLead();
        const tenantId = context.tenantId.toString();
        const vars = context.getAll();
        const message = (data.message || '').replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');

        const payload = {
            leadId:    lead?._id,
            leadName:  lead?.name,
            message,
            timestamp: new Date()
        };

        if (data.targetRole === 'assigned_agent' && lead?.assignedTo) {
            emitToUser(lead.assignedTo.toString(), 'workflow:notification', payload);
        } else if (data.targetRole === 'manager' || data.targetRole === 'all') {
            const query = data.targetRole === 'manager'
                ? { parentId: tenantId, role: 'manager' }
                : { parentId: tenantId };
            const users = await User.find(query).select('_id').lean();
            for (const u of users) {
                emitToUser(u._id.toString(), 'workflow:notification', payload);
            }
            // Also notify the owner
            emitToUser(tenantId, 'workflow:notification', payload);
        }

        return {
            nextPort: 'output',
            output: { 'notification.sent': true }
        };
    }
};

NodeRegistry.register(InternalNotificationNode);
module.exports = InternalNotificationNode;
