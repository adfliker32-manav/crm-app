// ============================================================
// 📧 LEAD-BASED EMAIL CONVERSATION ASSIGNMENT
// ============================================================
// The email twin of whatsappAssignmentService, and deliberately the same shape:
// the Lead is the SINGLE source of truth for who owns an email thread, and
// EmailConversation.assignedTo is a DERIVED MIRROR of Lead.assignedTo. This
// module is its only writer — there is no API, request body or UI control that
// sets it independently. If the two ever disagree the Lead wins
// (scripts/backfillEmailAssignment.js re-derives the collection, re-runnably).
//
// Why mirror rather than join leadId -> Lead.assignedTo at query time: the
// inbox list, the unread badge and search all paginate and sort by
// lastMessageAt. A $lookup forces a full-collection aggregation before
// $sort/$skip/$limit on every keystroke. One indexed equality predicate is
// O(index).
//
// EVERYTHING here is inert unless the workspace has
// WorkspaceSettings.emailFollowsLeadAssignment === true. With the toggle off
// the inbox behaves exactly as it always has: fully shared across the company.
//
// ── ONE DIFFERENCE FROM WHATSAPP ────────────────────────────────────────────
// EmailConversation.leadId is `required: true`, so an email thread can never be
// lead-less: every row is resolvable. That is why there is no
// linkConversationsToLead twin here — the "thread that existed before its Lead"
// case, which needed phone-suffix matching on the WhatsApp side, cannot arise.
// Both writers (emailSyncService for outbound, imapService for inbound) create
// the Lead first and the thread second.
//
// SCOPING
//   Does NOT reuse the global req.dataScope — that object is hardcoded to Lead
//   semantics (userId = tenant + Lead.assignedTo), while email threads are
//   owned by the TENANT (emailConversationController.tenantOf), not by the
//   agent who happened to send. Same reasoning as whatsappAssignmentService.
// ============================================================

const mongoose = require('mongoose');
const EmailConversation = require('../models/EmailConversation');
const { getRequestUserId } = require('../utils/controllerHelpers');

// ── Toggle cache ─────────────────────────────────────────────────────────────
// HTTP requests read the toggle straight off req.workspace (already loaded and
// cached by authMiddleware, so it costs nothing); this cache exists for the
// contexts that have no req at all — the IMAP poller, the email queue worker,
// cron jobs and the workflow engine.
const toggleCache = new Map(); // tenantId -> { value, expiresAt }
const TOGGLE_TTL_MS = 5 * 60 * 1000;
const TOGGLE_CACHE_MAX = 5000;

const pruneToggleCache = () => {
    const now = Date.now();
    for (const [k, v] of toggleCache.entries()) {
        if (v.expiresAt <= now) toggleCache.delete(k);
    }
    if (toggleCache.size > TOGGLE_CACHE_MAX) {
        const overflow = toggleCache.size - TOGGLE_CACHE_MAX;
        let i = 0;
        for (const k of toggleCache.keys()) {
            if (i++ >= overflow) break;
            toggleCache.delete(k);
        }
    }
};

/** Drop the cached toggle for a workspace. Called when the setting is saved. */
const invalidateEmailFollowLeadCache = (...tenantIds) => {
    for (const id of tenantIds) {
        if (id) toggleCache.delete(String(id));
    }
};

/**
 * Is lead-based assignment enabled for this workspace's email inbox?
 * Fails CLOSED to `false` on any error — i.e. degrades to today's shared inbox
 * rather than to an empty one.
 */
async function isEmailFollowLeadEnabled(tenantId) {
    if (!tenantId) return false;
    const key = String(tenantId);

    const cached = toggleCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let value = false;
    try {
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const ws = await WorkspaceSettings.findOne({ userId: tenantId })
            .select('emailFollowsLeadAssignment')
            .lean();
        value = ws?.emailFollowsLeadAssignment === true;
    } catch (err) {
        console.error('[Email Assignment] isEmailFollowLeadEnabled failed:', err.message);
        return false; // do not cache a failure
    }

    pruneToggleCache();
    toggleCache.set(key, { value, expiresAt: Date.now() + TOGGLE_TTL_MS });
    return value;
}

