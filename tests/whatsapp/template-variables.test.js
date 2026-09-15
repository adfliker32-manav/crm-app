// Template variable resolution — the mapping the tenant configures, and the
// values a third-party caller supplies.
//
// Three bugs are pinned here, all of which sent a wrong message with a 200 in
// hand rather than failing:
//
// 1. MAPPING NEVER SAVED ON AN APPROVED TEMPLATE. variableMapping sat inside
//    updateTemplate's `if (isDraft)` block, so the builder's mapping controls
//    were live on an APPROVED template, Save returned 200 and the change was
//    dropped — the one status where mapping matters, since only APPROVED
//    templates can be sent.
//
// 2. "Lead Stage" RESOLVED TO NOTHING. The builder saved `lead.status`; the
//    context exposes `lead.stage`. sanitizeParam turned the miss into "-".
//
// 3. "Company Name" RESOLVED TO NOTHING. No caller ever passed `company` to
//    buildTemplateContext, so that option was "-" on every send path.
//
// The rest covers the precedence contract for caller-supplied variables: with
// two sources able to fill one {{n}}, the rule has to live in exactly one place
// or the plan the caller is answered with drifts from what Meta receives.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const {
    buildTemplateContext, buildMetaComponents, resolveTemplate,
    normalizeVariableInput, planTemplateVariables, extractTemplateVariables,
    API_MAPPING
} = require(path.join(SRC, 'utils', 'templateResolver.js'));

const bodyOf = (comps) => comps.find(c => c.type === 'body').parameters.map(p => p.text);

// ─── the three silent-"-" bugs ───────────────────────────────────────────────
describe('mapping options that used to resolve to nothing', () => {
    test('a saved `lead.status` mapping still resolves, aliased to lead.stage', () => {
        const ctx = buildTemplateContext({ lead: { name: 'Rahul', status: 'Qualified' } });
        assert.strictEqual(resolveTemplate('{{lead.status}}', ctx), 'Qualified');
        assert.strictEqual(resolveTemplate('{{lead.stage}}', ctx), 'Qualified');

        const comps = buildMetaComponents(
            [{ type: 'BODY', text: 'Stage: {{1}}' }], { 1: 'lead.status' }, ctx
        );
        assert.deepStrictEqual(bodyOf(comps), ['Qualified'],
            'templates already saved with lead.status must keep working, not send "-"');
    });

    test('the builder no longer writes the broken `lead.status` value', () => {
        const ui = fs.readFileSync(
            path.join(__dirname, '..', '..', 'client', 'src', 'components', 'WhatsApp', 'TemplateBuilder.jsx'),
            'utf8'
        );
        assert.match(ui, /<option value="lead\.stage">/, 'the Lead Stage option must save the field that exists');
        assert.doesNotMatch(ui, /<option value="lead\.status">/);
    });

    test('company.name comes from the workspace owner when no company is passed', () => {
        const ctx = buildTemplateContext({ user: { name: 'Amit', companyName: 'Acme Exports' } });
        assert.strictEqual(ctx.company.name, 'Acme Exports');
        const comps = buildMetaComponents(
            [{ type: 'BODY', text: 'Team {{1}}' }], { 1: 'company.name' }, ctx
        );
        assert.deepStrictEqual(bodyOf(comps), ['Acme Exports']);
    });

    test('an explicitly passed company still wins over the owner', () => {
        const ctx = buildTemplateContext({
            user: { companyName: 'Acme Exports' },
            company: { name: 'Acme Logistics' }
        });
        assert.strictEqual(ctx.company.name, 'Acme Logistics');
    });
});

describe('variableMapping is a CRM-side setting, saved at any template status', () => {
    test('updateTemplate persists it outside the isDraft block', () => {
        const src = stripComments(read('controllers/whatsappTemplateController.js'));
        const update = src.slice(src.indexOf('exports.updateTemplate'), src.indexOf('exports.submitTemplate'));
        const draftAt   = update.indexOf('if (isDraft) {');
        const mappingAt = update.indexOf('template.variableMapping = variableMapping');
        assert.ok(mappingAt > -1, 'the mapping must still be persisted');
        assert.ok(mappingAt < draftAt,
            'inside the isDraft block the builder saves nothing on an APPROVED template, which is the only status that can send');
    });

    test('a mapping is rejected if it is not an object of text values', () => {
        const src = stripComments(read('controllers/whatsappTemplateController.js'));
        assert.match(src, /variableMapping must be an object keyed by variable number/);
        assert.match(src, /must be a text value/);
    });

    test('what Meta reviews never includes the mapping, so editing it cannot invalidate an approval', () => {
        const svc = stripComments(read('services/whatsappService.js'));
        const submit = svc.slice(svc.indexOf('const submitTemplateToMeta'));
        const payload = submit.slice(0, submit.indexOf('axios.post') + 400);
        assert.doesNotMatch(payload, /variableMapping/);
    });
});

