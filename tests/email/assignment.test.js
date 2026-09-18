// Lead-based EMAIL conversation assignment.
//
// The twin of tests/whatsapp/assignment.test.js, and it follows the same shape:
// the permission model and the Lead -> thread propagation are pure enough to
// test without MongoDB, so the models are replaced via require.cache injection
// (tests/email/helpers/stub.js).
//
// The schema/preset/source assertions run FIRST, against the real modules,
// before any stub is installed — otherwise they would assert against the fakes.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const mongoose = require('mongoose');

const { stub, makeModel } = require('./helpers/stub');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

// ── Capture real schema facts BEFORE stubbing ────────────────────────────────
const RealUser = require(path.join(SRC, 'models', 'User.js'));
const RealWorkspaceSettings = require(path.join(SRC, 'models', 'WorkspaceSettings.js'));
const RealConversation = require(path.join(SRC, 'models', 'EmailConversation.js'));
const PRESETS = require(path.join(SRC, 'constants', 'permissionPresets.js'));

const VIEW_ALL_EMAILS_DEFAULT = RealUser.schema.path('permissions.viewAllEmails')?.options?.default;
const FOLLOW_LEAD_DEFAULT = RealWorkspaceSettings.schema.path('emailFollowsLeadAssignment')?.options?.default;
const CONVERSATION_INDEXES = RealConversation.schema.indexes().map(([keys]) => Object.keys(keys).join(','));

// ── Ids used throughout ──────────────────────────────────────────────────────
const oid = () => new mongoose.Types.ObjectId().toString();
const TENANT_ID = oid();
const AGENT_A = oid();
const AGENT_B = oid();
const AGENT_FULL = oid();
const LEAD_ID = oid();
const LEAD_UNASSIGNED = oid();
const COMPANY_IDS = [TENANT_ID, AGENT_A, AGENT_B, AGENT_FULL];

// ── Stubs ────────────────────────────────────────────────────────────────────
let workspaceToggle = true;
let workspaceReadThrows = false;

const ConversationModel = makeModel([]);
stub('models/EmailConversation', ConversationModel);
const conversationStore = ConversationModel.__store;

stub('models/WorkspaceSettings', {
    findOne: () => ({
        select: () => ({
            lean: async () => {
                if (workspaceReadThrows) throw new Error('mongo is down');
                return { emailFollowsLeadAssignment: workspaceToggle };
            }
        })
    })
});

stub('models/Lead', makeModel([
    { _id: LEAD_ID, assignedTo: AGENT_A },
    { _id: LEAD_UNASSIGNED, assignedTo: null }
]));

stub('models/User', makeModel([
    { _id: TENANT_ID, name: 'The Manager', role: 'manager', permissions: {} },
    { _id: AGENT_A, name: 'Agent A', role: 'agent', permissions: { viewAllEmails: false } },
    { _id: AGENT_B, name: 'Agent B', role: 'agent', permissions: { viewAllEmails: false } },
    { _id: AGENT_FULL, name: 'Agent Full', role: 'agent', permissions: { viewAllEmails: true } }
]));

const emitted = [];
stub('services/socketService', {
    emitToUsers: () => {},
    emitToUser: () => {},
    emitToConversation: () => {},
    emitToEmailUsers: (ids, event, data) => emitted.push({ ids: ids.map(String), event, data })
});

const svc = require(path.join(SRC, 'services', 'emailAssignmentService.js'));

// ── Request builders ─────────────────────────────────────────────────────────
const reqFor = (user, { toggle = true } = {}) => ({
    user,
    tenantId: TENANT_ID,
    workspace: { emailFollowsLeadAssignment: toggle }
});

const manager = { userId: TENANT_ID, role: 'manager', permissions: {} };
const superadmin = { userId: oid(), role: 'superadmin', permissions: {} };
const restrictedAgent = { userId: AGENT_A, role: 'agent', permissions: { viewAllEmails: false } };
const fullInboxAgent = { userId: AGENT_FULL, role: 'agent', permissions: { viewAllEmails: true } };
// Every agent document written before viewAllEmails existed reads back as
// `undefined` under .lean(), which is exactly how authMiddleware loads it.
const legacyAgent = { userId: AGENT_B, role: 'agent', permissions: {} };

