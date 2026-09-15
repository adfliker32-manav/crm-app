// POST /api/partner/v1/whatsapp/template — the values a partner sends.
//
// This endpoint handed `variables` to Meta as the template's `components` array
// verbatim. Our own integration guide documented the flat list
// `["John", "3 PM", "Tomorrow"]`, which is not a components array, so every
// partner following the guide got a Meta rejection wrapped in a 500 — a status
// that tells their client to retry a send that can only fail again.
//
// Two more faults sat in the same four lines:
//   - `languageCode || 'en'` reached a service whose language lookup is skipped
//     whenever a language is passed, so a template approved as en_US could only
//     fail with 132001 — including for callers that sent no language at all.
//   - Nothing checked the template existed or was APPROVED, so a typo left the
//     account with a Meta error instead of an answer it could act on.
//
// The endpoint now shares the External API's plan (templateResolver), so the
// question "who fills {{2}}, the caller or the workspace?" has one answer in
// one place for both APIs.

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

const ROOT = path.join(__dirname, '..', '..');
const R = (p) => require.resolve(path.join(ROOT, p));

const stub = (relPath, exports) => {
    const full = R(relPath);
    require.cache[full] = new Module(full, null);
    require.cache[full].filename = full;
    require.cache[full].loaded = true;
    require.cache[full].exports = exports;
};

const TENANT = '0'.repeat(23) + '1';

let DB, calls;
const reset = () => {
    calls = { template: [], text: [] };
    DB = {
        templates: [],
        users: [{ _id: TENANT, name: 'Owner', companyName: 'Client Co' }]
    };
};
reset();

// Only the leaf that a call actually reaches needs to be real; the chain shape
// (findOne().lean(), findById().select().lean()) is what the controller uses.
const chain = (get) => {
    const p = Promise.resolve().then(get);
    p.lean = () => p;
    p.select = () => p;
    p.sort = () => p;
    return p;
};

stub('src/models/WhatsAppTemplate.js', {
    findOne: (q) => chain(() => DB.templates.find(t =>
        String(t.userId) === String(q.userId) && t.name === q.name) || null),
    find: (q) => chain(() => DB.templates.filter(t => String(t.userId) === String(q.userId)))
});
stub('src/models/User.js', {
    findById: (id) => chain(() => DB.users.find(u => String(u._id) === String(id)) || null)
});
stub('src/models/WorkspaceSettings.js', {});
stub('src/models/IntegrationConfig.js', {});
stub('src/models/PartnerApp.js', {});
stub('src/models/EmbedToken.js', {});
stub('src/models/WhatsAppConversation.js', {});
stub('src/models/WhatsAppMessage.js', {});
stub('src/services/partnerWebhookService.js', {
    forwardIfPartnerAccount: async () => {},
    clearCacheForTenant: () => {},
    clearCacheForPartner: () => {}
});
stub('src/utils/ssrfGuard.js', { validateOutboundUrl: async () => ({ ok: true }) });
stub('src/middleware/authMiddleware.js', { clearTokenVersionCache: () => {} });
stub('src/services/mediaLibraryService.js', { resolveTemplateMedia: async () => null });

let metaError = null;
stub('src/services/whatsappService.js', {
    sendWhatsAppTextMessage: async (to, message, userId) => {
        calls.text.push({ to, message, userId });
        return { messages: [{ id: 'wamid.TEXT' }] };
    },
    sendWhatsAppTemplateMessage: async (to, templateName, languageCode, components, userId) => {
        if (metaError) {
            const err = new Error('Request failed');
            err.response = { data: { error: metaError } };
            throw err;
        }
        calls.template.push({ to, templateName, languageCode, components, userId });
        return { messages: [{ id: `wamid.TPL${calls.template.length}` }] };
    }
});

// Real on purpose — templateResolver is the logic under test.
const ctrl = require(R('src/controllers/partnerApiController.js'));

const mkRes = () => ({
    code: 200, payload: null,
    status(c) { this.code = c; return this; },
    json(p) { this.payload = p; return this; }
});
const send = async (body) => {
    const res = mkRes();
    await ctrl.sendTemplate({ body, query: {}, params: {}, tenantId: TENANT }, res);
    return res;
};
const seedTpl = (over = {}) => {
    const t = {
        _id: '0'.repeat(22) + '21', userId: TENANT, name: 'order_ready',
        language: 'en', category: 'UTILITY', status: 'APPROVED',
        components: [{ type: 'BODY', text: 'Hi {{1}}, your {{2}} is ready. Team {{3}}' }],
        variableMapping: {}, ...over
    };
    DB.templates.push(t);
    return t;
};
const params = (i = 0) =>
    calls.template[i].components.find(c => c.type === 'body').parameters.map(p => p.text);

beforeEach(() => { reset(); metaError = null; });

