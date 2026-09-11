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
    // Returning quietly here left an 'active' enrollment with no job behind it: the
    // lead waits at that step forever, and since enrolment skips any lead already
    // active in the sequence, it can never be retried either. Throwing lets the two
    // callers roll their row back (manualEnroll already does; see below).
    if (!globalAgendaInstance) {
        throw new Error('Sequence scheduler unavailable (Agenda not initialised) - step was not scheduled');
    }
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

            let enrollment;
            try {
                enrollment = await SequenceEnrollment.create({
                    tenantId: lead.userId,
                    sequenceId: seq._id,
                    leadId: lead._id,
                    currentStep: 0,
                    currentStepId: seq.steps[0].stepId || null,
                    status: 'active',
                    enrolledAt: new Date()
                });
            } catch (createErr) {
                // uniq_active_enrollment. The find-then-create check above loses the
                // race whenever two triggers land together - a lead created straight
                // into a stage fires LEAD_CREATED and STAGE_CHANGED back to back - and
                // the loser used to become a second enrollment that sent every step
                // twice. The database settles it now; this branch is the loser.
                if (createErr?.code === 11000) {
                    console.log(`[Sequence] "${seq.name}" already has a live enrollment for lead ${lead._id} - skipping duplicate`);
                    continue;
                }
                throw createErr;
            }

            // Schedule step 0 (may fire immediately if delayHours === 0). The row has
            // to exist first - scheduling needs its _id - so a failure here has to undo
            // it, or the lead is stuck 'active' at step 0 and blocked from re-enrolling
            // forever. Other sequences in this loop are unaffected.
            try {
                await scheduleStepJob(enrollment._id, seq.steps[0].delayHours || 0);
            } catch (scheduleErr) {
                await SequenceEnrollment.deleteOne({ _id: enrollment._id }).catch(() => {});
                console.error(`[Sequence] Could not schedule "${seq.name}" for lead ${lead._id}: ${scheduleErr.message}`);
                continue;
            }

            // Counted only once the enrolment is real and scheduled.
            await Sequence.findByIdAndUpdate(seq._id, { $inc: { enrollmentCount: 1 } });

            console.log(`📋 [Sequence] Lead "${lead.name}" enrolled in "${seq.name}" (trigger: ${triggerType})`);
        }
    } catch (err) {
        console.error('[Sequence] Enrollment error:', err.message);
    }
};

