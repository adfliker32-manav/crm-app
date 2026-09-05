// Lead-based WhatsApp conversation assignment.
//
// The permission model and the Lead → conversation propagation are pure enough
// to test without MongoDB: the models and the company-scope helper are replaced
// via require.cache injection (tests/email/helpers/stub.js), the same approach
// the email suite uses.
//
// The schema/preset assertions run FIRST, against the real modules, before any
// stub is installed — otherwise they would assert against the fakes.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mongoose = require('mongoose');

const { stub, makeModel, matches } = require('../email/helpers/stub');

const SRC = path.join(__dirname, '..', '..', 'src');

// ── Capture real schema facts BEFORE stubbing ────────────────────────────────
const RealUser = require(path.join(SRC, 'models', 'User.js'));
const RealWorkspaceSettings = require(path.join(SRC, 'models', 'WorkspaceSettings.js'));
const RealConversation = require(path.join(SRC, 'models', 'WhatsAppConversation.js'));
const PRESETS = require(path.join(SRC, 'constants', 'permissionPresets.js'));

const VIEW_ALL_WA_DEFAULT = RealUser.schema.path('permissions.viewAllWhatsApp')?.options?.default;
const FOLLOW_LEAD_DEFAULT = RealWorkspaceSettings.schema.path('whatsappFollowsLeadAssignment')?.options?.default;
const CONVERSATION_INDEXES = RealConversation.schema.indexes().map(([keys]) => Object.keys(keys).join(','));

// ── Ids used throughout ──────────────────────────────────────────────────────
const oid = () => new mongoose.Types.ObjectId().toString();
const MANAGER_ID = oid();
const AGENT_A = oid();
const AGENT_B = oid();
const AGENT_FULL = oid();
const LEAD_ID = oid();
const COMPANY_IDS = [MANAGER_ID, AGENT_A, AGENT_B, AGENT_FULL];

// ── Stubs ────────────────────────────────────────────────────────────────────
let conversationStore;
let workspaceToggle = true;

const ConversationModel = makeModel([]);
stub('models/WhatsAppConversation', ConversationModel);
conversationStore = ConversationModel.__store;

stub('models/WorkspaceSettings', {
    findOne: () => ({
        select: () => ({
            lean: async () => ({ whatsappFollowsLeadAssignment: workspaceToggle })
        })
    })
});

stub('models/Lead', makeModel([
    { _id: LEAD_ID, assignedTo: AGENT_A },
    { _id: 'lead_unassigned_0000000', assignedTo: null }
]));

// require.cache stubs are process-global, so any test that swaps this roster
// MUST restore it or it leaks into every test that runs afterwards.
const DEFAULT_USERS = [
    { _id: MANAGER_ID, role: 'manager', permissions: {} },
    { _id: AGENT_A, role: 'agent', permissions: { viewAllWhatsApp: false } },
    { _id: AGENT_B, role: 'agent', permissions: { viewAllWhatsApp: false } },
    { _id: AGENT_FULL, role: 'agent', permissions: { viewAllWhatsApp: true } }
];
const stubUsers = (rows) => stub('models/User', makeModel(rows.map(r => ({ ...r }))));
stubUsers(DEFAULT_USERS);

stub('utils/whatsappUtils', {
    getCompanyUserIds: async () => COMPANY_IDS,
    getUserWhatsAppCredentials: async () => null,
    invalidateCompanyUserIds: () => {}
});

const svc = require(path.join(SRC, 'services', 'whatsappAssignmentService.js'));

// ── Request builders ─────────────────────────────────────────────────────────
const reqFor = (user, { toggle = true } = {}) => ({
    user,
    workspace: { whatsappFollowsLeadAssignment: toggle }
});

const manager = { userId: MANAGER_ID, role: 'manager', permissions: {} };
const superadmin = { userId: oid(), role: 'superadmin', permissions: {} };
const restrictedAgent = { userId: AGENT_A, role: 'agent', permissions: { viewAllWhatsApp: false } };
const fullInboxAgent = { userId: AGENT_FULL, role: 'agent', permissions: { viewAllWhatsApp: true } };

const resetToggle = () => { workspaceToggle = true; svc.invalidateFollowLeadCache(MANAGER_ID); };

