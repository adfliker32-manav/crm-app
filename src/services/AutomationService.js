const AutomationRule = require('../models/AutomationRule');
const AutomationLock = require('../models/AutomationLock');
const Lead = require('../models/Lead');
const LeadAutomationWatcher = require('../models/LeadAutomationWatcher');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog'); // Required by continueWorkflowAfterVoice
const VoiceEngineService = require('./VoiceEngineService');
const { sendEmail } = require('./emailService');
const { sendWhatsAppMessage } = require('./whatsappService');
const { logActivity } = require('./auditService');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { replaceVariables, wrapEmailHtml } = require('../utils/emailTemplateUtils');
const { emitToUser } = require('./socketService');

// Prototype-safe property resolver (handles 'customData.Property' etc)
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const resolveField = (obj, path) => {
    return path.split('.').reduce((prev, curr) => {
        if (prev == null || BLOCKED_KEYS.has(curr)) return undefined;
        return Object.prototype.hasOwnProperty.call(prev, curr) ? prev[curr] : undefined;
    }, obj);
};

// Condition Evaluator
const evaluateCondition = (condition, leadValue) => {
    const { operator, value } = condition;

    // A missing field is inherently "not equal to" any concrete value — every
    // other operator (equals/contains/etc) correctly has nothing to match against.
    if (leadValue === undefined || leadValue === null) {
        return operator === 'not_equals';
    }

    // Array fields (e.g. tags): match by membership, not string comparison.
    if (Array.isArray(leadValue)) {
        const target = typeof value === 'string' ? value.toLowerCase() : value;
        const normalized = leadValue.map(v => typeof v === 'string' ? v.toLowerCase() : v);
        switch (operator) {
            case 'equals':
            case 'contains':    return normalized.includes(target);
            case 'not_equals':  return !normalized.includes(target);
            default:            return false;
        }
    }

    const s1 = typeof leadValue === 'string' ? leadValue.toLowerCase() : leadValue;
    const s2 = typeof value === 'string' ? value.toLowerCase() : value;

    switch (operator) {
        case 'equals':        return s1 === s2;
        case 'not_equals':    return s1 !== s2;
        case 'contains':      return typeof s1 === 'string' && s1.includes(s2);
        case 'greater_than':  return Number(leadValue) > Number(value);
        case 'less_than':     return Number(leadValue) < Number(value);
        default:              return false;
    }
};

