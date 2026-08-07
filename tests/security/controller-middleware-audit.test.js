// Regression tests for the controller + middleware audit (2026-07-31).
//
// Each test pins one defect found in that audit. They are written to FAIL against
// the pre-fix code, so they are worth something — a suite that passes either way
// is the trap this repo already fell into once with the workflow engine.
//
// Where a fix is structural (middleware ordering, a removed query) the test reads
// the source or walks the router stack, matching settings-authorization.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

// Minimal Express double: runs a middleware and captures what it did.
const runMiddleware = async (mw, req) => {
    let statusCode = 200;
    let body = null;
    let nextCalled = false;
    const res = {
        status(c) { statusCode = c; return this; },
        json(b) { body = b; return this; },
        send(b) { body = b; return this; },
        setHeader() { return this; },
        set() { return this; }
    };
    await mw(req, res, () => { nextCalled = true; });
    return { statusCode, body, nextCalled };
};

// ─────────────────────────────────────────────────────────────────────────────
// C1 — impersonation tokens must carry `userId`
// ─────────────────────────────────────────────────────────────────────────────

test('C1: findById(undefined) is sent to MongoDB as an unfiltered query', () => {
    // This is WHY C1 is severe rather than cosmetic, and it is worth pinning
    // precisely because the reasoning is easy to get wrong:
    //
    //   1. findById(undefined) builds the filter { _id: undefined } — note the KEY
    //      IS PRESENT. (JSON.stringify hides this: it prints "{}". Use Object.keys.)
    //   2. The driver does not set `ignoreUndefined`, so BSON serialises with its
    //      own default, which DROPS undefined-valued keys entirely.
    //   3. The wire document is therefore the empty filter {} — "match everything"
    //      — so the query returns the FIRST document in the collection.
    //
    // Had step 2 gone the other way ({_id: null}) the query would match nothing and
    // this would be a harmless 404. Assert the actual encoding, not an internal.
    const mongoose = require('mongoose');
    const { BSON } = require('bson');
    const M = mongoose.models.__C1Probe
        || mongoose.model('__C1Probe', new mongoose.Schema({ name: String }));

    const q = M.findById(undefined);
    q._castConditions();
    const filter = q.getFilter();

    assert.deepStrictEqual(Object.keys(filter), ['_id'], 'precondition: the _id key survives casting');
    assert.strictEqual(filter._id, undefined, 'precondition: with an undefined value');

    // What actually reaches the server.
    const onWire = BSON.deserialize(BSON.serialize(filter));
    assert.deepStrictEqual(Object.keys(onWire), [],
        'the wire filter is empty — findById(undefined) returns the FIRST document, so controllers must never pass an unresolved id');
});

test('C1: the impersonation token carries both id and userId', () => {
    const src = read('controllers', 'superAdminController.js');
    const gen = src.slice(src.indexOf('const generateToken'), src.indexOf('const generateToken') + 700);

    assert.match(gen, /userId:\s*id/,
        'generateToken must emit a userId claim — controllers read req.user.userId directly');
    assert.match(gen, /\btv:/, 'the session-generation claim must still be present');
});

