const Sequence = require('../models/Sequence');
const SequenceEnrollment = require('../models/SequenceEnrollment');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { replaceVariables, wrapEmailHtml } = require('../utils/emailTemplateUtils');
const { isFeatureDisabled } = require('../utils/systemConfig');

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
    await SequenceEnrollment.findByIdAndUpdate(enrollmentId, { agendaJobId: job.attrs._id });
};

// ── Enroll a lead into all sequences matching the given trigger ───────────────
// Called from leadController on lead create and stage change.
const enrollLeadInSequences = async (lead, triggerType, triggerStage = null) => {
    try {
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) return;

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
    const templateData = {
        leadName: lead.name || '',
        leadEmail: lead.email || '',
        leadPhone: lead.phone || '',
        companyName: user?.companyName || '',
        userName: user?.name || '',
        stageName: lead.status || ''
    };

    if (step.action.type === 'SEND_WHATSAPP' && lead.phone && step.action.templateId) {
        const { sendWhatsAppMessage } = require('./whatsappService');
        const result = await sendWhatsAppMessage(lead.phone, step.action.templateId, lead.userId.toString());

        // FIX: Sync to conversation DB so sequence WA sends appear in inbox
        // (previously ghost messages — sent via Meta API but not recorded)
        try {
            const waMessageId = result?.messages?.[0]?.id;
            if (waMessageId) {
                const WhatsAppConversation = require('../models/WhatsAppConversation');
                const WhatsAppMessage = require('../models/WhatsAppMessage');
                const normalizedPhone = lead.phone.replace(/[^0-9]/g, '');

                let conversation = await WhatsAppConversation.findOne({
                    userId: lead.userId,
                    waContactId: normalizedPhone
                });

                if (!conversation && normalizedPhone.length >= 10) {
                    const phoneLastTen = normalizedPhone.slice(-10);
                    conversation = await WhatsAppConversation.findOne({
                        userId: lead.userId,
                        waContactId: { $regex: phoneLastTen + '$' }
                    });
                }

                if (conversation) {
                    const messageRecord = new WhatsAppMessage({
                        conversationId: conversation._id,
                        userId: lead.userId,
                        waMessageId: waMessageId,
                        direction: 'outbound',
                        type: 'template',
                        content: { text: `[Auto] Sequence "${sequenceName}": ${step.action.templateId}`, templateName: step.action.templateId },
                        status: 'sent',
                        timestamp: new Date(),
                        isAutomated: true,
                        automationSource: 'sequence'
                    });
                    await messageRecord.save();

                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                        $set: {
                            lastMessage: `[Auto] Sequence: ${step.action.templateId}`,
                            lastMessageAt: new Date(),
                            lastMessageDirection: 'outbound'
                        },
                        $inc: {
                            'metadata.totalMessages': 1,
                            'metadata.totalOutbound': 1
                        }
                    });
                }
            }
        } catch (syncErr) {
            console.error(`⚠️ [Sequence] WA sent but DB sync failed for ${lead.phone}:`, syncErr.message);
        }

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
        const subject = replaceVariables(step.action.subject || '', templateData);
        const body = replaceVariables(step.action.body || '', templateData);
        await sendEmail({ to: lead.email, subject, html: wrapEmailHtml(body), userId: lead.userId });
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
        // Continue to advance — don't retry indefinitely on a bad template name
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

module.exports = { enrollLeadInSequences, pauseLeadSequences, defineSequenceJobs };
