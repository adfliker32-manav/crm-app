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
        outputs: [
            { id: 'output', label: 'Sent' },
            // WF-M3: "nobody to notify" is a real outcome an author needs to handle
            // (fall back to the owner, raise a task, escalate). It used to report the
            // same success as a delivered notification.
            { id: 'no_recipient', label: 'No Recipient' }
        ]
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

        // WF-M3 FIX: count who was actually notified. This node returned
        // `notification.sent: true` unconditionally — including when targetRole was
        // 'assigned_agent' and the lead had no assignee, in which case NOTHING was
        // emitted at all. The history, the variables and the canvas all showed a
        // successful notification for a message nobody received.
        let notified = 0;

        if (data.targetRole === 'assigned_agent') {
            if (!lead?.assignedTo) {
                console.warn(
                    `[InternalNotificationNode] Lead ${lead?._id ?? 'N/A'} has no assigned agent — ` +
                    `nothing to notify (execution ${context.executionId}).`
                );
                return {
                    nextPort: 'no_recipient',
                    output: {
                        'notification.sent':      false,
                        'notification.recipients': 0,
                        'notification.reason':    'lead_has_no_assignee'
                    }
                };
            }
            emitToUser(lead.assignedTo.toString(), 'notification:agent', payload);
            notified = 1;
        } else if (data.targetRole === 'manager' || data.targetRole === 'all') {
            const query = data.targetRole === 'manager'
                ? { parentId: tenantId, role: 'manager' }
                : { parentId: tenantId };
            // M-DB8 FIX: this was an unbounded find + a synchronous emit loop, so a
            // tenant with thousands of sub-users blocked the event loop inside a
            // worker slot on every execution.
            const MAX_NOTIFY_USERS = Number(process.env.WORKFLOW_MAX_NOTIFY_USERS) || 500;
            const users = await User.find(query).select('_id').limit(MAX_NOTIFY_USERS).lean();
            if (users.length === MAX_NOTIFY_USERS) {
                console.warn(
                    `[InternalNotificationNode] Notify list truncated at ${MAX_NOTIFY_USERS} users ` +
                    `for tenant ${tenantId}.`
                );
            }
            for (const u of users) {
                emitToUser(u._id.toString(), 'notification:agent', payload);
            }
            // Also notify the owner
            emitToUser(tenantId, 'notification:agent', payload);
            notified = users.length + 1;
        }

        // WF-M3: Socket.IO delivery is best-effort — an agent who is offline right now
        // simply never sees this. Say so in the output rather than implying delivery,
        // so `notification.recipients` means "addressed", not "read".
        return {
            nextPort: 'output',
            output: {
                'notification.sent':       notified > 0,
                'notification.recipients': notified,
                'notification.message':    message
            }
        };
    }
};

NodeRegistry.register(InternalNotificationNode);
module.exports = InternalNotificationNode;