// ─── caller-supplied variables ───────────────────────────────────────────────
describe('normalizeVariableInput', () => {
    test('accepts the three documented shapes', () => {
        assert.deepStrictEqual(normalizeVariableInput(['a', 'b']).value, { body: { 1: 'a', 2: 'b' } });
        assert.deepStrictEqual(normalizeVariableInput({ 1: 'a', 2: 'b' }).value, { body: { 1: 'a', 2: 'b' } });
        assert.deepStrictEqual(
            normalizeVariableInput({ body: { 1: 'a' }, header: { 1: 'h' } }).value,
            { body: { 1: 'a' }, header: { 1: 'h' } }
        );
    });

    test('absent, empty and blank inputs mean "no overrides", not an error', () => {
        for (const input of [undefined, null, [], {}]) {
            const r = normalizeVariableInput(input);
            assert.strictEqual(r.ok, true, `${JSON.stringify(input)} should be accepted`);
            assert.deepStrictEqual(r.value, {});
        }
    });

    test('collapses the whitespace Meta rejects and keeps numbers', () => {
        assert.deepStrictEqual(
            normalizeVariableInput({ 1: ' Acme\n\nPvt    Ltd ', 2: 1029 }).value,
            { body: { 1: 'Acme Pvt Ltd', 2: '1029' } }
        );
    });

    test('every bad value is reported at once rather than one per retry', () => {
        const r = normalizeVariableInput({ 1: '', 2: { a: 1 }, 3: 'x'.repeat(1025) });
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.errors.length, 3);
    });

    test('rejects out-of-range numbers, non-numeric keys and mixed shapes', () => {
        assert.strictEqual(normalizeVariableInput({ 0: 'a' }).ok, false);
        assert.strictEqual(normalizeVariableInput({ 101: 'a' }).ok, false);
        assert.strictEqual(normalizeVariableInput({ name: 'a' }).ok, false);
        assert.strictEqual(normalizeVariableInput({ body: { 1: 'a' }, 2: 'b' }).ok, false);
        assert.strictEqual(normalizeVariableInput('Rahul').ok, false);
        assert.strictEqual(normalizeVariableInput(7).ok, false);
    });
});

