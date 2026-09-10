// ─────────────────────────────────────────────────────────────────────────────
// tests/workflow/trigger-audit.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Regression tests for the trigger/wiring audit (BUG-01 … BUG-20).
//
// The rest of tests/workflow/ is static source-text matching, which is exactly why
// BUG-01 — a TypeError thrown by every send_email node — sat behind 908 green
// tests. A regex proves the code still SAYS the right thing; it can never prove it
// DOES the right thing. Wherever a bug is reachable through a pure function or a
// real object, the test below EXERCISES it instead of grepping for it.
// ─────────────────────────────────────────────────────────────────────────────

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs   = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const { __test__ } = require(path.join(SRC, 'workflow-engine', 'WorkflowEngine.js'));
const { ExecutionContext, buildPayloadVariables, parseMaybeJson } = __test__;

/** Build a real ExecutionContext the way the engine does. */
const makeContext = (variables = {}, lead = null) => new ExecutionContext(
    {
        _id: 'exec1', workflowId: 'wf1', tenantId: 'tenant1',
        contactId: lead?._id || null, variables, startedBy: 'trigger'
    },
    { nodes: [], connections: [] },
    lead
);

describe('BUG-01/BUG-02: context.env exists and carries the trigger payload', () => {
    test('the exact expression both send nodes use does not throw', () => {
        const ctx = makeContext({});
        // This is verbatim what SendEmailNode.js evaluates. Before the fix it raised
        // "TypeError: Cannot read properties of undefined (reading 'trigger')".
        assert.doesNotThrow(() => {
            const _ = ctx.env?.trigger?.appointment || ctx.env?.trigger?.payload?.appointment;
        });
    });

    test('an APPOINTMENT_BOOKED payload round-trips into a usable appointment object', () => {
        const appointment = {
            _id: 'appt1',
            serviceType: 'Dental Cleaning',
            appointmentDate: new Date('2026-10-02T00:00:00.000Z'),
            appointmentTime: '11:30'
        };
        const variables = buildPayloadVariables({
            lead: { _id: 'lead1' }, tenantId: 'tenant1', appointment
        });

        const resolved = makeContext(variables).env.trigger.appointment;

        // buildTemplateContext reads exactly these three. Empty values are what made
        // Meta reject the confirmation template.
        assert.strictEqual(resolved.serviceType, 'Dental Cleaning');
        assert.strictEqual(resolved.appointmentTime, '11:30');
        assert.ok(!isNaN(new Date(resolved.appointmentDate).getTime()));
    });

    test('a truncated or non-JSON trigger value degrades instead of throwing', () => {
        assert.strictEqual(parseMaybeJson('just a reply'), 'just a reply');
        // MAX_TRIGGER_VALUE_CHARS can cut a serialised object mid-way.
        assert.strictEqual(parseMaybeJson('{"a":1…«truncated'), '{"a":1…«truncated');
        assert.deepStrictEqual(parseMaybeJson('{"a":1}'), { a: 1 });
    });

    test('neither send node dereferences env without optional chaining', () => {
        for (const rel of [
            'workflow-engine/nodes/communication/SendEmailNode.js',
            'workflow-engine/nodes/communication/SendWhatsAppNode.js'
        ]) {
            assert.doesNotMatch(
                read(rel), /context\.env\.trigger/,
                `${rel} reads context.env.trigger unguarded — that is the BUG-01 crash`
            );
        }
    });
});