// ─────────────────────────────────────────────────────────────────────────────
describe('conversationScope — who sees what', () => {

    test('1. a manager gets the whole company inbox even with the toggle on', async () => {
        const scope = await svc.conversationScope(reqFor(manager));
        assert.deepStrictEqual(scope, { userId: { $in: COMPANY_IDS } });
        assert.ok(!('assignedTo' in scope));
    });

    test('2. a superadmin gets the whole company inbox', async () => {
        const scope = await svc.conversationScope(reqFor(superadmin));
        assert.ok(!('assignedTo' in scope));
    });

    test('3. the toggle being off means nobody is restricted', async () => {
        const scope = await svc.conversationScope(reqFor(restrictedAgent, { toggle: false }));
        assert.ok(!('assignedTo' in scope), 'toggle off must preserve the shared inbox');
    });

    test('4. an agent with viewAllWhatsApp sees the whole inbox', async () => {
        const scope = await svc.conversationScope(reqFor(fullInboxAgent));
        assert.ok(!('assignedTo' in scope));
    });

    test('5. a restricted agent is narrowed to their own conversations', async () => {
        const scope = await svc.conversationScope(reqFor(restrictedAgent));
        assert.strictEqual(String(scope.assignedTo), AGENT_A);
        assert.deepStrictEqual(scope.userId, { $in: COMPANY_IDS });
    });

    test('5b. a LEGACY agent (viewAllWhatsApp never written) keeps the full inbox', async () => {
        // viewAllWhatsApp defaults to true in the schema, but Mongoose applies
        // defaults on HYDRATION, not in .lean() — and authMiddleware reads agent
        // permissions with .lean(). So every agent document written before this
        // field existed reads back as `undefined`.
        //
        // Testing `=== true` would restrict all of them the moment a workspace
        // enabled the toggle, which is exactly the lockout `default: true` was
        // chosen to prevent. Only an EXPLICIT false may restrict.
        const legacy = { userId: AGENT_A, role: 'agent', permissions: {} };
        const scope = await svc.conversationScope(reqFor(legacy));
        assert.ok(!('assignedTo' in scope), 'a legacy agent must not be restricted');

        // ...and with no permissions object at all.
        const noPerms = { userId: AGENT_A, role: 'agent' };
        const scope2 = await svc.conversationScope(reqFor(noPerms));
        assert.ok(!('assignedTo' in scope2));
    });

    test('5c. hasFullInbox: only an explicit false restricts', () => {
        assert.strictEqual(svc.hasFullInbox({ viewAllWhatsApp: false }), false);
        assert.strictEqual(svc.hasFullInbox({ viewAllWhatsApp: true }), true);
        assert.strictEqual(svc.hasFullInbox({}), true, 'legacy undefined = full inbox');
        assert.strictEqual(svc.hasFullInbox(undefined), true);
        assert.strictEqual(svc.hasFullInbox(null), true);
    });

    test('6. assignedTo is NEVER undefined — BSON drops undefined and the guard silently no-ops', async () => {
        // A restricted caller whose id cannot be resolved must match NOTHING,
        // not everything. This is the exact shape of two bugs already shipped
        // in this repo (socketService join:company, activityLog).
        // NOTE: viewAllWhatsApp must be an EXPLICIT false — an empty permissions
        // object now means "legacy agent, full inbox" (see 5b/5c).
        const scope = await svc.conversationScope(
            reqFor({ role: 'agent', permissions: { viewAllWhatsApp: false } })
        );
        assert.ok('assignedTo' in scope);
        assert.notStrictEqual(scope.assignedTo, undefined);
        assert.strictEqual(String(scope.assignedTo), '000000000000000000000000');
    });

    test('7. forAggregate yields an ObjectId — a $match stage will not coerce a string', async () => {
        const plain = await svc.conversationScope(reqFor(restrictedAgent));
        const agg = await svc.conversationScope(reqFor(restrictedAgent), { forAggregate: true });

        assert.strictEqual(typeof plain.assignedTo, 'string');
        assert.ok(agg.assignedTo instanceof mongoose.Types.ObjectId);
        assert.strictEqual(String(agg.assignedTo), AGENT_A);
    });

    test('8. an unassigned conversation is invisible to a restricted agent, visible to a manager', async () => {
        const restricted = await svc.conversationScope(reqFor(restrictedAgent));
        const privileged = await svc.conversationScope(reqFor(manager));

        const unassigned = { userId: MANAGER_ID, assignedTo: null };
        const mine = { userId: MANAGER_ID, assignedTo: AGENT_A };
        const theirs = { userId: MANAGER_ID, assignedTo: AGENT_B };

        assert.strictEqual(matches(unassigned, restricted), false, 'unassigned must be hidden');
        assert.strictEqual(matches(theirs, restricted), false, "another agent's must be hidden");
        assert.strictEqual(matches(mine, restricted), true);

        assert.strictEqual(matches(unassigned, privileged), true, 'manager still sees unassigned');
        assert.strictEqual(matches(theirs, privileged), true);
    });
});

