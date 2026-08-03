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
    if (lead.email) {
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

    if (lead.phone) {
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

    runInBackground('Workflow Engine Error (LEAD_CREATED/STAGE_CHANGED):', () => {
        WorkflowEngine.fireTrigger('LEAD_CREATED', { lead });
        WorkflowEngine.fireTrigger('STAGE_CHANGED', { lead, isInitialStage: true });
    });

    runInBackground('Sequence enrollment error (LEAD_CREATED):', () => {
        const { enrollLeadInSequences } = require('../services/sequenceService');
        return enrollLeadInSequences(lead, 'LEAD_CREATED');
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

const queueLeadStageChangeEffects = (lead, fromStage = undefined) => {
    runInBackground('Auto Error (STAGE_CHANGED):', () => evaluateLead(lead, 'STAGE_CHANGED'));
    
    runInBackground('Workflow Engine Error (STAGE_CHANGED):', () =>
        WorkflowEngine.fireTrigger('STAGE_CHANGED', { lead, fromStage, toStage: lead.status })
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
