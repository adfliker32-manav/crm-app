// Assignment-module audit fixes (2026-09-09).
//
// Five defects, all in the path "someone changes who owns a lead → the WhatsApp
// thread follows":
//
//  A1  The inbound webhook derived the conversation's owner from whatever lead
//      the PHONE matched, ignoring the conversation's own leadId. A missed phone
//      match therefore read as "unassigned" and silently took the chat away from
//      its agent on the next inbound message.
//  A2  A conversation linked to a DELETED lead could never recover — the backfill
//      only ever filled a null leadId, so the row stayed dangling forever.
//  A3  Only the external API linked unlinked conversations before syncing.
//      Assigning from the CRM, a workflow, an automation rule or MCP moved the
//      Lead and left the chat behind.
//  A4  The assign dropdown lists the manager (`my-team?includeManager=true`) but
//      the backend required `role: 'agent'`, so choosing them always 400'd.
//  A5  Neither assign route recorded the change: no lead history on
//      PUT /leads/:id/assign, and no activity log at all on bulk assign (its log
//      omitted the required entityId and was swallowed by the .catch).
//
// Source-assertion style, matching tests/sequences/sequence-coverage.js: these
// are structural guarantees about which call happens before which, and the
// surrounding code is webhook I/O that cannot be exercised without Mongo.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const webhook = read('controllers', 'whatsappWebhookController.js');
const effects = read('utils', 'leadEffects.js');
const leadCtrl = read('controllers', 'leadController.js');

// Slice one function body out of a source file, from its declaration to the
// next top-level `};` — enough to assert on ordering within it.
function fnBody(src, declaration) {
    const start = src.indexOf(declaration);
    assert.ok(start !== -1, `could not find: ${declaration}`);
    const end = src.indexOf('\n};', start);
    assert.ok(end !== -1, `could not find end of: ${declaration}`);
    return src.slice(start, end);
}

describe('A1 — the webhook mirrors the LINKED lead, not the phone match', () => {

    test('it reads the conversation\'s own leadId before resolving the owner', () => {
        assert.match(webhook, /const linkedLeadId = existingConversation\?\.leadId \|\| null;/,
            'the linked lead id is no longer read');
        assert.match(webhook, /Lead\.findById\(linkedLeadId\)/,
            'the linked lead is not fetched');
    });

    test('the linked lead wins over the phone-matched lead', () => {
        // The phone match only survives when it IS the linked lead, or when there
        // is no link at all.
        assert.match(webhook, /if \(linkedLeadId && String\(lead\?\._id \|\| ''\) !== String\(linkedLeadId\)\)/,
            'the linked-vs-matched comparison is gone');
        assert.match(webhook, /mirrorLead = linked;/, 'the linked lead is not adopted as the mirror source');
    });

    test('a failed read fails CLOSED — it must never clear an owner', () => {
        const idx = webhook.indexOf('linked-lead read failed');
        assert.ok(idx !== -1, 'the linked-lead read has no catch');
        const after = webhook.slice(idx, idx + 200);
        assert.match(after, /mirrorLead = undefined;/, 'a read failure does not mark the source unknown');

        // undefined must short-circuit to "do not write anything".
        assert.match(webhook, /mirrorLead === undefined\s*\n\s*\?\s*\{ enabled: false, assignedTo: null \}/,
            'an unknown mirror source does not resolve to enabled:false');
    });

    test('resolveAssignmentForConversation still distinguishes off from unassigned', () => {
        // A1 relies on this contract: `enabled:false` = write nothing.
        const svc = read('services', 'whatsappAssignmentService.js');
        assert.match(svc, /if \(!await isFollowLeadEnabled\(tenantId\)\) return \{ enabled: false, assignedTo: null \};/);
    });
});

describe('A2 — a link to a deleted lead self-heals', () => {

    test('a missing linked lead is marked stale rather than trusted', () => {
        assert.match(webhook, /staleLink = true;/, 'no stale-link detection');
    });

    test('a stale link is re-pointed when a real lead matches the phone', () => {
        assert.match(
            webhook,
            /if \(existingConversation && lead\?\._id && \(!existingConversation\.leadId \|\| staleLink\)\)/,
            'the backfill no longer re-points a stale link'
        );
    });

    test('a stale link with nothing to point at is cleared, not left dangling', () => {
        assert.match(webhook, /\} else if \(existingConversation && staleLink\) \{[\s\S]{0,220}\$set\.leadId = null;/,
            'a dangling link is not cleared');
    });

    test('the stale row does not also inherit the deleted lead\'s (absent) owner', () => {
        // When stale, the resolver is handed the phone-matched lead — not the
        // dead link — so the owner and the leadId end up describing the SAME lead.
        assert.match(webhook, /lead: staleLink \? \(lead \|\| null\) : \(mirrorLead \|\| null\)/,
            'a stale link no longer falls back to the phone-matched lead');
    });
});

