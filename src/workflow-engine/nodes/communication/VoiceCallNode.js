const NodeRegistry = require('../../NodeRegistry');
const VoiceEngineService = require('../../../services/VoiceEngineService');
const WorkflowWaitSignal = require('../../../models/WorkflowWaitSignal');

// ─────────────────────────────────────────────────────────────────────────────
// VoiceCallNode
// Initiates an AI Voice Call via VoiceEngineService.
// After the call, the engine waits for the voice outcome webhook.
// When the outcome arrives, resolveWaitSignal() fires with signalType=VOICE_OUTCOME.
// The connected edge label (e.g. 'Interested') determines which branch executes.
// ─────────────────────────────────────────────────────────────────────────────
const VoiceCallNode = {
    type: 'voice_call',

    meta: () => ({
        type:     'voice_call',
        name:     'AI Voice Call',
        icon:     'fa-solid fa-phone-volume',
        category: 'communication',
        color:    '#6366F1',
        description: 'Initiate an AI voice call and branch on the outcome'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',             label: 'In' }],
        outputs: [
            { id: 'Appointment Booked', label: 'Appointment Booked' },
            { id: 'Interested',         label: 'Interested' },
            { id: 'Not Interested',     label: 'Not Interested' },
            { id: 'Busy',               label: 'Busy / Retry' },
            { id: 'No Answer',          label: 'No Answer' },
            { id: 'error',              label: 'Call Failed' }
        ]
    }),

    schema: () => ({
        fields: [
            {
                key:      'executionMode',
                label:    'Execution Mode',
                type:     'select',
                required: true,
                options:  [
                    { value: 'static',   label: 'Static Prompt (No AI cost)' },
                    { value: 'injected', label: 'CRM Variable Injection' },
                    { value: 'smart',    label: 'Smart AI Context (Requires AI Credits)' }
                ]
            },
            {
                key:         'basePrompt',
                label:       'System Prompt / Instructions',
                type:        'textarea',
                required:    true,
                rows:        5,
                placeholder: 'You are a sales agent calling {{lead.name}}...'
            },
            {
                key:         'agentId',
                label:       'Override Voice Agent ID (Optional)',
                type:        'text',
                placeholder: 'Leave blank to use Global Default Agent'
            },
            {
                key:         'waitForOutcomeHours',
                label:       'Wait for Outcome (hours)',
                type:        'number',
                defaultValue: 2,
                description: 'How long to wait for the call outcome webhook before timing out'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.executionMode) errors.push('Execution mode is required');
        if (!data.basePrompt?.trim()) errors.push('System prompt is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead = context.getLead();

        // Build action in VoiceEngineService format
        const action = {
            executionMode: data.executionMode || 'static',
            basePrompt:    data.basePrompt || '',
            agentId:       data.agentId || null
        };

        // Initiate the call
        const workflowId = context.workflowId.toString();
        const success = await VoiceEngineService.executeCallAction(
            lead._id,
            context.tenantId.toString(),
            action,
            workflowId
        );

        if (!success) {
            return { nextPort: 'error', output: { 'voice.error': 'Call initiation failed' } };
        }

        // Wait for the voice outcome webhook to arrive
        const waitHours = data.waitForOutcomeHours || 2;
        const waitUntil = new Date(Date.now() + waitHours * 60 * 60 * 1000);

        return {
            nextPort: 'waiting',
            output:  { 'voice.callInitiated': true, 'voice.initiatedAt': new Date().toISOString() },
            waitSignal: {
                signalType: 'VOICE_OUTCOME',
                channelId:  lead._id,  // VoiceCallLog references leadId
                waitUntil
            }
        };
    }
};

NodeRegistry.register(VoiceCallNode);
module.exports = VoiceCallNode;