describe('withPredicate — search must not clobber the scope', () => {

    test('11. a search predicate is ANDed, leaving the scope keys intact', async () => {
        const scope = await svc.conversationScope(reqFor(restrictedAgent));
        const search = { $or: [{ displayName: /bob/i }, { phone: /bob/i }] };
        const merged = svc.withPredicate(scope, search);

        assert.strictEqual(String(merged.assignedTo), AGENT_A, 'scope survives');
        assert.deepStrictEqual(merged.userId, { $in: COMPANY_IDS });
        assert.deepStrictEqual(merged.$and, [search]);
        assert.ok(!('$or' in merged), 'must not assign $or at the top level');
    });

    test('withPredicate preserves an $and the scope already carried', () => {
        const scope = { userId: 1, $and: [{ a: 1 }] };
        const merged = svc.withPredicate(scope, { b: 2 });
        assert.deepStrictEqual(merged.$and, [{ a: 1 }, { b: 2 }]);
    });

    test('withPredicate is a no-op for an empty predicate', () => {
        const scope = { userId: 1 };
        assert.strictEqual(svc.withPredicate(scope, null), scope);
    });
});

describe('resolveAssigneeForConversation', () => {

    test('9. a lead with no assignee resolves to null', async () => {
        resetToggle();
        const got = await svc.resolveAssigneeForConversation({
            tenantId: MANAGER_ID,
            lead: { _id: LEAD_ID, assignedTo: null }
        });
        assert.strictEqual(got, null);
    });

    test('an assigned lead resolves to its agent', async () => {
        resetToggle();
        const got = await svc.resolveAssigneeForConversation({
            tenantId: MANAGER_ID,
            lead: { _id: LEAD_ID, assignedTo: AGENT_A }
        });
        assert.strictEqual(got, AGENT_A);
    });

    test('10. the toggle being off resolves to null whatever the lead says', async () => {
        workspaceToggle = false;
        svc.invalidateFollowLeadCache(MANAGER_ID);

        const got = await svc.resolveAssigneeForConversation({
            tenantId: MANAGER_ID,
            lead: { _id: LEAD_ID, assignedTo: AGENT_A }
        });
        assert.strictEqual(got, null);
        resetToggle();
    });

    test('no lead at all resolves to null', async () => {
        resetToggle();
        assert.strictEqual(
            await svc.resolveAssigneeForConversation({ tenantId: MANAGER_ID, leadId: null }),
            null
        );
    });
});