describe('extractTemplateVariables', () => {
    test('reports the numbers per component, deduped and sorted', () => {
        assert.deepStrictEqual(extractTemplateVariables([
            { type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' },
            { type: 'BODY', text: 'Hi {{2}}, about {{1}} and {{1}} again' },
            { type: 'FOOTER', text: 'no vars here' }
        ]), { body: [1, 2], header: [1] });
    });

    test('a media header is not reported — buildMetaComponents emits no text parameters for it', () => {
        // Reporting it would tell a caller to fill a variable that never reaches
        // Meta, and then reject the send for not filling it.
        assert.deepStrictEqual(
            extractTemplateVariables([{ type: 'HEADER', format: 'IMAGE', text: '{{1}}' }]),
            { body: [], header: [] }
        );
    });
});

describe('planTemplateVariables — precedence is decided in exactly one place', () => {
    const comps = [{ type: 'BODY', text: 'Hi {{1}}, your {{2}} is ready. Team {{3}}' }];
    const plan = (variableMapping, provided) =>
        planTemplateVariables({ components: comps, variableMapping, provided });

    test('an unmapped variable takes the caller value', () => {
        const p = plan({}, { body: { 1: 'Rahul' } });
        assert.deepStrictEqual(p.applied.body, { 1: 'Rahul' });
        assert.strictEqual(p.sources['body.1'], 'api');
        assert.deepStrictEqual(p.errors, []);
    });

    test('a mapped variable keeps the tenant value and reports the one it ignored', () => {
        const p = plan({ 1: 'lead.name' }, { body: { 1: 'Someone Else' } });
        assert.strictEqual(p.applied.body, undefined, 'nothing is overridden');
        assert.strictEqual(p.sources['body.1'], 'crm:lead.name');
        assert.strictEqual(p.warnings.length, 1);
    });

    test('an api-mapped variable is required, and the fallback satisfies it', () => {
        assert.deepStrictEqual(plan({ 2: API_MAPPING }, {}).missing, ['body.2']);
        const withFallback = plan({ 2: API_MAPPING, '2_custom': 'order' }, {});
        assert.deepStrictEqual(withFallback.missing, []);
        assert.strictEqual(withFallback.applied.body[2], 'order');
        assert.strictEqual(withFallback.sources['body.2'], 'fallback');
        assert.strictEqual(withFallback.warnings.length, 1);
    });

    test('a number the template does not carry is an error, never a silent drop', () => {
        const p = plan({}, { body: { 9: 'nope' } });
        assert.strictEqual(p.errors.length, 1);
        assert.match(p.errors[0], /\{\{9\}\}/);
    });

    test('a Mongoose Map mapping reads the same as a plain object', () => {
        const asMap = new Map([['1', 'lead.name'], ['2', API_MAPPING], ['2_custom', 'order']]);
        const fromMap = planTemplateVariables({ components: comps, variableMapping: asMap, provided: {} });
        const fromObj = plan({ 1: 'lead.name', 2: API_MAPPING, '2_custom': 'order' }, {});
        assert.deepStrictEqual(fromMap.sources, fromObj.sources);
        assert.deepStrictEqual(fromMap.applied, fromObj.applied);
    });

    test('planning mutates neither the mapping nor the provided values', () => {
        const mapping  = { 1: 'lead.name', 2: API_MAPPING };
        const provided = { body: { 2: 'invoice' } };
        const before   = [JSON.stringify(mapping), JSON.stringify(provided)];
        plan(mapping, provided);
        assert.deepStrictEqual([JSON.stringify(mapping), JSON.stringify(provided)], before);
    });

    test('buildMetaComponents only applies the plan, so the two cannot disagree', () => {
        // The override wins in build because the plan already put it in `applied`.
        // Were build to re-read the mapping and decide for itself, a caller could
        // be told its value was ignored while Meta received it (or the reverse).
        const mapping = { 1: 'lead.name', 2: API_MAPPING, 3: 'custom', '3_custom': 'Adfliker' };
        const p = plan(mapping, { body: { 1: 'Someone Else', 2: 'invoice', 3: 'Rival Corp' } });
        const ctx = buildTemplateContext({ lead: { name: 'Rahul Kumar' } });
        const out = bodyOf(buildMetaComponents(comps, mapping, ctx, p.applied));
        assert.deepStrictEqual(out, ['Rahul Kumar', 'invoice', 'Adfliker']);
        assert.strictEqual(p.sources['body.1'], 'crm:lead.name');
        assert.strictEqual(p.sources['body.2'], 'api');
        assert.strictEqual(p.sources['body.3'], 'crm:custom');
    });

    test('header and body of one template resolve independently', () => {
        const both = [
            { type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' },
            { type: 'BODY', text: 'Hi {{1}}' }
        ];
        const p = planTemplateVariables({
            components: both,
            variableMapping: { 1: API_MAPPING },
            provided: { header: { 1: 'A-1029' }, body: { 1: 'Rahul' } }
        });
        const ctx = buildTemplateContext({ lead: { name: 'Ignored' } });
        const out = buildMetaComponents(both, { 1: API_MAPPING }, ctx, p.applied);
        assert.strictEqual(out.find(c => c.type === 'header').parameters[0].text, 'A-1029');
        assert.strictEqual(out.find(c => c.type === 'body').parameters[0].text, 'Rahul');
    });
});

describe('the External API endpoint enforces the plan', () => {
    const ctrl = stripComments(read('controllers/extApiController.js'));
    const handler = ctrl.slice(ctrl.indexOf('exports.sendWhatsAppTemplate'), ctrl.indexOf('exports.listWhatsAppTemplates'));

    test('the shape is validated before any lookup, so a bad payload costs no query', () => {
        assert.ok(handler.indexOf('normalizeVariableInput') < handler.indexOf('Lead.findOne'));
    });

    test('missing required values stop the send instead of reaching the customer', () => {
        assert.ok(handler.indexOf('variables_required') < handler.indexOf('sendWhatsAppMessage'));
        assert.ok(handler.indexOf('invalid_variables') < handler.indexOf('sendWhatsAppMessage'));
    });

    test('the plan is built from the single template snapshot already read', () => {
        // A second read could pick up a mapping edit landing mid-request and
        // produce a message matching neither the plan nor the tenant's intent.
        assert.strictEqual((handler.match(/WhatsAppTemplate\.findOne/g) || []).length, 1);
        assert.ok(handler.indexOf('planTemplateVariables') > handler.indexOf('WhatsAppTemplate.findOne'));
    });

    test('the response tells the caller which source filled each placeholder', () => {
        assert.match(handler, /variableSources: plan\.sources/);
        assert.match(handler, /warnings: \[/);
    });
});

describe('a hostile or runaway payload cannot amplify into the response', () => {
    // express.json caps a body at 100kb, which still fits thousands of short
    // entries. One error line per entry would answer a small request with a
    // megabyte of text, so the count is refused wholesale and the itemised list
    // is capped.
    test('more entries than any template can have is one error, not thousands', () => {
        const r = normalizeVariableInput(new Array(5000).fill('x'));
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.errors.length, 1);
        assert.match(r.errors[0], /at most 100 variables/);
    });

    test('the same cap applies to an object and to each scope', () => {
        const huge = {};
        for (let i = 1; i <= 500; i++) huge[i] = 'x';
        assert.strictEqual(normalizeVariableInput(huge).errors.length, 1);
        assert.strictEqual(normalizeVariableInput({ body: huge, header: huge }).errors.length, 2);
    });

    test('a long but legal list still reports at most a handful of problems', () => {
        const bad = {};
        for (let i = 1; i <= 60; i++) bad[i] = '';
        const r = normalizeVariableInput(bad);
        assert.strictEqual(r.ok, false);
        assert.strictEqual(r.errors.length, 11, '10 problems plus the "and N more" line');
        assert.match(r.errors[10], /and 50 more problems/);
    });

    test('a payload at the cap is still processed normally', () => {
        const ok = {};
        for (let i = 1; i <= 100; i++) ok[i] = 'value';
        const r = normalizeVariableInput(ok);
        assert.strictEqual(r.ok, true);
        assert.strictEqual(Object.keys(r.value.body).length, 100);
    });
});

describe('duplicating a template keeps its mapping, without sharing it', () => {
    test('the duplicate carries the mapping over', () => {
        const src = stripComments(read('controllers/whatsappTemplateController.js'));
        const dup = src.slice(src.indexOf('exports.duplicateTemplate'), src.indexOf('exports.getTemplateAnalytics'));
        assert.match(dup, /variableMapping:/,
            'a copy without the mapping silently reverts every {{n}} to the positional default');
    });

    test('it is spread into a plain object, not handed over as the same Map', () => {
        // Mongoose keeps ONE Map instance across both documents, so passing
        // original.variableMapping straight in makes an edit to the copy rewrite
        // the original's mapping as well.
        const src = stripComments(read('controllers/whatsappTemplateController.js'));
        const dup = src.slice(src.indexOf('exports.duplicateTemplate'), src.indexOf('exports.getTemplateAnalytics'));
        assert.match(dup, /Object\.fromEntries\(original\.variableMapping\)/);
    });

    test('the Map really is shared without the spread — the reason the test above exists', () => {
        const path = require('node:path');
        const T = require(path.join(SRC, 'models', 'WhatsAppTemplate.js'));
        const base = { userId: '0'.repeat(23) + '1', language: 'en', category: 'UTILITY', components: [] };
        const original = new T({ ...base, name: 'a', variableMapping: { 1: 'api' } });

        const aliased = new T({ ...base, name: 'b', variableMapping: original.variableMapping });
        assert.strictEqual(aliased.variableMapping, original.variableMapping, 'same instance');

        const copied = new T({ ...base, name: 'c', variableMapping: Object.fromEntries(original.variableMapping) });
        copied.variableMapping.set('1', 'custom');
        assert.strictEqual(original.variableMapping.get('1'), 'api', 'the original must be untouched');
    });
});
