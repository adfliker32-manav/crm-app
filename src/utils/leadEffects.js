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

    // A lead can arrive ALREADY assigned (per-source default agent, a Meta form
    // mapping, an API payload, an assignment rule). If a conversation is already
    // linked to it — the chatbot creates leads from a live thread, and the inbox
    // can link one manually — that thread must pick the owner up immediately
    // rather than waiting for the next inbound message.
    // No-op when nothing is linked yet, which is the common case.
    if (lead.assignedTo) {
        queueLeadAssignmentEffects(lead, ownerId);
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

/**
 * Lead ownership changed → the WhatsApp conversation follows.
 *
 * The Lead is the single source of truth for who owns a conversation, so EVERY
 * path that writes Lead.assignedTo must call this. It is a no-op unless the
 * workspace has WorkspaceSettings.whatsappFollowsLeadAssignment enabled.
 *
 * Deliberately an explicit call rather than a Mongoose hook: the bulk paths use
 * updateMany, which fires no document middleware, so a hook would silently miss
 * exactly the case that matters most.
 *
 * @param {object} lead     needs at least { _id, assignedTo }
 * @param {string} tenantId the workspace owner (req.tenantId / lead.userId)
 */
/**
 * Link a lead's phone number to any conversation that has no lead yet.
 *
 * Callers pass wildly different lead shapes — a full Mongoose document, a lean
 * projection, or `{ _id, assignedTo }` built by hand (AssignUserNode does the
 * last one) — so the phone is fetched when it was not supplied. `null` is a
 * real answer (a lead genuinely without a phone) and is not re-fetched;
 * `undefined` means "not projected".
 *
 * Never throws: linking is opportunistic and must not break an assignment.
 */
const linkLeadConversations = async (svc, lead, tenantId) => {
    try {
        if (!await svc.isFollowLeadEnabled(tenantId)) return;

        let phone = lead.phone;
        if (phone === undefined) {
            const Lead = require('../models/Lead');
            const doc = await Lead.findById(lead._id).select('phone').lean();
            phone = doc?.phone || null;
        }
        if (!phone) return;

        await svc.linkConversationsToLead({ tenantId, phone, leadId: lead._id });
    } catch (err) {
        console.error('WhatsApp conversation link error (non-blocking):', err.message);
    }
};

const queueLeadAssignmentEffects = (lead, tenantId) => {
    if (!lead?._id || !tenantId) return;

    runInBackground('WhatsApp assignment sync error (non-blocking):', async () => {
        const svc = require('../services/whatsappAssignmentService');
        const { getCompanyUserIds } = require('./whatsappUtils');

        // Link BEFORE syncing. syncConversationsForLead filters on `leadId`, so a
        // thread that was never linked to a Lead is invisible to it — and that is
        // the normal state for anyone who messaged in before the Lead existed.
        //
        // Only the external API used to do this, so assigning from the CRM UI,
        // a workflow, an automation rule or MCP moved the Lead and left the chat
        // exactly where it was. It looked like assignment was broken, and for
        // every unlinked thread it was.
        //
        // Gated on the toggle to keep this module inert when the workspace does
        // not mirror assignment (see whatsappAssignmentService's header).
        await linkLeadConversations(svc, lead, tenantId);

        const result = await svc.syncConversationsForLead({
            leadId: lead._id,
            tenantId,
            assignedTo: lead.assignedTo || null
        });

        if (result.conversations.length === 0) return;

        // Tell the gaining side to pick the thread up and the losing side to
        // drop it — an agent with the inbox open must not keep a conversation
        // the API will now 404 on.
        await svc.broadcastAssignmentChanges({
            tenantId,
            companyUserIds: await getCompanyUserIds(tenantId),
            changes: result.conversations
        });
    });
};

/**
 * Same, for a batch of leads moving to the SAME assignee (bulk assign).
 * One updateMany instead of N.
 */
const queueBulkLeadAssignmentEffects = (leadIds, assignedTo, tenantId) => {
    if (!Array.isArray(leadIds) || leadIds.length === 0 || !tenantId) return;

    runInBackground('WhatsApp bulk assignment sync error (non-blocking):', async () => {
        const svc = require('../services/whatsappAssignmentService');
        const { getCompanyUserIds } = require('./whatsappUtils');

        // Same link-before-sync as the single path. Each conversation needs ITS
        // own lead's id, so this cannot collapse into one updateMany — it is a
        // sequential pass, which is fine because the whole call is backgrounded.
        // Only leads that actually have a phone are visited.
        if (await svc.isFollowLeadEnabled(tenantId)) {
            const Lead = require('../models/Lead');
            const docs = await Lead.find({ _id: { $in: leadIds } }).select('_id phone').lean();
            for (const doc of docs) {
                if (!doc.phone) continue;
                await svc.linkConversationsToLead({
                    tenantId, phone: doc.phone, leadId: doc._id
                });
            }
        }

        const result = await svc.syncConversationsForLeads({
            leadIds,
            tenantId,
            assignedTo: assignedTo || null
        });

        if (result.conversations.length === 0) return;

        await svc.broadcastAssignmentChanges({
            tenantId,
            companyUserIds: await getCompanyUserIds(tenantId),
            changes: result.conversations
        });
    });
};

/**
 * Leads were deleted → their conversations lose the link AND the derived owner.
 * The message history itself is preserved; the thread falls back to
 * manager-only visibility, because the assignment's justification is gone.
 */
const queueLeadDeletionEffects = (leadIds, tenantId) => {
    if (!Array.isArray(leadIds) || leadIds.length === 0 || !tenantId) return;

    runInBackground('WhatsApp lead-deletion detach error (non-blocking):', () =>
        require('../services/whatsappAssignmentService')
            .detachDeletedLeads({ leadIds, tenantId })
    );
};

module.exports = {
    appendLeadHistory,
    queueLeadCreatedEffects,
    queueLeadStageChangeEffects,
    queueLeadAssignmentEffects,
    queueBulkLeadAssignmentEffects,
    queueLeadDeletionEffects
};