describe('syncConversationsForLead — Lead is the source of truth', () => {

    test('propagates a reassignment to every conversation linked to the lead', async () => {
        resetToggle();
        conversationStore.length = 0;
        conversationStore.push(
            { _id: 'c1', userId: MANAGER_ID, leadId: LEAD_ID, assignedTo: AGENT_A },
            // same person, second thread under a differently-formatted waContactId
            { _id: 'c2', userId: AGENT_A, leadId: LEAD_ID, assignedTo: AGENT_A },
            { _id: 'c3', userId: MANAGER_ID, leadId: 'other_lead_000000000000', assignedTo: AGENT_A }
        );

        const res = await svc.syncConversationsForLead({
            leadId: LEAD_ID, tenantId: MANAGER_ID, assignedTo: AGENT_B
        });

        assert.strictEqual(res.modified, 2, 'both threads for this lead follow');
        assert.strictEqual(conversationStore.find(c => c._id === 'c1').assignedTo, AGENT_B);
        assert.strictEqual(conversationStore.find(c => c._id === 'c2').assignedTo, AGENT_B);
        assert.strictEqual(
            conversationStore.find(c => c._id === 'c3').assignedTo, AGENT_A,
            'another lead must not be touched'
        );
    });

    test('reports the previous assignee so the losing agent can be told to drop the row', async () => {
        resetToggle();
        conversationStore.length = 0;
        conversationStore.push({ _id: 'c1', userId: MANAGER_ID, leadId: LEAD_ID, assignedTo: AGENT_A });

        const res = await svc.syncConversationsForLead({
            leadId: LEAD_ID, tenantId: MANAGER_ID, assignedTo: AGENT_B
        });

        assert.deepStrictEqual(res.conversations, [
            { _id: 'c1', previousAssignedTo: AGENT_A, assignedTo: AGENT_B }
        ]);
    });

    test('unassigning a lead nulls the conversation rather than leaving a stale owner', async () => {
        resetToggle();
        conversationStore.length = 0;
        conversationStore.push({ _id: 'c1', userId: MANAGER_ID, leadId: LEAD_ID, assignedTo: AGENT_A });

        await svc.syncConversationsForLead({ leadId: LEAD_ID, tenantId: MANAGER_ID, assignedTo: null });
        assert.strictEqual(conversationStore[0].assignedTo, null);
    });

    test('does nothing at all while the toggle is off', async () => {
        workspaceToggle = false;
        svc.invalidateFollowLeadCache(MANAGER_ID);
        conversationStore.length = 0;
        conversationStore.push({ _id: 'c1', userId: MANAGER_ID, leadId: LEAD_ID, assignedTo: null });

        const res = await svc.syncConversationsForLead({
            leadId: LEAD_ID, tenantId: MANAGER_ID, assignedTo: AGENT_B
        });

        assert.strictEqual(res.modified, 0);
        assert.strictEqual(conversationStore[0].assignedTo, null, 'toggle off must not write');
        resetToggle();
    });

    test('syncConversationsForLeads batches a bulk assign into one write', async () => {
        resetToggle();
        conversationStore.length = 0;
        conversationStore.push(
            { _id: 'c1', userId: MANAGER_ID, leadId: 'lead_1_0000000000000000', assignedTo: null },
            { _id: 'c2', userId: MANAGER_ID, leadId: 'lead_2_0000000000000000', assignedTo: null },
            { _id: 'c3', userId: MANAGER_ID, leadId: 'lead_9_0000000000000000', assignedTo: null }
        );

        const res = await svc.syncConversationsForLeads({
            leadIds: ['lead_1_0000000000000000', 'lead_2_0000000000000000'],
            tenantId: MANAGER_ID,
            assignedTo: AGENT_B
        });

        assert.strictEqual(res.modified, 2);
        assert.strictEqual(conversationStore.find(c => c._id === 'c3').assignedTo, null);
    });

    test('detachDeletedLeads clears both the link and the derived owner', async () => {
        conversationStore.length = 0;
        conversationStore.push({ _id: 'c1', userId: MANAGER_ID, leadId: LEAD_ID, assignedTo: AGENT_A });

        await svc.detachDeletedLeads({ leadIds: [LEAD_ID], tenantId: MANAGER_ID });

        assert.strictEqual(conversationStore[0].leadId, null);
        assert.strictEqual(conversationStore[0].assignedTo, null);
        assert.strictEqual(conversationStore[0]._id, 'c1', 'history is preserved, not deleted');
    });
});