// ─────────────────────────────────────────────────────────────────
// Execute all actions in a rule sequentially for a given lead.
// Handles SEND_WHATSAPP, SEND_EMAIL, CHANGE_STAGE, ASSIGN_USER,
// and the new WAIT_FOR_REPLY with conditional branching.
// ─────────────────────────────────────────────────────────────────
const executeRuleActions = async (rule, lead) => {
    try {
        console.log(`🤖 [Automation] Executing Rule: "${rule.name}" for Lead: "${lead.name}"`);
        let changesMade = false;
        const updates = {};
        const historyEntries = []; // Collect all history entries to push at once

        for (const action of rule.actions) {

            // ── SEND_WHATSAPP ──────────────────────────────────────
            if (action.type === 'SEND_WHATSAPP') {
                if (lead.phone) {
                    const templateName = action.templateId || 'hello_world';
                    const waTemplate = await WhatsAppTemplate.findOne({ userId: lead.userId, name: templateName }).lean();
                    if (!waTemplate || waTemplate.status !== 'APPROVED') {
                        console.warn(`⚠️ [Automation] SEND_WHATSAPP skipped — template "${templateName}" is not APPROVED (Rule: ${rule.name})`);
                    } else {
                        await sendWhatsAppMessage(lead.phone, templateName, lead.userId);
                        historyEntries.push({ type: 'WhatsApp', subType: 'Auto', content: `Automated WhatsApp Sent (Rule: ${rule.name})`, date: new Date() });
                        changesMade = true;
                    }
                }

            // ── SEND_EMAIL ─────────────────────────────────────────
            } else if (action.type === 'SEND_EMAIL') {
                if (lead.email) {
                    const user = await User.findById(lead.userId).select('name companyName').lean();
                    const templateData = {
                        leadName: lead.name || '',
                        leadEmail: lead.email || '',
                        leadPhone: lead.phone || '',
                        companyName: user?.companyName || '',
                        userName: user?.name || '',
                        stageName: lead.status || ''
                    };
                    const subject = replaceVariables(action.subject || '', templateData);
                    const body = replaceVariables(action.body || '', templateData);
                    await sendEmail({ to: lead.email, subject, html: wrapEmailHtml(body), userId: lead.userId });
                    historyEntries.push({ type: 'Email', subType: 'Auto', content: `Automated Email Sent (Rule: ${rule.name})`, date: new Date() });
                    changesMade = true;
                }

            // ── CHANGE_STAGE ───────────────────────────────────────
            } else if (action.type === 'CHANGE_STAGE') {
                if (lead.status !== action.stageName) {
                    updates.$set = updates.$set || {};
                    updates.$set.status = action.stageName;
                    updates.$set.stageEnteredAt = new Date();
                    historyEntries.push({ type: 'System', subType: 'Auto', content: `Stage changed to ${action.stageName} (Rule: ${rule.name})`, date: new Date() });
                    changesMade = true;
                }

            // ── ASSIGN_USER ────────────────────────────────────────
            } else if (action.type === 'ASSIGN_USER') {
                if (lead.assignedTo?.toString() !== action.userId?.toString()) {
                    updates.$set = updates.$set || {};
                    updates.$set.assignedTo = action.userId;
                    historyEntries.push({ type: 'System', subType: 'Auto', content: `Lead assigned automatically (Rule: ${rule.name})`, date: new Date() });
                    changesMade = true;

                    // Real-time notification to the assigned agent
                    if (action.userId) {
                        setImmediate(() => {
                            emitToUser(action.userId.toString(), 'lead:assigned', {
                                leadId: lead._id,
                                leadName: lead.name,
                                ruleName: rule.name,
                                message: `You have been assigned lead: ${lead.name}`,
                                timestamp: new Date()
                            });
                        });
                    }
                }

            // ── VOICE_CALL ─────────────────────────────────────────
            } else if (action.type === 'VOICE_CALL') {
                try {
                    // executeCallAction now returns { success, callLog, error } — destructure it.
                    // Truthiness-testing the whole object would treat a failed dispatch as a success.
                    const { success, error } = await VoiceEngineService.executeCallAction(
                        lead._id, lead.userId, action, { automationRuleId: rule._id }
                    );
                    if (success) {
                        historyEntries.push({ type: 'System', subType: 'Auto', content: `Initiated AI Voice Call (Mode: ${action.executionMode || 'static'}) (Rule: ${rule.name})`, date: new Date() });
                        changesMade = true;
                    } else {
                        // Surface the failure on the lead timeline instead of only the console.
                        historyEntries.push({ type: 'System', subType: 'Auto', content: `AI Voice Call failed: ${error || 'unknown error'} (Rule: ${rule.name})`, date: new Date() });
                        changesMade = true;
                    }
                } catch (e) {
                    console.error(`⚠️ [Automation] Failed to execute VOICE_CALL for rule ${rule.name}:`, e);
                }

            // ── WAIT_FOR_REPLY (New) ───────────────────────────────
            // Creates a watcher document and schedules a timeout job.
            // The watcher listens on the lead's WhatsApp conversation.
            } else if (action.type === 'WAIT_FOR_REPLY') {
                // Find the lead's active WhatsApp conversation
                const conversation = await WhatsAppConversation.findOne({
                    leadId: lead._id,
                    status: 'active'
                }).lean();

                if (!conversation) {
                    console.warn(`⚠️ [Automation] WAIT_FOR_REPLY: No active WA conversation found for lead ${lead._id}. Skipping watcher.`);
                    continue;
                }

                const waitHours = action.waitForReplyHours || 24;
                const deadline = new Date(Date.now() + waitHours * 60 * 60 * 1000);

                // Create the watcher document. The partial unique index on
                // { conversationId, status: 'pending' } is the real guard against
                // two watchers stacking on the same conversation — the app-level
                // check in evaluateLead is only a fast-path and can lose a race
                // when two different WAIT_FOR_REPLY rules fire concurrently.
                let watcher;
                try {
                    watcher = await LeadAutomationWatcher.create({
                        tenantId: lead.userId,
                        leadId: lead._id,
                        conversationId: conversation._id,
                        ruleId: rule._id,
                        waitForReplyUntil: deadline,
                        ifRepliedAction: action.ifRepliedAction || {},
                        ifNoReplyAction: action.ifNoReplyAction || {},
                        status: 'pending'
                    });
                } catch (createErr) {
                    if (createErr.code === 11000) {
                        console.warn(`⚠️ [Automation] WAIT_FOR_REPLY: Lead ${lead._id} already has a pending watcher on this conversation (race). Skipping.`);
                        continue;
                    }
                    throw createErr;
                }

                // Schedule the "no reply" timeout job via Agenda
                if (globalAgendaInstance) {
                    const job = await globalAgendaInstance.schedule(
                        deadline,
                        'CHECK_REPLY_TIMEOUT',
                        { watcherId: watcher._id.toString() }
                    );
                    // Store Agenda job ID on the watcher so we can cancel it if they reply
                    await LeadAutomationWatcher.findByIdAndUpdate(watcher._id, {
                        $set: { agendaJobId: job.attrs._id }
                    });
                }

                console.log(`⏳ [Automation] WAIT_FOR_REPLY watcher created for lead "${lead.name}" — deadline: ${deadline.toISOString()}`);

                // Add to lead history
                historyEntries.push({
                    type: 'System',
                    subType: 'Auto',
                    content: `Waiting for WhatsApp reply (Rule: ${rule.name}). Deadline: ${deadline.toISOString()}`,
                    date: new Date()
                });
                changesMade = true;

                // Stop processing further actions in this rule — the watcher branches from here
                break;
            }
        }

        // Apply any DB updates with all history entries at once
        if (changesMade) {
            if (historyEntries.length > 0) {
                updates.$push = { history: { $each: historyEntries, $slice: -100 } };
            }
            await Lead.findByIdAndUpdate(lead._id, updates);

            // CAPI: automation-driven stage change (was missing — the old automation
            // engine never reported stage transitions to Meta). `lead` in memory still
            // holds the pre-update status, so it doubles as oldStatus.
            const capiNewStatus = updates.$set?.status;
            if (capiNewStatus && capiNewStatus !== lead.status) {
                const { sendMetaEventForLead } = require('./metaConversionService');
                sendMetaEventForLead(lead, capiNewStatus, lead.status)
                    .catch(e => console.error('[Automation] Meta CAPI error (CHANGE_STAGE):', e.message));
            }
        }

        // Increment rule execution counter and release the per-(rule, lead) lock.
        // The lock only guards this synchronous execution burst — a WAIT_FOR_REPLY
        // watcher (if created above) is guarded separately by the existingWatcher
        // check in evaluateLead, so it's safe to release here immediately.
        await AutomationRule.findByIdAndUpdate(rule._id, {
            $inc: { executionCount: 1 },
            $set: { lastFiredAt: new Date() }
        });
        await AutomationLock.deleteOne({ ruleId: rule._id, leadId: lead._id });

    } catch (err) {
        // Always release lock even if execution failed
        await AutomationLock.deleteOne({ ruleId: rule._id, leadId: lead._id });
        console.error(`❌ [Automation] Execution Error on Rule (${rule.name}):`, err);
    }
};

