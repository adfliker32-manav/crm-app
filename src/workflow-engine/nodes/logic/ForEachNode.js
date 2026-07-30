const NodeRegistry = require('../../NodeRegistry');

// ─────────────────────────────────────────────────────────────────────────────
// ForEachNode  (row 27)
// ─────────────────────────────────────────────────────────────────────────────
// Runs the steps on its 'each' port once per item.
//
// This is a FAN-OUT, not a back-edge. The engine claims each node at most once per
// execution — that invariant is what makes the diamond-dedup guard correct, and it
// is why publish rejects cyclic graphs. Rather than weaken it, the engine scopes the
// claim by ITERATION PATH: the body's nodes are claimed as 'loop#0/send',
// 'loop#1/send', … so the same node genuinely runs once per item with no cycle
// anywhere in the graph.
//
// NOT a `while` loop: there is no condition-driven repetition, because that WOULD
// need a back-edge. Iteration is over a known collection.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_ITEMS = Number(process.env.WORKFLOW_MAX_LOOP_ITEMS) || 500;

/** Coerce the configured source into an array of items. */
const resolveItems = (context, data) => {
    const source = String(data.source || '').trim();

    // Explicit static list
    if (data.mode === 'list') {
        return String(data.items || '')
            .split('\n')
            .map(s => s.trim())
            .filter(Boolean);
    }

    // A variable holding an array, a JSON array string, or a delimited string.
    const raw = context.get(source);
    if (raw === undefined || raw === null || raw === '') return [];
    if (Array.isArray(raw)) return raw;

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return parsed;
            } catch { /* fall through to delimiter split */ }
        }
        const delimiter = data.delimiter || ',';
        return trimmed.split(delimiter).map(s => s.trim()).filter(Boolean);
    }
    if (typeof raw === 'object') return Object.values(raw);
    return [raw];
};

const ForEachNode = {
    type: 'for_each',

    meta: () => ({
        type:     'for_each',
        name:     'For Each',
        icon:     'fa-solid fa-repeat',
        category: 'logic',
        color:    '#0EA5E9',
        description: 'Run the following steps once for every item in a list'
    }),

    ports: () => ({
        inputs:  [{ id: 'input', label: 'In' }],
        outputs: [
            { id: 'each',  label: 'For Each Item' },
            { id: 'empty', label: 'No Items' }
        ]
    }),

    schema: () => ({
        fields: [
            {
                key: 'mode', label: 'Items From', type: 'select', required: true,
                defaultValue: 'variable',
                options: [
                    { value: 'variable', label: 'A variable (array, JSON array, or delimited text)' },
                    { value: 'list',     label: 'A fixed list I type here' }
                ]
            },
            {
                key: 'source', label: 'Variable', type: 'text',
                placeholder: 'e.g. webhook.items or lead.tags',
                showWhen: { field: 'mode', value: 'variable' },
                description: 'The variable holding the items to loop over.'
            },
            {
                key: 'delimiter', label: 'Separator', type: 'text', defaultValue: ',',
                showWhen: { field: 'mode', value: 'variable' },
                description: 'Used only when the variable is plain text rather than a list.'
            },
            {
                key: 'items', label: 'Items (one per line)', type: 'textarea', rows: 5,
                showWhen: { field: 'mode', value: 'list' }
            },
            {
                key: 'maxItems', label: 'Maximum Items', type: 'number', defaultValue: 100,
                description: `Safety cap. Hard limit is ${MAX_ITEMS}.`
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.mode) errors.push('Choose where the items come from');
        if (data.mode === 'variable' && !data.source?.trim()) {
            errors.push('Variable is required');
        }
        if (data.mode === 'list' && !String(data.items || '').trim()) {
            errors.push('Add at least one item');
        }
        if (data.maxItems !== undefined && data.maxItems !== '' && data.maxItems !== null) {
            const n = Number(data.maxItems);
            if (!Number.isFinite(n) || n < 1 || n > MAX_ITEMS) {
                errors.push(`Maximum Items must be between 1 and ${MAX_ITEMS}`);
            }
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        let items = resolveItems(context, data);

        const cap = Math.min(Number(data.maxItems) || 100, MAX_ITEMS);
        const truncated = items.length > cap;
        if (truncated) {
            console.warn(
                `[ForEachNode] ${items.length} items exceeds the cap of ${cap} — ` +
                `iterating the first ${cap} only (execution ${context.executionId}).`
            );
            items = items.slice(0, cap);
        }

        if (items.length === 0) {
            return {
                nextPort: 'empty',
                output: { 'loop.count': 0, 'loop.truncated': false }
            };
        }

        // The engine reads `forEach` and fans out one token per item on the port
        // named by nextPort, each with its own iteration path.
        return {
            nextPort: 'each',
            forEach:  { items },
            output: {
                'loop.count':     items.length,
                'loop.truncated': truncated
            }
        };
    }
};

NodeRegistry.register(ForEachNode);
module.exports = ForEachNode;