describe('A3 — every assign path links before it syncs', () => {

    test('the single-lead hub links first', () => {
        const body = fnBody(effects, 'const queueLeadAssignmentEffects =');
        const link = body.indexOf('linkLeadConversations');
        const sync = body.indexOf('syncConversationsForLead(');
        assert.ok(link !== -1, 'the hub does not link at all');
        assert.ok(sync !== -1, 'the hub no longer syncs');
        assert.ok(link < sync, 'linking must happen BEFORE the sync that filters on leadId');
    });

    test('the bulk hub links first too', () => {
        const body = fnBody(effects, 'const queueBulkLeadAssignmentEffects =');
        const link = body.indexOf('linkConversationsToLead');
        const sync = body.indexOf('syncConversationsForLeads(');
        assert.ok(link !== -1, 'the bulk hub does not link');
        assert.ok(link < sync, 'bulk linking must precede the bulk sync');
    });

    test('linking tolerates a lead shape that carries no phone', () => {
        // AssignUserNode passes a hand-built { _id, assignedTo } with no phone.
        const body = fnBody(effects, 'const linkLeadConversations =');
        assert.match(body, /if \(phone === undefined\)/, 'an unprojected phone is not re-fetched');
        assert.match(body, /select\('phone'\)/, 'the phone is not fetched from the Lead');
        assert.match(body, /if \(!phone\) return;/, 'a lead with no phone is not skipped');
    });

    test('linking is gated on the workspace toggle, like the rest of the module', () => {
        const body = fnBody(effects, 'const linkLeadConversations =');
        assert.match(body, /isFollowLeadEnabled\(tenantId\)/, 'linking is not gated on the toggle');
    });

    test('linking never breaks the assignment it rides along with', () => {
        const body = fnBody(effects, 'const linkLeadConversations =');
        assert.match(body, /catch \(err\)/, 'linking is not wrapped in a catch');
    });

    test('linkConversationsToLead is still strictly additive', () => {
        // Re-pointing a thread that already belongs to another lead would steal it.
        const svc = read('services', 'whatsappAssignmentService.js');
        const body = fnBody(svc, 'async function linkConversationsToLead');
        assert.match(body, /leadId: null,/, 'the link filter no longer restricts to unlinked rows');
    });
});

describe('A4 — the workspace owner is a valid assignee', () => {

    test('resolveAssignee accepts the owner as well as their agents', () => {
        const body = fnBody(leadCtrl, 'const resolveAssignee =');
        assert.match(body, /\$or: \[\{ _id: ownerId \}, \{ parentId: ownerId \}\]/,
            'the owner is excluded again — the manager row in the dropdown will 400');
        assert.doesNotMatch(body, /role: 'agent'/,
            "role:'agent' is back, which is what excluded the manager");
    });

    test('a malformed id answers 400, not a CastError 500', () => {
        const body = fnBody(leadCtrl, 'const resolveAssignee =');
        assert.match(body, /mongoose\.isValidObjectId\(agentId\)/, 'no id validation');
    });

    test('all three CRM assign paths share that one resolver', () => {
        for (const decl of ['const assignLead =', 'const bulkAssignLeads =']) {
            const body = fnBody(leadCtrl, decl);
            assert.match(body, /resolveAssignee\(/, `${decl} does not use the shared resolver`);
        }
        // updateLead handles assignedTo inline; it must use the resolver too or
        // PUT /leads/:id and PUT /leads/:id/assign disagree about who is valid.
        assert.match(leadCtrl, /const resolvedAssignee = await resolveAssignee\(nextAssignee, ownerId\);/,
            'updateLead still has its own divergent agent check');
    });

    test('bulk assign filters malformed ids instead of throwing', () => {
        const body = fnBody(leadCtrl, 'const bulkAssignLeads =');
        assert.match(body, /filter\(i => mongoose\.isValidObjectId\(i\)\)/, 'ids are not validated');
    });
});

describe('A5 — reassignment is auditable', () => {

    test('single assign writes a lead history entry, only when it changed', () => {
        const body = fnBody(leadCtrl, 'const assignLead =');
        assert.match(body, /const assignmentChanged = previousAssignee !== nextAssignee;/,
            'no change detection — re-selecting the same agent would spam the timeline');
        assert.match(body, /if \(assignmentChanged\) \{[\s\S]{0,320}subType: 'Assignment'/,
            'no Assignment history entry');
    });

    test('bulk assign writes history for every lead it touched', () => {
        const body = fnBody(leadCtrl, 'const bulkAssignLeads =');
        assert.match(body, /\$push: \{ history: \{ \$each: \[historyEntry\], \$slice: -100 \} \}/,
            'bulk assign writes no history');
    });

    test('bulk assign writes an activity log WITH the required entityId', () => {
        const body = fnBody(leadCtrl, 'const bulkAssignLeads =');
        const logIdx = body.indexOf('logActivity(');
        assert.ok(logIdx !== -1, 'bulk assign writes no activity log');
        const call = body.slice(logIdx, logIdx + 700);
        assert.match(call, /actionType: 'LEAD_ASSIGNED'/);
        assert.match(call, /entityId: ownerId/,
            'entityId is required by the schema — without it the log silently fails validation');
    });

    test('the bulk status log was missing the same required field', () => {
        const body = fnBody(leadCtrl, 'const bulkUpdateStatus =');
        const logIdx = body.indexOf('logActivity(');
        assert.ok(logIdx !== -1, 'bulk status writes no activity log');
        const call = body.slice(logIdx, logIdx + 600);
        assert.match(call, /entityId: req\.tenantId/, 'bulk status log still omits entityId');
    });

    test('ActivityLog really does require entityId (the reason the above matters)', () => {
        const ActivityLog = require(path.join(SRC, 'models', 'ActivityLog.js'));
        assert.strictEqual(ActivityLog.schema.path('entityId').isRequired, true);
    });
});