test('C1: getMe and acceptTerms refuse to query on a missing id', () => {
    const src = read('controllers', 'authController.js');

    for (const fn of ['getMe', 'acceptTerms']) {
        const start = src.indexOf(`exports.${fn}`);
        assert.ok(start > -1, `${fn} should exist`);
        const body = src.slice(start, start + 900);

        assert.match(body, /getRequestUserId\(req\.user\)/,
            `${fn} must resolve the id via getRequestUserId, not req.user.userId alone`);
        assert.match(body, /if \(!userId\)/,
            `${fn} must bail out when the id is missing rather than querying with undefined`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// C2 — Google login must run the same lifecycle gate as password login
// ─────────────────────────────────────────────────────────────────────────────

test('C2: googleLogin enforces approval and email verification', () => {
    const src = read('controllers', 'authController.js');
    const start = src.indexOf('exports.googleLogin');
    const end = src.indexOf('exports.createAgent');
    const body = src.slice(start, end);

    assert.match(body, /blockUnapprovedLogin\(user, res\)/,
        'googleLogin must run blockUnapprovedLogin — authMiddleware never checks approved_by_admin or status');
    assert.match(body, /email_verified/,
        'an unverified Google address must not be linked onto an existing account');

    // The gate has to run BEFORE a token is minted, not after.
    assert.ok(
        body.indexOf('blockUnapprovedLogin') < body.indexOf('signAuthToken'),
        'the approval gate must precede token signing'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// H1 — team management scopes to the tenant, and never to yourself
// ─────────────────────────────────────────────────────────────────────────────

test('H1: team handlers scope to the workspace owner, not the caller', () => {
    const src = read('controllers', 'authController.js');

    assert.match(src, /const getTeamOwnerId = \(req\) => req\.tenantId/,
        'team operations must resolve the owner from req.tenantId');

    for (const fn of ['createAgent', 'deleteAgent', 'updateAgent', 'getMyTeam']) {
        const start = src.indexOf(`exports.${fn}`);
        const body = src.slice(start, start + 1600);
        assert.ok(
            !/const managerId = getRequestUserId\(req\.user\)/.test(body),
            `${fn} must not scope to the caller's own id — an agent with manageTeam is not the owner`
        );
    }
});

test('H1: an agent with manageTeam cannot edit or delete themselves', () => {
    const src = read('controllers', 'authController.js');
    for (const fn of ['deleteAgent', 'updateAgent']) {
        const start = src.indexOf(`exports.${fn}`);
        const body = src.slice(start, start + 1600);
        assert.match(body, /isSelf\(req,/,
            `${fn} must block self-targeting, otherwise manageTeam is a self-escalation primitive`);
    }
});

test('H1: manageTeam is a real grantable agent permission', () => {
    // If this ever stops being true the H1 scenario becomes unreachable and these
    // tests would be quietly testing nothing.
    const User = require(path.join(SRC, 'models', 'User.js'));
    assert.strictEqual(User.schema.path('permissions.manageTeam').options.default, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// H2 — support uploads are authorised before multer writes to disk
// ─────────────────────────────────────────────────────────────────────────────

test('H2: authorizeTicketAccess is mounted before the upload middleware', () => {
    const src = fs.readFileSync(path.join(SRC, 'routes', 'supportRoutes.js'), 'utf8');
    const post = src.slice(src.indexOf("router.post('/tickets/:id/messages'"));
    const route = post.slice(0, post.indexOf(');'));

    const authAt = route.indexOf('authorizeTicketAccess');
    const uploadAt = route.indexOf('uploadSupportMedia');

    assert.ok(authAt > -1, 'the ticket message route must mount authorizeTicketAccess');
    assert.ok(uploadAt > -1, 'the ticket message route must mount uploadSupportMedia');
    assert.ok(authAt < uploadAt,
        'multer writes files as a side effect of parsing — authorising after it lets any user plant files in another tenant\'s ticket folder');
});

test('H2: rejected uploads are removed from disk', () => {
    const src = read('controllers', 'supportController.js');
    assert.match(src, /const discardUploads/, 'a cleanup helper must exist');
    // Every non-2xx exit that can follow multer should call it.
    const sendMessage = src.slice(src.indexOf('const sendMessage'), src.indexOf('const closeTicket'));
    assert.match(sendMessage, /discardUploads\(req\)/,
        'sendMessage must delete orphaned uploads on its rejection paths');
});

// ─────────────────────────────────────────────────────────────────────────────
// H3 — WhatsApp data scope never crosses the tenant boundary
// ─────────────────────────────────────────────────────────────────────────────

test('H3: the company scope is not widened by a shared phone number', () => {
    const src = read('utils', 'whatsappUtils.js');
    const fn = src.slice(src.indexOf('const getCompanyUserIds'));

    assert.ok(
        !/waPhoneNumberId/.test(fn),
        'getCompanyUserIds must not look up other tenants by waPhoneNumberId — two workspaces sharing a number were merged into one data scope'
    );
    assert.match(fn, /parentId: companyManagerId/,
        'the scope must still be the owner plus their agents');
});

test('H3: the scope cache is bounded and invalidatable', () => {
    const utils = require(path.join(SRC, 'utils', 'whatsappUtils.js'));
    assert.strictEqual(typeof utils.invalidateCompanyUserIds, 'function',
        'connect/disconnect must be able to evict the cached scope');

    const src = read('utils', 'whatsappUtils.js');
    assert.match(src, /pruneCache/, 'the cache must evict, not grow forever');
});

// ─────────────────────────────────────────────────────────────────────────────
// H4 — MCP stage changes fire the same side effects as every other path
// ─────────────────────────────────────────────────────────────────────────────

test('H4: MCP stage changes fire automation, workflow and Meta CAPI', () => {
    const src = read('controllers', 'mcpController.js');
    const effectsSrc = read('utils', 'leadEffects.js');

    assert.match(effectsSrc, /evaluateLead\(lead, 'STAGE_CHANGED'\)/, 'automations must fire');
    assert.match(effectsSrc, /fireTrigger\('STAGE_CHANGED'/, 'the workflow trigger must fire');
    assert.match(effectsSrc, /sendMetaEventForLead/, 'the Meta CAPI conversion event must fire');

    const updateLead = src.slice(src.indexOf('async update_lead'), src.indexOf('async assign_lead'));
    assert.match(updateLead, /stageEnteredAt/,
        'a stage change must reset stageEnteredAt or stage-age reporting silently drifts');
    assert.match(updateLead, /queueLeadStageChangeEffects\(/, 'update_lead must invoke the shared helper');
});

// ─────────────────────────────────────────────────────────────────────────────
// M1 — the click tracker is not an open redirect
// ─────────────────────────────────────────────────────────────────────────────

test('M1: a tracked URL is only trusted with a valid signature', async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-audit-tests';
    const { signTrackedUrl } = require(path.join(SRC, 'utils', 'emailTemplateUtils.js'));

    const logId = 'a'.repeat(24);
    const good = 'https://legit.example/offer';
    const sig = signTrackedUrl(logId, good);

    assert.ok(sig && sig.length === 24, 'links must be signed at generation time');

    // The signature must be bound to BOTH the log and the URL.
    assert.notStrictEqual(sig, signTrackedUrl(logId, 'https://evil.example'),
        'a different destination must not verify under the same signature');
    assert.notStrictEqual(sig, signTrackedUrl('b'.repeat(24), good),
        'a signature must not be replayable across email logs');
});

test('M1: trackClick refuses an unsigned attacker-supplied destination', async () => {
    const { trackClick } = require(path.join(SRC, 'controllers', 'emailTrackingController.js'));

    let redirectedTo = null;
    let statusCode = 200;
    let sent = null;
    const res = {
        status(c) { statusCode = c; return this; },
        send(b) { sent = b; return this; },
        redirect(_code, url) { redirectedTo = url; }
    };

    // A well-formed https URL with no signature and a non-existent log: the old
    // code redirected on the scheme check alone.
    await trackClick(
        { params: { logId: 'c'.repeat(24) }, query: { url: 'https://phishing.example/login' } },
        res
    );

    assert.strictEqual(redirectedTo, null, 'an unverified destination must NOT be redirected to');
    assert.strictEqual(statusCode, 400);
});

// ─────────────────────────────────────────────────────────────────────────────
// M2 — validateObjectId actually validates
// ─────────────────────────────────────────────────────────────────────────────

test('M2: a non-hex 12-character string is rejected', async () => {
    const validateObjectId = require(path.join(SRC, 'middleware', 'validateObjectId.js'));
    const mongoose = require('mongoose');

    // NOTE: the classic "any 12-char string passes isValid()" trap does NOT apply
    // on Mongoose 9 — string handling was tightened, and only 24-hex strings (or
    // raw 12-byte Buffers, which a route param can never be) are accepted now.
    // Pinned here so a DOWNGRADE, or a revert to isValid(), is caught: on the
    // older semantics this input was accepted and cast to an unrelated id.
    assert.strictEqual(mongoose.Types.ObjectId.isValid('abcdefghijkl'), false,
        'Mongoose 9 rejects this; the regex check must agree');

    const r = await runMiddleware(
        validateObjectId({ params: ['id'] }),
        { params: { id: 'abcdefghijkl' } }
    );
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.nextCalled, false);
});

test('M2: a missing route param is rejected, a valid one passes', async () => {
    const validateObjectId = require(path.join(SRC, 'middleware', 'validateObjectId.js'));

    const missing = await runMiddleware(validateObjectId({ params: ['id'] }), { params: {} });
    assert.strictEqual(missing.statusCode, 400, 'an absent required param must not fall through');

    const ok = await runMiddleware(
        validateObjectId({ params: ['id'] }),
        { params: { id: '507f1f77bcf86cd799439011' } }
    );
    assert.strictEqual(ok.nextCalled, true, 'a real 24-hex ObjectId must pass');
});

test('M2: an operator-injection probe is rejected', async () => {
    const validateObjectId = require(path.join(SRC, 'middleware', 'validateObjectId.js'));
    const r = await runMiddleware(
        validateObjectId({ query: ['leadId'] }),
        { query: { leadId: { $ne: null } } }
    );
    assert.strictEqual(r.statusCode, 400, 'a non-string value must never reach the query layer');
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission middleware fails closed
// ─────────────────────────────────────────────────────────────────────────────

test('permission gates return 401, not 500, without an authenticated user', async () => {
    const checkPermission = require(path.join(SRC, 'middleware', 'checkPermission.js'));
    const r = await runMiddleware(checkPermission('viewLeads'), {});
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(r.nextCalled, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// M3 — usage metering targets the tenant and increments atomically
// ─────────────────────────────────────────────────────────────────────────────

test('M3: metering keys off the tenant and uses an atomic claim', () => {
    const src = read('middleware', 'usageMeter.js');

    assert.match(src, /req\.tenantId \|\|/,
        'metering must key off the tenant — req.user.agencyId is not a JWT claim');
    assert.match(src, /findOneAndUpdate/,
        'the counter must be claimed atomically, not read-modify-written via save()');
    assert.match(src, /\$inc/, 'the increment must be a $inc');
    assert.ok(
        !/settings\.usage\.whatsappSent \+= 1/.test(src),
        'the lost-update read-modify-write pattern must be gone'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// M4 — uploads are partitioned, and extensions come from the MIME allowlist
// ─────────────────────────────────────────────────────────────────────────────

test('M4: attachment storage no longer collapses to a single default bucket', () => {
    const src = read('middleware', 'uploadMiddleware.js');
    assert.ok(
        !/req\.user\?\.id \|\| 'default'/.test(src),
        "req.user.id is always undefined (the JWT carries userId) — every tenant landed in 'default'"
    );
    assert.match(src, /req\.tenantId/, 'uploads must be partitioned by tenant');
});

test('M4: the stored extension is derived from the MIME type, not the filename', () => {
    for (const f of ['uploadMiddleware.js', 'supportUploadMiddleware.js']) {
        const src = read('middleware', f);
        assert.match(src, /EXT_FOR_MIME\[file\.mimetype\]/,
            `${f}: a .html payload declared as image/png must not be stored as .html`);
        assert.ok(
            !/path\.extname\(file\.originalname\)\.slice/.test(src),
            `${f}: the client-supplied extension must not reach disk`
        );
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// M5 — ticket creation is throttled (it spends the PLATFORM's AI key)
// ─────────────────────────────────────────────────────────────────────────────

test('M5: ticket creation is rate limited', () => {
    const src = fs.readFileSync(path.join(SRC, 'routes', 'supportRoutes.js'), 'utf8');
    const route = src.slice(src.indexOf("router.post('/tickets'"));
    assert.match(route.slice(0, 200), /Limiter/,
        'createTicket triggers a platform-billed LLM call and must be throttled');
});

// ─────────────────────────────────────────────────────────────────────────────
// M6 / M7 — External API validation
// ─────────────────────────────────────────────────────────────────────────────

test('M6: assignedTo must belong to the calling tenant', () => {
    const src = read('controllers', 'extApiController.js');
    const createLead = src.slice(src.indexOf('exports.createLead'), src.indexOf('exports.listLeads'));

    assert.match(createLead, /parentId: req\.tenantId/,
        'assignedTo must be verified against this workspace, not just checked for ObjectId shape');
    assert.ok(
        !/if \(assignedTo && isValidId\(assignedTo\)\) leadData\.assignedTo = assignedTo;/.test(createLead),
        'the shape-only check must be gone'
    );
});

test('M7: the External API checks for a slot conflict before booking', () => {
    const src = read('controllers', 'extApiController.js');

    assert.match(src, /const findSlotConflict/, 'a conflict check must exist');

    const create = src.slice(src.indexOf('exports.createAppointment'), src.indexOf('exports.updateAppointment'));
    assert.match(create, /findSlotConflict\(/, 'creation must check for a double booking');
    assert.match(create, /tzOffsetMinutes/, 'appointmentAt must be derived in the tenant timezone for reminders');

    const update = src.slice(src.indexOf('exports.updateAppointment'), src.indexOf('exports.getLeadStats'));
    assert.match(update, /findSlotConflict\(/, 'rescheduling must check for a double booking too');
    assert.match(update, /reminder24hSent = false/, 'a moved appointment must be able to remind again');
});

// ─────────────────────────────────────────────────────────────────────────────
// M8 — bulk lead operations validate their ids
// ─────────────────────────────────────────────────────────────────────────────

test('M8: bulk lead operations reject malformed ids instead of 500ing', () => {
    const src = read('controllers', 'leadController.js');

    assert.match(src, /const isValidLeadId = \(value\) => typeof value === 'string' && \/\^\[a-f\\d\]\{24\}\$\/i\.test\(value\)/,
        'lead id validation must be strict 24-hex, not the permissive Mongoose helper');

    for (const fn of ['bulkDeleteLeads', 'bulkUpdateStatus']) {
        const start = src.indexOf(`const ${fn}`);
        const body = src.slice(start, start + 1400);
        assert.match(body, /invalid\s*=\s*ids\.filter/,
            `${fn} must validate every id before building the $in query`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Low — MCP honours the subscription lapse; unsubscribe output is escaped
// ─────────────────────────────────────────────────────────────────────────────

test('MCP access is blocked once the plan has lapsed', () => {
    const src = read('middleware', 'mcpAuthMiddleware.js');
    assert.match(src, /planExpiryDate/,
        'the API-key path bypassed the read-only lock that authMiddleware applies to JWT requests');
    assert.match(src, /select\([^)]*planExpiryDate/,
        'planExpiryDate must actually be selected or the check reads undefined');
});

test('the unsubscribe confirmation escapes the reflected address', () => {
    const src = read('controllers', 'emailUnsubscribeController.js');
    assert.match(src, /escapeHtml\(email\)/,
        'the email regex permits < > " \' so the reflected value must be escaped');
});
