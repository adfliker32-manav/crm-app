const AutomationRule = require('../models/AutomationRule');
const Lead = require('../models/Lead');
const { sendEmail } = require('./emailService');
const { sendWhatsAppMessage } = require('./whatsappService');
const { logActivity } = require('./auditService');

// Advanced property resolver (handles 'customData.Property' etc)
const resolveField = (obj, path) => {
    return path.split('.').reduce((prev, curr) => {
        return prev ? prev[curr] : undefined;
    }, obj);
};

// Condition Evaluator
const evaluateCondition = (condition, leadValue) => {
    const { operator, value } = condition;
    
    // Normalize string comparisons if possible
    const s1 = typeof leadValue === 'string' ? leadValue.toLowerCase() : leadValue;
    const s2 = typeof value === 'string' ? value.toLowerCase() : value;

    switch (operator) {
        case 'equals':
            return s1 === s2;
        case 'not_equals':
            return s1 !== s2;
        case 'contains':
            return typeof s1 === 'string' && s1.includes(s2);
        case 'greater_than':
            return Number(leadValue) > Number(value);
        case 'less_than':
            return Number(leadValue) < Number(value);
        default:
            return false;
    }
};

// Main execution block: actually performs the logic
const executeRuleActions = async (rule, lead) => {
    try {
        console.log(`🤖 [Automation] Executing Rule: "${rule.name}" for Lead: "${lead.name}"`);
        let changesMade = false;
        const updates = {};

        for (const action of rule.actions) {
            if (action.type === 'SEND_WHATSAPP') {
                if (lead.phone) {
                    await sendWhatsAppMessage(lead.phone, action.templateId || 'hello_world', lead.userId);
                    // Add history
                    if (!updates.$push) updates.$push = { history: {} };
                    updates.$push.history = { type: 'WhatsApp', subType: 'Auto', content: `Automated WhatsApp Sent (Rule: ${rule.name})`, date: new Date() };
                    changesMade = true;
                }
            } else if (action.type === 'SEND_EMAIL') {
                if (lead.email) {
                    await sendEmail({ to: lead.email, subject: action.subject, text: action.body, userId: lead.userId });
                    // Add history
                    if (!updates.$push) updates.$push = { history: {} };
                    updates.$push.history = { type: 'Email', subType: 'Auto', content: `Automated Email Sent (Rule: ${rule.name})`, date: new Date() };
                    changesMade = true;
                }
            } else if (action.type === 'CHANGE_STAGE') {
                if (lead.status !== action.stageName) {
                    updates.$set = updates.$set || {};
                    updates.$set.status = action.stageName;
                    
                    if (!updates.$push) updates.$push = { history: {} };
                    updates.$push.history = { type: 'System', subType: 'Auto', content: `Stage changed to ${action.stageName} (Rule: ${rule.name})`, date: new Date() };
                    changesMade = true;
                }
            } else if (action.type === 'ASSIGN_USER') {
                if (lead.assignedTo?.toString() !== action.userId?.toString()) {
                    updates.$set = updates.$set || {};
                    updates.$set.assignedTo = action.userId;
                    
                    if (!updates.$push) updates.$push = { history: {} };
                    updates.$push.history = { type: 'System', subType: 'Auto', content: `Lead assigned automatically (Rule: ${rule.name})`, date: new Date() };
                    changesMade = true;
                }
            }
        }

        // Apply any DB updates
        if (changesMade) {
            await Lead.findByIdAndUpdate(lead._id, updates);
        }

        // Increment rule execution counter
        await AutomationRule.findByIdAndUpdate(rule._id, { $inc: { executionCount: 1 }, lastFiredAt: new Date() });

    } catch (err) {
        console.error(`❌ [Automation] Execution Error on Rule (${rule.name}):`, err);
    }
};

// Global Event Hook exported to leadController/etc
let globalAgendaInstance = null; // Store reference to agenda
const evaluateLead = async (lead, triggerType) => {
    try {
        if (!lead || !lead.userId) return;

        // Find totally active rules matching this exact trigger
        const rules = await AutomationRule.find({ tenantId: lead.userId, isActive: true, trigger: triggerType });
        if (!rules || rules.length === 0) return;

        for (const rule of rules) {
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
                    console.log(`🤖 [Automation] Scheduling Rule: "${rule.name}" in ${rule.delayMinutes} mins.`);
                    // Schedule Job
                    await globalAgendaInstance.schedule(
                        new Date(Date.now() + rule.delayMinutes * 60000), 
                        'EXECUTE_AUTOMATION_ACTION', 
                        { ruleId: rule._id, leadId: lead._id }
                    );
                } else {
                    // Execute immediately
                    await executeRuleActions(rule, lead);
                }
            }
        }
    } catch (err) {
        console.error(`❌ [Automation] Evaluation Error:`, err.message);
    }
};

// Define Agenda Queue Background Workers
const defineAutomationJobs = (agenda) => {
    globalAgendaInstance = agenda;
    
    agenda.define('EXECUTE_AUTOMATION_ACTION', async (job) => {
        const { ruleId, leadId } = job.attrs.data;
        
        try {
            const rule = await AutomationRule.findById(ruleId);
            const lead = await Lead.findById(leadId);
            
            // Only fire if rule is still active, and elements still exist
            if (rule && rule.isActive && lead) {
                
                // CRITICAL SAFETY CHECK: Does the lead STILL meet conditions? 
                // Ex: If a rule says "Fire in 48 hrs if Stage == New", we ONLY fire if Stage is still "New" after 48 hrs!
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
                    console.log(`⏱️ [Automation] Skipped Job: Lead no longer meets criteria for Rule "${rule.name}"`);
                }
            }
        } catch (error) {
            console.error('❌ [Automation] Background Job Execution failed:', error.message);
        }
    });
};

module.exports = {
    evaluateLead,
    defineAutomationJobs
};
