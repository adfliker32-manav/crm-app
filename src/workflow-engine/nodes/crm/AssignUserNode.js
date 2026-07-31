const mongoose = require('mongoose');
const NodeRegistry = require('../../NodeRegistry');
const Lead = require('../../../models/Lead');
const User = require('../../../models/User');
const { emitToUser } = require('../../../services/socketService');

const AssignUserNode = {
    type: 'assign_user',
    sideEffect: true, // L4/L5: mutates the lead — dry-run in Test Mode, idempotent on retry

    meta: () => ({
        type: 'assign_user', name: 'Assign User', icon: 'fa-solid fa-user-tag',
        category: 'crm', color: '#EC4899',
        description: 'Assign the lead to a team member'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [
            { id: 'output', label: 'Assigned' },
            // WF-M4: an assignment that was REFUSED (invalid id, or a user outside
            // this tenant — see H1) used to leave down the success port, so the rest
            // of the workflow ran as though the lead had an owner: "notify the
            // assigned agent" then silently notified nobody. A refusal needs its own
            // branch so the author can fall back or escalate.
            { id: 'error',  label: 'Not Assigned' }
        ]
    }),

    schema: () => ({
        fields: [
            { key: 'userId', label: 'Assign To', type: 'user_select', required: true }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.userId) errors.push('User is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead = context.getLead();
        // WF-M4: no lead means no assignment happened — that is the error branch, not
        // the success one (matches how every other lead-bound node now reports it).
        if (!lead) {
            return {
                nextPort: 'error',
                output: { 'assign.skipped': true, 'assign.reason': 'no_lead_in_context' }
            };
        }

        // ── H1 FIX: the assignee MUST belong to this tenant ──────────────────
        // The schema field is type:'user_select', so ownership was assumed to be
        // enforced by the UI picker. But createWorkflow/updateWorkflow validate
        // only the node TYPE (NodeRegistry.has) and never sanitise node.data, so a
        // hand-crafted POST /api/workflows can set userId to a user in ANOTHER
        // tenant. That both corrupted Lead.assignedTo across the tenant boundary
        // and pushed the lead's id + name over Socket.IO into that foreign user's
        // live session on every execution.
        const tenantId = context.tenantId.toString();
        const targetId = String(data.userId || '');

        if (!mongoose.Types.ObjectId.isValid(targetId)) {
            console.warn(`[AssignUserNode] Invalid userId "${targetId}" — skipping assignment.`);
            // WF-M4: route the refusal, don't pretend it succeeded.
            return { nextPort: 'error', output: { 'assign.skipped': true, 'assign.reason': 'invalid_user_id' } };
        }
        // Valid assignees: the tenant owner itself, or one of its sub-users.
        const inTenant = targetId === tenantId
            || !!(await User.exists({ _id: targetId, parentId: tenantId }));
        if (!inTenant) {
            console.error(
                `[AssignUserNode] Cross-tenant assignment BLOCKED: user ${targetId} ` +
                `does not belong to tenant ${tenantId} (execution ${context.executionId}).`
            );
            // WF-M4: a blocked cross-tenant assignment is a failure, and continuing
            // down "Assigned" hid it from the author entirely.
            return { nextPort: 'error', output: { 'assign.skipped': true, 'assign.reason': 'user_not_in_tenant' } };
        }

        if (lead.assignedTo?.toString() !== data.userId?.toString()) {
            await Lead.findByIdAndUpdate(lead._id, {
                $set:  { assignedTo: data.userId },
                $push: {
                    history: {
                        $each:  [{ type: 'System', subType: 'WorkflowEngine', content: `Lead assigned by Workflow`, date: new Date() }],
                        $slice: -100
                    }
                }
            });

            setImmediate(() => {
                emitToUser(data.userId.toString(), 'lead:assigned', {
                    leadId: lead._id, leadName: lead.name,
                    message: `You have been assigned lead: ${lead.name}`, timestamp: new Date()
                });
            });
        }

        return { nextPort: 'output', output: { 'lead.assignedTo': data.userId } };
    }
};

NodeRegistry.register(AssignUserNode);
module.exports = AssignUserNode;
