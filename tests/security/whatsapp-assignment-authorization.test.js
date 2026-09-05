// Server-side authorization for the WhatsApp inbox.
//
// Two distinct guarantees are asserted here:
//
//   1. AGENT GATE — every conversation route mounts checkPermission('viewWhatsApp').
//      Before this, `viewWhatsApp` was enforced only by hiding the sidebar entry
//      (client/src/components/Sidebar.jsx), so any agent could reach the entire
//      inbox with a direct API call. requireModule/requireFeature are NOT a
//      substitute: both are WORKSPACE plan gates, so every agent in a paying
//      tenant passes them.
//
//   2. ROW GATE — no handler still filters by the raw company scope. Every one
//      must resolve its row through conversationScope(), or lead-based
//      assignment is enforced in some endpoints and silently bypassed in others.
//
// These read the sources rather than mounting Express, matching the approach in
// settings-authorization.test.js and validation-coverage.test.js.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const GATE = /canViewWhatsApp|checkPermission\('viewWhatsApp'\)/;

// ─────────────────────────────────────────────────────────────────────────────
describe('1. the agent gate is mounted on every inbox route', () => {

    test("checkPermission('viewWhatsApp') is a real, inspectable gate", () => {
        const checkPermission = require(path.join(SRC, 'middleware', 'checkPermission.js'));
        const mw = checkPermission('viewWhatsApp');
        assert.strictEqual(typeof mw, 'function');
        // Deliberately name-tagged so a router-stack walk can assert the gate is
        // actually mounted rather than trusting that someone remembered it.
        assert.strictEqual(mw.permission, 'viewWhatsApp');
        assert.strictEqual(mw.name, 'checkPermission:viewWhatsApp');
    });

    test('viewWhatsApp defaults to false, so an ungated route would be open to agents', () => {
        const User = require(path.join(SRC, 'models', 'User.js'));
        assert.strictEqual(User.schema.path('permissions.viewWhatsApp').options.default, false);
    });

    test('every /conversations route names the viewWhatsApp gate', () => {
        const src = stripComments(read('routes', 'whatsappRoutes.js'));
        const offenders = src.split('\n')
            .filter(l => /^router\.(get|post|put|delete)\('\/conversations/.test(l.trim()))
            .filter(l => !GATE.test(l));

        assert.deepStrictEqual(
            offenders, [],
            'ungated conversation route(s):\n' + offenders.join('\n')
        );
    });

    test('the media proxy is gated too — attachments are conversation content', () => {
        const src = stripComments(read('routes', 'whatsappRoutes.js'));
        const mediaRoutes = src.split('\n')
            .filter(l => /^router\.get\('\/media\//.test(l.trim()));

        assert.ok(mediaRoutes.length > 0, 'expected a /media/:mediaId route to exist');
        for (const line of mediaRoutes) {
            assert.ok(GATE.test(line), 'ungated media route: ' + line.trim());
        }
    });

    test('the gate is mounted, not merely imported', () => {
        const src = stripComments(read('routes', 'whatsappRoutes.js'));
        const usages = (src.match(/canViewWhatsApp/g) || []).length;
        // 1 declaration + one per gated route.
        assert.ok(usages > 10, `expected the gate on every inbox route, saw ${usages} references`);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. every handler resolves rows through conversationScope', () => {

    const controller = stripComments(read('controllers', 'whatsappConversationController.js'));

    test('no handler still filters by the raw company scope', () => {
        // `userId: { $in: companyUserIds }` was the OLD, unfiltered shared-inbox
        // filter. The only surviving uses must be the deliberate ones flagged
        // below; a handler still using it would ignore assignment entirely.
        const lines = controller.split('\n')
            .map((l, i) => [i + 1, l])
            .filter(([, l]) => l.includes('userId: { $in: companyUserIds }'));

        // Allowed, and each is guarded independently:
        //  - startConversation's duplicate-avoidance + lead lookups, which sit
        //    behind an explicit isAssignmentRestricted() ownership check
        //  - the MediaAsset library lookup (library assets are tenant-shared,
        //    not conversation-scoped)
        //  - the media-proxy message pre-check, which is followed by an
        //    explicit conversationScope check on the owning conversation
        assert.ok(
            lines.length <= 5,
            'unexpected raw company-scope filters:\n' +
            lines.map(([n, l]) => `  line ${n}: ${l.trim()}`).join('\n')
        );
    });

    test('the media proxy verifies the OWNING CONVERSATION, not just the message', () => {
        // Proving only that a message with this mediaId belongs to the company
        // lets a restricted agent pull attachments out of a thread they cannot
        // open, by guessing a media id.
        const idx = controller.indexOf('exports.downloadMediaProxy');
        assert.ok(idx > 0, 'downloadMediaProxy not found');
        const body = controller.slice(idx, idx + 4000);

        assert.ok(body.includes('conversationScope'), 'media proxy does not scope the conversation');
        assert.ok(
            /WhatsAppConversation\.exists\(\s*\{\s*_id:\s*owningMsg\.conversationId/.test(body),
            'media proxy does not prove the owning conversation is in scope'
        );
    });

    test('the unread aggregate casts assignedTo to an ObjectId', () => {
        // A $match stage does NOT coerce a string id. Without forAggregate the
        // scoped badge silently reads 0 for every restricted agent.
        const idx = controller.indexOf('exports.getUnreadCount');
        assert.ok(idx > 0, 'getUnreadCount not found');
        const body = controller.slice(idx, idx + 1200);
        assert.ok(
            /conversationScope\(req,\s*\{\s*forAggregate:\s*true\s*\}\)/.test(body),
            'getUnreadCount must request forAggregate: true'
        );
    });

    test('search is ANDed into the scope, never assigned over it', () => {
        const idx = controller.indexOf('exports.getConversations');
        const body = controller.slice(idx, idx + 2500);
        assert.ok(body.includes('withPredicate'), 'search must compose via withPredicate');
        assert.ok(
            !/query\.\$or\s*=/.test(body),
            'assigning query.$or can clobber the authorization scope'
        );
    });

    test('conversation events go out through the audience helper, not a raw user loop', () => {
        // `user:<id>` rooms are reachable through join:company, so a per-user
        // loop leaks to any agent who joined their manager's room.
        assert.ok(
            !/emitToUsers\(\s*companyUserIds/.test(controller),
            'found a raw emitToUsers(companyUserIds, ...) fan-out'
        );
        assert.ok(
            controller.includes('broadcastConversationEvent'),
            'controller must emit via broadcastConversationEvent'
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. the socket layer honours the same scope', () => {

    const socket = stripComments(read('services', 'socketService.js'));

    test('watch:conversation authorizes with conversationScopeForUser', () => {
        const idx = socket.indexOf("socket.on('watch:conversation'");
        assert.ok(idx > 0, 'watch:conversation handler not found');
        const body = socket.slice(idx, idx + 1600);
        assert.ok(
            body.includes('conversationScopeForUser'),
            'watch:conversation must apply the assignment scope, not just company ownership'
        );
    });

    test('a dedicated wa: room exists that join:company cannot grant', () => {
        assert.ok(socket.includes('socket.join(`wa:${userId}`)'), 'wa: room is not joined');
        assert.ok(socket.includes('emitToWhatsAppUsers'), 'emitToWhatsAppUsers is not exported');

        // join:company must only ever grant `user:` rooms.
        const idx = socket.indexOf("socket.on('join:company'");
        const body = socket.slice(idx, idx + 2200);
        assert.ok(
            !body.includes('wa:'),
            'join:company must never be able to join a wa: room'
        );
    });

    test('emitToWhatsAppUsers targets wa: rooms, not user: rooms', () => {
        const idx = socket.indexOf('const emitToWhatsAppUsers');
        assert.ok(idx > 0);
        const body = socket.slice(idx, idx + 400);
        assert.ok(body.includes('`wa:${String(uid)}`'), 'must address the wa: room');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. the settings endpoint is gated and validated', () => {

    const routes = stripComments(read('routes', 'leadRoutes.js'));

    test('both config routes require accessSettings and the whatsapp module', () => {
        const lines = routes.split('\n')
            .filter(l => l.includes('whatsapp-assignment-config'));

        assert.strictEqual(lines.length, 2, 'expected a GET and a PUT');
        for (const line of lines) {
            assert.ok(line.includes("checkPermission('accessSettings')"), 'ungated: ' + line.trim());
            assert.ok(line.includes("requireModule('whatsapp')"), 'no module gate: ' + line.trim());
        }
    });

    test('the PUT mounts validate() — the write-route ratchet requires it', () => {
        const put = routes.split('\n')
            .find(l => l.includes("router.put('/whatsapp-assignment-config'"));
        assert.ok(put, 'PUT route not found');
        assert.ok(
            put.includes('validate(schemas.whatsappAssignmentConfig)'),
            'PUT must mount its Joi schema'
        );
    });

    test('the schema requires a real boolean, so a typo cannot silently no-op', () => {
        const { schemas } = require(path.join(SRC, 'middleware', 'validateRequest.js'));
        const s = schemas.whatsappAssignmentConfig;
        assert.ok(s, 'whatsappAssignmentConfig schema is missing');

        assert.ok(s.validate({ whatsappFollowsLeadAssignment: true }).error === undefined);
        assert.ok(s.validate({}).error, 'an empty body must be rejected');
        assert.ok(s.validate({ typo: true }).error, 'a misspelled field must be rejected');
        assert.ok(
            s.validate({ whatsappFollowsLeadAssignment: 'nonsense' }).error,
            'a non-boolean must be rejected'
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('5. the legacy WhatsApp endpoints are scoped too', () => {

    const legacy = stripComments(read('controllers', 'webhookController.js'));

    test('getWhatsAppLeads uses req.dataScope, not a bare userId', () => {
        const idx = legacy.indexOf('const getWhatsAppLeads');
        const body = legacy.slice(idx, idx + 900);
        assert.ok(body.includes('req.dataScope'), 'must apply the lead row-level scope');
        assert.ok(
            !/Lead\.find\(\s*\{\s*userId:\s*currentUserId/.test(body),
            'still filtering by a bare userId'
        );
    });

    test('sendReply resolves and authorizes the lead BEFORE sending', () => {
        const idx = legacy.indexOf('const sendReply');
        const body = legacy.slice(idx, idx + 2600);

        assert.ok(
            !/Lead\.findById\(leadId\)/.test(body),
            'unscoped Lead.findById(leadId) — a cross-tenant write, and with an ' +
            'undefined id Mongoose matches the FIRST document in the collection'
        );
        assert.ok(body.includes('...req.dataScope'), 'lead lookup must be scoped');

        // The authorization must happen before the outbound HTTP call.
        const guard = body.indexOf('req.dataScope');
        const send = body.indexOf('axios.post');
        assert.ok(guard > 0 && send > 0 && guard < send,
            'the lead must be authorized before the message is sent');
    });
});
