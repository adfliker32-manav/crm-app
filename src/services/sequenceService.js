const mongoose = require('mongoose');
const Sequence = require('../models/Sequence');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { wrapEmailHtml } = require('../utils/emailTemplateUtils');
const { resolveTemplate, buildTemplateContext } = require('../utils/templateResolver');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { isTenantExpired } = require('../utils/tenantStatus');

let globalAgendaInstance = null;

// ── Schedule the Agenda job for the next sequence step ────────────────────────
const scheduleStepJob = async (enrollmentId, delayHours) => {
    if (!globalAgendaInstance) return;
    const delayMs = (delayHours || 0) * 60 * 60 * 1000;
    const fireAt = new Date(Date.now() + delayMs);
    await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { nextStepAt: fireAt });
    const job = await globalAgendaInstance.schedule(fireAt, 'PROCESS_SEQUENCE_STEP', {
        enrollmentId: enrollmentId.toString()
    });
    // job.attrs._id is minted by Agenda's bundled bson 4; Mongoose 9's bson 7
    // serializer rejects any value not carrying its own version stamp. Re-mint it
    // so what crosses into Mongoose is always native. The schema path is typed
    // ObjectId and would cast it too — this keeps the boundary visible at the seam.
    await SequenceEnrollment.findByIdAndUpdate(enrollmentId, {
        agendaJobId: new mongoose.Types.ObjectId(String(job.attrs._id))
    });
};

// ── Enroll a lead into all sequences matching the given trigger ───────────────
// Called from leadController on lead create and stage change.
const enrollLeadInSequences = async (lead, triggerType, triggerStage = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return;

        // 🔒 BUG-1 FIX: Skip enrollment for expired tenants.
        if (await isTenantExpired(lead.userId)) return;

        const query = { tenantId: lead.userId, isActive: true, trigger: triggerType };
        if (triggerType === 'STAGE_CHANGED' && triggerStage) {
            query.triggerStage = triggerStage;
        }

        const sequences = await Sequence.find(query).lean();
        if (!sequences.length) return;

        for (const seq of sequences) {
            if (!seq.steps || seq.steps.length === 0) continue;

            // Never re-enroll a lead that is already active, completed, or paused in this sequence.
            // Previously only checked 'active' — a lead that completed or was paused by a reply
            // could get re-enrolled on the next trigger, causing duplicate messaging.
            const existing = await SequenceEnrollment.findOne({
                sequenceId: seq._id,
                leadId: lead._id,
                status: { $in: ['active', 'completed', 'paused'] }
            });
            if (existing) continue;

            const enrollment = await SequenceEnrollment.create({
                tenantId: lead.userId,
                sequenceId: seq._id,
                leadId: lead._id,
                currentStep: 0,
                status: 'active',
                enrolledAt: new Date()
            });

            await Sequence.findByIdAndUpdate(seq._id, { $inc: { enrollmentCount: 1 } });

            // Schedule step 0 (may fire immediately if delayHours === 0)
            await scheduleStepJob(enrollment._id, seq.steps[0].delayHours || 0);

            console.log(`📋 [Sequence] Lead "${lead.name}" enrolled in "${seq.name}" (trigger: ${triggerType})`);
        }
    } catch (err) {
        console.error('[Sequence] Enrollment error:', err.message);
    }
};