const resetToggle = () => {
    workspaceToggle = true;
    workspaceReadThrows = false;
    svc.invalidateEmailFollowLeadCache(TENANT_ID);
};
const resetStore = () => { conversationStore.length = 0; emitted.length = 0; };

// ─────────────────────────────────────────────────────────────────────────────
describe('conversationScope — who sees what', () => {

    test('1. a manager gets the whole tenant inbox even with the toggle on', () => {
        const scope = svc.conversationScope(reqFor(manager));
        assert.deepStrictEqual(scope, { userId: TENANT_ID });
        assert.ok(!('assignedTo' in scope));
    });

    test('2. a superadmin is never restricted', () => {
        assert.ok(!('assignedTo' in svc.conversationScope(reqFor(superadmin))));
    });

    test('3. with the workspace toggle OFF nobody is restricted', () => {
        const scope = svc.conversationScope(reqFor(restrictedAgent, { toggle: false }));
        assert.deepStrictEqual(scope, { userId: TENANT_ID });
    });

    test('4. a restricted agent only sees threads assigned to them', () => {
        const scope = svc.conversationScope(reqFor(restrictedAgent));
        assert.equal(String(scope.assignedTo), AGENT_A);
    });

    test('5. viewAllEmails: true keeps the full inbox', () => {
        assert.ok(!('assignedTo' in svc.conversationScope(reqFor(fullInboxAgent))));
    });

    test('6. a LEGACY agent (permission undefined) keeps the full inbox', () => {
        // The trap this feature must not walk into: authMiddleware reads agent
        // permissions with .lean(), which does NOT apply the schema default, so
        // every pre-existing agent row carries `undefined`. Testing `=== true`
        // would lock all of them out the moment a workspace flipped the toggle.
        assert.equal(svc.hasFullInbox({}), true);
        assert.equal(svc.hasFullInbox(undefined), true);
        assert.equal(svc.hasFullInbox({ viewAllEmails: undefined }), true);
        assert.ok(!('assignedTo' in svc.conversationScope(reqFor(legacyAgent))));
    });

    test('7. only an explicit false restricts', () => {
        assert.equal(svc.hasFullInbox({ viewAllEmails: false }), false);
        assert.equal(svc.hasFullInbox({ viewAllEmails: true }), true);
    });

    test('8. assignedTo is NEVER undefined in a scope — BSON would drop it', () => {
        // An undefined value is dropped rather than serialized, which silently
        // turns the whole guard into a no-op. A restricted caller we cannot
        // identify must match nothing, not everything.
        const scope = svc.conversationScope({
            user: { role: 'agent', permissions: { viewAllEmails: false } },
            tenantId: TENANT_ID,
            workspace: { emailFollowsLeadAssignment: true }
        });
        assert.ok('assignedTo' in scope);
        assert.notEqual(scope.assignedTo, undefined);
        assert.equal(String(scope.assignedTo), '000000000000000000000000');
    });

    test('9. forAggregate casts to a real ObjectId — $match does not coerce', () => {
        const scope = svc.conversationScope(reqFor(restrictedAgent), { forAggregate: true });
        assert.ok(scope.assignedTo instanceof mongoose.Types.ObjectId);
    });

    test('10. the socket side needs no scope helper — the room IS the boundary', () => {
        // The WhatsApp service exports conversationScopeForUser because its
        // socket handler authorizes joining a `conversation:<id>` room that a
        // client asks for BY ID. Email has no such room: every email event goes
        // to `em:<userId>`, which a socket joins only for its own id, so there is
        // nothing a client can ask to be let into. Shipping an unused helper that
        // looks like an authorization check is how a later change comes to rely
        // on one that was never wired.
        assert.ok(!('conversationScopeForUser' in svc),
            'add one only alongside a room that actually needs it');

        const socketSrc = read('services', 'socketService.js');
        assert.ok(!/socket\.on\('watch:emailConversation'/.test(socketSrc),
            'no client-requested email room exists');
        assert.ok(socketSrc.includes('socket.join(`em:${userId}`)'),
            'the email room is joined for the socket\'s own id only');
    });
});

describe('withPredicate — search must not escape the scope', () => {

    test('11. the extra predicate is ANDed, never assigned over', () => {
        const scope = { userId: TENANT_ID, assignedTo: AGENT_A };
        const merged = svc.withPredicate(scope, { $or: [{ email: /x/ }] });

        assert.equal(String(merged.assignedTo), AGENT_A, 'the scope survives');
        assert.ok(Array.isArray(merged.$and));
        assert.equal(merged.$and.length, 1);
        assert.ok(!('$or' in merged), 'a top-level $or would read as an OR against the scope');
    });

    test('12. the original scope object is not mutated', () => {
        const scope = { userId: TENANT_ID };
        svc.withPredicate(scope, { $or: [{ email: /x/ }] });
        assert.deepStrictEqual(scope, { userId: TENANT_ID });
    });
});

describe('resolveAssignmentForConversation — null has three meanings', () => {

    test('13. toggle off reports enabled:false so the caller writes nothing', async () => {
        workspaceToggle = false;
        svc.invalidateEmailFollowLeadCache(TENANT_ID);
        const res = await svc.resolveAssignmentForConversation({ tenantId: TENANT_ID, leadId: LEAD_ID });
        assert.deepStrictEqual(res, { enabled: false, assignedTo: null });
        resetToggle();
    });

    test('14. an assigned lead resolves to its owner', async () => {
        resetToggle();
        const res = await svc.resolveAssignmentForConversation({ tenantId: TENANT_ID, leadId: LEAD_ID });
        assert.equal(res.enabled, true);
        assert.equal(String(res.assignedTo), AGENT_A);
    });

    test('15. a genuinely unassigned lead reports enabled:true + null', async () => {
        // This is the distinction that matters: "clear the owner" vs "do not
        // touch it". Collapsing them is what let an un-assignment silently leave
        // a thread with the agent who no longer owns the lead.
        resetToggle();
        const res = await svc.resolveAssignmentForConversation({ tenantId: TENANT_ID, leadId: LEAD_UNASSIGNED });
        assert.deepStrictEqual(res, { enabled: true, assignedTo: null });
    });

    test('16. a supplied lead object short-circuits the read', async () => {
        resetToggle();
        const res = await svc.resolveAssignmentForConversation({
            tenantId: TENANT_ID, lead: { _id: LEAD_ID, assignedTo: AGENT_B }
        });
        assert.equal(String(res.assignedTo), AGENT_B);
    });

    test('17. a toggle read failure fails CLOSED — never wipes an owner', async () => {
        workspaceReadThrows = true;
        svc.invalidateEmailFollowLeadCache(TENANT_ID);
        const res = await svc.resolveAssignmentForConversation({ tenantId: TENANT_ID, leadId: LEAD_ID });
        assert.deepStrictEqual(res, { enabled: false, assignedTo: null });
        resetToggle();
    });

    test('18. a failed toggle read is not cached', async () => {
        workspaceReadThrows = true;
        svc.invalidateEmailFollowLeadCache(TENANT_ID);
        assert.equal(await svc.isEmailFollowLeadEnabled(TENANT_ID), false);
        workspaceReadThrows = false;
        assert.equal(await svc.isEmailFollowLeadEnabled(TENANT_ID), true,
            'the next call must re-read rather than serve a cached failure');
        resetToggle();
    });
});

describe('propagation — the Lead is the only writer', () => {

    test('19. syncConversationsForLead mirrors the owner onto the thread', async () => {
        resetToggle(); resetStore();
        conversationStore.push({ _id: 'c1', userId: TENANT_ID, leadId: LEAD_ID, assignedTo: null });

        const res = await svc.syncConversationsForLead({
            leadId: LEAD_ID, tenantId: TENANT_ID, assignedTo: AGENT_A
        });

        assert.equal(String(conversationStore[0].assignedTo), AGENT_A);
        assert.equal(res.conversations.length, 1);
        assert.equal(res.conversations[0].previousAssignedTo, null);
        assert.equal(String(res.conversations[0].assignedTo), AGENT_A);
    });

    test('20. the PREVIOUS owner is snapshotted before the write', async () => {
        resetToggle(); resetStore();
        conversationStore.push({ _id: 'c1', userId: TENANT_ID, leadId: LEAD_ID, assignedTo: AGENT_A });

        const res = await svc.syncConversationsForLead({
            leadId: LEAD_ID, tenantId: TENANT_ID, assignedTo: AGENT_B
        });

        // Without a snapshot taken before the update, the losing agent can never
        // be told to drop the thread — they would keep it open forever.
        assert.equal(String(res.conversations[0].previousAssignedTo), AGENT_A);
        assert.equal(String(res.conversations[0].assignedTo), AGENT_B);
    });

    test('21. un-assigning a lead clears the thread owner', async () => {
        resetToggle(); resetStore();
        conversationStore.push({ _id: 'c1', userId: TENANT_ID, leadId: LEAD_ID, assignedTo: AGENT_A });

        await svc.syncConversationsForLead({ leadId: LEAD_ID, tenantId: TENANT_ID, assignedTo: null });
        assert.equal(conversationStore[0].assignedTo, null);
    });

    test('22. with the toggle OFF nothing is written at all', async () => {
        resetStore();
        conversationStore.push({ _id: 'c1', userId: TENANT_ID, leadId: LEAD_ID, assignedTo: null });
        workspaceToggle = false;
        svc.invalidateEmailFollowLeadCache(TENANT_ID);

        const res = await svc.syncConversationsForLead({
            leadId: LEAD_ID, tenantId: TENANT_ID, assignedTo: AGENT_A
        });

        assert.equal(conversationStore[0].assignedTo, null);
        assert.equal(res.conversations.length, 0);
        resetToggle();
    });

    test('23. the bulk twin moves a batch in one write', async () => {
        resetToggle(); resetStore();
        conversationStore.push(
            { _id: 'c1', userId: TENANT_ID, leadId: LEAD_ID, assignedTo: null },
            { _id: 'c2', userId: TENANT_ID, leadId: LEAD_UNASSIGNED, assignedTo: null }
        );

        const res = await svc.syncConversationsForLeads({
            leadIds: [LEAD_ID, LEAD_UNASSIGNED], tenantId: TENANT_ID, assignedTo: AGENT_B
        });

        assert.equal(res.conversations.length, 2);
        assert.ok(conversationStore.every(c => String(c.assignedTo) === AGENT_B));
    });

    test('24. deleting a lead clears the owner but keeps leadId (it is required)', async () => {
        resetToggle(); resetStore();
        conversationStore.push({ _id: 'c1', userId: TENANT_ID, leadId: LEAD_ID, assignedTo: AGENT_A });

        await svc.detachDeletedLeads({ leadIds: [LEAD_ID], tenantId: TENANT_ID });

        assert.equal(conversationStore[0].assignedTo, null, 'falls back to manager-only visibility');
        assert.equal(String(conversationStore[0].leadId), LEAD_ID,
            'EmailConversation.leadId is required — nulling it would make the doc unsavable');
    });

    test('25. a thread belonging to another tenant is never touched', async () => {
        resetToggle(); resetStore();
        const OTHER = oid();
        conversationStore.push({ _id: 'c1', userId: OTHER, leadId: LEAD_ID, assignedTo: null });

        const res = await svc.syncConversationsForLead({
            leadId: LEAD_ID, tenantId: TENANT_ID, assignedTo: AGENT_A
        });

        assert.equal(res.conversations.length, 0);
        assert.equal(conversationStore[0].assignedTo, null);
    });
});

describe('real-time audience', () => {

    test('26. managers and full-inbox agents always receive; others only their own', async () => {
        resetToggle();
        const audience = (await svc.conversationAudience({
            tenantId: TENANT_ID, companyUserIds: COMPANY_IDS, assignedTo: AGENT_A
        })).map(String);

        assert.ok(audience.includes(TENANT_ID), 'manager');
        assert.ok(audience.includes(AGENT_FULL), 'viewAllEmails agent');
        assert.ok(audience.includes(AGENT_A), 'the assignee');
        assert.ok(!audience.includes(AGENT_B), 'a different restricted agent must NOT receive it');
    });

    test('27. an unassigned thread reaches managers and full-inbox agents only', async () => {
        resetToggle();
        const audience = (await svc.conversationAudience({
            tenantId: TENANT_ID, companyUserIds: COMPANY_IDS, assignedTo: null
        })).map(String);

        assert.ok(audience.includes(TENANT_ID));
        assert.ok(!audience.includes(AGENT_A));
        assert.ok(!audience.includes(AGENT_B));
    });

    test('28. with the toggle off the audience is the whole company', async () => {
        workspaceToggle = false;
        svc.invalidateEmailFollowLeadCache(TENANT_ID);
        const audience = await svc.conversationAudience({
            tenantId: TENANT_ID, companyUserIds: COMPANY_IDS, assignedTo: AGENT_A
        });
        assert.deepStrictEqual(audience, COMPANY_IDS);
        resetToggle();
    });

    test('29. a reassignment tells the losing agent to drop the thread', async () => {
        resetToggle(); resetStore();

        await svc.broadcastAssignmentChanges({
            tenantId: TENANT_ID,
            companyUserIds: COMPANY_IDS,
            changes: [{ _id: 'c1', previousAssignedTo: AGENT_A, assignedTo: AGENT_B }]
        });

        const revoked = emitted.find(e => e.data.revoked === true);
        assert.ok(revoked, 'the previous owner needs a targeted revoke event');
        assert.deepStrictEqual(revoked.ids, [AGENT_A]);

        const gained = emitted.find(e => !e.data.revoked);
        assert.ok(gained.ids.includes(AGENT_B));
        assert.ok(!gained.ids.includes(AGENT_A), 'the loser is not in the normal audience');
    });

    test('30. the assignment event carries the owner NAME, not just an id', async () => {
        resetToggle(); resetStore();

        await svc.broadcastAssignmentChanges({
            tenantId: TENANT_ID,
            companyUserIds: COMPANY_IDS,
            changes: [{ _id: 'c1', previousAssignedTo: null, assignedTo: AGENT_B }]
        });

        // The inbox renders chat.assignedTo.name; a bare id blanks the badge
        // until the next full refetch, which reads as the feature having failed.
        assert.equal(emitted[0].data.assignedToName, 'Agent B');
    });

    test('31. no revoke is sent when the owner did not actually change', async () => {
        resetToggle(); resetStore();

        await svc.broadcastAssignmentChanges({
            tenantId: TENANT_ID,
            companyUserIds: COMPANY_IDS,
            changes: [{ _id: 'c1', previousAssignedTo: AGENT_A, assignedTo: AGENT_A }]
        });

        assert.equal(emitted.filter(e => e.data.revoked).length, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Schema + wiring facts, asserted against the REAL modules / sources.
// ─────────────────────────────────────────────────────────────────────────────
describe('schema and defaults — upgrading must change nothing', () => {

    test('32. emailFollowsLeadAssignment defaults to FALSE', () => {
        assert.equal(FOLLOW_LEAD_DEFAULT, false,
            'an existing workspace must keep its shared inbox until it opts in');
    });

    test('33. viewAllEmails defaults to TRUE', () => {
        assert.equal(VIEW_ALL_EMAILS_DEFAULT, true,
            'every existing agent row must read as full inbox, or enabling the '
            + 'workspace toggle would silently empty their inbox');
    });

    test('34. the restricted presets opt NEW agents in', () => {
        assert.equal(PRESETS.VIEW_ONLY.viewAllEmails, false);
        assert.equal(PRESETS.BASIC_AGENT.viewAllEmails, false);
        assert.equal(PRESETS.SENIOR_AGENT.viewAllEmails, true);
        assert.equal(PRESETS.MANAGER.viewAllEmails, true);
    });

    test('35. EmailConversation carries assignedTo with an index that covers the list', () => {
        assert.ok(RealConversation.schema.path('assignedTo'), 'the mirror field must exist');
        assert.equal(RealConversation.schema.path('assignedTo').options.default, null);
        assert.ok(
            CONVERSATION_INDEXES.some(k => k === 'userId,status,assignedTo,lastMessageAt'),
            'the scoped, sorted, paginated list needs a covering index'
        );
    });
});

describe('wiring — the invariants that broke WhatsApp first', () => {

    test('36. the conversation upsert never puts assignedTo in $set AND $setOnInsert', () => {
        // Mongo validates an update document STATICALLY: a path present in both
        // operators throws "would create a conflict at 'x'" even when only one
        // could ever apply. That clash killed every inbound WhatsApp message in
        // production; both email writers must stay clear of it.
        for (const file of ['services/emailSyncService.js', 'services/imapService.js']) {
            const src = read(...file.split('/'));
            const setOnInsert = src.slice(src.indexOf('$setOnInsert'), src.indexOf('$inc'));
            assert.ok(!setOnInsert.includes('assignedTo'),
                `${file}: assignedTo must be written through $set only`);
        }
    });

    test('37. both writers derive the owner instead of accepting one', () => {
        for (const file of ['services/emailSyncService.js', 'services/imapService.js']) {
            const src = read(...file.split('/'));
            assert.ok(src.includes('resolveAssignmentForConversation'),
                `${file} must derive the owner from the lead`);
            assert.ok(src.includes('mirrorAssignment'),
                `${file} must honour "toggle off => write nothing"`);
        }
    });

    test('38. every conversation handler resolves through conversationScope', () => {
        const src = read('controllers', 'emailConversationController.js');
        const handlers = ['getConversations', 'getMessages', 'downloadAttachment', 'markRead', 'updateStatus'];
        for (const name of handlers) {
            const start = src.indexOf(`exports.${name} =`);
            assert.ok(start > -1, `${name} should exist`);
            const end = src.indexOf('\nexports.', start + 1);
            const body = src.slice(start, end === -1 ? undefined : end);
            assert.ok(body.includes('conversationScope(req)'),
                `${name} must scope its read, or an out-of-scope id leaks`);
        }
    });

    test('39. the socket fan-out uses the em: rooms, not user: rooms', () => {
        const socketSrc = read('services', 'socketService.js');
        assert.ok(socketSrc.includes('socket.join(`em:${userId}`)'),
            'the dedicated room must be joined for the socket\'s own id only');
        assert.ok(socketSrc.includes('emitToEmailUsers'));

        // join:company deliberately lets an agent into their manager's `user:`
        // room, so a filtered emitToUsers() would still leak everything.
        for (const file of ['services/emailSyncService.js', 'services/imapService.js']) {
            const src = read(...file.split('/'));
            assert.ok(src.includes('broadcastConversationEvent'),
                `${file} must address the audience, not every user: room`);
            assert.ok(!/emitToUsers\(recipients, 'email:/.test(src),
                `${file} must not emit email events into user: rooms`);
        }
    });

    test('40. the lead-effects hub propagates to email on assign, bulk and delete', () => {
        const src = read('utils', 'leadEffects.js');
        const calls = src.split('emailAssignmentService').length - 1;
        assert.ok(calls >= 3,
            'queueLeadAssignmentEffects, queueBulkLeadAssignmentEffects and '
            + 'queueLeadDeletionEffects must each reach the email service');
    });

    test('41. compose claims the contact through the LEAD, never the thread', () => {
        const src = read('controllers', 'emailController.js');
        assert.ok(src.includes('claimRecipientForAgent'));
        assert.ok(src.includes('This contact is assigned to another agent.'),
            'another agent\'s contact must be refused');
        assert.ok(!/assignedTo['"]?\s*[:=]\s*.*conversation/i.test(src),
            'the thread owner is a derived mirror — never written from a controller');
    });

    test('42b. the inbox can reassign a thread, and only through the LEAD', () => {
        // The WhatsApp inbox has an Assigned Agent dropdown in its contact
        // panel; without the twin, a manager could see the owner badge but had
        // to leave the inbox and go to Leads to change it.
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', 'client', 'src', 'components', 'Email', 'EmailInbox.jsx'),
            'utf8'
        );
        assert.ok(src.includes('handleAssignThread'), 'the control must exist');
        assert.ok(/api\.put\(`\/leads\/\$\{leadId\}\/assign`/.test(src),
            'it must write the LEAD owner — there is no endpoint that sets a thread owner');
        assert.ok(src.includes('assignmentMirrored'),
            'the panel must know whether assigning will actually move the thread');
    });

    test('42. the toggle cache is invalidated across processes on save', () => {
        // The IMAP poller runs outside the web instance that handles the PUT, so
        // a local clear alone leaves it deriving owners from the old value.
        const src = read('controllers', 'emailConversationController.js');
        assert.ok(src.includes('invalidateEmailFollowLeadCache'));
        assert.ok(src.includes('publishTenantInvalidation'));
        assert.ok(read('services', 'cacheInvalidationBus.js').includes('invalidateEmailFollowLeadCache'),
            'the bus must clear the email toggle when another process broadcasts');
    });
});