// ── Permission model ─────────────────────────────────────────────────────────

/** Managers and superadmins always get the complete inbox. */
const isPrivileged = (user = {}) => ['manager', 'superadmin'].includes(user.role);

/**
 * Full-inbox check. Only an EXPLICIT `false` restricts.
 *
 * viewAllEmails defaults to true in the schema, but a Mongoose default is
 * applied on hydration — NOT by .lean(), which returns raw BSON. authMiddleware
 * reads agent permissions with .lean(), so for every agent document written
 * before this field existed the value is `undefined`, not `true`.
 *
 * Testing `=== true` would therefore restrict every pre-existing agent the
 * moment a workspace enabled the toggle — the exact lockout the `default: true`
 * was chosen to avoid. Legacy undefined must read as full inbox.
 */
function hasFullInbox(permissions) {
    return permissions?.viewAllEmails !== false;
}

/**
 * Would this requester be restricted to their own threads?
 * Order matters and mirrors the documented rules:
 *   1. privileged role         -> full inbox, always
 *   2. workspace toggle off    -> full inbox (today's behaviour)
 *   3. viewAllEmails not false -> full inbox (see hasFullInbox)
 *   4. otherwise               -> assignment-based
 */
function isAssignmentRestricted(req) {
    if (!req || !req.user) return false;
    if (isPrivileged(req.user)) return false;
    if (req.workspace?.emailFollowsLeadAssignment !== true) return false;
    return !hasFullInbox(req.user.permissions);
}

/**
 * The Mongo filter fragment describing every thread this requester may see or
 * act on. Spread it into EVERY read and resolve every single-document mutation
 * through it, so an out-of-scope id 404s instead of leaking a 403.
 *
 * Email threads are keyed by the TENANT id (emailSyncService and imapService
 * both write `userId: tenantId`), so unlike WhatsApp there is no company-user
 * fan-out to resolve — `userId` is a single value.
 *
 * @param {object}  req
 * @param {object}  [options]
 * @param {boolean} [options.forAggregate] cast assignedTo to an ObjectId — a
 *        $match stage does NOT coerce a string, so without this a scoped
 *        aggregate silently matches nothing.
 */
function conversationScope(req, { forAggregate = false } = {}) {
    const tenantId = req.tenantId || req.user?.userId || req.user?.id;
    return buildScope({
        tenantId,
        selfId: getRequestUserId(req.user),
        restricted: isAssignmentRestricted(req),
        forAggregate
    });
}

// NOTE: there is deliberately no conversationScopeForUser() twin here.
// The WhatsApp service needs one because its socket handler authorizes joining a
// `conversation:<id>` room, which a client can ask for by id. Email has no such
// room — every email event is addressed to `em:<userId>`, which a socket joins
// only for its own id — so the audience filter in conversationAudience() is the
// whole authorization story. Add one only alongside a room that needs it.

function buildScope({ tenantId, selfId, restricted, forAggregate }) {
    const scope = { userId: tenantId };
    if (!restricted) return scope;

    // NEVER leave this undefined. BSON DROPS an undefined value rather than
    // serializing it, which would silently turn the whole guard into a no-op —
    // this repo has shipped that exact bug more than once.
    if (!selfId) {
        // Cannot identify the caller but they are provably restricted: match
        // nothing rather than everything.
        scope.assignedTo = new mongoose.Types.ObjectId('000000000000000000000000');
        return scope;
    }

    scope.assignedTo = forAggregate ? new mongoose.Types.ObjectId(String(selfId)) : selfId;
    return scope;
}

/**
 * Merge extra `$or`-style predicates (search) into a scope WITHOUT clobbering
 * it. Assigning `query.$or = [...]` would overwrite any `$or` the scope itself
 * needs and reads as an OR against the scope rather than an AND with it.
 */
