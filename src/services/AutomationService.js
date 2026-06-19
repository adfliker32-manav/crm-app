const AutomationRule = require('../models/AutomationRule');
const Lead = require('../models/Lead');
const LeadAutomationWatcher = require('../models/LeadAutomationWatcher');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');
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

// Condition Evaluator — returns false if the lead field is missing/undefined
const evaluateCondition = (condition, leadValue) => {
    if (leadValue === undefined || leadValue === null) return false;

    const { operator, value } = condition;
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

                // Create the watcher document
                const watcher = await LeadAutomationWatcher.create({
                    tenantId: lead.userId,
                    leadId: lead._id,
                    conversationId: conversation._id,
                    ruleId: rule._id,
                    waitForReplyUntil: deadline,
                    ifRepliedAction: action.ifRepliedAction || {},
                    ifNoReplyAction: action.ifNoReplyAction || {},
                    status: 'pending'
                });

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
        }

        // Increment rule execution counter and release the one-at-a-time lock
        await AutomationRule.findByIdAndUpdate(rule._id, {
            $inc: { executionCount: 1 },
            $set: {
                lastFiredAt: new Date(),
                currentlyProcessingLeadId: null,
                lockAcquiredAt: null
            }
        });

    } catch (err) {
        // Always release lock even if execution failed
        await AutomationRule.findByIdAndUpdate(rule._id, {
            $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
        });
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
            // ─── STALE LOCK RECOVERY ──────────────────────────────
            // Use lockAcquiredAt (set at lock time) not lastFiredAt (set only on success).
            // Without this, a rule that has never fired would never auto-recover.
            if (rule.currentlyProcessingLeadId) {
                const lockAge = rule.lockAcquiredAt
                    ? Date.now() - new Date(rule.lockAcquiredAt).getTime()
                    : Infinity; // No timestamp → definitely stale
                const ONE_HOUR = 60 * 60 * 1000;
                if (lockAge > ONE_HOUR) {
                    console.warn(`⚠️ [Automation] Stale lock on rule "${rule.name}" (held ${Math.round(lockAge / 60000)}min). Releasing.`);
                    await AutomationRule.findByIdAndUpdate(rule._id, {
                        $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
                    });
                } else {
                    console.log(`⏭️ [Automation] Rule "${rule.name}" locked (acquired ${Math.round(lockAge / 60000)}min ago). Skipping.`);
                    continue;
                }
            }

            // ALSO: if there's already an active watcher for this LEAD, skip —
            // we don't stack multiple automations on the same lead simultaneously.
            const existingWatcher = await LeadAutomationWatcher.findOne({
                leadId: lead._id,
                status: 'pending'
            });
            if (existingWatcher) {
                console.log(`⏭️ [Automation] Lead "${lead.name}" already has a pending watcher. Skipping rule "${rule.name}".`);
                continue;
            }

            // ⚠️ RACE CONDITION FIX: Acquire lock ATOMICALLY.
            // Previously the check (if locked) and acquire (set lock) were separate operations.
            // Two concurrent requests could both pass the check and both acquire the lock.
            // Now uses findOneAndUpdate with a "not locked" condition — only one wins.
            const lockAcquired = await AutomationRule.findOneAndUpdate(
                { _id: rule._id, currentlyProcessingLeadId: null },
                { $set: { currentlyProcessingLeadId: lead._id, lockAcquiredAt: new Date() } },
                { new: true }
            );

            if (!lockAcquired) {
                console.log(`⏭️ [Automation] Rule "${rule.name}" lock busy. Skipping.`);
                continue;
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
                        await AutomationRule.findByIdAndUpdate(rule._id, {
                            $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
                        });
                    }
                } else {
                    // Execute immediately and release lock inside
                    await executeRuleActions(rule, lead);
                }
            } else {
                await AutomationRule.findByIdAndUpdate(rule._id, {
                    $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
                });
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
                    await AutomationRule.findByIdAndUpdate(ruleId, {
                        $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
                    });
                    console.log(`⏱️ [Automation] Skipped Job: Lead no longer meets criteria for Rule "${rule.name}"`);
                }
            } else {
                console.log(`⏱️ [Automation] Job skipped: rule ${ruleId} inactive or lead ${leadId} missing.`);
                await AutomationRule.findByIdAndUpdate(ruleId, {
                    $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
                });
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
            await AutomationRule.findByIdAndUpdate(ruleId, {
                $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
            });
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
            updates.$set = { status: watcher.ifRepliedAction.changeStage };
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
        }

        // Send follow-up template if configured
        if (watcher.ifRepliedAction?.sendTemplateId && lead.phone) {
            await sendWhatsAppMessage(lead.phone, watcher.ifRepliedAction.sendTemplateId, lead.userId.toString());
        }

        // Release the one-at-a-time rule lock
        await AutomationRule.findByIdAndUpdate(watcher.ruleId, {
            $set: { currentlyProcessingLeadId: null, lockAcquiredAt: null }
        });

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

module.exports = {
    evaluateLead,
    defineAutomationJobs,
    handleWatcherReply,
    cancelJobsForRule
};
