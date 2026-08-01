const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');

// ─────────────────────────────────────────────────────────────────────────────
// UpdateStageNode
// Moves the lead to a different pipeline stage.
// ─────────────────────────────────────────────────────────────────────────────
const UpdateStageNode = {
    type: 'update_stage',
    sideEffect: true, // L4/L5: mutates the lead + fires triggers — dry-run in Test Mode, idempotent on retry

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

        // ── M-DB7 + M-DB6 FIX: one atomic, capped update ────────────────────────
        // This used to findById → mutate → save(), a read-modify-write that clobbered
        // any concurrent edit to the lead, and pushed to `history` with no $slice so
        // the array grew without bound (AssignUserNode already caps at 100). Making
        // the status change part of the query condition also makes the "did it
        // actually change?" test atomic, so two concurrent executions can't both
        // believe they performed the transition and both fire STAGE_CHANGED.
        const prev = await Lead.findOneAndUpdate(
            { _id: lead._id, status: { $ne: stageName } },
            {
                $set:  { status: stageName, stageEnteredAt: new Date() },
                $push: {
                    history: {
                        $each: [{
                            type: 'System',
                            subType: 'Stage Change',
                            content: `Stage changed to "${stageName}" by Workflow`,
                            date: new Date()
                        }],
                        $slice: -100
                    }
                }
            },
            { returnDocument: 'before' }   // pre-image gives us the old status for the trigger payload
        );

        const leadDoc = prev ? await Lead.findById(lead._id) : null;   // post-image for downstream consumers

        // `leadDoc` can be null if the lead was deleted between the update and this
        // read; the downstream effects all dereference it, so skip them rather than
        // throwing inside a background handler where the cause would be obscured.
        if (prev && leadDoc) {
            const oldStatus = prev.status;

            // Run post-stage-change effects in background, just like leadController
            const { runInBackground } = require('../../../utils/controllerHelpers');
            const { sendMetaEventForLead } = require('../../../services/metaConversionService');
            const { enrollLeadInSequences } = require('../../../services/sequenceService');
            const { updateLeadScore } = require('../../../services/leadScoringService');

            runInBackground('Workflow Engine Error (STAGE_CHANGED):', () => {
                const WorkflowEngine = require('../../WorkflowEngine');
                // L1 FIX: pass toStage so triggerConfig stage filters match on
                // workflow-driven stage changes too.
                return WorkflowEngine.fireTrigger('STAGE_CHANGED', {
                    lead: leadDoc,
                    fromStage: oldStatus,
                    toStage: stageName,
                    // C8 FIX: carry the causation chain forward. Without this every
                    // hop restarted at depth 0, so two workflows each moving a lead
                    // into the stage the other watches ping-ponged forever — and the
                    // per-workflow cycle check at publish cannot see a loop that
                    // closes through a side effect like this one.
                    _depth: context.getTriggerDepth() + 1,
                    _chain: [...context.getTriggerChain(), `${context.workflowId}:stage=${stageName}`]
                });
            });

            runInBackground('Sequence enrollment error (STAGE_CHANGED):', () => {
                return enrollLeadInSequences(leadDoc, 'STAGE_CHANGED', stageName);
            });

            runInBackground('Score update error (STAGE_CHANGED):', () => {
                const isLost = /lost|dead/i.test(stageName || '');
                return updateLeadScore(leadDoc._id, isLost ? 'STAGE_LOST' : 'STAGE_FORWARD');
            });

            // Outbox-backed entry point — handles config resolution (incl. the
            // agent → parent fallback this path used to miss) and retry-on-failure.
            runInBackground('Meta CAPI error (non-blocking):', () =>
                sendMetaEventForLead(leadDoc, stageName, oldStatus)
            );
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
