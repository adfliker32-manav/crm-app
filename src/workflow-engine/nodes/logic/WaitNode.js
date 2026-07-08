const NodeRegistry = require('../../NodeRegistry');
const WhatsAppConversation = require('../../../models/WhatsAppConversation');

// ─────────────────────────────────────────────────────────────────────────────
// WaitNode
// Pauses execution for a configurable duration or until an external signal.
// Supported wait types:
//   'duration'       — wait X minutes/hours/days
//   'whatsapp_reply' — wait for a WhatsApp reply (creates WorkflowWaitSignal)
// ─────────────────────────────────────────────────────────────────────────────
const WaitNode = {
    type: 'wait',

    meta: () => ({
        type:     'wait',
        name:     'Wait',
        icon:     'fa-solid fa-hourglass-half',
        category: 'logic',
        color:    '#F97316',
        description: 'Pause the workflow for a duration or until an event'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',    label: 'In' }],
        outputs: [
            { id: 'output',   label: 'Resumed' },
            { id: 'replied',  label: 'Replied (WhatsApp)' },
            { id: 'timeout',  label: 'Timed Out' }
        ]
    }),

    schema: () => ({
        fields: [
            {
                key:      'waitType',
                label:    'Wait For',
                type:     'select',
                required: true,
                options:  [
                    { value: 'duration',       label: 'Fixed Duration (minutes / hours / days)' },
                    { value: 'whatsapp_reply', label: 'WhatsApp Reply from Lead' }
                ]
            },
            {
                key:          'duration',
                label:        'Duration',
                type:         'number',
                defaultValue: 60,
                placeholder:  'e.g. 60',
                showWhen:     { field: 'waitType', value: 'duration' },
                description:  'Duration in minutes'
            },
            {
                key:          'replyTimeoutHours',
                label:        'Reply Timeout (hours)',
                type:         'number',
                defaultValue: 24,
                showWhen:     { field: 'waitType', value: 'whatsapp_reply' },
                description:  'How many hours to wait for a reply before timing out'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.waitType) errors.push('Wait type is required');
        if (data.waitType === 'duration' && !data.duration) errors.push('Duration is required');
        if (data.waitType === 'whatsapp_reply' && !data.replyTimeoutHours) errors.push('Reply timeout is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const waitType = data.waitType;

        if (waitType === 'duration') {
            const minutes  = Number(data.duration) || 60;
            const waitUntil = new Date(Date.now() + minutes * 60 * 1000);

            return {
                nextPort: 'output',
                output:  { 'wait.resumedAt': waitUntil.toISOString() },
                waitSignal: {
                    signalType: 'TIMEOUT',
                    resolvedPort: 'output',
                    waitUntil
                }
            };
        }

        if (waitType === 'whatsapp_reply') {
            const lead = context.getLead();
            // Find the lead's active WhatsApp conversation
            const conversation = await WhatsAppConversation.findOne({
                leadId: lead._id,
                status: 'active'
            }).lean();

            if (!conversation) {
                console.warn(`[WaitNode] No active WhatsApp conversation for lead ${lead._id}. Skipping wait.`);
                return { nextPort: 'timeout', output: { 'wait.skipped': true } };
            }

            const waitHours = Number(data.replyTimeoutHours) || 24;
            const waitUntil  = new Date(Date.now() + waitHours * 60 * 60 * 1000);

            return {
                nextPort: 'waiting',
                output:  {},
                waitSignal: {
                    signalType: 'WHATSAPP_REPLY',
                    channelId:  conversation._id,
                    waitUntil
                }
            };
        }

        // Unknown wait type — continue immediately
        return { nextPort: 'output', output: {} };
    }
};

NodeRegistry.register(WaitNode);
module.exports = WaitNode;
