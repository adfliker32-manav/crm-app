const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');

// ─────────────────────────────────────────────────────────────────────────────
// FindLeadsNode  (row 26)
// ─────────────────────────────────────────────────────────────────────────────
// Selects leads by filter and runs a workflow for each one.
//
// A SCHEDULED_TRIGGER execution has no contact (fireTrigger sets contactId null),
// so every lead-bound node hit its own `if (!lead) return` guard and returned the
// SUCCESS port having done nothing. "Every Monday, message everyone in Negotiation"
// completed green with a history full of no-ops.
//
// Rather than try to swap the lead underneath one execution — contactId is fixed for
// the run, and `getLead()` reads it — this dispatches a CHILD EXECUTION per lead.
// Each child is an ordinary lead-triggered run with its own contactId, history,
// idempotency ledger and branch accounting, so every existing node works unchanged.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_LEADS = Number(process.env.WORKFLOW_MAX_FIND_LEADS) || 1000;

const FindLeadsNode = {
    type: 'find_leads',
    sideEffect: true,   // dispatches real executions — must be dry-run in Test Mode

    meta: () => ({
        type:     'find_leads',
        name:     'Find Leads',
        icon:     'fa-solid fa-filter',
        category: 'crm',
        color:    '#0EA5E9',
        description: 'Select leads by filter and run this workflow for each one'
    }),

    ports: () => ({
        inputs:  [{ id: 'input', label: 'In' }],
        outputs: [
            { id: 'output', label: 'Dispatched' },
            { id: 'empty',  label: 'No Matches' }
        ]
    }),

    schema: () => ({
        fields: [
            { key: 'stageName', label: 'In Stage', type: 'stage_select',
              description: 'Leave blank to match any stage.' },
            { key: 'tag', label: 'Has Tag', type: 'text', placeholder: 'e.g. newsletter' },
            { key: 'source', label: 'Source', type: 'text', placeholder: 'e.g. Facebook' },
            { key: 'inactiveDays', label: 'No Activity For (days)', type: 'number',
              placeholder: 'e.g. 14' },
            { key: 'targetWorkflowId', label: 'Workflow To Run', type: 'text', required: true,
              description: 'The ID of the MANUAL_TRIGGER workflow to run for each matching lead.' },
            { key: 'maxLeads', label: 'Maximum Leads', type: 'number', defaultValue: 200,
              description: `Safety cap. Hard limit is ${MAX_LEADS}.` }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.targetWorkflowId?.trim()) {
            errors.push('Choose the workflow to run for each lead');
        }
        if (data.maxLeads !== undefined && data.maxLeads !== '' && data.maxLeads !== null) {
            const n = Number(data.maxLeads);
            if (!Number.isFinite(n) || n < 1 || n > MAX_LEADS) {
                errors.push(`Maximum Leads must be between 1 and ${MAX_LEADS}`);
            }
        }
        // At least one filter, so a mistyped config cannot fan out over the whole CRM.
        if (!data.stageName && !data.tag && !data.source && !data.inactiveDays) {
            errors.push('Add at least one filter — this step will not run against every lead in the CRM');
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const tenantId = context.tenantId.toString();
        const cap = Math.min(Number(data.maxLeads) || 200, MAX_LEADS);

        const query = { userId: tenantId };
        if (data.stageName) query.status = data.stageName;
        if (data.tag)       query.tags   = data.tag;
        if (data.source)    query.source = data.source;
        if (data.inactiveDays) {
            const days = Number(data.inactiveDays);
            if (Number.isFinite(days) && days > 0) {
                query.updatedAt = { $lt: new Date(Date.now() - days * 24 * 3600 * 1000) };
            }
        }

        // Bounded projection + limit: never materialise the whole lead set in the worker.
        const leads = await Lead.find(query).select('_id').limit(cap).lean();

        if (leads.length === 0) {
            return { nextPort: 'empty', output: { 'leads.matched': 0 } };
        }

        const WorkflowEngine = require('../../WorkflowEngine');
        let dispatched = 0;

        for (const l of leads) {
            try {
                await WorkflowEngine.fireTrigger('MANUAL_TRIGGER', {
                    lead: { _id: l._id, userId: context.tenantId },
                    workflowId: String(data.targetWorkflowId).trim(),
                    startedBy: 'cron',
                    // C8: children inherit the causation chain, so a find_leads that
                    // targets a workflow which loops back is still bounded.
                    _depth: context.getTriggerDepth() + 1,
                    _chain: [...context.getTriggerChain(), `${context.workflowId}:find_leads`],
                    // H7: one child per (dispatch, lead) — a retry of this node cannot
                    // double-dispatch, because the unique index rejects the duplicate.
                    idempotencyKey: `find:${context.executionId}:${l._id}`
                });
                dispatched++;
            } catch (err) {
                console.error(`[FindLeadsNode] Failed to dispatch lead ${l._id}: ${err.message}`);
            }
        }

        return {
            nextPort: 'output',
            output: {
                'leads.matched':    leads.length,
                'leads.dispatched': dispatched,
                'leads.truncated':  leads.length >= cap
            }
        };
    }
};

NodeRegistry.register(FindLeadsNode);
module.exports = FindLeadsNode;
