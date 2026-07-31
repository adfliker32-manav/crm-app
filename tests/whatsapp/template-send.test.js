// WhatsApp template sending — language resolution and Meta error classification.
//
// These cover the two criticals from the 2026-07-30 WhatsApp module audit, both
// of which were still live when re-checked on 2026-07-31.
//
// 1. LANGUAGE. Meta identifies a template by the PAIR (name, language). Ask for a
//    language the template was not created in and it returns 132001 and drops the
//    message. WhatsAppTemplate.language defaults to 'en' and the builder UI
//    creates 'en', but sendWhatsAppMessage defaulted its parameter to 'en_US' —
//    and 11 of 16 call sites omit the argument. Every automation rule, cron
//    reminder, drip step and the workflow send node therefore failed silently.
//
// 2. ERROR CLASSIFICATION. sendWhatsAppMessage THROWS on failure; it never
//    returns a failure shape. The broadcast worker classified Meta errors on
//    `result.success === false`, which is unreachable, so a template paused by
//    Meta mid-run never aborted the broadcast — the worker kept sending a blocked
//    template to every remaining contact, which is what gets a WABA restricted.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// ─── Language ────────────────────────────────────────────────────────────────

test('the stored template language and the send default cannot silently disagree', () => {
    const model = read('models/WhatsAppTemplate.js');
    const schemaDefault = model.match(/default:\s*'([a-z_A-Z]+)'\s*\/\/ ISO 639-1/)?.[1];
    assert.strictEqual(schemaDefault, 'en', 'templates are created as en');

    const svc = stripComments(read('services/whatsappService.js'));
    // The parameter must NOT carry a hardcoded language default any more — that is
    // exactly what made 11 call sites request en_US for an en template.
    assert.doesNotMatch(svc, /languageCode\s*=\s*'en_US'\s*\)/,
        'sendWhatsAppMessage must not default the language to en_US');
    assert.match(svc, /languageCode\s*=\s*null\s*\)/,
        'the language must be resolved, not assumed');
});

test('the language is resolved from the stored template', () => {
    const svc = stripComments(read('services/whatsappService.js'));
    assert.match(svc, /const resolveTemplateLanguage =/);
    // Explicit argument wins, so bulk paths that already hold the template skip
    // the extra query.
    assert.match(svc, /if \(explicitLanguage\) return explicitLanguage;/);
    assert.match(svc, /WhatsAppTemplate\.findOne\(\{ userId, name: templateName \}\)/);
    // The resolved value, not the raw parameter, must reach Meta.
    assert.match(svc, /code:\s*resolvedLanguage/);
});

test('the (name, language) pair is unambiguous — one template per name per tenant', () => {
    // Resolving language by name is only correct because this index guarantees a
    // single row. If it were ever dropped, the lookup could pick either language.
    const model = read('models/WhatsAppTemplate.js');
    assert.match(model, /index\(\{ userId: 1, name: 1 \}, \{ unique: true \}\)/);
});

test('every send site either passes a language or supplies a userId to resolve one', () => {
    // resolveTemplateLanguage needs userId to find the template. A call site that
    // passes neither would fall back to en_US and reintroduce the bug.
    const files = [
        'services/AutomationService.js', 'services/cronJobs.js',
        'services/sequenceService.js', 'services/whatsappQueueService.js',
        'services/whatsappAutomationService.js', 'services/broadcastQueueService.js',
        'controllers/whatsappTemplateController.js', 'controllers/mcpController.js',
        'controllers/whatsappConversationController.js',
        'workflow-engine/nodes/communication/SendWhatsAppNode.js'
    ];
    const offenders = [];
    for (const f of files) {
        const src = stripComments(read(f));
        for (const m of src.matchAll(/sendWhatsAppMessage\(([^;]*?)\)\s*;/gs)) {
            const args = m[1].split(',').map(a => a.trim());
            if (args.length < 3 || !args[2] || args[2] === 'null') {
                offenders.push(`${f}: ${m[0].slice(0, 90)}`);
            }
        }
    }
    assert.deepStrictEqual(offenders, [],
        `these sends can neither state nor resolve a language:\n${offenders.join('\n')}`);
});

test('the workflow node passes the template it already loaded', () => {
    // It fetches the template to check approval, so omitting the language here was
    // a free bug — the correct value was already in hand.
    const node = stripComments(read('workflow-engine/nodes/communication/SendWhatsAppNode.js'));
    assert.match(node, /sendWhatsAppMessage\([^)]*template\.language\)/);
});

test('a 132001 mismatch is reported as a language problem, not a generic failure', () => {
    // Meta's payload never says "language", so this used to be misread as an
    // approval problem and sent people looking in the wrong place.
    const svc = read('services/whatsappService.js');
    assert.match(svc, /132001/);
    assert.match(svc, /language/i);
});

// ─── Broadcast error classification ──────────────────────────────────────────

