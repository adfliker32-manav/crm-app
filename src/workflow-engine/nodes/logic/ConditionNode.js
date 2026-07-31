const NodeRegistry     = require('../../NodeRegistry');
// WEAK #6 FIX: Use shared operators module instead of duplicating logic
const { evaluateCondition, isKnownOperator } = require('./operators');

// ─────────────────────────────────────────────────────────────────────────────
// ConditionNode (If / Else)
// Evaluates multiple conditions on the execution variables.
// Outputs to 'true' port if conditions match based on matchType, 'false' otherwise.
// ─────────────────────────────────────────────────────────────────────────────

const ConditionNode = {
    type: 'condition',

    meta: () => ({
        type:     'condition',
        name:     'If / Else',
        icon:     'fa-solid fa-code-branch',
        category: 'logic',
        color:    '#F59E0B',
        description: 'Branch the workflow based on conditions'
    }),

    ports: () => ({
        inputs:  [{ id: 'input', label: 'In' }],
        outputs: [
            { id: 'true',  label: 'True (Yes)' },
            { id: 'false', label: 'False (No)' }
        ]
    }),

    schema: () => ({
        fields: [
            {
                key:      'matchType',
                label:    'Match Type',
                type:     'select',
                required: true,
                defaultValue: 'ALL',
                options:  [
                    { value: 'ALL', label: 'ALL conditions must be met (AND)' },
                    { value: 'ANY', label: 'ANY condition must be met (OR)' }
                ]
            },
            {
                key:      'conditions',
                label:    'Conditions',
                type:     'condition_builder',
                required: true,
                description: 'Add one or more conditions to evaluate.'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.conditions || !Array.isArray(data.conditions) || data.conditions.length === 0) {
            errors.push('At least one condition is required');
        } else {
            data.conditions.forEach((cond, index) => {
                if (!cond.variable?.trim()) errors.push(`Condition ${index + 1}: Variable is required`);
                if (!cond.operator) {
                    errors.push(`Condition ${index + 1}: Operator is required`);
                } else if (!isKnownOperator(cond.operator)) {
                    // M-C5 FIX: an unrecognised operator evaluates to false forever,
                    // so the workflow silently always takes the 'false' branch.
                    errors.push(`Condition ${index + 1}: Unknown operator "${cond.operator}"`);
                }
            });
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const conditions = Array.isArray(data.conditions) ? data.conditions : [];
        const matchType  = data.matchType || 'ALL';

        // ── WF-M8 FIX: no conditions is not "true" ──────────────────────────────
        // `finalResult` seeds to true for matchType ALL, so an empty condition list
        // fell straight through to the 'true' port — a vacuous truth that reads as a
        // working filter. validate() rejects this at publish, but updateWorkflow only
        // checks node TYPES, so a draft (or an imported / API-written workflow) can
        // carry `data: {}` and reach the worker. Route it to 'false' and say why: an
        // unconfigured filter must never let every lead through.
        if (conditions.length === 0) {
            console.warn(
                `[ConditionNode] No conditions configured (execution ${context.executionId}) — ` +
                `routing to 'false' rather than letting everything through.`
            );
            return {
                nextPort: 'false',
                output: {
                    'condition.result': false,
                    'condition.error':  'no_conditions_configured'
                }
            };
        }

        // WEAK #6 FIX: Use shared evaluateCondition() from operators.js
        // Previously parseValue + OPERATORS were copy-pasted from SwitchNode.
        let finalResult = matchType === 'ALL';
        const results   = [];

        for (const cond of conditions) {
            const result = evaluateCondition(cond, context);
            results.push({ variable: cond.variable, operator: cond.operator, result });

            if (matchType === 'ALL') {
                finalResult = finalResult && result;
                if (!finalResult) break; // Short-circuit AND
            } else {
                finalResult = finalResult || result;
                if (finalResult) break;  // Short-circuit OR
            }
        }

        console.log(`[ConditionNode] matchType=${matchType} → finalResult=${finalResult}`);

        return {
            nextPort: finalResult ? 'true' : 'false',
            output:  {
                'condition.result':  finalResult,
                'condition.details': results
            }
        };
    }
};

NodeRegistry.register(ConditionNode);
module.exports = ConditionNode;