describe('the flat list our own guide documented', () => {
    test('["Rahul", "invoice", "Adfliker"] becomes real Meta parameters', () => {
        seedTpl();
        return send({ phone: '919876543210', templateName: 'order_ready',
            variables: ['Rahul', 'invoice', 'Adfliker'] }).then(res => {
            assert.strictEqual(res.code, 200);
            // What reached Meta before this fix: components = ["Rahul", …],
            // three bare strings where objects were required.
            assert.deepStrictEqual(params(), ['Rahul', 'invoice', 'Adfliker']);
            assert.deepStrictEqual(calls.template[0].components[0].type, 'body');
        });
    });

    test('an object keyed by variable number works too', async () => {
        seedTpl();
        await send({ phone: '919876543210', templateName: 'order_ready', variables: { 2: 'invoice' } });
        assert.strictEqual(params()[1], 'invoice');
    });

    test('a template with variables and no values sent still gets a full parameter set', async () => {
        // Meta rejects on a count mismatch and its error names no field, so the
        // components have to match the approved shape either way.
        seedTpl();
        const res = await send({ phone: '919876543210', templateName: 'order_ready' });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(params().length, 3);
    });
});

describe('the precedence contract is the same as the External API', () => {
    test("a variable mapped to the workspace's own text is not replaceable by a partner", async () => {
        seedTpl({ variableMapping: { 3: 'custom', '3_custom': 'Adfliker Pvt Ltd' } });
        const res = await send({ phone: '919876543210', templateName: 'order_ready',
            variables: { 3: 'Rival Corp' } });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(params()[2], 'Adfliker Pvt Ltd');
        assert.strictEqual(res.payload.variableSources['body.3'], 'crm:custom');
        assert.match(res.payload.warnings.join(' '), /ignored/);
    });

    test('an api-mapped variable with no value and no fallback is refused before Meta', async () => {
        seedTpl({ variableMapping: { 2: 'api' } });
        const res = await send({ phone: '919876543210', templateName: 'order_ready' });
        assert.strictEqual(res.code, 400);
        assert.strictEqual(res.payload.error, 'variables_required');
        assert.deepStrictEqual(res.payload.required, [{ scope: 'body', variable: 2 }]);
        assert.strictEqual(calls.template.length, 0);
    });

    test('a number the template does not have, and malformed values, are rejected', async () => {
        seedTpl();
        for (const variables of [{ 9: 'nope' }, { 1: { a: 1 } }, { 1: '' }, { 1: 'x'.repeat(1025) }]) {
            const res = await send({ phone: '919876543210', templateName: 'order_ready', variables });
            assert.strictEqual(res.code, 400, JSON.stringify(variables));
            assert.strictEqual(res.payload.error, 'invalid_variables');
        }
        assert.strictEqual(calls.template.length, 0);
    });

    test('the response names the source of every placeholder', async () => {
        seedTpl({ variableMapping: { 1: 'lead.phone', 2: 'api' } });
        const res = await send({ phone: '919876543210', templateName: 'order_ready',
            variables: { 2: 'invoice' } });
        assert.deepStrictEqual(res.payload.variableSources, {
            'body.1': 'crm:lead.phone', 'body.2': 'api', 'body.3': 'auto'
        });
    });
});

describe('a partner already sending raw Meta components keeps working', () => {
    test('the ready-made shape is passed through untouched, with a nudge to stop', async () => {
        seedTpl();
        const raw = [{ type: 'body', parameters: [
            { type: 'text', text: 'Rahul' }, { type: 'text', text: 'invoice' }, { type: 'text', text: 'Adfliker' }
        ] }];
        const res = await send({ phone: '919876543210', templateName: 'order_ready', variables: raw });
        assert.strictEqual(res.code, 200);
        assert.deepStrictEqual(calls.template[0].components, raw);
        assert.match(res.payload.warnings.join(' '), /ready-made Meta components/);
    });
});