test('Meta errors are classified where they actually arrive — the catch', () => {
    const bq = stripComments(read('services/broadcastQueueService.js'));

    // The unreachable guard must be gone.
    assert.doesNotMatch(bq, /result\.success === false/,
        'sendWhatsAppMessage throws; it never returns { success: false }');

    // Classification must read the thrown axios error, not a return value.
    assert.match(bq, /err\.response\?\.data\?\.error\?\.code/);

    const catchBlock = bq.slice(bq.indexOf('} catch (err) {'));
    for (const codes of ['META_RATE_LIMIT_CODES', 'META_TEMPLATE_BLOCKED', 'META_PERMANENT_FAIL']) {
        assert.ok(catchBlock.includes(codes),
            `${codes} must be checked in the catch, or its branch is dead`);
    }
});

test('a template paused by Meta still aborts the whole broadcast', () => {
    // The single most damaging consequence of the dead branching: continuing to
    // blast a blocked template drives the WABA quality rating down.
    const bq = stripComments(read('services/broadcastQueueService.js'));
    const catchBlock = bq.slice(bq.indexOf('} catch (err) {'));
    assert.match(catchBlock, /isTemplateFatal = true/);
    assert.match(catchBlock, /isRateLimit = true/);
    // And the pre-existing re-throw must still let them escape to _processBatch.
    assert.match(catchBlock, /if \(err\.isRateLimit \|\| err\.isTemplateFatal\) throw err;/);
});

test('the Meta code lists still cover the codes the branches name', () => {
    const bq = read('services/broadcastQueueService.js');
    assert.match(bq, /META_RATE_LIMIT_CODES\s*=\s*\['131056', '131045', '131057'\]/);
    assert.match(bq, /META_TEMPLATE_BLOCKED\s*=\s*\['131031', '131026'\]/);
    assert.match(bq, /META_PERMANENT_FAIL\s*=\s*\['130472', '131047', '131021'\]/);
});

// ─── Approval pre-check ──────────────────────────────────────────────────────

test('the approval guard blocks what Meta will reject, but not what it might accept', () => {
    const svc = stripComments(read('services/whatsappService.js'));
    assert.match(svc, /const checkTemplateSendable =/);

    const fn = svc.slice(svc.indexOf('const checkTemplateSendable ='));
    const body = fn.slice(0, fn.indexOf('const sendWhatsAppMessage'));

    // Known-bad status → blocked. Meta's template-status webhook keeps this fresh.
    assert.match(body, /template\.status !== 'APPROVED'/);
    assert.match(body, /ok: false/);

    // Unknown template → ALLOWED. It may exist in Meta and simply not be synced
    // here; blocking it would silently stop sends that work today. This is the
    // deliberate difference from a naive `!template || status !== APPROVED` gate.
    assert.match(body, /not_in_crm/);
    assert.match(body, /ok: true, reason: 'not_in_crm'/);

    // A lookup failure must not swallow the send either.
    assert.match(body, /precheck_error/);
});

test('every unguarded automated send path now checks approval', () => {
    // These four fired at Meta with no approval check, so a rejected or
    // quality-paused template produced a guaranteed API failure on every run —
    // and the crons repeat, so it recurred indefinitely.
    const paths = [
        ['services/sequenceService.js',      'drip sequence step'],
        ['services/whatsappQueueService.js', 'no-reply follow-up'],
        ['services/cronJobs.js',             'scheduled follow-up'],
        ['services/AutomationService.js',    'if-replied follow-up']
    ];
    for (const [file, label] of paths) {
        const src = stripComments(read(file));
        assert.match(src, /checkTemplateSendable\(/,
            `${label} (${file}) still sends without checking template approval`);
    }
});

test('the approval guard and the language fix share one lookup', () => {
    // checkTemplateSendable returns the template, so callers pass its language
    // straight through rather than making resolveTemplateLanguage query again.
    for (const f of ['services/sequenceService.js', 'services/cronJobs.js',
                     'services/AutomationService.js', 'services/whatsappQueueService.js']) {
        const src = stripComments(read(f));
        assert.match(src, /Gate(\?)?\.template\?\.language|gate\.template\?\.language/,
            `${f} should reuse the gate's template for the language`);
    }
});

// ─── Template name ───────────────────────────────────────────────────────────

test('template names are constrained to what Meta accepts', () => {
    // Meta rejects anything outside lowercase/digits/underscore. Enforced in both
    // the schema and the controller, so a bad name cannot reach Meta.
    const model = read('models/WhatsAppTemplate.js');
    assert.match(model, /match:\s*\/\^\[a-z0-9_\]\+\$\//);
    assert.match(model, /lowercase:\s*true/);
    const ctrl = read('controllers/whatsappTemplateController.js');
    assert.match(ctrl, /\/\^\[a-z0-9_\]\+\$\/\.test\(name\)/);
});