// ── A step that sent nothing must say so on the lead ──────────────────────────
// Every silent exit from executeStepAction goes through here. Until it did, a step
// that never reached the customer was indistinguishable from one that did: the only
// trace was a line in the server log, so "the email went out but the WhatsApp did
// not" was invisible from the CRM.
const recordStepSkipped = async (lead, step, sequenceName, why) => {
    const isEmailStep = step.action?.type === 'SEND_EMAIL';
    console.warn(
        `[Sequence] "${sequenceName}" step ${step.stepNumber} skipped for lead ${lead._id} - ${why}`
    );
    await Lead.findByIdAndUpdate(lead._id, {
        $push: {
            history: {
                $each: [{
                    type: isEmailStep ? 'Email' : 'WhatsApp',
                    subType: 'Auto',
                    content: `Sequence "${sequenceName}" step ${step.stepNumber} skipped - ${why}`,
                    date: new Date()
                }],
                $slice: -100
            }
        }
    }).catch(() => {});
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
            // THE silent one. A template that is no longer APPROVED (Meta paused or
            // rejected it after the step was built) stopped the send here and wrote
            // nothing anywhere the user could see - the sequence just appeared to
            // skip WhatsApp while the email steps went out normally.
            await recordStepSkipped(
                lead, step, sequenceName,
                `the WhatsApp template "${step.action.templateId}" is ${String(gate.reason).replace('status_', '')} ` +
                `in this workspace. Get it approved in Meta and re-sync templates, then re-enrol the lead.`
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

        // A step keeps the setup for BOTH channels (see Sequence.StepSchema), and the
        // email half keeps both composers, so emailTemplateId can still be present on
        // a step whose email was last edited in Custom mode. emailMode is what decides.
        // Only fall back to "a template id means template mode" for rows written
        // before that field existed - which is exactly how they behaved when saved.
        const usesEmailTemplate = step.action.emailMode
            ? step.action.emailMode === 'template'
            : !!step.action.emailTemplateId;

        if (usesEmailTemplate && step.action.emailTemplateId) {
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
    } else {
        // Neither branch could run - almost always a lead with no phone (WhatsApp
        // step) or no email address (Email step).
        const why = step.action.type === 'SEND_EMAIL'
            ? 'the lead has no email address'
            : (!lead.phone ? 'the lead has no phone number' : 'the step has no WhatsApp template');
        await recordStepSkipped(lead, step, sequenceName, why);
    }
};

// ── Which step does this enrollment run right now? ────────────────────────────
// The array index is re-derived from the step's stable id on every firing, so a
// sequence edited while leads are mid-flight no longer slides them onto someone
// else's message. Pure and synchronous - the behaviour is covered directly by
// tests/sequences/sequence-live-editing.test.js.
//
// reason:
//   'id'        - found by stepId, run it (the normal path)
//   'index'     - enrollment predates stepId, fall back to the old index lookup
//   'recovered' - its step was deleted; resume after the last step it processed
//   'duplicate' - already processed; a second job for the same step, do nothing
//   'completed' - nothing left to run
const resolveStepToRun = (sequence, enrollment) => {
    const steps = sequence?.steps || [];
    const processed = new Set(enrollment?.processedStepIds || []);
    const done = { step: null, index: -1, reason: 'completed' };

    // Enrollments written before steps carried ids have only their position.
    if (!enrollment?.currentStepId) {
        const step = steps[enrollment?.currentStep];
        return step ? { step, index: enrollment.currentStep, reason: 'index' } : done;
    }

    const i = steps.findIndex(s => s.stepId === enrollment.currentStepId);
    if (i !== -1) {
        return processed.has(enrollment.currentStepId)
            ? { step: null, index: i, reason: 'duplicate' }
            : { step: steps[i], index: i, reason: 'id' };
    }

    // The step this lead was waiting on was deleted. Pick up after the last step
    // they actually went through - never re-send one, never rewind to a step that
    // merely slid into the old index.
    let lastProcessedIdx = -1;
    steps.forEach((s, k) => { if (s.stepId && processed.has(s.stepId)) lastProcessedIdx = k; });
    const j = steps.findIndex((s, k) => k > lastProcessedIdx && s.stepId && !processed.has(s.stepId));
    return j === -1 ? done : { step: steps[j], index: j, reason: 'recovered' };
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
    if (!sequence) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, {
            status: 'cancelled',
            lastError: 'the sequence was deleted'
        });
        return;
    }

    // Switching a sequence off used to CANCEL everyone still inside it, one by one,
    // as their steps came due - so a sequence paused for an hour quietly destroyed
    // every lead mid-flight, and switching it back on resumed nobody. Hold them
    // instead; reactivating the sequence releases exactly this set (see
    // resumeEnrollmentsForSequence).
    if (!sequence.isActive) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, {
            status: 'paused',
            pauseReason: 'sequence_inactive'
        });
        console.log(`⏸️ [Sequence] Held "${sequence.name}" for enrollment ${enrollmentId} - sequence is switched off`);
        return;
    }

    const lead = await Lead.findById(enrollment.leadId).lean();
    if (!lead) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { status: 'cancelled' });
        return;
    }

    const { step, index, reason } = resolveStepToRun(sequence, enrollment);

    // A second job for a step this enrollment already went through - an Agenda
    // retry, a recovery sweep racing the original, a double schedule. Do nothing:
    // the firing that processed it also scheduled what comes next.
    if (reason === 'duplicate') {
        console.log(`↩️ [Sequence] Ignoring duplicate job for enrollment ${enrollmentId} (step already processed)`);
        return;
    }

    if (!step) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { status: 'completed', completedAt: new Date() });
        return;
    }

    if (reason === 'recovered') {
        console.warn(
            `⚠️ [Sequence] Step "${enrollment.currentStepId}" of "${sequence.name}" was deleted while ` +
            `enrollment ${enrollmentId} waited on it - resuming at step ${index + 1}`
        );
    }

    try {
        await executeStepAction(step, lead, sequence.name);
    } catch (err) {
        console.error(`❌ [Sequence] Step ${index} failed for enrollment ${enrollmentId}:`, err.message);
        // Continue to advance — don't retry indefinitely on a bad template name.
        // The failure used to exist only in the server log, so a step that never
        // reached the customer looked exactly like one that did. Put it on the lead.
        await Lead.findByIdAndUpdate(lead._id, {
            $push: {
                history: {
                    $each: [{
                        type: step.action?.type === 'SEND_EMAIL' ? 'Email' : 'WhatsApp',
                        subType: 'Auto',
                        content: `Sequence "${sequence.name}" step ${index + 1} FAILED: ${err.message}`,
                        date: new Date()
                    }],
                    $slice: -100
                }
            }
        }).catch(() => {});
    }

    // Recorded whether the send succeeded or failed: either way this step is spent,
    // and it is what stops a duplicate job from sending it again.
    const markProcessed = step.stepId ? { $addToSet: { processedStepIds: step.stepId } } : {};

    // Position is read from the array as it exists NOW. The next firing resolves by
    // id again, so an edit landing between here and then is still handled - only the
    // delay can go stale, never the message.
    const nextStepIndex = index + 1;
    const nextStep = sequence.steps[nextStepIndex];

    if (!nextStep) {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, {
            $set: { status: 'completed', completedAt: new Date(), currentStep: nextStepIndex, currentStepId: null },
            ...markProcessed
        });
        console.log(`✅ [Sequence] Lead "${lead.name}" completed sequence "${sequence.name}"`);
    } else {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, {
            $set: {
                currentStep: nextStepIndex,
                currentStepId: nextStep.stepId || null,
                // A step that advanced under its own power is not stalled any more.
                recoveryCount: 0
            },
            ...markProcessed
        });
        await scheduleStepJob(enrollmentId, nextStep.delayHours || 0);
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

            await SequenceEnrollment.findByIdAndUpdate(enrollment._id, {
                status: 'paused',
                pauseReason: 'reply'
            });
            console.log(`⏸️ [Sequence] Paused "${sequence.name}" for lead ${leadId} (reply received)`);
        }
    } catch (err) {
        console.error('[Sequence] Pause error:', err.message);
    }
};