describe('language, status and failure reporting', () => {
    test('the approved language wins over whatever the caller sent', async () => {
        // `languageCode || 'en'` reached a service that skips its own lookup when
        // a language is passed, so an en_US template could only 132001.
        seedTpl({ language: 'en_US' });
        const res = await send({ phone: '919876543210', templateName: 'order_ready', languageCode: 'en' });
        assert.strictEqual(calls.template[0].languageCode, 'en_US');
        assert.match(res.payload.warnings.join(' '), /approved in "en_US"/);
    });

    test('no languageCode at all still resolves to the approved one', async () => {
        seedTpl({ language: 'en_US' });
        const res = await send({ phone: '919876543210', templateName: 'order_ready' });
        assert.strictEqual(calls.template[0].languageCode, 'en_US');
        assert.strictEqual(res.payload.warnings, undefined, 'nothing to warn about when no language was asked for');
    });

    test('a name this account does not store is a 404 only when values must be mapped to it', async () => {
        const res = await send({ phone: '919876543210', templateName: 'typo_name', variables: { 1: 'Rahul' } });
        assert.strictEqual(res.code, 404);
        assert.strictEqual(res.payload.error, 'template_not_found');
        assert.match(res.payload.message, /whatsapp\/templates/);
    });

    test('an unapproved template is refused here rather than by Meta', async () => {
        seedTpl({ status: 'PENDING' });
        const res = await send({ phone: '919876543210', templateName: 'order_ready' });
        assert.strictEqual(res.code, 400);
        assert.strictEqual(res.payload.error, 'template_not_approved');
        assert.match(res.payload.message, /PENDING/);
        assert.strictEqual(calls.template.length, 0);
    });

    test("another account's template is never read, mapping and all", async () => {
        // It is not an error to send a name this account does not store — see the
        // unsynced-template suite below — so what has to hold is that the foreign
        // row contributes nothing: no mapping, no static text, no components. The
        // send itself runs on THIS account's own WhatsApp credentials.
        seedTpl({
            userId: '0'.repeat(23) + '2',
            variableMapping: { 1: 'custom', '1_custom': 'RIVAL SECRET' }
        });
        const res = await send({ phone: '919876543210', templateName: 'order_ready' });
        assert.strictEqual(calls.template[0].userId, TENANT);
        assert.deepStrictEqual(calls.template[0].components, [],
            "a foreign template's components must never be built into our send");
        assert.deepStrictEqual(res.payload.variableSources, {});
        assert.match(res.payload.warnings.join(' '), /not stored in this account/);
    });

    test("plain values against another account's template are refused", async () => {
        seedTpl({ userId: '0'.repeat(23) + '2' });
        const res = await send({ phone: '919876543210', templateName: 'order_ready', variables: ['x'] });
        assert.strictEqual(res.code, 404);
        assert.strictEqual(calls.template.length, 0);
    });

    test('a Meta rejection is a 422 carrying its code, not a retryable 500', async () => {
        seedTpl();
        metaError = { code: 132000, message: 'Number of parameters does not match' };
        const res = await send({ phone: '919876543210', templateName: 'order_ready' });
        assert.strictEqual(res.code, 422);
        assert.strictEqual(res.payload.error, 'whatsapp_send_failed');
        assert.strictEqual(res.payload.metaCode, 132000);
    });

    test('phone and templateName are still both required', async () => {
        assert.strictEqual((await send({ templateName: 'order_ready' })).code, 400);
        assert.strictEqual((await send({ phone: '919876543210' })).code, 400);
    });

    test('the raw Meta response stays on `data` for callers already reading it', async () => {
        seedTpl();
        const res = await send({ phone: '919876543210', templateName: 'order_ready' });
        assert.strictEqual(res.payload.data.messages[0].id, 'wamid.TPL1');
        assert.strictEqual(res.payload.messageId, 'wamid.TPL1');
    });
});

describe('a template this CRM does not store', () => {
    // Nothing imports the templates a WABA already had — only templates created
    // in this CRM land in the database (see whatsappService's own en_US fallback
    // note for "an unsynced one, or Meta's hello_world"). Those sends worked
    // before, so a 404 here would break a live partner.
    test('still sends when no values need mapping', async () => {
        const res = await send({ phone: '919876543210', templateName: 'hello_world' });
        assert.strictEqual(res.code, 200);
        assert.strictEqual(calls.template.length, 1);
        assert.strictEqual(calls.template[0].templateName, 'hello_world');
        assert.match(res.payload.warnings.join(' '), /not stored in this account/);
    });

    test('a ready-made components array still goes through untouched', async () => {
        const raw = [{ type: 'body', parameters: [{ type: 'text', text: 'Rahul' }] }];
        const res = await send({ phone: '919876543210', templateName: 'hello_world', variables: raw });
        assert.strictEqual(res.code, 200);
        assert.deepStrictEqual(calls.template[0].components, raw);
    });

    test('the language is left for the service to resolve, not forced to en', async () => {
        await send({ phone: '919876543210', templateName: 'hello_world' });
        assert.strictEqual(calls.template[0].languageCode, null,
            'a null lets resolveTemplateLanguage apply its en_US fallback; "en" would 132001 on hello_world');
    });

    test('plain values are refused, because there are no placeholders to match them to', async () => {
        const res = await send({ phone: '919876543210', templateName: 'hello_world', variables: ['Rahul'] });
        assert.strictEqual(res.code, 404);
        assert.strictEqual(res.payload.error, 'template_not_found');
        assert.strictEqual(calls.template.length, 0);
    });

    test('a malformed variables payload is caught before the send either way', async () => {
        const res = await send({ phone: '919876543210', templateName: 'hello_world', variables: { 1: { a: 1 } } });
        assert.strictEqual(res.code, 400);
        assert.strictEqual(res.payload.error, 'invalid_variables');
        assert.strictEqual(calls.template.length, 0);
    });

    test('a non-string templateName is rejected rather than queried', async () => {
        const res = await send({ phone: '919876543210', templateName: { $ne: null } });
        assert.strictEqual(res.code, 400);
        assert.strictEqual(calls.template.length, 0);
    });
});