// Global Event Hook exported to leadController/etc
let globalAgendaInstance = null;

const evaluateLead = async (lead, triggerType) => {
    try {
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) {
            console.log(`🛑 AUTOMATION KILL SWITCH ACTIVE. Blocked automation evaluation for lead: ${lead?.name}`);
            return;
        }

        if (!lead || !lead.userId) return;

        // Find totally active rules matching this exact trigger
        const rules = await AutomationRule.find({ tenantId: lead.userId, isActive: true, trigger: triggerType });
        if (!rules || rules.length === 0) return;

        for (const rule of rules) {
            // Only WAIT_FOR_REPLY rules can create a competing watcher on this lead's
            // conversation — skip the check entirely for rules that can't conflict,
            // so unrelated automations (assign, tag, stage change, etc.) still fire
            // even while this lead has an unrelated pending watcher open.
            const rulePendsOnReply = rule.actions.some(a => a.type === 'WAIT_FOR_REPLY');
            if (rulePendsOnReply) {
                const existingWatcher = await LeadAutomationWatcher.findOne({
                    leadId: lead._id,
                    status: 'pending'
                });
                if (existingWatcher) {
                    console.log(`⏭️ [Automation] Lead "${lead.name}" already has a pending watcher. Skipping rule "${rule.name}".`);
                    continue;
                }
            }

            // Acquire a per-(rule, lead) lock ATOMICALLY via a unique index — this only
            // blocks the SAME lead from double-firing the SAME rule concurrently (e.g.
            // duplicate webhook deliveries). It does NOT serialize different leads
            // through the same rule. A TTL index auto-recovers crashed/hung locks.
            try {
                await AutomationLock.create({ ruleId: rule._id, leadId: lead._id });
            } catch (lockErr) {
                if (lockErr.code === 11000) {
                    console.log(`⏭️ [Automation] Rule "${rule.name}" already processing lead "${lead.name}". Skipping.`);
                    continue;
                }
                throw lockErr;
            }

            // Check AND conditions
            let allConditionsMet = true;
            for (const condition of rule.conditions) {
                const leadValue = resolveField(lead, condition.field);
                if (!evaluateCondition(condition, leadValue)) {
                    allConditionsMet = false;
                    break;
                }
            }

            if (allConditionsMet) {
                if (rule.delayMinutes > 0 && globalAgendaInstance) {
                    // FIX: Wrap schedule in try-catch — if scheduling fails, release the lock.
                    // Previously a schedule failure left the lock permanently acquired.
                    try {
                        console.log(`🤖 [Automation] Scheduling Rule: "${rule.name}" in ${rule.delayMinutes} mins.`);
                        await globalAgendaInstance.schedule(
                            new Date(Date.now() + rule.delayMinutes * 60000),
                            'EXECUTE_AUTOMATION_ACTION',
                            { ruleId: rule._id, leadId: lead._id }
                        );
                        // Note: lock will be released when the scheduled job fires
                    } catch (scheduleErr) {
                        console.error(`❌ [Automation] Failed to schedule Rule "${rule.name}":`, scheduleErr.message);
                        await AutomationLock.deleteOne({ ruleId: rule._id, leadId: lead._id });
                    }
                } else {
                    // Execute immediately and release lock inside
                    await executeRuleActions(rule, lead);
                }
            } else {
                await AutomationLock.deleteOne({ ruleId: rule._id, leadId: lead._id });
            }
        }
    } catch (err) {
        console.error(`❌ [Automation] Evaluation Error:`, err.message);
    }
};

