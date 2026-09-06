// When the AI chatbot is allowed to turn a conversation into a Lead.
//
// The AI has always been ABLE to create leads — create_lead is a real action and
// executeAction implements it. What did not exist was any tenant control over
// when it fires: the decision rested on one sentence in a static prompt, so it
// fired on a greeting one day and never fired the next.
//
// These tests cover the policy layer that now sits in front of it. The important
// guarantee is that the LLM is not trusted: whatever the model asks for, nothing
// creates a lead unless the server-side gate agrees.

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

// ── in-memory state ─────────────────────────────────────────────────────────
let inboundCount;

const reset = () => { inboundCount = 0; };

stub('src/models/WhatsAppMessage.js', {
    countDocuments: async (q) => (q.direction === 'inbound' ? inboundCount : 0)
});

// chatbotEngineService pulls in a great deal at require time; none of it is
// exercised by the policy gate.
for (const m of [
    'src/models/WhatsAppConversation.js', 'src/models/ChatbotSession.js',
    'src/models/ChatbotFlow.js', 'src/models/Lead.js', 'src/models/IntegrationConfig.js',
    'src/models/WorkspaceSettings.js', 'src/models/GlobalSetting.js',
    'src/models/BookingPage.js', 'src/models/Appointment.js', 'src/models/User.js',
    'src/models/WhatsAppTemplate.js'
]) stub(m, {});

// Captured BEFORE the stub below replaces it in the require cache — the engine
// gets the fake, this file keeps the real prompt builder.
const realAi = require(R('src/services/aiService.js'));

stub('src/services/whatsappService.js', {});
stub('src/services/aiService.js', { generateReply: async () => ({}), mapReplyToOption: async () => null });
stub('src/services/aiCreditService.js', { hasCredits: async () => true, charge: async () => ({}) });
stub('src/services/knowledgeBaseService.js', { retrieveKnowledge: async () => [], buildKnowledgeContext: () => '' });
stub('src/services/socketService.js', { getIO: () => null, emitToUser: () => {} });
stub('src/services/metaConversionService.js', { sendMetaEventForLead: async () => {} });
stub('src/services/AutomationService.js', { evaluateLead: async () => {} });
stub('src/services/sequenceService.js', { enrollLeadInSequences: async () => {} });
stub('src/utils/leadEffects.js', { queueLeadCreatedEffects: () => {} });

const engine = require(R('src/services/chatbotEngineService.js'));
const { evaluateAiLeadPolicy, buildPolicyLeadActionData } = engine;

const vars = (obj) => new Map(Object.entries(obj));
// Name-focused policy, used by the requirement tests below.
const basePolicy = {
    enabled: true, minCustomerMessages: 3,
    requirePhone: false, requireName: true, requireEmail: false
};

beforeEach(reset);

