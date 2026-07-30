const NodeRegistry = require('../../NodeRegistry');
const WhatsAppConversation = require('../../../models/WhatsAppConversation');

// C4 FIX: hard ceiling on any single wait. Must stay at or below the workflow's
// settings.timeoutHours, or the timeout enforcer reaps the execution mid-wait.
const MAX_WAIT_HOURS = Number(process.env.WORKFLOW_MAX_WAIT_HOURS) || 720; // 30 days

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
        inputs:  [{ id: 'input',             label: 'In' }],
        outputs: [
            { id: 'output',          label: 'Resumed' },
            { id: 'replied',         label: 'Replied (WhatsApp)' },
            { id: 'timeout',         label: 'Timed Out' },
            // WEAK #5 FIX: Added explicit port for when no active WhatsApp
            // conversation exists — previously this was silently mapped to 'timeout'
            // which caused false timeout branch execution.
            { id: 'no_conversation', label: 'No Active Conversation' }
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

        // C4 FIX: an execution is reaped once it passes its workflow's
        // settings.timeoutHours, so a wait longer than that silently dies days
        // later with a misleading error. Surface the ceiling at authoring time.
        if (data.waitType === 'duration') {
            if (!data.duration) {
                errors.push('Duration is required');
            } else if (Number(data.duration) / 60 > MAX_WAIT_HOURS) {
                errors.push(`Duration cannot exceed ${MAX_WAIT_HOURS} hours (${MAX_WAIT_HOURS / 24} days)`);
            }
        }
        if (data.waitType === 'whatsapp_reply') {
            if (!data.replyTimeoutHours) {
                errors.push('Reply timeout is required');
            } else if (Number(data.replyTimeoutHours) > MAX_WAIT_HOURS) {
                errors.push(`Reply timeout cannot exceed ${MAX_WAIT_HOURS} hours (${MAX_WAIT_HOURS / 24} days)`);
            }
        }
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

            // BUG #2 FIX: Guard against null lead.
            // WEBHOOK_RECEIVED triggers may have no associated lead — accessing lead._id
            // without this guard throws TypeError and crashes the execution.
            if (!lead) {
                console.warn('[WaitNode] No lead in execution context. Cannot wait for WhatsApp reply. Routing to no_conversation.');
                return {
                    nextPort: 'no_conversation',
                    output: { 'wait.skipped': true, 'wait.reason': 'no_lead_in_context' }
                };
            }

            // Find the lead's active WhatsApp conversation
            const conversation = await WhatsAppConversation.findOne({
                leadId: lead._id,
                status: 'active'
            }).lean();

            if (!conversation) {
                // WEAK #5 FIX: Route to dedicated 'no_conversation' port instead of 'timeout'.
                // The 'timeout' port implies a wait happened and expired — but here the wait
                // never even started. Using 'timeout' silently would cause downstream
                // "you didn't reply" logic to fire incorrectly.
                console.warn(`[WaitNode] No active WhatsApp conversation for lead ${lead._id}. Routing to 'no_conversation' port.`);
                return {
                    nextPort: 'no_conversation',
                    output: { 'wait.skipped': true, 'wait.reason': 'no_active_conversation' }
                };
            }

            const waitHours = Number(data.replyTimeoutHours) || 24;
            const waitUntil  = new Date(Date.now() + waitHours * 60 * 60 * 1000);

            return {
                // M-E6 FIX: 'waiting' is not a declared port. Harmless today only
                // because the engine returns early on `waitSignal` before routing —
                // but if that order ever changes it becomes a silent dead end.
                // VoiceCallNode already uses null here for exactly this reason.
                nextPort: null,
                output:  {},
                waitSignal: {
                    signalType: 'WHATSAPP_REPLY',
                    channelId:  conversation._id,
                    waitUntil,
                    resolvedPort: 'timeout' // Default if the lead doesn't reply within the time limit
                }
            };
        }

        // Unknown wait type — continue immediately
        return { nextPort: 'output', output: {} };
    }
};

NodeRegistry.register(WaitNode);
module.exports = WaitNode;