// ── Put a paused enrollment back to work ─────────────────────────────────────
// Nothing used to move an enrollment out of 'paused': a lead who replied once was
// out of that sequence for good, because enrolment also skips leads that are
// already active, completed or paused. The step was already due when it paused,
// so it is scheduled immediately rather than re-waiting its delay.
const resumeEnrollment = async (enrollmentId) => {
    const enrollment = await SequenceEnrollment.findById(enrollmentId);
    if (!enrollment) return { ok: false, reason: 'not_found' };
    if (enrollment.status === 'active') return { ok: true, reason: 'already_active' };
    if (enrollment.status !== 'paused') return { ok: false, reason: enrollment.status };

    try {
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, {
            status: 'active',
            pauseReason: null,
            lastError: null,
            recoveryCount: 0
        });
    } catch (err) {
        // uniq_active_enrollment: the lead picked up a fresh enrollment in this
        // sequence while this one sat paused. Two live rows would send everything
        // twice, so this one stays where it is.
        if (err?.code === 11000) return { ok: false, reason: 'duplicate_active' };
        throw err;
    }

    try {
        await scheduleStepJob(enrollmentId, 0);
    } catch (scheduleErr) {
        // Same all-or-nothing rule as enrolment: 'active' with no job is a lead
        // frozen mid-sequence with no way back.
        await SequenceEnrollment.findByIdAndUpdate(enrollmentId, {
            status: 'paused',
            pauseReason: enrollment.pauseReason || 'manual',
            lastError: scheduleErr.message
        }).catch(() => {});
        return { ok: false, reason: 'schedule_failed', message: scheduleErr.message };
    }

    return { ok: true };
};