// Define Agenda Queue Background Workers
const defineAutomationJobs = (agenda) => {
    globalAgendaInstance = agenda;
    
    // ── Original EXECUTE_AUTOMATION_ACTION job ────────────────────
    agenda.define('EXECUTE_AUTOMATION_ACTION', async (job) => {
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) {
            console.log(`🛑 AUTOMATION KILL SWITCH ACTIVE. Blocked scheduled background job.`);
            return;
        }

        const { ruleId, leadId } = job.attrs.data;
        const attempt = (job.attrs.failCount || 0) + 1;
        const MAX_RETRIES = 3;
        
        try {
            const rule = await AutomationRule.findById(ruleId);
            const lead = await Lead.findById(leadId);
            
            if (rule && rule.isActive && lead) {
                // CRITICAL SAFETY CHECK: Does the lead STILL meet conditions?
                let stillMet = true;
                for (const condition of rule.conditions) {
                    const leadValue = resolveField(lead, condition.field);
                    if (!evaluateCondition(condition, leadValue)) {
                        stillMet = false;
                        break;
                    }
                }

                if (stillMet) {
                    await executeRuleActions(rule, lead);
                } else {
                    await AutomationLock.deleteOne({ ruleId, leadId });
                    console.log(`⏱️ [Automation] Skipped Job: Lead no longer meets criteria for Rule "${rule.name}"`);
                }
            } else {
                console.log(`⏱️ [Automation] Job skipped: rule ${ruleId} inactive or lead ${leadId} missing.`);
                await AutomationLock.deleteOne({ ruleId, leadId });
            }
        } catch (error) {
            console.error(`❌ [Automation] Background Job FAILED (attempt ${attempt}/${MAX_RETRIES}):`, error.message);

            // 🔄 RETRY: If under max retries, let Agenda retry the job
            if (attempt < MAX_RETRIES) {
                console.log(`🔄 [Automation] Will retry job for rule ${ruleId} (attempt ${attempt + 1}/${MAX_RETRIES})`);
                throw error; // Throwing lets Agenda increment failCount and reschedule
                // FIX: Do NOT call job.remove() here — Agenda needs the job to retry
            }

            // Max retries exhausted — release lock permanently and clean up
            await AutomationLock.deleteOne({ ruleId, leadId });
            console.error(`🚨 [Automation] Job PERMANENTLY FAILED after ${MAX_RETRIES} attempts. Rule: ${ruleId}, Lead: ${leadId}`);
            await job.remove();
        }
    });
};