function withPredicate(scope, predicate) {
    if (!predicate) return scope;
    const merged = { ...scope };
    merged.$and = [...(scope.$and || []), predicate];
    return merged;
}

// ── Assignment resolution + propagation ──────────────────────────────────────

/**
 * The agent a thread for this lead should be assigned to, plus WHY the answer
 * is null — the caller cannot act on a bare null.
 *
 * `enabled: false` means "this workspace does not mirror assignment — write
 * nothing". `enabled: true` with `assignedTo: null` means "this thread
 * genuinely has no owner — clear it". Collapsing the two is what let the
 * WhatsApp webhook keep a thread with an agent after its lead was unassigned.
 *
 * Fails CLOSED to `enabled: false` on a read error, so a transient failure
 * never wipes an owner.
 *
 * @returns {Promise<{enabled: boolean, assignedTo: (ObjectId|null)}>}
 */
async function resolveAssignmentForConversation({ tenantId, leadId, lead }) {
    if (!await isEmailFollowLeadEnabled(tenantId)) return { enabled: false, assignedTo: null };

    if (lead !== undefined && lead !== null) {
        return { enabled: true, assignedTo: lead.assignedTo || null };
    }
    if (!leadId) return { enabled: true, assignedTo: null };

    try {
        const Lead = require('../models/Lead');
        const doc = await Lead.findById(leadId).select('assignedTo').lean();
        return { enabled: true, assignedTo: doc?.assignedTo || null };
    } catch (err) {
        console.error('[Email Assignment] resolveAssignmentForConversation failed:', err.message);
        return { enabled: false, assignedTo: null };
    }
}

/** Convenience wrapper for callers that only need the owner. */
async function resolveAssigneeForConversation({ tenantId, leadId, lead }) {
    const { assignedTo } = await resolveAssignmentForConversation({ tenantId, leadId, lead });
    return assignedTo;
}

/**
 * Push a lead's assignment onto every email thread linked to it.
 *
 * updateMany rather than updateOne: the { userId, leadId } index is unique, so
 * in practice this is one row — but a historical duplicate must not be left
 * behind carrying a stale owner.
 *
 * Never throws — assignment sync must not fail a lead write.
 */
async function syncConversationsForLead({ leadId, tenantId, assignedTo }) {
    if (!leadId || !tenantId) return { matched: 0, modified: 0, conversations: [] };
    if (!await isEmailFollowLeadEnabled(tenantId)) return { matched: 0, modified: 0, conversations: [] };

    try {
        const filter = { userId: tenantId, leadId };

        // Read the affected rows first so we can tell the OLD assignee to drop
        // the thread as well as the new one to pick it up.
        const before = await EmailConversation.find(filter).select('_id assignedTo').lean();
        if (before.length === 0) return { matched: 0, modified: 0, conversations: [] };

        // Snapshot to primitives BEFORE the write — the caller relies on
        // previousAssignedTo to tell the LOSING agent to drop the row, and it
        // must not be reachable through a shared reference.
        const snapshot = before.map(c => ({
            _id: c._id,
            previousAssignedTo: c.assignedTo ? String(c.assignedTo) : null
        }));

        const next = assignedTo || null;
        const res = await EmailConversation.updateMany(filter, { $set: { assignedTo: next } });

        return {
            matched: res.matchedCount ?? res.n ?? snapshot.length,
            modified: res.modifiedCount ?? res.nModified ?? 0,
            conversations: snapshot.map(c => ({
                _id: c._id,
                previousAssignedTo: c.previousAssignedTo,
                assignedTo: next
            }))
        };
    } catch (err) {
        console.error('[Email Assignment] syncConversationsForLead failed:', err.message);
        return { matched: 0, modified: 0, conversations: [] };
    }
}

/**
 * Same, for a batch of leads that all move to the SAME assignee (bulk assign).
 * One updateMany instead of N.
 */
