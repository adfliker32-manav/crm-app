// ============================================================
// 💬 LEAD-BASED WHATSAPP CONVERSATION ASSIGNMENT
// ============================================================
// The Lead is the SINGLE source of truth for who owns a WhatsApp conversation.
// WhatsAppConversation.assignedTo is a DERIVED MIRROR of Lead.assignedTo — this
// module is its only writer, and there is deliberately no API, request body or
// UI control that sets it independently. If the two ever disagree, the Lead
// wins (scripts/backfillWhatsAppAssignment.js re-derives the collection).
//
// Why mirror rather than join leadId → Lead.assignedTo at query time: the inbox
// list, the unread aggregate and search all paginate and sort by lastMessageAt.
// A $lookup forces a full-collection aggregation before $sort/$skip/$limit on
// every keystroke, and `leadId: { $in: [...my lead ids] }` needs an unbounded id
// list. One indexed equality predicate is O(index).
//
// EVERYTHING here is inert unless the workspace has
// WorkspaceSettings.whatsappFollowsLeadAssignment === true. With the toggle off
// the inbox behaves exactly as it always has: fully shared across the company.
//
// SCOPING
//   Does NOT reuse the global req.dataScope — that object is hardcoded to Lead
//   semantics (userId = tenant + Lead.assignedTo), while conversations are
//   scoped by getCompanyUserIds() (owner + agents, because a conversation's
//   userId may be any team member's). Same reasoning as teamTaskService.
// ============================================================

const mongoose = require('mongoose');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const { getCompanyUserIds } = require('../utils/whatsappUtils');
const { getRequestUserId } = require('../utils/controllerHelpers');

// ── Toggle cache ──────────────────────────────────────────────────────────────
// Mirrors the shape of getCompanyUserIds' cache. HTTP requests read the toggle
// straight off req.workspace (already loaded + cached by authMiddleware, so it
// costs nothing); this cache exists for the contexts that have no req at all —
// the inbound webhook, broadcasts, cron jobs and the workflow engine.
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
const invalidateFollowLeadCache = (...tenantIds) => {
    for (const id of tenantIds) {
        if (id) toggleCache.delete(String(id));
    }
};

/**
 * Is lead-based assignment enabled for this workspace?
 * Fails CLOSED to `false` on any error — i.e. degrades to today's shared inbox
 * rather than to an empty one.
 */
async function isFollowLeadEnabled(tenantId) {
    if (!tenantId) return false;
    const key = String(tenantId);

    const cached = toggleCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let value = false;
    try {
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const ws = await WorkspaceSettings.findOne({ userId: tenantId })
            .select('whatsappFollowsLeadAssignment')
            .lean();
        value = ws?.whatsappFollowsLeadAssignment === true;
    } catch (err) {
        console.error('[WA Assignment] isFollowLeadEnabled failed:', err.message);
        return false; // do not cache a failure
    }

    pruneToggleCache();
    toggleCache.set(key, { value, expiresAt: Date.now() + TOGGLE_TTL_MS });
    return value;
}

// ── Permission model ──────────────────────────────────────────────────────────

/** Managers and superadmins always get the complete inbox. */
const isPrivileged = (user = {}) => ['manager', 'superadmin'].includes(user.role);

/**
 * Would this requester be restricted to their own conversations?
 * Order matters and mirrors the documented rules:
 *   1. privileged role            → full inbox, always
 *   2. workspace toggle off       → full inbox (today's behaviour)
 *   3. viewAllWhatsApp not false  → full inbox (see hasFullInbox)
 *   4. otherwise                  → assignment-based
 */
function isAssignmentRestricted(req) {
    if (!req || !req.user) return false;
    if (isPrivileged(req.user)) return false;
    if (req.workspace?.whatsappFollowsLeadAssignment !== true) return false;
    return !hasFullInbox(req.user.permissions);
}

/**
 * Full-inbox check. Only an EXPLICIT `false` restricts.
 *
 * viewAllWhatsApp defaults to true in the schema, but a Mongoose default is
 * applied on hydration — NOT by .lean(), which returns raw BSON. authMiddleware
 * reads agent permissions with .lean(), so for every agent document written
 * before this field existed the value is `undefined`, not `true`.
 *
 * Testing `=== true` would therefore restrict every pre-existing agent the
 * moment a workspace enabled the toggle — the exact lockout the `default: true`
 * was chosen to avoid. Legacy undefined must read as full inbox.
 */
