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

        const leadDoc = await Lead.findById(lead._id);
        if (leadDoc && leadDoc.status !== stageName) {
            const oldStatus = leadDoc.status;
            leadDoc.status = stageName;
            leadDoc.stageEnteredAt = new Date();
            leadDoc.history.push({
                type: 'System',
                subType: 'Stage Change',
                content: `Stage changed to "${stageName}" by Workflow`,
                date: new Date()
            });

            await leadDoc.save();

            // Run post-stage-change effects in background, just like leadController
            const { runInBackground } = require('../../../utils/controllerHelpers');
            const IntegrationConfig = require('../../../models/IntegrationConfig');
            const { sendMetaEvent } = require('../../../services/metaConversionService');
            const { enrollLeadInSequences } = require('../../../services/sequenceService');
            const { updateLeadScore } = require('../../../services/leadScoringService');

            runInBackground('Workflow Engine Error (STAGE_CHANGED):', () => {
                const WorkflowEngine = require('../../WorkflowEngine');
                // L1 FIX: pass toStage so triggerConfig stage filters match on
                // workflow-driven stage changes too.
                return WorkflowEngine.fireTrigger('STAGE_CHANGED', {
                    lead: leadDoc,
                    fromStage: oldStatus,
                    toStage: stageName
                });
            });

            runInBackground('Sequence enrollment error (STAGE_CHANGED):', () => {
                return enrollLeadInSequences(leadDoc, 'STAGE_CHANGED', stageName);
            });

            runInBackground('Score update error (STAGE_CHANGED):', () => {
                const isLost = /lost|dead/i.test(stageName || '');
                return updateLeadScore(leadDoc._id, isLost ? 'STAGE_LOST' : 'STAGE_FORWARD');
            });

            runInBackground('Meta CAPI error (non-blocking):', async () => {
                try {
                    const config = await IntegrationConfig.findOne({ userId: leadDoc.userId })
                        .select('+meta.metaCapiAccessToken +meta.metaCapiEnabled +meta.metaPixelId +meta.metaStageMapping +meta.metaTestEventCode');
                    if (config && config.meta?.metaCapiEnabled) {
                        await sendMetaEvent(config, leadDoc, stageName, oldStatus);
                    }
                } catch (err) {
                    console.error('Error fetching config for Meta CAPI (non-blocking):', err);
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