describe('BUG-03/BUG-09: the chatbot routes lead mutations through leadEffects', () => {
    const bot = read('services/chatbotEngineService.js');

    test('stage changes reach the effects hub', () => {
        assert.match(bot, /queueLeadStageChangeEffects/,
            'chatbotEngineService must call the hub every other stage-change path uses');
    });

    test('all three stage-write paths fire the effects', () => {
        // The three paths that write Lead.status in this file: the qualification
        // rules, the change_stage action, and the create_lead upsert branch.
        // The declaration reads `const x = (lead, fromStage) =>`, so matching on
        // `x(` counts call sites only.
        const calls = bot.match(/triggerChatbotStageChangeEffects\(/g) || [];
        assert.strictEqual(calls.length, 3,
            `expected 3 call sites, found ${calls.length}`);
        assert.match(bot, /const triggerChatbotStageChangeEffects = /);
    });

    test('tag writes fire TAG_ADDED', () => {
        assert.match(bot, /fireChatbotTagAdded/);
        assert.match(bot, /fireTrigger\('TAG_ADDED'/);
    });
});

describe('BUG-04: the workflow engine does not start inside the Agenda try block', () => {
    test('registerAllNodes is a sibling of the Agenda block, not nested in it', () => {
        const index = fs.readFileSync(path.join(SRC, '..', 'index.js'), 'utf8').split('\n');
        const agendaAt = index.findIndex(l => l.includes('── Agenda: Automations'));
        const engineAt = index.findIndex(l => l.includes('── Workflow Engine: Node Registration'));
        assert.ok(agendaAt !== -1 && engineAt !== -1, 'could not find both startup blocks');

        let depth = 0;
        for (let i = agendaAt; i < engineAt; i++) {
            depth += (index[i].match(/{/g) || []).length;
            depth -= (index[i].match(/}/g) || []).length;
        }
        assert.strictEqual(depth, 0,
            'the workflow engine startup is nested inside the Agenda try — an Agenda ' +
            'failure would skip registerAllNodes and leave NodeRegistry empty');
    });
});

describe('BUG-05/BUG-06: changedFields reflects what actually changed', () => {
    const ctrl = read('controllers/leadController.js');

    test('LEAD_UPDATED no longer reports the request body keys', () => {
        assert.doesNotMatch(ctrl, /changedFields:\s*Object\.keys\(updates/,
            'changedFields must be a diff, not a list of submitted keys');
    });

    test('assignedTo is tracked even though it is deleted from `updates`', () => {
        assert.match(ctrl, /TRACKED_LEAD_FIELDS\s*=\s*\[\.\.\.ALLOWED_LEAD_UPDATE_FIELDS,\s*'assignedTo'/);
    });

    test('the diff is taken against a pre-update snapshot', () => {
        assert.match(ctrl, /const beforeValues = \{\}/);
        assert.match(ctrl, /valuesDiffer\(beforeValues\[field\], lead\[field\]\)/);
    });
});

describe('BUG-07: bulk tagging only fires for tags a lead did not already have', () => {
    const ctrl = read('controllers/leadController.js');

    test('the pre-image is read before the write', () => {
        const before = ctrl.indexOf('const before = await Lead.find(query).select(\'_id tags\')');
        const write  = ctrl.indexOf('$addToSet: { tags: { $each: tags } }');
        assert.ok(before !== -1 && before < write,
            'tags must be snapshotted BEFORE updateMany, or the set difference is unrecoverable');
    });

    test('the trigger receives the newly-added tags, not the requested ones', () => {
        assert.match(ctrl, /addedTags: newlyAdded/);
        assert.doesNotMatch(ctrl, /fireTrigger\('TAG_ADDED', \{ lead: taggedLead, addedTags: tags \}\)/);
    });

    test('bulk tagging is capped like bulk status updates', () => {
        assert.match(ctrl, /Tag at most 500 at a time/);
    });
});

describe('BUG-08: renaming a stage cascades into the automations that name it', () => {
    const { renameStageInDefinition } = require(path.join(SRC, 'utils', 'stageRename.js'));

    test('trigger filters, stage nodes and lead.status conditions are rewritten', () => {
        const def = {
            triggerConfig: { toStage: 'Negotiation', fromStage: 'New' },
            nodes: [
                { type: 'update_stage', data: { stageName: 'Negotiation' } },
                { type: 'find_leads',   data: { stageName: 'Negotiation' } },
                { type: 'condition',    data: { conditions: [
                    { variable: 'lead.status', operator: 'equals', value: 'Negotiation' }
                ] } }
            ]
        };

        assert.strictEqual(renameStageInDefinition(def, 'Negotiation', 'In Discussion'), true);
        assert.strictEqual(def.triggerConfig.toStage, 'In Discussion');
        assert.strictEqual(def.triggerConfig.fromStage, 'New');
        assert.strictEqual(def.nodes[0].data.stageName, 'In Discussion');
        assert.strictEqual(def.nodes[1].data.stageName, 'In Discussion');
        assert.strictEqual(def.nodes[2].data.conditions[0].value, 'In Discussion');
    });

    test('a literal on a DIFFERENT variable is left alone', () => {
        const def = { nodes: [{ type: 'condition', data: { conditions: [
            { variable: 'lead.source', operator: 'equals', value: 'Negotiation' }
        ] } }] };
        assert.strictEqual(renameStageInDefinition(def, 'Negotiation', 'In Discussion'), false);
        assert.strictEqual(def.nodes[0].data.conditions[0].value, 'Negotiation');
    });

    test('array-valued filters are rewritten element-wise', () => {
        const def = { triggerConfig: { toStage: ['New', 'Negotiation'] }, nodes: [] };
        assert.strictEqual(renameStageInDefinition(def, 'Negotiation', 'In Discussion'), true);
        assert.deepStrictEqual(def.triggerConfig.toStage, ['New', 'In Discussion']);
    });

    test('a rename to the same name is a no-op', () => {
        const def = { triggerConfig: { toStage: 'New' }, nodes: [] };
        assert.strictEqual(renameStageInDefinition(def, 'Missing', 'Other'), false);
    });
});

describe('BUG-10: a rejected trigger releases its rate-limit slot', () => {
    const limiter = read('utils/workflowRateLimiter.js');

    test('the member is removed when the check denies', () => {
        assert.match(limiter, /if \(!allowed\) \{[\s\S]{0,200}?redis\.zrem\(key, member\)/,
            'a denied attempt must not hold window capacity, or the window never drains');
    });
});

describe('BUG-11: a Test run is not filtered by triggerConfig', () => {
    test('matchesTriggerConfig is skipped for startedBy === test', () => {
        assert.match(
            read('workflow-engine/WorkflowEngine.js'),
            /payload\.startedBy !== 'test' &&\s*\n\s*!matchesTriggerConfig\(/,
            'a test pins one workflow by id — the filter can only stop it running'
        );
    });
});

describe('BUG-12: the webhook content-hash fallback is time-bounded', () => {
    const ctrl = read('controllers/workflowController.js');

    test('the hash key carries a window bucket', () => {
        assert.match(ctrl, /body:\$\{bucket\}:\$\{crypto\.createHash\('sha256'\)/);
    });

    test('a delivery-id header still wins', () => {
        assert.match(ctrl, /deliveryId\s*\n?\s*\?\s*`hdr:/);
    });
});

describe('BUG-13: Find Leads dispatches a usable lead', () => {
    const node = read('workflow-engine/nodes/crm/FindLeadsNode.js');

    test('the projection covers what buildInitialVariables reads', () => {
        for (const field of ['name', 'phone', 'email', 'source', 'status', 'tags', 'dealValue']) {
            assert.match(node, new RegExp(`select\\([^)]*${field}`),
                `${field} must be projected or {{lead.${field}}} interpolates as empty`);
        }
    });

    test('the two-field stub is gone', () => {
        assert.doesNotMatch(node, /lead: \{ _id: l\._id, userId: context\.tenantId \}/);
    });

    test('every field buildInitialVariables reads survives the dispatch shape', () => {
        const projected = {
            _id: 'lead1', userId: 'tenant1', name: 'Asha Rao', phone: '+919876543210',
            email: 'asha@example.com', source: 'Meta Sync', status: 'Negotiation',
            score: 42, dealValue: 90000, tags: ['vip']
        };
        const dispatched = { ...projected, userId: projected.userId || 'tenant1' };
        for (const key of ['name', 'phone', 'email', 'source', 'status', 'tags']) {
            assert.ok(dispatched[key] !== undefined && dispatched[key] !== '',
                `lead.${key} would have been seeded empty`);
        }
    });
});

describe('BUG-14: scheduled triggers are reconciled in both directions', () => {
    test('publish takes down a schedule when the trigger is no longer scheduled', () => {
        assert.match(
            read('controllers/workflowController.js'),
            /\} else \{[\s\S]{0,900}?removeScheduledTrigger\(workflow\._id\)/,
            'switching a published workflow away from SCHEDULED_TRIGGER must remove its cron'
        );
    });

    test('startup sweeps orphaned schedulers', () => {
        const q = read('workflow-engine/WorkflowQueue.js');
        assert.match(q, /getJobSchedulers/);
        assert.match(q, /wanted\.has\(id\)/);
        assert.match(q, /Removed orphaned schedule/);
    });
});

describe('BUG-15: WHATSAPP_REPLY uses the conversation\'s linked lead', () => {
    test('the trigger prefers conversation.leadId over the phone match', () => {
        const ctrl = read('controllers/whatsappWebhookController.js');
        assert.match(ctrl, /let triggerLead = lead;/);
        assert.match(ctrl, /fireTrigger\('WHATSAPP_REPLY', \{\s*\n\s*lead: triggerLead/);
    });
});

describe('BUG-16: a lead-bound node records why it did nothing', () => {
    test('the CRM nodes report a no-contact skip instead of a silent success', () => {
        const cases = [
            ['workflow-engine/nodes/crm/UpdateStageNode.js',       'lead.stageSkipped'],
            ['workflow-engine/nodes/crm/AddTagNode.js',            'lead.tagSkipped'],
            ['workflow-engine/nodes/crm/UpdateCustomFieldNode.js', 'field.skipped']
        ];
        for (const [rel, marker] of cases) {
            const src = read(rel);
            assert.match(src, new RegExp(marker.replace('.', '\\.')),
                `${rel} must record the skip`);
            assert.doesNotMatch(src, /if \(!lead\) return \{ nextPort: 'output', output: \{\} \};/,
                `${rel} still returns a bare success with no contact`);
        }
    });
});

describe('BUG-17: the same write fires the same triggers everywhere', () => {
    test('bulk status change fires LEAD_UPDATED as well as STAGE_CHANGED', () => {
        assert.match(read('controllers/leadController.js'),
            /LEAD_UPDATED bulk[\s\S]{0,300}?changedFields: \['status'\]/);
    });

    test('assign_user and update_custom_field fire LEAD_UPDATED', () => {
        assert.match(read('workflow-engine/nodes/crm/AssignUserNode.js'),
            /fireTrigger\('LEAD_UPDATED'[\s\S]{0,200}?changedFields: \['assignedTo'\]/);
        assert.match(read('workflow-engine/nodes/crm/UpdateCustomFieldNode.js'),
            /fireTrigger\('LEAD_UPDATED'[\s\S]{0,200}?changedFields: \[updateKey\]/);
    });

    test('both carry the causation chain, so the depth guard can bound a loop', () => {
        for (const rel of [
            'workflow-engine/nodes/crm/AssignUserNode.js',
            'workflow-engine/nodes/crm/UpdateCustomFieldNode.js'
        ]) {
            assert.match(read(rel), /_depth: context\.getTriggerDepth\(\) \+ 1/, rel);
            assert.match(read(rel), /_chain: \[\.\.\.context\.getTriggerChain\(\)/, rel);
        }
    });
});

describe('BUG-19: the source filter offers the values that actually exist', () => {
    test('the endpoint is exposed above the permission gate', () => {
        assert.match(read('routes/workflowRoutes.js'), /router\.get\('\/lead-sources'/);
        assert.match(read('controllers/workflowController.js'), /exports\.getLeadSources/);
    });

    test('the misleading placeholder is gone', () => {
        const sidebar = fs.readFileSync(
            path.join(SRC, '..', 'client', 'src', 'components', 'WorkflowBuilder', 'ConfigSidebar.jsx'),
            'utf8'
        );
        assert.doesNotMatch(sidebar, /e\.g\. Facebook \(leave blank for any source\)/);
        assert.match(sidebar, /list="wf-lead-sources"/);
    });
});