function hasFullInbox(permissions) {
    return permissions?.viewAllWhatsApp !== false;
}

/**
 * The Mongo filter fragment describing every conversation this requester may
 * see or act on. Spread it into EVERY read and resolve every single-document
 * mutation through it, so an out-of-scope id 404s instead of leaking a 403.
 *
 * @param {object}  req
 * @param {object}  [options]
 * @param {boolean} [options.forAggregate] cast assignedTo to an ObjectId — a
 *        $match stage does NOT coerce a string, so without this a scoped
 *        aggregate silently matches nothing (same trap reportsController's
 *        getDataScope works around).
 */
async function conversationScope(req, { forAggregate = false } = {}) {
    const selfId = getRequestUserId(req.user);
    const companyUserIds = await getCompanyUserIds(selfId);
    return buildScope({
        selfId,
        companyUserIds,
        restricted: isAssignmentRestricted(req),
        forAggregate
    });
}

/**
 * Same scope, for callers that have no `req` — the Socket.IO handshake being
 * the one that matters, since it must authorize `watch:conversation`.
 * Resolves the workspace toggle itself (cached) instead of reading req.workspace.
 */
async function conversationScopeForUser({ userId, role, permissions, tenantId }, { forAggregate = false } = {}) {
    const companyUserIds = await getCompanyUserIds(userId);

    let restricted = false;
    if (!isPrivileged({ role }) && !hasFullInbox(permissions)) {
        restricted = await isFollowLeadEnabled(tenantId);
    }

    return buildScope({ selfId: userId, companyUserIds, restricted, forAggregate });
}

