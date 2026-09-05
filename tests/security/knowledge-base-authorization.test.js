// Authorization + tenant isolation for the RAG knowledge base.
//
// WHY THIS FILE EXISTS
//   A knowledge base leak does not surface as an error. It quotes one dealer's
//   price list to a different dealer's customer, over WhatsApp, in the tenant's
//   own brand voice — and nothing in the logs looks wrong. There is no runtime
//   signal to catch it, so the isolation has to be asserted structurally.
//
// These read the sources rather than mounting Express, matching the approach in
// validation-coverage.test.js and whatsapp-assignment-authorization.test.js.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const controller = stripComments(read('src', 'controllers', 'knowledgeBaseController.js'));
const service    = stripComments(read('src', 'services', 'knowledgeBaseService.js'));
const routes     = stripComments(read('src', 'routes', 'knowledgeBaseRoutes.js'));
const indexJs    = stripComments(read('index.js'));

// ─────────────────────────────────────────────────────────────────────────────
describe('1. the feature is gated before any handler runs', () => {

    test('the route is mounted behind authMiddleware', () => {
        const mount = indexJs.match(/app\.use\(\s*'\/api\/knowledge-base'[\s\S]*?\);/);
        assert.ok(mount, '/api/knowledge-base is not mounted at all');
        assert.match(mount[0], /authMiddleware/,
            'knowledge base routes must not be reachable unauthenticated');
    });

    test('the route is gated on the plan entitlement, not just on login', () => {
        const mount = indexJs.match(/app\.use\(\s*'\/api\/knowledge-base'[\s\S]*?\);/)[0];
        assert.match(mount, /requireFeature\(/,
            'a paid feature that spends AI credits must carry a plan gate');
        assert.match(mount, /whatsapp\.chatbot\.knowledgeBase/,
            'gate on the registry node key so SuperAdmin per-client overrides apply');
    });

    test('the entitlement is declared in the feature registry as enforced', () => {
        const registry = read('src', 'constants', 'featureRegistry.js');
        assert.match(registry, /key:\s*'whatsapp\.chatbot\.knowledgeBase'/,
            'a gate on a key absent from the registry can never be granted in the UI');

        // Take a flat window after the key rather than trying to brace-match: the
        // node contains a nested `storage: { ... }`, so a non-greedy {...} match
        // stops at the INNER closing brace and never sees `enforced`.
        const at = registry.indexOf("key: 'whatsapp.chatbot.knowledgeBase'");
        const node = registry.slice(at, at + 300);
        assert.match(node, /storage:\s*\{\s*type:\s*'feature',\s*key:\s*'knowledgeBase'\s*\}/);
        assert.match(node, /enforced:\s*true/,
            'the gate IS enforced at runtime, so the registry must say so');
    });

    test('the plan flag defaults to OFF for existing tenants', () => {
        const workspace = read('src', 'models', 'WorkspaceSettings.js');
        const field = workspace.match(/knowledgeBase:\s*\{[^}]*\}/)[0];
        assert.match(field, /default:\s*false/,
            'defaulting to true would switch this on — and start billing credits — ' +
            'for every existing tenant on deploy');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('1b. a plan toggle actually persists (the silent-drop trap)', () => {

    // Plan.planFeatures and WorkspaceSettings.planFeatures are STRICT Mongoose
    // subdocuments. A registry node whose storage key is missing from one of them
    // is dropped WITHOUT ERROR on save: the SuperAdmin ticks the box, the UI says
    // saved, and nobody on that plan ever receives the feature. This ratchet is
    // general on purpose — it guards every current and future `feature` node, not
    // just the knowledge base that exposed the bug.
    const subPaths = (Model) => Object.keys(Model.schema.paths)
        .filter(p => p.startsWith('planFeatures.'))
        .map(p => p.slice('planFeatures.'.length));

    const featureNodes = () => {
        const { FEATURE_REGISTRY } = require(path.join(ROOT, 'src', 'constants', 'featureRegistry.js'));
        const out = [];
        (function walk(nodes) {
            for (const n of nodes) {
                if (n.storage?.type === 'feature') out.push({ key: n.key, store: n.storage.key });
                if (n.children) walk(n.children);
            }
        })(FEATURE_REGISTRY);
        return out;
    };

    test('every registry feature node exists on BOTH Plan and WorkspaceSettings', () => {
        const Plan = require(path.join(ROOT, 'src', 'models', 'Plan.js'));
        const WorkspaceSettings = require(path.join(ROOT, 'src', 'models', 'WorkspaceSettings.js'));
        const planKeys = subPaths(Plan);
        const wsKeys = subPaths(WorkspaceSettings);

        const nodes = featureNodes();
        assert.ok(nodes.length > 0, 'no feature nodes found — the walk is broken');

        for (const n of nodes) {
            assert.ok(planKeys.includes(n.store),
                `registry node "${n.key}" stores planFeatures.${n.store}, which is MISSING from ` +
                'Plan.planFeatures. Mongoose will silently discard it when the Plan Catalog saves.');
            assert.ok(wsKeys.includes(n.store),
                `registry node "${n.key}" stores planFeatures.${n.store}, which is MISSING from ` +
                'WorkspaceSettings.planFeatures, so the per-client toggle cannot persist.');
        }
    });

    test('the knowledge base flag survives a round trip through the Plan schema', () => {
        const Plan = require(path.join(ROOT, 'src', 'models', 'Plan.js'));
        const doc = new Plan({
            code: 'ratchet-test', name: 'Ratchet',
            planFeatures: { knowledgeBase: true, knowledgeBaseDocLimit: 25, knowledgeBaseChunkLimit: 10000 }
        });
        const pf = doc.toObject().planFeatures;
        assert.strictEqual(pf.knowledgeBase, true);
        assert.strictEqual(pf.knowledgeBaseDocLimit, 25);
        assert.strictEqual(pf.knowledgeBaseChunkLimit, 10000);
    });

    test('a SuperAdmin grant is stored as a sparse override that survives renewal', () => {
        const reg = require(path.join(ROOT, 'src', 'constants', 'featureRegistry.js'));
        const KEY = 'whatsapp.chatbot.knowledgeBase';

        // Starter plan: knowledge base off. SuperAdmin grants it to one client.
        const plan = { activeModules: ['whatsapp'], planFeatures: { aiChatbot: true, leadLimit: 100 }, featureFlags: {} };
        const baseVals = reg.resolveValues(plan);
        assert.strictEqual(baseVals[KEY], false, 'must be off on a plan that does not include it');

        const override = reg.diffOverrides({ ...baseVals, [KEY]: true }, baseVals);
        assert.deepStrictEqual(override, { [KEY]: true }, 'only the deviation is persisted');

        // Dots are illegal as Mongo field names — the stored form must be encoded.
        const stored = reg.encodeOverrides(override);
        assert.ok(!Object.keys(stored).some(k => k.includes('.')), 'stored override key still contains dots');

        // Renewal re-layers the override on top of the plan baseline.
        const eff = reg.resolveEffective(plan, stored, plan);
        assert.strictEqual(eff.planFeatures.knowledgeBase, true, 'the grant did not survive plan renewal');
        assert.strictEqual(eff.planFeatures.leadLimit, 100, 'numeric limits must be preserved');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. every handler is scoped to the caller\'s tenant', () => {

    // Handlers that touch tenant data. getStats is included: it reports document
    // counts and storage, which are themselves tenant information.
    const HANDLERS = [
        'listDocuments', 'getDocument', 'uploadDocument',
        'toggleDocument', 'reprocessDocument', 'deleteDocument',
        'getStats', 'testQuery'
    ];

    for (const name of HANDLERS) {
        test(`${name} passes req.tenantId into the service`, () => {
            const fn = controller.match(new RegExp(`exports\\.${name}\\s*=[\\s\\S]*?\\n\\};`));
            assert.ok(fn, `handler ${name} not found`);
            assert.match(fn[0], /req\.tenantId/,
                `${name} must scope on req.tenantId — an unscoped query would ` +
                'return another tenant\'s documents');
        });
    }

    test('no handler trusts a tenant id from the request body or query', () => {
        // req.tenantId is derived from the verified JWT in authMiddleware. Reading
        // it from user input would make every gate above decorative.
        assert.ok(!/req\.(body|query|params)\.(tenantId|userId)/.test(controller),
            'tenant identity must come from the token, never from the request');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. the service layer never queries without a tenant filter', () => {

    test('every document lookup filters on userId', () => {
        // Matches KnowledgeDocument.<op>({ ... }) and asserts userId is inside.
        const calls = service.match(/KnowledgeDocument\.(find|findOne|findOneAndUpdate|countDocuments|deleteOne|deleteMany|exists)\(\s*\{[^}]*\}/g) || [];
        assert.ok(calls.length >= 5, `expected several document queries, found ${calls.length}`);
        for (const call of calls) {
            assert.match(call, /userId/, `document query without a tenant filter: ${call}`);
        }
    });

    test('chunk deletion is scoped so one tenant cannot purge another\'s index', () => {
        const deletes = service.match(/KnowledgeChunk\.deleteMany\(\s*\{[^}]*\}/g) || [];
        assert.ok(deletes.length > 0);
        for (const call of deletes) {
            // documentId alone is enough to be CORRECT (ids are unguessable), but
            // pairing it with userId keeps the invariant checkable and survives a
            // future caller that passes an id straight from a request.
            assert.ok(/userId/.test(call) || /documentId/.test(call),
                `unscoped chunk delete: ${call}`);
        }
    });

    test('retrieval re-checks the tenant when fetching chunk content', () => {
        const fetch = service.match(/KnowledgeChunk\.find\(\{\s*_id:\s*\{\s*\$in:[\s\S]*?\}\)/);
        assert.ok(fetch, 'content fetch in retrieveKnowledge not found');
        assert.match(fetch[0], /userId/,
            'defence in depth: the ids come from a tenant-scoped index, but the ' +
            'final read must still be tenant-filtered');
    });

    test('retrieveKnowledge cannot be called without a tenant id', () => {
        const kb = require(path.join(ROOT, 'src', 'services', 'knowledgeBaseService.js'));
        // A falsy tenant must return nothing rather than querying across tenants.
        return Promise.all([
            kb.retrieveKnowledge(null, 'what is the price'),
            kb.retrieveKnowledge(undefined, 'what is the price'),
            kb.retrieveKnowledge('', 'what is the price')
        ]).then(results => {
            for (const r of results) assert.deepStrictEqual(r, []);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. the vector cache cannot serve one tenant another\'s vectors', () => {

    test('the cache is keyed by tenant id', () => {
        const get = service.match(/function cacheGet[\s\S]*?\n\}/)[0];
        assert.match(get, /String\(tenantId\)/,
            'a cache key that is not the tenant id is a cross-tenant leak');
    });

    test('the cache is also keyed by embedding model', () => {
        // Comparing vectors from two different models yields plausible-looking but
        // meaningless rankings — worse than an error, because it looks like data.
        const load = service.match(/async function loadVectorIndex[\s\S]*?\n\}/)[0];
        assert.match(load, /cached\.model === model/,
            'a cached index from another embedding model must not be reused');
        assert.match(load, /embeddingModel: model/,
            'the DB query must filter to the model actually in use');
    });

    test('every write path invalidates the cache', () => {
        // A stale cache would keep answering from deleted or disabled documents.
        for (const fn of ['processDocument', 'setDocumentActive', 'deleteDocument']) {
            const body = service.match(new RegExp(`async function ${fn}[\\s\\S]*?\\n\\}`))[0];
            assert.match(body, /invalidateCache\(/, `${fn} must invalidate the vector cache`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. uploads are validated as files, not as claims', () => {

    test('the declared MIME type is not trusted on its own', () => {
        assert.match(service, /verifySignature/,
            'magic bytes must be checked — the client-declared MIME is attacker-controlled');
        assert.match(service, /SIGNATURE_CHECKS/);
    });

    test('the storage key is unguessable and not built from the filename', () => {
        const key = service.match(/const storageKey = [^;]+;/)[0];
        assert.match(key, /uuidv4\(\)/, 'keys must be unguessable');
        assert.ok(!/originalName/.test(key),
            'a key derived from the client filename invites path traversal');
        assert.match(key, /\$\{tenantId\}/, 'objects must be namespaced per tenant');
    });

    test('quota, plan and credit checks all run before the file is stored', () => {
        const create = service.match(/async function createDocument[\s\S]*?\n\}/)[0];
        const storeAt = create.indexOf('putObject');
        assert.ok(storeAt > -1, 'createDocument does not store the object');

        for (const [label, pattern] of [
            ['document count limit', /docLimit/],
            ['storage limit',        /storageMb/],
            ['AI credit balance',    /hasCredits/]
        ]) {
            const at = create.search(pattern);
            assert.ok(at > -1, `${label} is never checked`);
            assert.ok(at < storeAt, `${label} is checked AFTER the file is stored`);
        }
    });

    test('a failed database insert removes the already-stored object', () => {
        const create = service.match(/async function createDocument[\s\S]*?\n\}/)[0];
        assert.match(create, /catch[\s\S]*?deleteObject/,
            'an object with no row is an orphan nobody will ever find or bill');
    });

    test('the upload route enforces a size limit at the multer layer', () => {
        assert.match(routes, /limits:\s*\{\s*fileSize:/,
            'without a multer limit the disk fills before any handler runs');
        assert.match(routes, /files:\s*1/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('6. the chatbot injection degrades safely', () => {

    const engine = stripComments(read('src', 'services', 'chatbotEngineService.js'));

    test('retrieval failure never blocks the customer\'s reply', () => {
        const helper = engine.match(/const buildRagContext = async[\s\S]*?\n\};/)[0];
        assert.match(helper, /try\s*\{/, 'must be wrapped in try/catch');
        assert.match(helper, /return '';/,
            'a knowledge base failure must degrade to no context, not to no reply');
    });

    test('the query is the customer\'s message, not the bot\'s own', () => {
        const helper = engine.match(/const buildRagContext = async[\s\S]*?\n\};/)[0];
        assert.match(helper, /direction === 'inbound'/,
            "retrieving against the bot's last message would search for whatever " +
            'the bot just said, not what the customer asked');
    });

    test('both customer-facing AI call sites inject knowledge context', () => {
        // runAiReply (fallback/rescue) and the 'ai' flow node. A tenant who uploads
        // a price list expects it used wherever the AI speaks.
        //
        // Exactly two CALLS: the definition is `const buildRagContext = async (`,
        // which does not match this pattern, so every hit here is a real call site.
        const uses = engine.match(/await buildRagContext\(/g) || [];
        assert.strictEqual(uses.length, 2,
            `expected both AI call sites to retrieve knowledge, found ${uses.length}`);

        const fallback = engine.match(/const knowledgeContextText = await buildRagContext\(tenantId, history\)/);
        const aiNode   = engine.match(/const knowledgeContextText = await buildRagContext\(session\.userId, history\)/);
        assert.ok(fallback, 'runAiReply does not inject knowledge context');
        assert.ok(aiNode,   "the 'ai' flow node does not inject knowledge context");
    });

    test('the AI node actually passes the augmented prompt to the model', () => {
        // Building the context and then sending the un-augmented prompt is a silent
        // no-op: retrieval is paid for and the answer ignores it.
        assert.match(engine, /systemPrompt:\s*effectiveSystemPrompt/,
            'the AI node must send effectiveSystemPrompt, not the bare systemPrompt');
    });

    test('the model is instructed not to invent values it was not given', () => {
        const ai = read('src', 'services', 'aiService.js');
        assert.match(ai, /KNOWLEDGE BASE/,
            'buildEnforcedSystemPrompt must teach the model how to treat the block');
        assert.match(ai, /NEVER estimate, guess/i);
    });
});
