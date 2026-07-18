const NodeRegistry = require('../../NodeRegistry');
const VoiceEngineService = require('../../../services/VoiceEngineService');
const WorkflowWaitSignal = require('../../../models/WorkflowWaitSignal');
// BUG #8 FIX: canonical outcome port ids shared with VoiceEngineService's
// resolvedPort mapping, so the ports the canvas renders and the ports the
// webhook resolves to can never drift apart.
const { VOICE_OUTCOME_PORTS } = require('./voiceOutcomePorts');

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
        inputs:  [{ id: 'input', label: 'In' }],
        // BUG #8 FIX: sourced from the shared canonical list so the canvas ports
        // stay in lockstep with the ports VoiceEngineService resolves outcomes to.
        outputs: VOICE_OUTCOME_PORTS
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

        // Initiate the call. `workflowId` is passed under its own key — it used to be
        // handed to the `ruleId` parameter and stored in VoiceCallLog.automationRuleId,
        // a field declared `ref: 'AutomationRule'`, corrupting that reference.
        const { success, callLog, error } = await VoiceEngineService.executeCallAction(
            lead._id,
            context.tenantId.toString(),
            action,
            { workflowId: context.workflowId }
        );

        if (!success) {
            return {
                nextPort: 'error',
                output: { 'voice.error': error || 'Call initiation failed' }
            };
        }

        // Wait for the voice outcome webhook to arrive
        const waitHours = data.waitForOutcomeHours || 2;
        const waitUntil = new Date(Date.now() + waitHours * 60 * 60 * 1000);

        // BUG #4 FIX: nextPort should NOT be 'waiting' — that is not a real canvas port.
        // The WorkflowEngine pauses execution purely based on the presence of waitSignal.
        // Setting nextPort to null prevents the engine from looking for a non-existent
        // 'waiting' connection and incorrectly marking the execution as completed.
        return {
            nextPort: null,
            output:  {
                'voice.callInitiated': true,
                'voice.initiatedAt':   new Date().toISOString(),
                'voice.callLogId':     callLog._id.toString()
            },
            waitSignal: {
                signalType: 'VOICE_OUTCOME',
                // BUG FIX: keyed on THIS call, not on the lead. resolveWaitSignal resumes
                // every pending signal on a channel, so with channelId = lead._id a second
                // call to the same lead (or two workflows calling one lead) had its outcome
                // resolve the other call's branch. The call log id is unique per call.
                channelId:  callLog._id,
                waitUntil,
                resolvedPort: 'No Answer' // Default outcome if the webhook never arrives within the deadline
            }
        };
    }
};

NodeRegistry.register(VoiceCallNode);
module.exports = VoiceCallNode;