// ─────────────────────────────────────────────────────────────────
// Exported: called by whatsappWebhookController when an inbound
// message arrives, to check if a WAIT_FOR_REPLY watcher is pending.
// ─────────────────────────────────────────────────────────────────
// FIX: Moved to a regular function (not exports.X) to avoid mixed export confusion.
const handleWatcherReply = async (conversationId) => {
    try {
        // FIX: Kill switch check — watcher reply actions should also respect the global switch
        if (await isFeatureDisabled('DISABLE_AUTOMATIONS')) {
            console.log(`🛑 AUTOMATION KILL SWITCH ACTIVE. Blocked watcher reply action.`);
            return;
        }

        // FIX: RACE CONDITION — Use atomic findOneAndUpdate to claim the watcher.
        // Previously used findOne then findByIdAndUpdate — two concurrent webhook
        // deliveries could both find the same pending watcher and both execute.
        const watcher = await LeadAutomationWatcher.findOneAndUpdate(
            { conversationId, status: 'pending' },
            { $set: { status: 'replied' } },
            { new: false } // Return the ORIGINAL document (before update) so we get the old status
        );

        if (!watcher) return; // No active watcher — normal traffic

        console.log(`✅ [Automation] Reply detected for watcher ${watcher._id} (Rule: ${watcher.ruleId})`);

        // Cancel the pending Agenda timeout job
        if (watcher.agendaJobId && globalAgendaInstance) {
            const jobs = await globalAgendaInstance.jobs({ _id: watcher.agendaJobId });
            for (const job of jobs) {
                await job.remove();
            }
            console.log(`🛑 [Automation] Cancelled no-reply timeout job for watcher ${watcher._id}`);
        }

        // Execute the ifReplied branch
        const lead = await Lead.findById(watcher.leadId);
        if (!lead) return;

        const updates = {};

        if (watcher.ifRepliedAction?.changeStage) {
            updates.$set = { status: watcher.ifRepliedAction.changeStage, stageEnteredAt: new Date() };
            updates.$push = {
                history: {
                    $each: [{
                        type: 'System',
                        subType: 'Auto',
                        content: `Lead replied! Stage changed to "${watcher.ifRepliedAction.changeStage}" by automation.`,
                        date: new Date()
                    }],
                    $slice: -100
                }
            };
        }

        if (Object.keys(updates).length > 0) {
            await Lead.findByIdAndUpdate(watcher.leadId, updates);

            // CAPI: reply-triggered stage change (was missing). `lead` was fetched
            // before the update, so lead.status is the previous stage.
            const replyStage = watcher.ifRepliedAction?.changeStage;
            if (replyStage && replyStage !== lead.status) {
                const { sendMetaEventForLead } = require('./metaConversionService');
                sendMetaEventForLead(lead, replyStage, lead.status)
                    .catch(e => console.error('[Automation] Meta CAPI error (reply changeStage):', e.message));
            }
        }

        // Send follow-up template if configured
        if (watcher.ifRepliedAction?.sendTemplateId && lead.phone) {
            await sendWhatsAppMessage(lead.phone, watcher.ifRepliedAction.sendTemplateId, lead.userId.toString());
        }

        // Release the per-(rule, lead) lock, in case it's still held
        await AutomationLock.deleteOne({ ruleId: watcher.ruleId, leadId: watcher.leadId });

        // Apply human handoff — pause chatbot for 24hrs since a human or reply happened
        const { cancelActiveChatbots } = require('./chatbotEngineService');
        await cancelActiveChatbots(conversationId.toString());

        console.log(`✅ [Automation] Watcher ${watcher._id} resolved: lead replied branch executed.`);

    } catch (err) {
        console.error('❌ [Automation] Error handling watcher reply:', err.message);
    }
};

