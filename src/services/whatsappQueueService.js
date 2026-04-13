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
    // Fires when a chatbot delay node timer expires.
    // Resumes the flow from the next node after the delay.
    agenda.define('resume-chatbot-session', { priority: 'normal', concurrency: 10 }, async (job) => {
        const { sessionId, flowId, nextNodeId } = job.attrs.data;
        try {
            const ChatbotSession = mongoose.model('ChatbotSession');
            const chatbotEngineService = require('./chatbotEngineService');

            const session = await ChatbotSession.findById(sessionId);

            if (!session || session.status !== 'active') {
                console.log(`⏱️ [Queue] Skipping delayed node ${nextNodeId} — session ${sessionId} no longer active`);
                await job.remove();
                return;
            }

            const ChatbotFlow = mongoose.model('ChatbotFlow');
            const flow = await ChatbotFlow.findById(flowId).lean();

            if (!flow || !Array.isArray(flow.nodes)) {
                await job.remove();
                return;
            }

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
            const AutomationRule = require('../models/AutomationRule');
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
                updates.$set = { status: watcher.ifNoReplyAction.changeStage };
                updates.$push = {
                    history: {
                        type: 'System', subType: 'Auto',
                        content: `No reply received. Stage moved to "${watcher.ifNoReplyAction.changeStage}" by automation.`,
                        date: new Date()
                    }
                };
                await Lead.findByIdAndUpdate(watcher.leadId, updates);
            }

            if (watcher.ifNoReplyAction?.sendTemplateId && lead.phone) {
                await sendWhatsAppMessage(lead.phone, watcher.ifNoReplyAction.sendTemplateId, watcher.tenantId.toString());
                console.log(`📤 [Timeout] No-reply follow-up template sent to ${lead.phone}`);
            }

            // Release the one-at-a-time automation lock
            await AutomationRule.findByIdAndUpdate(watcher.ruleId, {
                $set: { currentlyProcessingLeadId: null }
            });

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
exports.scheduleDelayNode = async (sessionId, flowId, nextNodeId, delaySeconds) => {
    if (!sharedAgenda) {
        console.error('❌ [Queue] scheduleDelayNode called but sharedAgenda not initialized. Was defineWhatsAppJobs() called?');
        return;
    }
    try {
        const runAt = new Date(Date.now() + delaySeconds * 1000);
        await sharedAgenda.schedule(runAt, 'resume-chatbot-session', { sessionId, flowId, nextNodeId });
        console.log(`⏱️ [Queue] Scheduled delay for node ${nextNodeId} in ${delaySeconds}s`);
    } catch (err) {
        console.error('❌ [Queue] scheduleDelayNode error:', err.message);
    }
};

exports.defineWhatsAppJobs = defineWhatsAppJobs;