async function syncConversationsForLeads({ leadIds, tenantId, assignedTo }) {
    if (!Array.isArray(leadIds) || leadIds.length === 0 || !tenantId) {
        return { matched: 0, modified: 0, conversations: [] };
    }
    if (!await isEmailFollowLeadEnabled(tenantId)) return { matched: 0, modified: 0, conversations: [] };

    try {
        const filter = { userId: tenantId, leadId: { $in: leadIds } };

        const before = await EmailConversation.find(filter).select('_id assignedTo').lean();
        if (before.length === 0) return { matched: 0, modified: 0, conversations: [] };

        const snapshot = before.map(c => ({
            _id: c._id,
            previousAssignedTo: c.assignedTo ? String(c.assignedTo) : null
        }));

        const next = assignedTo || null;
        const res = await EmailConversation.updateMany(filter, { $set: { assignedTo: next } });

        return {
            matched: res.matchedCount ?? res.n ?? snapshot.length,
            modified: res.modifiedCount ?? res.nModified ?? 0,
            conversations: snapshot.map(c => ({
                _id: c._id,
                previousAssignedTo: c.previousAssignedTo,
                assignedTo: next
            }))
        };
    } catch (err) {
        console.error('[Email Assignment] syncConversationsForLeads failed:', err.message);
        return { matched: 0, modified: 0, conversations: [] };
    }
}

/**
 * A Lead was deleted: the justification for the assignment is gone, so the
 * thread falls back to manager-only visibility. The message history itself is
 * deliberately preserved.
 *
 * Unlike the WhatsApp twin this does NOT clear leadId — EmailConversation
 * declares it `required: true`, so nulling it would make the document
 * unsavable. Clearing the owner alone produces the same visibility outcome.
 */
async function detachDeletedLeads({ leadIds, tenantId }) {
    if (!Array.isArray(leadIds) || leadIds.length === 0 || !tenantId) return { modified: 0 };
    try {
        const res = await EmailConversation.updateMany(
            { userId: tenantId, leadId: { $in: leadIds } },
            { $set: { assignedTo: null } }
        );
        return { modified: res.modifiedCount ?? res.nModified ?? 0 };
    } catch (err) {
        console.error('[Email Assignment] detachDeletedLeads failed:', err.message);
        return { modified: 0 };
    }
}

// ── Real-time audience ───────────────────────────────────────────────────────

/**
 * The company roster this module needs to compute an audience: role, the
 * full-inbox permission, and the display name (so an assignment event can carry
 * the new owner's name instead of a bare id).
 *
 * Split out so a caller computing MANY audiences — a bulk reassignment touching
 * hundreds of threads — can load it once instead of once per thread.
 */
async function loadCompanyRoster(companyUserIds = []) {
    if (companyUserIds.length === 0) return [];
    const User = require('../models/User');
    return User.find({ _id: { $in: companyUserIds } })
        .select('name role permissions.viewAllEmails')
        .lean();
}

/**
 * Which company users may receive socket events for a given thread.
 *
 * Filtering the emit loop is NOT on its own enough to stop a leak — see
 * socketService's `em:<userId>` rooms, which exist because `join:company` lets
 * an agent into their manager's `user:<id>` room. Both halves are needed.
 *
 * Falls back to the full company list on any error, matching today's behaviour.
 */
async function conversationAudience({ tenantId, companyUserIds, assignedTo, roster = null }) {
    const all = companyUserIds || [];
    if (!await isEmailFollowLeadEnabled(tenantId)) return all;
    if (all.length === 0) return all;

    try {
        const users = roster || await loadCompanyRoster(all);

        const assignee = assignedTo ? String(assignedTo) : null;
        return users
            .filter(u =>
                isPrivileged(u) ||
                hasFullInbox(u.permissions) ||
                (assignee !== null && String(u._id) === assignee)
            )
            .map(u => u._id);
    } catch (err) {
        console.error('[Email Assignment] conversationAudience failed:', err.message);
        return all;
    }
}