function buildScope({ selfId, companyUserIds, restricted, forAggregate }) {
    const scope = { userId: { $in: companyUserIds } };
    if (!restricted) return scope;

    // NEVER leave this undefined. BSON DROPS an undefined value rather than
    // serializing it, which would silently turn the whole guard into a no-op —
    // this repo has shipped that exact bug twice (socketService join:company,
    // activityLog viewActivityLogs).
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

// ── Assignment resolution + propagation ───────────────────────────────────────

/**
 * The agent a conversation for this lead should be assigned to.
 * Returns null when the toggle is off, there is no lead, or the lead is
 * unassigned — an unassigned conversation is visible to managers and
 * full-inbox agents only, exactly mirroring how an unassigned Lead already
 * behaves under req.dataScope.
 */
async function resolveAssigneeForConversation({ tenantId, leadId, lead }) {
    if (!await isFollowLeadEnabled(tenantId)) return null;

    if (lead !== undefined && lead !== null) return lead.assignedTo || null;
    if (!leadId) return null;

    try {
        const Lead = require('../models/Lead');
        const doc = await Lead.findById(leadId).select('assignedTo').lean();
        return doc?.assignedTo || null;
    } catch (err) {
        console.error('[WA Assignment] resolveAssigneeForConversation failed:', err.message);
        return null;
    }
}

/**
 * Link a phone number's UNLINKED conversations to a lead.
 *
 * syncConversationsForLead below filters on `leadId`, so a thread that was
 * never linked to a Lead is invisible to it. That is the normal state for a
 * customer who messaged in before the Lead existed, which is exactly the case
 * an external CRM hits when it assigns by phone number.
 *
 * Matching mirrors the webhook's own lookup: last-10-digit suffix, against
 * both `waContactId` and `phone`, because the same person can be stored under
 * differently-formatted numbers.
 *
 * STRICTLY ADDITIVE — only `leadId: null` rows are touched, never a re-link.
 * Re-pointing a thread that already belongs to another Lead would silently
 * steal it, and the webhook holds the same rule
 * (whatsappWebhookController: "only ever null -> a real link").
 *
 * Never throws — a failure here must not fail the caller's lead write.
 *
 * @returns {Promise<{linked:number}>}
 */
async function linkConversationsToLead({ tenantId, phone, leadId }) {
    if (!tenantId || !leadId || !phone) return { linked: 0 };

    // Digits only, so the value is safe to interpolate into a regex.
    const suffix = String(phone).replace(/\D/g, '').slice(-10);
    if (suffix.length < 7) return { linked: 0 };

    try {
        const companyUserIds = await getCompanyUserIds(tenantId);
        const res = await WhatsAppConversation.updateMany(
            {
                userId: { $in: companyUserIds },
                leadId: null,
                $or: [
                    { waContactId: { $regex: suffix + '$' } },
                    { phone: { $regex: suffix + '$' } }
                ]
            },
            { $set: { leadId } }
        );
        return { linked: res.modifiedCount ?? res.nModified ?? 0 };
    } catch (err) {
        console.error('[WA Assignment] linkConversationsToLead failed:', err.message);
        return { linked: 0 };
    }
}

/**
 * Push a lead's assignment onto every conversation linked to it.
 *
 * updateMany, not updateOne: one lead can legitimately have several
 * conversations (the same person reached under differently-formatted
 * waContactIds, which the webhook's suffix matching tolerates).
 *
 * Never throws — assignment sync must not fail a lead write.
 */
async function syncConversationsForLead({ leadId, tenantId, assignedTo }) {
    if (!leadId || !tenantId) return { matched: 0, modified: 0, conversations: [] };
    if (!await isFollowLeadEnabled(tenantId)) return { matched: 0, modified: 0, conversations: [] };

    try {
        const companyUserIds = await getCompanyUserIds(tenantId);
        const filter = { userId: { $in: companyUserIds }, leadId };

        // Read the affected rows first so we can tell the OLD assignee to drop
        // the conversation as well as the new one to pick it up.
        const before = await WhatsAppConversation.find(filter)
            .select('_id assignedTo')
            .lean();
        if (before.length === 0) return { matched: 0, modified: 0, conversations: [] };

        // Snapshot to primitives BEFORE the write. The update below must not be
        // able to reach these values through a shared reference — the caller
        // relies on previousAssignedTo to tell the LOSING agent to drop the row.
        const snapshot = before.map(c => ({
            _id: c._id,
            previousAssignedTo: c.assignedTo ? String(c.assignedTo) : null
        }));

        const next = assignedTo || null;
        const res = await WhatsAppConversation.updateMany(filter, { $set: { assignedTo: next } });

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
        console.error('[WA Assignment] syncConversationsForLead failed:', err.message);
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
    if (!await isFollowLeadEnabled(tenantId)) return { matched: 0, modified: 0, conversations: [] };

    try {
        const companyUserIds = await getCompanyUserIds(tenantId);
        const filter = { userId: { $in: companyUserIds }, leadId: { $in: leadIds } };

        const before = await WhatsAppConversation.find(filter).select('_id assignedTo').lean();
        if (before.length === 0) return { matched: 0, modified: 0, conversations: [] };

        // Snapshot to primitives before the write — see syncConversationsForLead.
        const snapshot = before.map(c => ({
            _id: c._id,
            previousAssignedTo: c.assignedTo ? String(c.assignedTo) : null
        }));

        const next = assignedTo || null;
        const res = await WhatsAppConversation.updateMany(filter, { $set: { assignedTo: next } });

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
        console.error('[WA Assignment] syncConversationsForLeads failed:', err.message);
        return { matched: 0, modified: 0, conversations: [] };
    }
}

/**
 * Break the link when a Lead is deleted: the justification for the assignment
 * is gone, so the conversation falls back to manager-only visibility rather
 * than staying with an agent for a lead that no longer exists. The message
 * history itself is deliberately preserved.
 */
async function detachDeletedLeads({ leadIds, tenantId }) {
    if (!Array.isArray(leadIds) || leadIds.length === 0 || !tenantId) return { modified: 0 };
    try {
        const companyUserIds = await getCompanyUserIds(tenantId);
        const res = await WhatsAppConversation.updateMany(
            { userId: { $in: companyUserIds }, leadId: { $in: leadIds } },
            { $set: { leadId: null, assignedTo: null } }
        );
        return { modified: res.modifiedCount ?? res.nModified ?? 0 };
    } catch (err) {
        console.error('[WA Assignment] detachDeletedLeads failed:', err.message);
        return { modified: 0 };
    }
}

// ── Real-time audience ────────────────────────────────────────────────────────

/**
 * Which company users may receive socket events for a given conversation.
 *
 * Filtering the emit loop is NOT on its own enough to stop a leak — see
 * socketService's `wa:<userId>` rooms, which exist because `join:company`
 * lets an agent into their manager's `user:<id>` room. Both halves are needed.
 *
 * Falls back to the full company list on any error, matching today's behaviour.
 */
async function conversationAudience({ tenantId, companyUserIds, assignedTo }) {
    const all = companyUserIds || [];
    if (!await isFollowLeadEnabled(tenantId)) return all;
    if (all.length === 0) return all;

    try {
        const User = require('../models/User');
        const users = await User.find({ _id: { $in: all } })
            .select('role permissions.viewAllWhatsApp')
            .lean();

        const assignee = assignedTo ? String(assignedTo) : null;
        return users
            .filter(u =>
                isPrivileged(u) ||
                hasFullInbox(u.permissions) ||
                (assignee !== null && String(u._id) === assignee)
            )
            .map(u => u._id);
    } catch (err) {
        console.error('[WA Assignment] conversationAudience failed:', err.message);
        return all;
    }
}

/**
 * Emit one or more WhatsApp events for a conversation to EXACTLY the users
 * allowed to see it, plus anyone already watching the conversation room.
 *
 * This is the only sanctioned way to push a conversation event. Call sites must
 * not loop `emitToUser` over the company themselves: `user:<id>` rooms are
 * reachable through `join:company`, so an agent joined to their manager would
 * receive everything regardless of the audience list.
 *
 * Never throws — a socket problem must not fail the request that triggered it.
 *
 * @param {object}   args
 * @param {string}   args.tenantId
 * @param {Array}    args.companyUserIds     the unfiltered company scope
 * @param {string}   args.conversationId
 * @param {*}        [args.assignedTo]       the conversation's derived owner
 * @param {Array<{event:string,data:object}>} args.events
 * @param {boolean}  [args.includeConversationRoom=true]
 */
async function broadcastConversationEvent({
    tenantId,
    companyUserIds,
    conversationId,
    assignedTo = null,
    events = [],
    includeConversationRoom = true
}) {
    if (!events.length) return;
    try {
        const { emitToWhatsAppUsers, emitToConversation } = require('./socketService');

        const audience = await conversationAudience({ tenantId, companyUserIds, assignedTo });
        const convIdStr = conversationId ? String(conversationId) : null;

        for (const { event, data } of events) {
            emitToWhatsAppUsers(audience, event, data);
            if (includeConversationRoom && convIdStr) {
                emitToConversation(convIdStr, event, data);
            }
        }
    } catch (err) {
        console.error('[WA Assignment] broadcastConversationEvent failed:', err.message);
    }
}

/**
 * Tell both sides of a reassignment. The LOSING agent is evicted from the
 * conversation room and told to drop the row; the gaining agent (and every
 * manager / full-inbox agent) is told to pick it up.
 *
 * `changes` is the `conversations` array returned by syncConversationsForLead.
 */
async function broadcastAssignmentChanges({ tenantId, companyUserIds, changes = [] }) {
    if (!changes.length) return;
    try {
        const { emitToWhatsAppUsers, removeUserFromConversation } = require('./socketService');

        for (const change of changes) {
            const payload = {
                conversationId: String(change._id),
                assignedTo: change.assignedTo ? String(change.assignedTo) : null
            };

            // Whoever can see it now.
            const audience = await conversationAudience({
                tenantId, companyUserIds, assignedTo: change.assignedTo
            });
            emitToWhatsAppUsers(audience, 'whatsapp:conversationAssigned', payload);

            // And the agent who just lost it — they are NOT in the audience
            // above, so they need a targeted event plus eviction from the
            // conversation room, otherwise a thread they can no longer open
            // keeps streaming live messages into their open inbox.
            const previous = change.previousAssignedTo;
            if (previous && String(previous) !== String(change.assignedTo || '')) {
                const stillVisible = audience.some(id => String(id) === String(previous));
                if (!stillVisible) {
                    emitToWhatsAppUsers([previous], 'whatsapp:conversationAssigned', {
                        ...payload,
                        revoked: true
                    });
                    removeUserFromConversation(previous, change._id);
                }
            }
        }
    } catch (err) {
        console.error('[WA Assignment] broadcastAssignmentChanges failed:', err.message);
    }
}

module.exports = {
    // permission model
    isPrivileged,
    hasFullInbox,
    isAssignmentRestricted,
    conversationScope,
    conversationScopeForUser,
    withPredicate,
    // toggle
    isFollowLeadEnabled,
    invalidateFollowLeadCache,
    // assignment
    resolveAssigneeForConversation,
    linkConversationsToLead,
    syncConversationsForLead,
    syncConversationsForLeads,
    detachDeletedLeads,
    // real-time
    conversationAudience,
    broadcastConversationEvent,
    broadcastAssignmentChanges
};