describe('conversationAudience — socket fan-out', () => {

    test('12. the toggle being off keeps the full company fan-out', async () => {
        workspaceToggle = false;
        svc.invalidateFollowLeadCache(MANAGER_ID);

        const got = await svc.conversationAudience({
            tenantId: MANAGER_ID, companyUserIds: COMPANY_IDS, assignedTo: AGENT_A
        });
        assert.deepStrictEqual(got, COMPANY_IDS);
        resetToggle();
    });

    test('13. managers, full-inbox agents and the assignee are included; other agents are not', async () => {
        resetToggle();
        const got = (await svc.conversationAudience({
            tenantId: MANAGER_ID, companyUserIds: COMPANY_IDS, assignedTo: AGENT_A
        })).map(String);

        assert.ok(got.includes(MANAGER_ID), 'manager keeps the complete inbox');
        assert.ok(got.includes(AGENT_FULL), 'full-inbox agent still notified');
        assert.ok(got.includes(AGENT_A), 'the assignee is notified');
        assert.ok(!got.includes(AGENT_B), 'a restricted non-assignee must NOT be notified');
    });

    test('13b. a legacy agent is still in the audience (undefined != restricted)', async () => {
        resetToggle();
        const LEGACY = String(new mongoose.Types.ObjectId());
        // Same lean()/default trap as 5b, on the socket fan-out path.
        stubUsers([...DEFAULT_USERS, { _id: LEGACY, role: 'agent', permissions: {} }]);
        try {
            const got = (await svc.conversationAudience({
                tenantId: MANAGER_ID,
                companyUserIds: [MANAGER_ID, AGENT_A, LEGACY],
                assignedTo: AGENT_A
            })).map(String);

            assert.ok(got.includes(LEGACY), 'a legacy agent must keep receiving events');
            assert.ok(got.includes(AGENT_A), 'the assignee is notified');
            assert.ok(!got.includes(AGENT_B), 'an explicitly-restricted non-assignee is still excluded');
        } finally {
            stubUsers(DEFAULT_USERS); // never leak the roster into later tests
        }
    });

    test('an unassigned conversation reaches only managers and full-inbox agents', async () => {
        resetToggle();
        const got = (await svc.conversationAudience({
            tenantId: MANAGER_ID, companyUserIds: COMPANY_IDS, assignedTo: null
        })).map(String);

        assert.ok(got.includes(MANAGER_ID));
        assert.ok(got.includes(AGENT_FULL));
        assert.ok(!got.includes(AGENT_A));
        assert.ok(!got.includes(AGENT_B));
    });
});

describe('schema + preset defaults (backward compatibility)', () => {

    test('14. viewAllWhatsApp defaults to TRUE so existing agents keep the shared inbox', () => {
        assert.strictEqual(
            VIEW_ALL_WA_DEFAULT, true,
            'a false default would empty every existing agent inbox the moment the toggle is enabled'
        );
    });

    test('15. whatsappFollowsLeadAssignment defaults to FALSE — upgrading changes nothing', () => {
        assert.strictEqual(FOLLOW_LEAD_DEFAULT, false);
    });

    test('16. every preset declares viewAllWhatsApp, and new/junior agents start restricted', () => {
        for (const name of ['VIEW_ONLY', 'BASIC_AGENT', 'SENIOR_AGENT', 'MANAGER']) {
            assert.ok(
                Object.prototype.hasOwnProperty.call(PRESETS[name], 'viewAllWhatsApp'),
                `${name} preset is missing viewAllWhatsApp`
            );
        }
        assert.strictEqual(PRESETS.VIEW_ONLY.viewAllWhatsApp, false);
        assert.strictEqual(PRESETS.BASIC_AGENT.viewAllWhatsApp, false);
        assert.strictEqual(PRESETS.SENIOR_AGENT.viewAllWhatsApp, true);
        assert.strictEqual(PRESETS.MANAGER.viewAllWhatsApp, true);
    });

    test('17. the conversation collection is indexed for the scoped list and the leadId lookup', () => {
        assert.ok(
            CONVERSATION_INDEXES.includes('userId,assignedTo,lastMessageAt'),
            'a restricted inbox page would be a collection scan without this index'
        );
        assert.ok(CONVERSATION_INDEXES.includes('userId,leadId'));
    });
});

describe('isAssignmentRestricted — the decision table itself', () => {
    const cases = [
        ['manager, toggle on',            manager,          true,  false],
        ['superadmin, toggle on',         superadmin,       true,  false],
        ['restricted agent, toggle off',  restrictedAgent,  false, false],
        ['restricted agent, toggle on',   restrictedAgent,  true,  true],
        ['full-inbox agent, toggle on',   fullInboxAgent,   true,  false]
    ];

    for (const [label, user, toggle, expected] of cases) {
        test(`${label} → ${expected ? 'restricted' : 'full inbox'}`, () => {
            assert.strictEqual(svc.isAssignmentRestricted(reqFor(user, { toggle })), expected);
        });
    }

    test('a request with no user is never treated as restricted (fails open to the auth layer)', () => {
        assert.strictEqual(svc.isAssignmentRestricted({}), false);
        assert.strictEqual(svc.isAssignmentRestricted(null), false);
    });
});