/**
 * Emit one or more email events for a thread to EXACTLY the users allowed to
 * see it.
 *
 * This is the only sanctioned way to push an email inbox event. Call sites must
 * not loop emitToUsers over the company themselves: `user:<id>` rooms are
 * reachable through `join:company`, so an agent joined to their manager would
 * receive everything regardless of the audience list.
 *
 * Never throws — a socket problem must not fail the request that triggered it.
 */
async function broadcastConversationEvent({
    tenantId,
    companyUserIds,
    assignedTo = null,
    events = []
}) {
    if (!events.length) return;
    try {
        const { emitToEmailUsers } = require('./socketService');
        const audience = await conversationAudience({ tenantId, companyUserIds, assignedTo });
        for (const { event, data } of events) {
            emitToEmailUsers(audience, event, data);
        }
    } catch (err) {
        console.error('[Email Assignment] broadcastConversationEvent failed:', err.message);
    }
}

/**
 * Tell both sides of a reassignment. The gaining agent (and every manager /
 * full-inbox agent) is told to pick the thread up; the LOSING agent is told to
 * drop it, otherwise a thread the API will now 404 on keeps sitting in their
 * open inbox receiving live messages.
 *
 * `changes` is the `conversations` array returned by syncConversationsForLead.
 */
async function broadcastAssignmentChanges({ tenantId, companyUserIds, changes = [] }) {
    if (!changes.length) return;
    try {
        const { emitToEmailUsers } = require('./socketService');

        // The audience depends ONLY on the assignee, and a bulk reassignment
        // moves every lead to the SAME one — so computing it inside the loop
        // would run one identical team-wide User.find per thread. Load the
        // roster once and memoize per distinct assignee.
        const roster = await loadCompanyRoster(companyUserIds || []);
        const audienceByAssignee = new Map();
        const audienceFor = async (assignedTo) => {
            const key = assignedTo ? String(assignedTo) : 'null';
            if (!audienceByAssignee.has(key)) {
                audienceByAssignee.set(key, await conversationAudience({
                    tenantId, companyUserIds, assignedTo, roster
                }));
            }
            return audienceByAssignee.get(key);
        };

        // The inbox renders the owner as a { name } object, so an event carrying
        // only an id would blank the badge until the next full refetch — the
        // reassignment would look like it had failed.
        const nameById = new Map(roster.map(u => [String(u._id), u.name || null]));

        for (const change of changes) {
            const assigneeId = change.assignedTo ? String(change.assignedTo) : null;
            const payload = {
                conversationId: String(change._id),
                assignedTo: assigneeId,
                assignedToName: assigneeId ? (nameById.get(assigneeId) || null) : null
            };

            const audience = await audienceFor(change.assignedTo);
            emitToEmailUsers(audience, 'email:conversationAssigned', payload);

            // And the agent who just lost it — they are NOT in the audience
            // above, so they need a targeted event, otherwise a thread they can
            // no longer open keeps streaming live mail into their open inbox.
            const previous = change.previousAssignedTo;
            if (previous && String(previous) !== String(change.assignedTo || '')) {
                const stillVisible = audience.some(id => String(id) === String(previous));
                if (!stillVisible) {
                    emitToEmailUsers([previous], 'email:conversationAssigned', {
                        ...payload,
                        revoked: true
                    });
                }
            }
        }
    } catch (err) {
        console.error('[Email Assignment] broadcastAssignmentChanges failed:', err.message);
    }
}

module.exports = {
    // permission model
    isPrivileged,
    hasFullInbox,
    isAssignmentRestricted,
    conversationScope,
    withPredicate,
    // toggle
    isEmailFollowLeadEnabled,
    invalidateEmailFollowLeadCache,
    // assignment
    resolveAssignmentForConversation,
    resolveAssigneeForConversation,
    syncConversationsForLead,
    syncConversationsForLeads,
    detachDeletedLeads,
    // real-time
    loadCompanyRoster,
    conversationAudience,
    broadcastConversationEvent,
    broadcastAssignmentChanges
};