// ── Execute the action for a single step ─────────────────────────────────────
const executeStepAction = async (step, lead, sequenceName) => {
    const user = await User.findById(lead.userId).select('name companyName').lean();
    const tplContext = buildTemplateContext({
        lead,
        user
    });

    if (step.action.type === 'SEND_WHATSAPP' && lead.phone && step.action.templateId) {
        const { sendWhatsAppMessage, checkTemplateSendable } = require('./whatsappService');

        // Meta rejects anything not APPROVED, so a rejected or quality-paused
        // template was previously retried against the API on every enrolled lead.
        const gate = await checkTemplateSendable(lead.userId.toString(), step.action.templateId);
        if (!gate.ok) {
            console.warn(
                `[Sequence] Step skipped — template "${step.action.templateId}" is ${gate.reason} ` +
                `(lead ${lead._id}). Get it approved in Meta, then re-enrol.`
            );
            return;
        }

        // Recorded centrally by whatsappOutboundRecorder - note there is no
        // skipConversationRecord here any more. The hand-rolled copy that used to
        // live in this spot recorded nothing at all when the lead had no existing
        // thread (the normal case for proactive outreach), never linked the lead,
        // never derived assignedTo, and never pushed the socket events - so even a
        // stored message did not show up in an inbox that was already open.
        await sendWhatsAppMessage(
            lead.phone, step.action.templateId, lead.userId.toString(), null, gate.template?.language,
            {
                lead,
                isAutomated: true,
                automationSource: 'sequence',
                source: `Sequence: ${sequenceName}`
            }
        );

        await Lead.findByIdAndUpdate(lead._id, {
            $push: {
                history: {
                    $each: [{ type: 'WhatsApp', subType: 'Auto', content: `Sequence "${sequenceName}": WhatsApp sent`, date: new Date() }],
                    $slice: -100
                }
            }
        });
    } else if (step.action.type === 'SEND_EMAIL' && lead.email) {
        const { sendEmail } = require('./emailService');

        // The builder snapshots the chosen template's subject/body onto the step.
        // That snapshot goes stale the moment the template is edited, and is absent
        // entirely when a sequence is created through the API. An empty subject then
        // makes sendEmail throw on its FIRST line - before resolveSendPolicy and
        // recordBlocked exist - so the failure left no EmailLog row, no Inbox entry
        // and no lead history. Resolve the template live; fall back to the snapshot
        // only when the template is gone.
        let rawSubject = step.action.subject;
        let rawBody = step.action.body;

        if (step.action.emailTemplateId) {
            const EmailTemplate = require('../models/EmailTemplate');
            const tpl = await EmailTemplate.findOne({
                _id: step.action.emailTemplateId,
                userId: lead.userId   // tenant-scoped: never read another workspace's template
            }).select('subject body').lean();

            if (tpl) {
                rawSubject = tpl.subject;
                rawBody = tpl.body;
            } else {
                console.warn(
                    `[Sequence] Email template ${step.action.emailTemplateId} not found for tenant ` +
                    `${lead.userId} - falling back to the subject/body saved on the step.`
                );
            }
        }

        if (!rawSubject || !String(rawSubject).trim()) {
            throw new Error(
                `Sequence "${sequenceName}" step ${step.stepNumber}: the email has no subject ` +
                `(emailTemplateId: ${step.action.emailTemplateId || 'none'}). Re-save the step in the builder.`
            );
        }

        const subject = resolveTemplate(rawSubject, tplContext);
        const body = resolveTemplate(rawBody || '', tplContext);
        await sendEmail({
            to: lead.email,
            subject,
            html: wrapEmailHtml(body),
            bodyForInbox: body,
            userId: lead.userId,
            isAutomated: true,
            triggerType: 'sequence',
            leadId: lead._id,
            maxRetries: 1 // FIX D6: background sends retry transient SMTP failures
        });
        await Lead.findByIdAndUpdate(lead._id, {
            $push: {
                history: {
                    $each: [{ type: 'Email', subType: 'Auto', content: `Sequence "${sequenceName}": Email sent`, date: new Date() }],
                    $slice: -100
                }
            }
        });
    }
};