// ── Release everyone a switched-off sequence was holding ──────────────────────
// Called when a sequence goes inactive → active. Leads paused by their own reply
// are deliberately left alone: that pause was about the lead, not the sequence.
const resumeEnrollmentsForSequence = async (sequenceId) => {
    const held = await SequenceEnrollment.find(
        { sequenceId, status: 'paused', pauseReason: 'sequence_inactive' },
        { _id: 1 }
    ).lean();

    let resumed = 0;
    for (const row of held) {
        const result = await resumeEnrollment(row._id).catch(err => ({ ok: false, reason: err.message }));
        if (result.ok) resumed++;
        else console.warn(`[Sequence] Could not resume enrollment ${row._id}: ${result.reason}`);
    }
    if (held.length) {
        console.log(`▶️ [Sequence] Reactivated ${sequenceId}: resumed ${resumed}/${held.length} held enrollments`);
    }
    return { held: held.length, resumed };
};

// ── Recover enrollments whose step job never ran ──────────────────────────────
// Agenda is created with no retry policy, so a job that throws is simply marked
// failed: the enrollment stays 'active' with a nextStepAt in the past and no job
// behind it, and nothing ever looks at it again. Same outcome if the process dies
// mid-step or the job row is purged. This sweep is the only thing that notices.
//
// Re-firing a step that did run is harmless - processedStepIds makes the second
// job a no-op - and scheduleStepJob rewrites nextStepAt, so a recovered row drops
// straight back out of this query instead of being swept again next tick.
const STALL_GRACE_MINUTES = 10;
const MAX_STEP_RECOVERIES = 5;

const recoverStalledEnrollments = async ({
    graceMinutes = STALL_GRACE_MINUTES,
    maxRecoveries = MAX_STEP_RECOVERIES,
    limit = 200
} = {}) => {
    const summary = { scanned: 0, rescheduled: 0, abandoned: 0, skippedExpired: 0 };
    if (!globalAgendaInstance) return summary;
    if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return summary;

    const cutoff = new Date(Date.now() - graceMinutes * 60 * 1000);
    const stalled = await SequenceEnrollment.find(
        { status: 'active', nextStepAt: { $ne: null, $lt: cutoff } },
        { _id: 1, recoveryCount: 1, tenantId: 1 }
    ).limit(limit).lean();

    summary.scanned = stalled.length;

    // processSequenceStep deliberately returns without rescheduling for an expired
    // tenant, leaving nextStepAt in the past - which looks exactly like a stalled
    // enrollment. Recovering those would burn the retry budget and then cancel the
    // very enrollments that are supposed to survive until the plan is renewed.
    const expiredTenants = new Map();
    const tenantExpired = async (tenantId) => {
        const key = String(tenantId);
        if (!expiredTenants.has(key)) expiredTenants.set(key, await isTenantExpired(tenantId));
        return expiredTenants.get(key);
    };

    for (const row of stalled) {
        try {
            if (await tenantExpired(row.tenantId)) {
                summary.skippedExpired++;
                continue;
            }
            // Bounded: a step that can never be scheduled must not churn forever.
            if ((row.recoveryCount || 0) >= maxRecoveries) {
                await SequenceEnrollment.findByIdAndUpdate(row._id, {
                    status: 'cancelled',
                    lastError: `step could not be scheduled after ${maxRecoveries} recovery attempts`
                });
                summary.abandoned++;
                console.error(`❌ [Sequence] Gave up on enrollment ${row._id} after ${maxRecoveries} recovery attempts`);
                continue;
            }

            await SequenceEnrollment.findByIdAndUpdate(row._id, { $inc: { recoveryCount: 1 } });
            await scheduleStepJob(row._id, 0);
            summary.rescheduled++;
        } catch (err) {
            console.error(`[Sequence] Recovery failed for enrollment ${row._id}:`, err.message);
        }
    }

    if (summary.rescheduled || summary.abandoned) {
        console.log(
            `🔧 [Sequence] Stall sweep: ${summary.rescheduled} re-scheduled, ` +
            `${summary.abandoned} abandoned (of ${summary.scanned} overdue)`
        );
    }
    return summary;
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
module.exports = {
    enrollLeadInSequences,
    pauseLeadSequences,
    defineSequenceJobs,
    scheduleStepJob,
    // resolveStepToRun is exported for its unit tests: it is the whole of the
    // live-editing behaviour and is pure, so it can be tested without a database.
    resolveStepToRun,
    resumeEnrollment,
    resumeEnrollmentsForSequence,
    recoverStalledEnrollments
};
