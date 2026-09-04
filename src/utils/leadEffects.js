const Lead = require('../models/Lead');
const { sendAutomatedEmailOnLeadCreate, sendAutomatedEmailOnStageChange } = require('../services/emailAutomationService');
const { sendAutomatedWhatsAppOnLeadCreate, sendAutomatedWhatsAppOnStageChange } = require('../services/whatsappAutomationService');
const { sendMetaEventForLead } = require('../services/metaConversionService');
const { evaluateLead } = require('../services/AutomationService');
const WorkflowEngine = require('../workflow-engine/WorkflowEngine');
const { runInBackground } = require('./controllerHelpers');
const { normalizePhone } = require('../services/duplicateService');

const appendLeadHistory = (leadId, historyEntry) =>
    Lead.findByIdAndUpdate(leadId, {
        $push: { history: { $each: [historyEntry], $slice: -100 } }
    }).exec();

const queueLeadCreatedEffects = (lead, ownerId, options = {}) => {
    // QUIET MODE (bulk migration imports). Suppresses the two "welcome" sends
    // ONLY — importing 1,000 historical contacts must not greet every one of
    // them as a fresh inbound lead, which for WhatsApp is a genuine ban risk.
    // Everything else still runs: sequences, automation rules, workflows, lead
    // alerts and scoring. A migrated contact still belongs in the pipeline
    // logic; it just must not be messaged as if it had just arrived.
    //
    // NOTE: a sequence whose first step has delayHours = 0 will still send.
    // Quiet mode governs the welcome messages, not every downstream automation.
    const skipWelcome = options.skipWelcome === true;

    if (lead.email && !skipWelcome) {
        runInBackground('Email automation error (non-blocking):', async () => {
            const sent = await sendAutomatedEmailOnLeadCreate(lead, ownerId);
            if (sent) {
                await appendLeadHistory(lead._id, {
                    type: 'Email',
                    subType: 'Auto',
                    content: 'Automated Welcome Email Sent' + (options.source ? ` (${options.source})` : ''),
                    date: new Date()
                });
            }
        });
    }

    if (lead.phone && !skipWelcome) {
        runInBackground('WhatsApp automation error (non-blocking):', async () => {
            const phoneToSend = normalizePhone(lead.phone) || lead.phone;
            const leadForWhatsApp = typeof lead.toObject === 'function'
                ? { ...lead.toObject(), phone: phoneToSend }
                : { ...lead, phone: phoneToSend };

            const sent = await sendAutomatedWhatsAppOnLeadCreate(leadForWhatsApp, ownerId);
            if (sent) {
                await appendLeadHistory(lead._id, {
                    type: 'WhatsApp',
                    subType: 'Auto',
                    content: 'Automated Welcome WhatsApp Sent' + (options.source ? ` (${options.source})` : ''),
                    date: new Date()
                });
            }
        });
    }

    runInBackground('Automation Service Error (LEAD_CREATED):', () =>
        evaluateLead(lead, 'LEAD_CREATED')
    );

    // L-16: `startedBy` labels who caused the run. WorkflowExecution's enum carries
    // 'api' precisely so external-API traffic is distinguishable from internal CRM
    // events in the execution list — but nothing was passing it once extApiController
    // moved onto this shared helper, so those runs all recorded as 'trigger' again.
    // Omitted ⇒ WorkflowEngine defaults to 'trigger', which is right for CRM events.
    const startedBy = options.startedBy;

    runInBackground('Workflow Engine Error (LEAD_CREATED/STAGE_CHANGED):', () => {
        WorkflowEngine.fireTrigger('LEAD_CREATED', { lead, startedBy });
        WorkflowEngine.fireTrigger('STAGE_CHANGED', { lead, isInitialStage: true, startedBy });
    });

    runInBackground('Sequence enrollment error (LEAD_CREATED):', async () => {
        const { enrollLeadInSequences } = require('../services/sequenceService');
        await enrollLeadInSequences(lead, 'LEAD_CREATED');

        // A lead can ARRIVE already sitting in a stage rather than being moved
        // into it — a Meta form mapped to a stage, a CSV status column, an API
        // payload, an assignment rule. It never "moves", so a STAGE_CHANGED
        // sequence for that stage would never fire and the user just sees a
        // sequence that silently does nothing. The workflow engine above already
        // treats the initial stage as a stage change (isInitialStage: true);
        // this mirrors it, so "run this sequence when a lead is in X" behaves
        // the same however the lead got into X.
        // Safe against double-enrolment: LEAD_CREATED and STAGE_CHANGED select
        // different Sequence rows, and enrollLeadInSequences skips any lead
        // already active/completed/paused in a given sequence.
        if (lead.status) {
            await enrollLeadInSequences(lead, 'STAGE_CHANGED', lead.status);
        }
    });

    if (!options.skipCapi) {
        runInBackground('Meta CAPI error (Lead Created):', () =>
            sendMetaEventForLead(lead, lead.status, null, { eventTime: options.eventTime, deferSend: options.deferSend })
        );
    }

    try {
        const { sendLeadArrivalAlert } = require('../services/leadAlertService');
        sendLeadArrivalAlert(lead).catch(err => console.error('❌ Error sending lead arrival alerts:', err.message));
    } catch (alertErr) {
        console.error('❌ Failed to trigger lead arrival alerts:', alertErr.message);
    }
};

const queueLeadStageChangeEffects = (lead, fromStage = undefined, options = {}) => {
    runInBackground('Auto Error (STAGE_CHANGED):', () => evaluateLead(lead, 'STAGE_CHANGED'));

    // L-16: same attribution as queueLeadCreatedEffects — see the note there.
    runInBackground('Workflow Engine Error (STAGE_CHANGED):', () =>
        WorkflowEngine.fireTrigger('STAGE_CHANGED', {
            lead, fromStage, toStage: lead.status, startedBy: options.startedBy
        })
    );

    runInBackground('Sequence enrollment error (STAGE_CHANGED):', () => {
        const { enrollLeadInSequences } = require('../services/sequenceService');
        return enrollLeadInSequences(lead, 'STAGE_CHANGED', lead.status);
    });

    runInBackground('Score update error (STAGE_CHANGED):', () => {
        const { updateLeadScore } = require('../services/leadScoringService');
        const isLost = /lost|dead/i.test(lead.status || '');
        return updateLeadScore(lead._id, isLost ? 'STAGE_LOST' : 'STAGE_FORWARD');
    });
};

module.exports = {
    appendLeadHistory,
    queueLeadCreatedEffects,
    queueLeadStageChangeEffects
};