// ── Core Agenda job handler: process one step then schedule the next ──────────
const processSequenceStep = async (enrollmentId) => {
    if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return;

    const enrollment = await SequenceEnrollment.findById(enrollmentId);
    if (!enrollment || enrollment.status !== 'active') return;

    // 🔒 BUG-1 FIX: Skip step execution for expired tenants.
    // Enrollment stays 'active' so re-subscribing resumes the sequence.
    if (await isTenantExpired(enrollment.tenantId)) {
        console.log(`⏸️ [Sequence] Skipping step — tenant plan expired (enrollment ${enrollmentId})`);
        return;
    }

    const sequence = await Sequence.findById(enrollment.sequenceId);
    if (!sequence || !sequence.isActive) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { status: 'cancelled' });
        return;
    }

    const lead = await Lead.findById(enrollment.leadId).lean();
    if (!lead) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { status: 'cancelled' });
        return;
    }

    const step = sequence.steps[enrollment.currentStep];
    if (!step) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { status: 'completed', completedAt: new Date() });
        return;
    }

    try {
        await executeStepAction(step, lead, sequence.name);
    } catch (err) {
        console.error(`❌ [Sequence] Step ${enrollment.currentStep} failed for enrollment ${enrollmentId}:`, err.message);
        // Continue to advance — don't retry indefinitely on a bad template name.
        // The failure used to exist only in the server log, so a step that never
        // reached the customer looked exactly like one that did. Put it on the lead.
        await Lead.findByIdAndUpdate(lead._id, {
            $push: {
                history: {
                    $each: [{
                        type: step.action?.type === 'SEND_EMAIL' ? 'Email' : 'WhatsApp',
                        subType: 'Auto',
                        content: `Sequence "${sequence.name}" step ${enrollment.currentStep + 1} FAILED: ${err.message}`,
                        date: new Date()
                    }],
                    $slice: -100
                }
            }
        }).catch(() => {});
    }

    const nextStepIndex = enrollment.currentStep + 1;

    if (nextStepIndex >= sequence.steps.length) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { status: 'completed', completedAt: new Date() });
        console.log(`✅ [Sequence] Lead "${lead.name}" completed sequence "${sequence.name}"`);
    } else {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { currentStep: nextStepIndex });
        await scheduleStepJob(enrollmentId, sequence.steps[nextStepIndex].delayHours || 0);
        console.log(`📋 [Sequence] Lead "${lead.name}" → step ${nextStepIndex + 1}/${sequence.steps.length} of "${sequence.name}"`);
    }
};

// ── Pause all active sequences for a lead when they reply ────────────────────
// Called from whatsappWebhookController on every inbound message.
const pauseLeadSequences = async (leadId) => {
    try {
        const enrollments = await SequenceEnrollment.find({ leadId, status: 'active' }).lean();
        for (const enrollment of enrollments) {
            const sequence = await Sequence.findById(enrollment.sequenceId).select('stopOnReply name').lean();
            if (!sequence?.stopOnReply) continue;

            // Cancel the pending Agenda job so the next step doesn't fire
            if (enrollment.agendaJobId && globalAgendaInstance) {
                await globalAgendaInstance.cancel({ _id: enrollment.agendaJobId }).catch(() => {});
            }

            await SequenceEnrollment.findByIdAndUpdate(enrollment._id, { status: 'paused' });
            console.log(`⏸️ [Sequence] Paused "${sequence.name}" for lead ${leadId} (reply received)`);
        }
    } catch (err) {
        console.error('[Sequence] Pause error:', err.message);
    }
};

// ── Register the Agenda job definition — called from index.js ─────────────────
const defineSequenceJobs = (agenda) => {
    globalAgendaInstance = agenda;

    agenda.define('PROCESS_SEQUENCE_STEP', { concurrency: 10 }, async (job) => {
        const { enrollmentId } = job.attrs.data;
        try {
            await processSequenceStep(enrollmentId);
        } catch (err) {
            console.error(`❌ [Sequence] Agenda job failed for enrollment ${enrollmentId}:`, err.message);
            throw err; // Let Agenda retry
        }
    });
};

// scheduleStepJob is exported for sequenceController.manualEnroll, which builds
// its enrollment row directly instead of going through enrollLeadInSequences.
module.exports = { enrollLeadInSequences, pauseLeadSequences, defineSequenceJobs, scheduleStepJob };
