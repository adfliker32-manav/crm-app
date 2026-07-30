const NodeRegistry = require('../../NodeRegistry');

// ─────────────────────────────────────────────────────────────────────────────
// MergeNode  (row 27 — the join half)
// ─────────────────────────────────────────────────────────────────────────────
// Waits until EVERY incoming branch has arrived, then continues once.
//
// Without this, a diamond (A→B, A→C, B→D, C→D) was first-arrival-wins: the dedup
// guard claimed D for whichever branch got there first and silently absorbed the
// other, so D ran before the slower branch finished and could not see its
// variables. Any parallel graph that expected to combine results was quietly wrong.
//
// `joinNode: true` exempts this node from the single-claim guard — it MUST observe
// every arrival to know when the last one lands. That is safe because the node is a
// pure atomic counter: `$inc` is applied server-side, so N concurrent arrivals
// produce N distinct counts and exactly one of them equals the expected total.
// ─────────────────────────────────────────────────────────────────────────────

const MergeNode = {
    type: 'merge',

    // Tells the engine to skip the once-per-execution claim for this node.
    joinNode: true,

    meta: () => ({
        type:     'merge',
        name:     'Merge / Wait for All',
        icon:     'fa-solid fa-code-merge',
        category: 'logic',
        color:    '#14B8A6',
        description: 'Wait for every incoming branch (or loop iteration) to finish, then continue once'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [{ id: 'output', label: 'All Done' }]
    }),

    schema: () => ({
        fields: [
            {
                key: 'expectedInputs', label: 'Wait For', type: 'number',
                placeholder: 'Leave blank to detect automatically',
                description:
                    'How many branches must arrive before continuing. Leave blank to use ' +
                    'the number of connections into this step, or the number of loop ' +
                    'iterations when this step ends a For Each body.'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (data.expectedInputs !== undefined && data.expectedInputs !== '' && data.expectedInputs !== null) {
            const n = Number(data.expectedInputs);
            if (!Number.isFinite(n) || n < 1 || n > 10000) {
                errors.push('Wait For must be a number between 1 and 10000');
            }
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        // Resolve how many arrivals constitute "all", in order of specificity:
        //   1. an explicit setting
        //   2. the enclosing for_each's item count (this merge closes a loop body)
        //   3. the number of graph edges pointing at this node
        let expected = Number(data.expectedInputs) || null;
        let basis = 'configured';

        if (!expected) {
            const loopCount = context.getEnclosingLoopCount();
            if (loopCount) {
                expected = loopCount;
                basis = 'loop';
            }
        }
        if (!expected) {
            expected = context.countIncomingConnections();
            basis = 'edges';
        }
        expected = Math.max(1, expected);

        // A loop-closing merge counts arrivals across ALL iterations, so it must key
        // on the loop, not on this node's own per-iteration key (which would always
        // be 1). A branch-closing merge keys on its own node key.
        const counterKey = basis === 'loop'
            ? `${context.getIterPath().split('/').slice(0, -1).join('/')}|${context.getNodeIdForJoin()}`
            : context.getNodeKey();

        const arrived = await context.recordJoinArrival(counterKey);

        if (arrived < expected) {
            console.log(`[MergeNode] ${arrived}/${expected} branches arrived at "${context.getNodeIdForJoin()}" — waiting.`);
            // Absorb this token; the engine retires it without routing onward.
            return {
                absorbToken: true,
                output: { 'merge.arrived': arrived, 'merge.expected': expected }
            };
        }

        console.log(`[MergeNode] all ${expected} branches arrived at "${context.getNodeIdForJoin()}" — continuing.`);
        return {
            nextPort: 'output',
            output: { 'merge.arrived': arrived, 'merge.expected': expected, 'merge.basis': basis }
        };
    }
};

NodeRegistry.register(MergeNode);
module.exports = MergeNode;
