const NodeRegistry     = require('../../NodeRegistry');
// WEAK #6 FIX: Use shared operators module instead of duplicating logic
const { evaluateCondition, isKnownOperator } = require('./operators');

// M-C7 FIX: port names are free text and become the routing key. These collide with
// engine/canvas semantics — notably 'output', which the engine also matches for
// connections that have no explicit sourcePort.
const RESERVED_PORT_NAMES = new Set(['output', 'input', 'error', 'default', 'timeout', 'no_reply']);

// ─────────────────────────────────────────────────────────────────────────────
// SwitchNode (Multi-Branch)
// Evaluates multiple cases. Routes to the port of the FIRST case that matches.
// Falls through to 'default' if no case matches.
// ─────────────────────────────────────────────────────────────────────────────

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
            const seen = new Set();
            data.cases.forEach((c, index) => {
                const port = c.portName?.trim();
                if (!port) {
                    errors.push(`Case ${index + 1}: Port Name is required`);
                } else if (RESERVED_PORT_NAMES.has(port.toLowerCase())) {
                    errors.push(`Case ${index + 1}: "${port}" is a reserved port name — choose another.`);
                } else if (seen.has(port.toLowerCase())) {
                    // Duplicates make routing depend on array order.
                    errors.push(`Case ${index + 1}: Duplicate port name "${port}".`);
                } else {
                    seen.add(port.toLowerCase());
                }
                if (!c.variable?.trim()) errors.push(`Case ${index + 1}: Variable is required`);
                if (!c.operator) {
                    errors.push(`Case ${index + 1}: Operator is required`);
                } else if (!isKnownOperator(c.operator)) {
                    errors.push(`Case ${index + 1}: Unknown operator "${c.operator}"`);
                }
            });
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const cases = data.cases || [];

        for (const c of cases) {
            // WEAK #6 FIX: Use shared evaluateCondition() from operators.js
            // The condition shape is { variable, operator, value } — same as ConditionNode.
            const conditionLike = { variable: c.variable, operator: c.operator, value: c.value ?? '' };
            const isMatch = evaluateCondition(conditionLike, context);

            if (isMatch) {
                const variableValue = context.get(c.variable) ?? '';
                console.log(`[SwitchNode] Matched Port: ${c.portName} (${c.variable} ${c.operator} ${c.value ?? ''})`);
                return {
                    nextPort: c.portName,
                    output:  {
                        'switch.matched':  true,
                        'switch.port':     c.portName,
                        'switch.variable': c.variable,
                        'switch.value':    variableValue
                    }
                };
            }
        }

        // No case matched — use default
        console.log('[SwitchNode] No cases matched. Routing to default.');
        return {
            nextPort: 'default',
            output:  { 'switch.matched': false, 'switch.port': 'default' }
        };
    }
};

NodeRegistry.register(SwitchNode);
module.exports = SwitchNode;
