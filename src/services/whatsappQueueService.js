const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// whatsappQueueService
// ─────────────────────────────────────────────────────────────────────────────
// This module does NOT create its own Agenda instance.
// It registers job definitions onto the SHARED agenda instance provided by
// index.js (which owns the single authoritative Agenda connected to MongoDB).
//
// Pattern:
//   index.js creates agenda → calls defineWhatsAppJobs(agenda)
//   → all job handlers are registered before agenda.start()
//   → scheduleDelayNode() uses the shared agenda reference to enqueue jobs
// ─────────────────────────────────────────────────────────────────────────────

let sharedAgenda = null; // Set by defineWhatsAppJobs() at boot

/**
 * Called from index.js BEFORE agenda.start().
 * Registers all job definitions on the shared agenda instance.
 */
const defineWhatsAppJobs = (agenda) => {
    sharedAgenda = agenda;

    // ── Job 1: resume-chatbot-session ────────────────────────────────────────
    // Fires when a chatbot delay node timer expires OR a no-reply timeout fires.
    // Resumes the flow from the next node after the delay.
    agenda.define('resume-chatbot-session', { priority: 'normal', concurrency: 10 }, async (job) => {
        const { sessionId, flowId, nextNodeId, cancelIfReplied, scheduledAt, isNoReplyTimeout, questionNodeId } = job.attrs.data;
        try {
            const ChatbotSession = mongoose.model('ChatbotSession');
            const chatbotEngineService = require('./chatbotEngineService');

            const session = await ChatbotSession.findById(sessionId);

            if (!session || session.status !== 'active') {
                console.log(`⏱️ [Queue] Skipping delayed node ${nextNodeId} — session ${sessionId} no longer active`);
                await job.remove();
                return;
            }

            // ── No-Reply Timeout Guard ────────────────────────────────────────
            // If this job was scheduled as a no-reply timeout on a question node,
            // skip it if the customer already answered (session moved past that node).
            // Atomic check-and-update: prevents a race where a near-simultaneous
            // customer reply would otherwise cause the next node to run twice.
            if (isNoReplyTimeout && questionNodeId) {
                const advanced = await ChatbotSession.findOneAndUpdate(
                    { _id: sessionId, currentNodeId: questionNodeId, status: 'active' },
                    { $set: { currentNodeId: nextNodeId } },
                    { new: true }
                );
                if (!advanced) {
                    console.log(`⏱️ [Queue] No-reply timeout for node ${questionNodeId} skipped — customer already replied or session inactive`);
                    await job.remove();
                    return;
                }
                console.log(`⏱️ [Queue] No-reply timeout fired for question node ${questionNodeId} — advancing session to ${nextNodeId}`);
                const ChatbotFlow = mongoose.model('ChatbotFlow');
                const flow = await ChatbotFlow.findById(flowId).lean();
                if (flow && Array.isArray(flow.nodes) && chatbotEngineService.resumeExecution) {
                    await chatbotEngineService.resumeExecution(advanced, flow, nextNodeId);
                }
                await job.remove();
                return;
            }

            // ── "Cancel If Replied" Guard ─────────────────────────────────────
            // Fetch the flow once — used by both the cancel path and the normal path.
            const ChatbotFlow = mongoose.model('ChatbotFlow');
            const flow = await ChatbotFlow.findById(flowId).lean();

            if (!flow || !Array.isArray(flow.nodes)) {
                await job.remove();
                return;
            }

            // If the node was configured with cancelIfReplied=true AND the
            // customer sent a message AFTER this delay was scheduled, skip the
            // delayed message (but still advance the session to nextNodeId so
            // the flow continues from the correct point).
            if (cancelIfReplied && session.lastCustomerReplyAt && scheduledAt) {
                const repliedAfterSchedule = new Date(session.lastCustomerReplyAt) > new Date(scheduledAt);
                if (repliedAfterSchedule) {
                    console.log(`⏱️ [Queue] Delay node CANCELLED — customer replied at ${session.lastCustomerReplyAt} (after schedule time ${scheduledAt}). Advancing session without sending.`);
                    session.currentNodeId = nextNodeId;
                    await session.save();
                    // Still advance the flow so the next node executes normally
                    if (chatbotEngineService.resumeExecution) {
                        await chatbotEngineService.resumeExecution(session, flow, nextNodeId);
                    }
                    await job.remove();
                    return;
                }
            }

            // Normal path — delay expired, customer did NOT reply → send the message
            session.currentNodeId = nextNodeId;
            await session.save();

            console.log(`⏱️ [Queue] Resuming delayed node ${nextNodeId} for session ${sessionId}`);

            if (chatbotEngineService.resumeExecution) {
                await chatbotEngineService.resumeExecution(session, flow, nextNodeId);
            }
        } catch (err) {
            console.error('❌ [Queue] resume-chatbot-session failed:', err.message);
        }
        // Always clean up completed job (prevent DB bloat)
        await job.remove();
    });

    // ── Job 2: CHECK_REPLY_TIMEOUT ────────────────────────────────────────────
    // Fires when a WAIT_FOR_REPLY automation window expires.
    // If the lead still hasn't replied → executes ifNoReplyAction branch.
    agenda.define('CHECK_REPLY_TIMEOUT', { priority: 'high', concurrency: 5 }, async (job) => {
        const { watcherId } = job.attrs.data;
        try {
            const LeadAutomationWatcher = require('../models/LeadAutomationWatcher');
            const Lead = require('../models/Lead');
            const AutomationLock = require('../models/AutomationLock');
            const { sendWhatsAppMessage } = require('./whatsappService');

            const watcher = await LeadAutomationWatcher.findById(watcherId);

            if (!watcher || watcher.status !== 'pending') {
                console.log(`⏱️ [Timeout] Watcher ${watcherId} already resolved (${watcher?.status}). Skipping.`);
                await job.remove();
                return;
            }

            // Mark as expired immediately (idempotency guard)
            await LeadAutomationWatcher.findByIdAndUpdate(watcherId, { $set: { status: 'expired' } });

            const lead = await Lead.findById(watcher.leadId);
            if (!lead) { await job.remove(); return; }

            const updates = {};

            if (watcher.ifNoReplyAction?.changeStage) {
                updates.$set = { status: watcher.ifNoReplyAction.changeStage, stageEnteredAt: new Date() };
                updates.$push = {
                    history: {
                        $each: [{
                            type: 'System', subType: 'Auto',
                            content: `No reply received. Stage moved to "${watcher.ifNoReplyAction.changeStage}" by automation.`,
                            date: new Date()
                        }],
                        $slice: -100
                    }
                };
                await Lead.findByIdAndUpdate(watcher.leadId, updates);
            }

            if (watcher.ifNoReplyAction?.sendTemplateId && lead.phone) {
                const result = await sendWhatsAppMessage(lead.phone, watcher.ifNoReplyAction.sendTemplateId, watcher.tenantId.toString());
                console.log(`📤 [Timeout] No-reply follow-up template sent to ${lead.phone}`);

                // FIX: Sync the no-reply template to conversation DB (was a ghost message)
                try {
                    const waMessageId = result?.messages?.[0]?.id;
                    if (waMessageId) {
                        const WhatsAppConversation = require('../models/WhatsAppConversation');
                        const WhatsAppMessage = require('../models/WhatsAppMessage');
                        const normalizedPhone = lead.phone.replace(/[^0-9]/g, '');

                        let conversation = await WhatsAppConversation.findOne({
                            userId: watcher.tenantId,
                            waContactId: { $regex: normalizedPhone.slice(-10) + '$' }
                        });

                        if (conversation) {
                            const messageRecord = new WhatsAppMessage({
                                conversationId: conversation._id,
                                userId: watcher.tenantId,
                                waMessageId: waMessageId,
                                direction: 'outbound',
                                type: 'template',
                                content: { text: `[Auto] No-reply follow-up: ${watcher.ifNoReplyAction.sendTemplateId}` },
                                status: 'sent',
                                timestamp: new Date(),
                                isAutomated: true,
                                automationSource: 'automation'
                            });
                            await messageRecord.save();

                            await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                                $set: {
                                    lastMessage: `[Auto] No-reply follow-up`,
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
                    console.error(`⚠️ [Timeout] No-reply template sent but DB sync failed:`, syncErr.message);
                }
            }

            // Release the per-(rule, lead) automation lock
            await AutomationLock.deleteOne({ ruleId: watcher.ruleId, leadId: watcher.leadId });

            console.log(`⏱️ [Timeout] Watcher expired → lead "${lead.name}" → stage "${watcher.ifNoReplyAction?.changeStage}"`);
        } catch (err) {
            console.error('❌ [Timeout] CHECK_REPLY_TIMEOUT failed:', err.message);
        }
        await job.remove();
    });

    console.log('✅ [Queue] WhatsApp job definitions registered (resume-chatbot-session, CHECK_REPLY_TIMEOUT)');
};

/**
 * Schedule a delay node job. Called by chatbotEngineService when it hits a 'delay' node.
 * @param {string} sessionId - ChatbotSession ObjectId
 * @param {string} flowId    - ChatbotFlow ObjectId
 * @param {string} nextNodeId - Node to resume after delay
 * @param {number} delaySeconds - How many seconds to wait
 */
exports.scheduleDelayNode = async (sessionId, flowId, nextNodeId, delaySeconds, cancelIfReplied = true) => {
    if (!sharedAgenda) {
        console.error('❌ [Queue] scheduleDelayNode called but sharedAgenda not initialized. Was defineWhatsAppJobs() called?');
        return;
    }
    try {
        const scheduledAt = new Date();
        const runAt = new Date(Date.now() + delaySeconds * 1000);
        await sharedAgenda.schedule(runAt, 'resume-chatbot-session', {
            sessionId,
            flowId,
            nextNodeId,
            cancelIfReplied,   // passed through to the job handler
            scheduledAt        // exact moment the delay was created
        });
        console.log(`⏱️ [Queue] Scheduled delay for node ${nextNodeId} in ${delaySeconds}s (cancelIfReplied=${cancelIfReplied})`);
    } catch (err) {
        console.error('❌ [Queue] scheduleDelayNode error:', err.message);
    }
};

/**
 * Schedule a no-reply timeout on a question node.
 * If the customer doesn't reply within timeoutSeconds, the flow auto-advances to nextNodeId.
 */
exports.scheduleNoReplyTimeout = async (sessionId, flowId, questionNodeId, nextNodeId, timeoutSeconds) => {
    if (!sharedAgenda) {
        console.error('❌ [Queue] scheduleNoReplyTimeout called but sharedAgenda not initialized.');
        return;
    }
    try {
        const runAt = new Date(Date.now() + timeoutSeconds * 1000);
        await sharedAgenda.schedule(runAt, 'resume-chatbot-session', {
            sessionId,
            flowId,
            nextNodeId,
            isNoReplyTimeout: true,
            questionNodeId
        });
        console.log(`⏱️ [Queue] No-reply timeout scheduled for question node ${questionNodeId} → ${nextNodeId} in ${timeoutSeconds}s`);
    } catch (err) {
        console.error('❌ [Queue] scheduleNoReplyTimeout error:', err.message);
    }
};

/**
 * Cancel a pending no-reply timeout for a specific session + question node.
 * Called when the customer actually replies before the timeout fires.
 */
exports.cancelNoReplyTimeout = async (sessionId, questionNodeId) => {
    if (!sharedAgenda) return;
    try {
        const removed = await sharedAgenda.cancel({
            name: 'resume-chatbot-session',
            'data.sessionId': sessionId,
            'data.isNoReplyTimeout': true,
            'data.questionNodeId': questionNodeId
        });
        if (removed > 0) {
            console.log(`✅ [Queue] Cancelled no-reply timeout for session ${sessionId} node ${questionNodeId}`);
        }
    } catch (err) {
        console.error('❌ [Queue] cancelNoReplyTimeout error:', err.message);
    }
};

exports.defineWhatsAppJobs = defineWhatsAppJobs;
