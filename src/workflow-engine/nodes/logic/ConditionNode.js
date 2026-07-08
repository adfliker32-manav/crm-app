const NodeRegistry = require('../../NodeRegistry');

// ─────────────────────────────────────────────────────────────────────────────
// ConditionNode (If / Else)
// Evaluates multiple conditions on the execution variables.
// Outputs to 'true' port if conditions match based on matchType, 'false' otherwise.
// ─────────────────────────────────────────────────────────────────────────────

// Helper to safely cast values for comparison
const parseValue = (val) => {
    if (val === null || val === undefined) return '';
    if (!isNaN(val) && String(val).trim() !== '') return Number(val);
    const d = new Date(val);
    if (!isNaN(d.getTime()) && String(val).match(/^\d{4}-\d{2}-\d{2}/)) return d.getTime();
    return String(val).toLowerCase();
};

const OPERATORS = {
    equals:         (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
    not_equals:     (a, b) => String(a).toLowerCase() !== String(b).toLowerCase(),
    contains:       (a, b) => String(a).toLowerCase().includes(String(b).toLowerCase()),
    not_contains:   (a, b) => !String(a).toLowerCase().includes(String(b).toLowerCase()),
    starts_with:    (a, b) => String(a).toLowerCase().startsWith(String(b).toLowerCase()),
    greater_than:   (a, b) => parseValue(a) > parseValue(b),
    less_than:      (a, b) => parseValue(a) < parseValue(b),
    is_empty:       (a)    => !a || String(a).trim() === '',
    is_not_empty:   (a)    => !!a && String(a).trim() !== ''
};

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
                if (!cond.operator) errors.push(`Condition ${index + 1}: Operator is required`);
            });
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const conditions = data.conditions || [];
        const matchType = data.matchType || 'ALL';
        
        let finalResult = matchType === 'ALL' ? true : false;
        const results = [];

        for (const cond of conditions) {
            // Support variable vs variable comparison if the compare value looks like a variable
            let compareValue = cond.value ?? '';
            if (typeof compareValue === 'string' && (compareValue.startsWith('lead.') || compareValue.startsWith('webhook.'))) {
                compareValue = context.get(compareValue) ?? compareValue;
            }

            const variableValue = context.get(cond.variable) ?? '';
            const operator = cond.operator;
            
            const evalFn = OPERATORS[operator];
            let result = false;
            
            if (evalFn) {
                result = evalFn(variableValue, compareValue);
            } else {
                console.warn(`[ConditionNode] Unknown operator: ${operator}`);
            }

            results.push({ variable: cond.variable, operator, value: compareValue, result });

            if (matchType === 'ALL') {
                finalResult = finalResult && result;
                if (!finalResult) break; // Short-circuit AND
            } else {
                finalResult = finalResult || result;
                if (finalResult) break; // Short-circuit OR
            }
        }

        console.log(`[ConditionNode] matchType=${matchType} → finalResult=${finalResult}`);

        return {
            nextPort: finalResult ? 'true' : 'false',
            output:  {
                'condition.result': finalResult,
                'condition.details': results
            }
        };
    }
};

NodeRegistry.register(ConditionNode);
module.exports = ConditionNode;
