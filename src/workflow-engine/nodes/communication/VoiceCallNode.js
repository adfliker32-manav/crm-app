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
    sideEffect: true, // L4/L5: real call — dry-run in Test Mode, idempotent on retry
    slow: true,       // L-6: telephony provider latency

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
                key:         'voiceTemplateId',
                label:       'Voice Template',
                type:        'voice_template_select',
                required:    false,
                description: 'Optional. Uses a saved Voice Template — its prompt and execution mode. Leave empty to write the prompt here.'
            },
            {
                key:      'executionMode',
                label:    'Execution Mode',
                type:     'select',
                required: true,
                description: 'Ignored when a Voice Template is selected above.',
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
                placeholder: 'You are a sales agent calling {{lead.name}}...',
                description: 'Ignored when a Voice Template is selected above.'
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
        // A template supplies both, so neither is required alongside one.
        if (!data.voiceTemplateId) {
            if (!data.executionMode) errors.push('Execution mode is required');
            if (!data.basePrompt?.trim()) errors.push('System prompt is required');
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead = context.getLead();

        // ── H21 FIX: guard the null lead, like every other lead-bound node ──────
        // WEBHOOK_RECEIVED with no matching lead, and every SCHEDULED_TRIGGER, run
        // with contactId null. `lead._id` below then threw a TypeError, which the
        // engine caught and turned into a failed execution whose errorMessage was a
        // raw "Cannot read properties of null" shown to the end user. WaitNode
        // documents this exact hazard (BUG #2) — this node was simply never given
        // the same treatment.
        if (!lead?._id) {
            console.warn('[VoiceCallNode] No lead in execution context — cannot place a call.');
            return {
                nextPort: 'error',
                output: { 'voice.skipped': true, 'voice.error': 'no_lead_in_context' }
            };
        }
        if (!lead.phone) {
            console.warn(`[VoiceCallNode] Lead ${lead._id} has no phone number — cannot place a call.`);
            return {
                nextPort: 'error',
                output: { 'voice.skipped': true, 'voice.error': 'no_phone' }
            };
        }

        // A saved Voice Template supplies the prompt and the execution mode, the
        // same way the Send Email node takes an email template. Resolved live, so
        // editing the template updates every workflow pointing at it rather than
        // leaving a stale copy behind on the node.
        let executionMode = data.executionMode || 'static';
        let basePrompt    = data.basePrompt || '';

        if (data.voiceTemplateId) {
            const VoiceTemplate = require('../../../models/VoiceTemplate');
            const tenantId = context.tenantId.toString();
            // Tenant's own templates, plus the platform-wide ones the Voice Hub
            // also offers — matching what the picker lists.
            const tpl = await VoiceTemplate.findOne({
                _id: data.voiceTemplateId,
                $or: [{ tenantId }, { isGlobal: true }]
            }).lean().catch(() => null);

            if (tpl) {
                executionMode = tpl.executionMode || executionMode;
                basePrompt    = tpl.basePrompt || basePrompt;
            } else {
                // Deleted template: fall back to whatever the node still carries
                // rather than placing a call with an empty prompt.
                console.warn(`[VoiceCallNode] Voice template ${data.voiceTemplateId} not found for tenant ${context.tenantId} — using the node's own prompt.`);
            }
        }

        if (!basePrompt.trim()) {
            console.warn('[VoiceCallNode] No prompt to call with — routing to error port.');
            return {
                nextPort: 'error',
                output: { 'voice.skipped': true, 'voice.error': 'no_prompt' }
            };
        }

        // Build action in VoiceEngineService format
        const action = {
            executionMode,
            basePrompt,
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

        // H21 FIX: also require the callLog. `callLog._id` is dereferenced below to
        // key the wait signal, so a {success:true, callLog:undefined} response would
        // throw the same TypeError one line later.
        if (!success || !callLog?._id) {
            return {
                nextPort: 'error',
                output: { 'voice.error': error || 'Call initiation returned no call log' }
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