// Cancel any pending Agenda jobs and watchers that reference a deleted rule.
// Without this, scheduled EXECUTE_AUTOMATION_ACTION jobs and CHECK_REPLY_TIMEOUT
// watchers continue to fire after the rule is gone, leading to phantom WhatsApp
// sends and orphan watcher rows that never resolve.
const cancelJobsForRule = async (ruleId) => {
    if (!ruleId) return { cancelledJobs: 0, cancelledWatchers: 0 };
    const id = ruleId.toString();
    let cancelledJobs = 0;
    let cancelledWatchers = 0;

    if (globalAgendaInstance) {
        try {
            const result = await globalAgendaInstance.cancel({
                $or: [
                    { name: 'EXECUTE_AUTOMATION_ACTION', 'data.ruleId': id },
                    { name: 'EXECUTE_AUTOMATION_ACTION', 'data.ruleId': ruleId }
                ]
            });
            cancelledJobs = typeof result === 'number' ? result : (result?.deletedCount || 0);
        } catch (err) {
            console.error('[Automation] Failed to cancel scheduled jobs for rule', id, err.message);
        }
    }

    try {
        const watchers = await LeadAutomationWatcher.find({ ruleId, status: 'pending' }).select('agendaJobId').lean();
        if (globalAgendaInstance && watchers.length > 0) {
            const jobIds = watchers.map(w => w.agendaJobId).filter(Boolean);
            if (jobIds.length > 0) {
                await globalAgendaInstance.cancel({ _id: { $in: jobIds } }).catch(() => {});
            }
        }
        const watcherResult = await LeadAutomationWatcher.updateMany(
            { ruleId, status: 'pending' },
            { $set: { status: 'cancelled' } }
        );
        cancelledWatchers = watcherResult.modifiedCount || 0;
    } catch (err) {
        console.error('[Automation] Failed to cancel watchers for rule', id, err.message);
    }

    return { cancelledJobs, cancelledWatchers };
};

/**
 * Handles the continuation of an automation workflow based on Voice Call Outcomes.
 * Called by VoiceEngineService when an outcome webhook is received.
 */
const continueWorkflowAfterVoice = async (callLog) => {
    try {
        if (!callLog.automationRuleId || !callLog.outcome) return;

        const rule = await AutomationRule.findById(callLog.automationRuleId);
        if (!rule || !rule.isActive) return;

        const lead = await Lead.findById(callLog.leadId);
        if (!lead) return;

        // Find the VOICE_CALL action in the rule that triggered this
        const voiceAction = rule.actions.find(a => a.type === 'VOICE_CALL');
        if (!voiceAction || !voiceAction.voiceOutcomes) return;

        // Check if there are specific mapped actions for this outcome
        const mappedActions = voiceAction.voiceOutcomes.get(callLog.outcome);
        if (!mappedActions || !mappedActions.length) {
            console.log(`[Automation] No mapped actions for outcome "${callLog.outcome}" on rule ${rule.name}`);
            return;
        }

        console.log(`[Automation] Continuing workflow for lead ${lead._id} on outcome: ${callLog.outcome}`);
        
        let changesMade = false;
        let historyEntries = [];
        const statusBeforeVoiceActions = lead.status; // for CAPI oldStatus (loop mutates lead.status)

        // Execute mapped branch actions
        for (const action of mappedActions) {
            if (action.type === 'CHANGE_STAGE' && action.stageName && lead.status !== action.stageName) {
                lead.status = action.stageName;
                lead.stageEnteredAt = new Date();
                historyEntries.push({ type: 'System', subType: 'Auto', content: `Changed stage to ${action.stageName} due to Voice Outcome: ${callLog.outcome} (Rule: ${rule.name})`, date: new Date() });
                changesMade = true;
            } else if (action.type === 'ASSIGN_USER' && action.userId) {
                // Similar to standard ASSIGN_USER
                if (!lead.assignedTo || lead.assignedTo.toString() !== action.userId.toString()) {
                    lead.assignedTo = action.userId;
                    historyEntries.push({ type: 'System', subType: 'Auto', content: `Assigned user due to Voice Outcome: ${callLog.outcome} (Rule: ${rule.name})`, date: new Date() });
                    changesMade = true;
                }
            }
        }

        if (changesMade) {
            if (historyEntries.length > 0) lead.history.push(...historyEntries);
            await lead.save();
            await ActivityLog.create({
                userId: lead.userId,
                leadId: lead._id,
                actionType: 'LEAD_EDITED',
                changes: { source: 'Voice Workflow Continuation', outcome: callLog.outcome },
                userName: 'System Automation',
                ipAddress: 'System'
            });

            // CAPI: voice-outcome stage change (was missing)
            if (lead.status !== statusBeforeVoiceActions) {
                const { sendMetaEventForLead } = require('./metaConversionService');
                sendMetaEventForLead(lead, lead.status, statusBeforeVoiceActions)
                    .catch(e => console.error('[Automation] Meta CAPI error (voice CHANGE_STAGE):', e.message));
            }
        }
    } catch (err) {
        console.error(`⚠️ [Automation] Failed to continue workflow after voice call:`, err);
    }
};

module.exports = {
    evaluateLead,
    defineAutomationJobs,
    handleWatcherReply,
    cancelJobsForRule,
    continueWorkflowAfterVoice
};
