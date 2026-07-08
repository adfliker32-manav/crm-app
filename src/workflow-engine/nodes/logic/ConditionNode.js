const NodeRegistry     = require('../../NodeRegistry');
// WEAK #6 FIX: Use shared operators module instead of duplicating logic
const { evaluateCondition } = require('./operators');

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
                if (!cond.operator)         errors.push(`Condition ${index + 1}: Operator is required`);
            });
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const conditions = data.conditions || [];
        const matchType  = data.matchType || 'ALL';

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