// ─────────────────────────────────────────────────────────────────────────────
describe('1. the gate is the authority, not the model', () => {

    test('a disabled policy blocks everything', async () => {
        inboundCount = 99;
        const verdict = await evaluateAiLeadPolicy({
            policy: { ...basePolicy, enabled: false },
            conversationId: 'c1',
            variables: vars({ name: 'Ravi' })
        });
        assert.strictEqual(verdict.allowed, false);
        assert.match(verdict.reason, /disabled/);
    });

    test('a missing policy blocks everything', async () => {
        const verdict = await evaluateAiLeadPolicy({
            policy: null, conversationId: 'c1', variables: vars({ name: 'Ravi' })
        });
        assert.strictEqual(verdict.allowed, false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. the message floor', () => {

    test('below the minimum is blocked', async () => {
        inboundCount = 2;
        const verdict = await evaluateAiLeadPolicy({
            policy: basePolicy, conversationId: 'c1', variables: vars({ name: 'Ravi' })
        });
        assert.strictEqual(verdict.allowed, false);
        assert.match(verdict.reason, /2 customer message/);
    });

    test('exactly the minimum passes', async () => {
        inboundCount = 3;
        const verdict = await evaluateAiLeadPolicy({
            policy: basePolicy, conversationId: 'c1', variables: vars({ name: 'Ravi' })
        });
        assert.strictEqual(verdict.allowed, true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. required details', () => {

    test('no name collected is blocked', async () => {
        inboundCount = 5;
        const verdict = await evaluateAiLeadPolicy({
            policy: basePolicy, conversationId: 'c1', variables: vars({})
        });
        assert.strictEqual(verdict.allowed, false);
        assert.match(verdict.reason, /name/);
    });

    test('any of the accepted name keys satisfies it', async () => {
        inboundCount = 5;
        for (const key of ['name', 'full_name', 'fullName', 'customer_name', 'customerName', 'lead_name']) {
            const verdict = await evaluateAiLeadPolicy({
                policy: basePolicy, conversationId: 'c1', variables: vars({ [key]: 'Ravi' })
            });
            assert.strictEqual(verdict.allowed, true, `${key} should satisfy requireName`);
        }
    });

    test('a WhatsApp profile name is NOT a collected name', async () => {
        // The trap this gate exists to avoid: buildLeadPayloadFromSession falls
        // back to conversation.displayName, and WhatsApp always supplies one. Had
        // the gate reused that fallback, requireName would pass on message one and
        // the whole feature would be decorative.
        inboundCount = 5;
        const verdict = await evaluateAiLeadPolicy({
            policy: basePolicy,
            conversationId: 'c1',
            variables: vars({ displayName: 'Ravi (WhatsApp profile)' })
        });
        assert.strictEqual(verdict.allowed, false);
        assert.match(verdict.reason, /name/);
    });

    test('an empty-string name does not count as collected', async () => {
        inboundCount = 5;
        const verdict = await evaluateAiLeadPolicy({
            policy: basePolicy, conversationId: 'c1', variables: vars({ name: '   ' })
        });
        assert.strictEqual(verdict.allowed, false);
    });

    test('requireEmail is enforced when switched on', async () => {
        inboundCount = 5;
        const withEmail = { ...basePolicy, requireEmail: true };

        assert.strictEqual((await evaluateAiLeadPolicy({
            policy: withEmail, conversationId: 'c1', variables: vars({ name: 'Ravi' })
        })).allowed, false);

        assert.strictEqual((await evaluateAiLeadPolicy({
            policy: withEmail, conversationId: 'c1', variables: vars({ name: 'Ravi', email: 'r@x.com' })
        })).allowed, true);
    });

    test('requirements can be switched off entirely', async () => {
        inboundCount = 1;
        const verdict = await evaluateAiLeadPolicy({
            policy: { enabled: true, minCustomerMessages: 1, requirePhone: false, requireName: false, requireEmail: false },
            conversationId: 'c1',
            variables: vars({})
        });
        assert.strictEqual(verdict.allowed, true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A lead with no way to call the customer back is the one nobody wants, so the
// contact number is the requirement that ships on by default. It is NOT
// redundant on WhatsApp: Meta usernames let a contact hide their number, and
// WhatsAppConversation.phone is nullable for exactly that case.
describe('3b. the contact number', () => {
    const phonePolicy = {
        enabled: true, minCustomerMessages: 1,
        requirePhone: true, requireName: false, requireEmail: false
    };

    test("the conversation's own number satisfies it — the customer is not asked twice", async () => {
        inboundCount = 1;
        const verdict = await evaluateAiLeadPolicy({
            policy: phonePolicy,
            conversationId: 'c1',
            variables: vars({}),
            conversation: { phone: '919876543210' }
        });
        assert.strictEqual(verdict.allowed, true);
    });

    test('a username-only contact with no number is blocked', async () => {
        inboundCount = 5;
        const verdict = await evaluateAiLeadPolicy({
            policy: phonePolicy,
            conversationId: 'c1',
            variables: vars({ name: 'Ravi' }),
            conversation: { phone: null, displayName: 'Ravi', waBsuid: 'bsuid-1' }
        });
        assert.strictEqual(verdict.allowed, false);
        assert.match(verdict.reason, /contact number/);
    });

    test('a number the AI collected in chat unblocks it', async () => {
        inboundCount = 5;
        for (const key of ['phone', 'phone_number', 'phoneNumber', 'mobile', 'mobile_number', 'mobileNumber', 'lead_phone']) {
            const verdict = await evaluateAiLeadPolicy({
                policy: phonePolicy,
                conversationId: 'c1',
                variables: vars({ [key]: '9876543210' }),
                conversation: { phone: null }
            });
            assert.strictEqual(verdict.allowed, true, `${key} should satisfy requirePhone`);
        }
    });

    test('switching it off lets a numberless contact through', async () => {
        inboundCount = 5;
        const verdict = await evaluateAiLeadPolicy({
            policy: { ...phonePolicy, requirePhone: false },
            conversationId: 'c1',
            variables: vars({}),
            conversation: { phone: null }
        });
        assert.strictEqual(verdict.allowed, true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. the tenant labels the lead, not the AI', () => {

    test('configured stage, source and tags are what get used', () => {
        const data = buildPolicyLeadActionData({
            status: 'Qualified', source: 'Website AI', tags: ['ai', 'hot']
        });
        assert.deepStrictEqual(data, {
            status: 'Qualified', source: 'Website AI', tags: ['ai', 'hot']
        });
    });

    test('sane defaults when the tenant left fields blank', () => {
        assert.deepStrictEqual(buildPolicyLeadActionData({}), {
            status: 'New', source: 'WhatsApp AI Chatbot', tags: []
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// A policy that can be bypassed by entering through a different door is not a
// policy. There are three AI surfaces — fallback, rescue, and the `ai` node
// inside a flow — and the in-flow one used to call executeAction directly, so
// the tenant's rules were enforced on two of the three.
describe('4b. every AI surface uses the same door', () => {
    const fs = require('node:fs');
    const source = fs.readFileSync(R('src/services/chatbotEngineService.js'), 'utf8');
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    test('EVERY create_lead dispatch is behind the policy gate', () => {
        // Not "exactly one call site" — the opt-in safety net is legitimately a
        // second one. The invariant that matters is that none of them can run
        // without the policy having been consulted first, which is precisely
        // what the in-flow AI node used to do.
        const marker = /actionType:\s*'create_lead'/g;
        const sites = [];
        let m;
        while ((m = marker.exec(code)) !== null) sites.push(m.index);

        assert.ok(sites.length > 0, 'create_lead is no longer dispatched at all');

        for (const idx of sites) {
            const enclosing = code.slice(Math.max(0, idx - 1200), idx);
            assert.match(
                enclosing,
                /buildPolicyLeadActionData|evaluateAiLeadPolicy/,
                `a create_lead dispatch at offset ${idx} is not behind the policy gate — ` +
                'this is how the in-flow AI node came to ignore the tenant\'s rules'
            );
        }
    });

    test('no AI surface builds its own lead labels', () => {
        // The bypass looked exactly like this: status/source taken from whatever
        // the model proposed, instead of the tenant's configuration.
        assert.doesNotMatch(
            code,
            /actionType:\s*'create_lead'[\s\S]{0,200}action\.status/,
            'an AI path is labelling leads from the model\'s own suggestion again'
        );
    });

    test('both AI call sites dispatch through executeAiAction', () => {
        const calls = code.match(/await executeAiAction\(/g) || [];
        assert.ok(
            calls.length >= 2,
            `expected the fallback/rescue path and the in-flow AI node to share the dispatcher, found ${calls.length}`
        );
    });

    test('every AI call site passes a leadPolicy to the model', () => {
        // Being gated without being told the rules just burns turns on proposals
        // the server then discards.
        const generateCalls = code.match(/generateReply\(\{[\s\S]{0,600}?\}\)/g) || [];
        const aiSurfaces = generateCalls.filter(c => c.includes('availableTemplates'));
        assert.ok(aiSurfaces.length >= 2, 'expected at least two AI surfaces');
        for (const call of aiSurfaces) {
            assert.match(call, /leadPolicy/, 'an AI surface calls the model without the lead policy');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. the prompt block', () => {

    test('with no policy the model is told NOT to create leads', () => {
        // OFF means off, so the prompt must not advertise a capability the
        // server will refuse — every proposal it makes is a billed wasted turn.
        const prompt = realAi.__buildLeadCreationRules(null);
        assert.match(prompt, /DISABLED for this business/);
        assert.match(prompt, /NEVER set action type to "create_lead"/);
        assert.doesNotMatch(prompt, /you may set action type to "create_lead"/);
    });

    test('a disabled policy says the same thing', () => {
        const prompt = realAi.__buildLeadCreationRules({ enabled: false, minCustomerMessages: 5 });
        assert.match(prompt, /NEVER set action type to "create_lead"/);
    });

    test('variable extraction keeps working while creation is off', () => {
        // Turning lead creation off must not stop the AI collecting details —
        // they still land on the conversation for a human to act on.
        const prompt = realAi.__buildLeadCreationRules(null);
        assert.match(prompt, /extracted_variables/);
    });

    test('an active policy states the real thresholds and the tenant rule', () => {
        const prompt = realAi.__buildLeadCreationRules({
            enabled: true,
            minCustomerMessages: 4,
            requireName: true,
            requireEmail: true,
            instruction: 'Only after they ask for a quote.'
        });
        assert.match(prompt, /at least 4 message/);
        assert.match(prompt, /name and the customer's email address/);
        assert.match(prompt, /Only after they ask for a quote\./);
        assert.doesNotMatch(prompt, /at minimum: the customer's name/);
    });

    test('an off switch is an off switch', () => {
        // Regression guard for the fix: the disabled branch previously fell
        // through to "the AI's own judgement, its own labels", so a tenant who
        // turned Auto-Create Leads off kept getting AI-created leads anyway.
        const off = realAi.__buildLeadCreationRules({ enabled: false });
        assert.doesNotMatch(off, /you may set action type/i);
        assert.match(off, /NEVER/);
    });

    test('the contact number is asked for only when we do not already have it', () => {
        // runAiReply drops requirePhone from the PROMPT copy when the conversation
        // already carries a number, so the AI never pesters a customer for a
        // detail already on screen. The server gate is unaffected.
        assert.match(
            realAi.__buildLeadCreationRules({ enabled: true, minCustomerMessages: 1, requirePhone: true }),
            /contact number/
        );
        assert.doesNotMatch(
            realAi.__buildLeadCreationRules({ enabled: true, minCustomerMessages: 1, requirePhone: false }),
            /contact number/
        );
    });
});
