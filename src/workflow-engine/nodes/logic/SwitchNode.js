const NodeRegistry = require('../../NodeRegistry');

// ─────────────────────────────────────────────────────────────────────────────
// SwitchNode (Multi-Branch)
// Evaluates multiple cases. Routes to the port of the FIRST case that matches.
// Falls through to 'default' if no case matches.
// ─────────────────────────────────────────────────────────────────────────────

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

const SwitchNode = {
    type: 'switch',

    meta: () => ({
        type:     'switch',
        name:     'Switch',
        icon:     'fa-solid fa-shuffle',
        category: 'logic',
        color:    '#EF4444',
        description: 'Route to different branches based on rules'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',   label: 'In' }],
        outputs: [{ id: 'default', label: 'Default' }]
        // Additional outputs are dynamic — defined by the 'cases' config field.
        // The canvas renders them based on the node's data.cases array.
    }),

    schema: () => ({
        fields: [
            {
                key:      'cases',
                label:    'Routing Cases',
                type:     'switch_builder',
                required: true,
                description: 'Add rules to route the workflow. The first matching rule wins.'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.cases || !Array.isArray(data.cases) || data.cases.length === 0) {
            errors.push('At least one routing case is required');
        } else {
            data.cases.forEach((c, index) => {
                if (!c.portName?.trim()) errors.push(`Case ${index + 1}: Port Name is required`);
                if (!c.variable?.trim()) errors.push(`Case ${index + 1}: Variable is required`);
                if (!c.operator) errors.push(`Case ${index + 1}: Operator is required`);
            });
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const cases = data.cases || [];

        for (const c of cases) {
            const variableValue = context.get(c.variable) ?? '';
            
            let compareValue = c.value ?? '';
            if (typeof compareValue === 'string' && (compareValue.startsWith('lead.') || compareValue.startsWith('webhook.'))) {
                compareValue = context.get(compareValue) ?? compareValue;
            }

            const operator = c.operator;
            const evalFn = OPERATORS[operator];

            if (evalFn) {
                const isMatch = evalFn(variableValue, compareValue);
                if (isMatch) {
                    console.log(`[SwitchNode] Matched Port: ${c.portName} (${c.variable} ${operator} ${compareValue})`);
                    return {
                        nextPort: c.portName,
                        output:  { 
                            'switch.matched': true, 
                            'switch.port': c.portName,
                            'switch.variable': c.variable,
                            'switch.value': variableValue
                        }
                    };
                }
            } else {
                console.warn(`[SwitchNode] Unknown operator: ${operator}`);
            }
        }

        // No case matched — use default
        console.log(`[SwitchNode] No cases matched. Routing to default.`);
        return {
            nextPort: 'default',
            output:  { 'switch.matched': false, 'switch.port': 'default' }
        };
    }
};

NodeRegistry.register(SwitchNode);
module.exports = SwitchNode;
