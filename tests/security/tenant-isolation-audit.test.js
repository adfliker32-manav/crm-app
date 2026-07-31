// Regression tests for the multi-tenancy security audit (H-1, H-2, M-1, M-2, M-3,
// L-1, L-2, L-3, L-4). C-1 has its own file (socket-room-isolation.test.js);
// C-2 (WhatsApp webhook signature bypass) is deliberately NOT covered here — it is
// still open and awaiting a product decision on the manual-connect flow.
//
// Written to FAIL against the pre-fix code, matching the convention in
// controller-middleware-audit.test.js.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');
const readRoot = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Several of these assertions are "this pattern must NOT appear". The fixes
// deliberately DOCUMENT the old broken pattern in a comment so the reason survives,
// which would trip a naive doesNotMatch. Strip comments so we assert on real code.
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ─── H-1: WhatsApp template list must not scope by shared phone number ───────
test('H-1: getTemplates scopes to the company tree, not to every tenant on the phone number', () => {
    const c = read('controllers', 'whatsappTemplateController.js');

    // The platform-wide union must be gone.
    assert.doesNotMatch(
        c, /IntegrationConfig\.find\(\s*\{\s*['"]whatsapp\.waPhoneNumberId['"]/,
        'the global waPhoneNumberId lookup must not return — it merges unrelated tenants into one scope'
    );
    assert.doesNotMatch(c, /sharedConfigs/, 'the shared-config union must be removed entirely');

    // And it must use the same helper every sibling method uses.
    assert.match(c, /getCompanyUserIds/, 'getTemplates must scope via getCompanyUserIds');
});

test('H-1: getTemplates no longer needs the User / IntegrationConfig models', () => {
    const c = read('controllers', 'whatsappTemplateController.js');
    // Dead imports left behind after a scoping fix are a smell that the old path survives.
    assert.doesNotMatch(c, /require\(['"]\.\.\/models\/IntegrationConfig['"]\)/);
});

// ─── H-2: /uploads must be ownership-checked, not blanket-served ─────────────
test('H-2: the blanket express.static uploads mount is gone', () => {
    const idx = stripComments(readRoot('index.js'));
    assert.doesNotMatch(
        idx, /app\.use\(\s*['"]\/uploads['"]\s*,\s*authMiddleware\s*,\s*express\.static/,
        'authMiddleware proves someone is logged in, not that the file is theirs'
    );
});

test('H-2: support attachments are served through an ownership-checked route', () => {
    const idx = readRoot('index.js');
    assert.match(idx, /\/uploads\/support\/:ticketId\/:filename/, 'a scoped route must exist');
    assert.match(idx, /SupportTicket/, 'the route must load the ticket to authorize');
    assert.match(
        idx, /String\(ticket\.createdBy\)\s*!==\s*String\(uid\)/,
        'ownership must be enforced with the same rule as authorizeTicketAccess'
    );
    assert.match(idx, /startsWith\(root \+ path\.sep\)/, 'path traversal must be blocked');
});

test('H-2: the WhatsApp media cache is no longer reachable over HTTP', () => {
    const idx = stripComments(readRoot('index.js'));
    // A bare /uploads mount would re-expose uploads/whatsapp/<mediaId>.<ext>, which
    // is keyed by an id that appears in message payloads, plus uploads/email-attachments.
    assert.doesNotMatch(idx, /app\.use\(\s*['"]\/uploads['"]/, 'no blanket /uploads mount may exist');
    assert.doesNotMatch(idx, /express\.static\(\s*['"]uploads['"]\s*\)/, 'the uploads tree must not be statically served');

    // Any route that DOES serve from /uploads must be the scoped support one.
    const served = idx.match(/app\.(get|use|post)\(\s*['"]\/uploads[^'"]*['"]/g) || [];
    for (const r of served) {
        assert.match(r, /\/uploads\/support\//, `unexpected uploads route exposed: ${r}`);
    }
});

// ─── M-1: media proxy must verify ownership locally ─────────────────────────
test('M-1: downloadMediaProxy proves the media belongs to the caller before fetching', () => {
    const c = read('controllers', 'whatsappConversationController.js');
    // exists() or findOne() — the lookup now also returns the object-storage key,
    // but the scoping predicate (mediaId AND the caller's company) is the point.
    assert.match(
        c, /WhatsAppMessage\.(exists|findOne)\(\s*\{[\s\S]*?['"]content\.mediaId['"][\s\S]*?userId:\s*\{\s*\$in:\s*companyUserIds/,
        'ownership must be checked locally, not delegated entirely to Meta token scoping'
    );
    // …and it must gate the fetch, not merely exist somewhere in the file.
    const fn = c.slice(c.indexOf('exports.downloadMediaProxy'));
    assert.ok(
        fn.indexOf('companyUserIds') < fn.indexOf('getBuffer'),
        'the ownership check must run before any media bytes are read'
    );
});

// ─── M-2: the open-tracking pixel must be signed ────────────────────────────
test('M-2: the tracking pixel is signed when generated', () => {
    const u = read('utils', 'emailTemplateUtils.js');
    assert.match(u, /OPEN_SENTINEL/, 'a sentinel must exist so signer and verifier cannot drift');
    assert.match(u, /signTrackedUrl\(logId,\s*OPEN_SENTINEL\)/, 'the pixel URL must carry an HMAC');
});

test('M-2: trackOpen rejects an unsigned or forged pixel request', () => {
    const c = read('controllers', 'emailTrackingController.js');
    assert.match(c, /isValidOpenSignature/, 'the open endpoint must verify a signature');
    assert.match(c, /timingSafeEqual/, 'comparison must be constant time');
    assert.match(
        c, /isValidOpenSignature\(logId,\s*s\)/,
        'the signature check must gate the DB write and the EMAIL_OPENED trigger'
    );
});

test('M-2: the signature round-trips, and a wrong sentinel does not validate', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-verification';
    const { signTrackedUrl, OPEN_SENTINEL } = require(path.join(SRC, 'utils', 'emailTemplateUtils.js'));
    const logId = 'a'.repeat(24);

    const good = signTrackedUrl(logId, OPEN_SENTINEL);
    assert.ok(good && good.length === 24, 'a signature must be produced');
    assert.notStrictEqual(good, signTrackedUrl(logId, 'not-open'), 'a different payload must not collide');
    assert.notStrictEqual(good, signTrackedUrl('b'.repeat(24), OPEN_SENTINEL), 'signature must bind to the logId');
});

// ─── M-3: the Community Library must not publish tenant ids ─────────────────
test('M-3: getLibrary does not return authorTenantId to other tenants', () => {
    const c = read('controllers', 'workflowLibraryController.js');
    assert.match(
        c, /\.select\(['"]-nodes -connections -authorTenantId['"]\)/,
        'authorTenantId is a workspace owner _id and must not be handed to every tenant'
    );
});

// ─── L-1 / L-4: destructive-delete guard + correct AgencySettings key ───────
test('L-1: buildUserIdFilter refuses an undefined or empty scope', () => {
    const svc = require(path.join(SRC, 'services', 'accountCleanupService.js'));
    // Not exported directly, so exercise it through the public entry point. Each of
    // these would previously have produced deleteMany({}) — a full-collection wipe.
    return Promise.all([
        assert.rejects(() => svc.deleteOwnedRecords(undefined), /refusing to delete/),
        assert.rejects(() => svc.deleteOwnedRecords(null), /refusing to delete/),
        assert.rejects(() => svc.deleteOwnedRecords(''), /refusing to delete/),
        assert.rejects(() => svc.deleteOwnedRecords([]), /refusing to delete/),
        assert.rejects(() => svc.deleteOwnedRecords([undefined]), /refusing to delete/),
        assert.rejects(() => svc.deleteOwnedRecords(['abc', null]), /refusing to delete/)
    ]);
});

test('L-4: AgencySettings is deleted by agencyId, not userId', () => {
    const c = read('services', 'accountCleanupService.js');
    assert.match(
        c, /AgencySettings\.deleteMany\(\{\s*agencyId:/,
        'AgencySettings has no userId field — deleting by it silently matched nothing'
    );
    // And it must no longer sit in the userId-keyed bulk list.
    const listBlock = c.slice(c.indexOf('USER_OWNED_MODELS'), c.indexOf('const buildUserIdFilter'));
    assert.doesNotMatch(listBlock, /^\s*AgencySettings,?\s*$/m, 'AgencySettings must not be in the userId list');
});

// ─── L-2: impersonation must validate its target id ────────────────────────
test('L-2: impersonateUser rejects a missing or malformed userId before the lookup', () => {
    const c = read('controllers', 'superAdminController.js');
    const fn = c.slice(c.indexOf('const impersonateUser'), c.indexOf('const getCloudUsage'));
    assert.match(
        fn, /\/\^\[a-f\\d\]\{24\}\$\/i\.test\(userId\)/,
        'findById(undefined) resolves to findOne({}) and returns an arbitrary user'
    );
    // The guard must come BEFORE the lookup.
    assert.ok(
        fn.indexOf('test(userId)') < fn.indexOf('User.findById(userId)'),
        'validation must precede the database lookup'
    );
});

// ─── L-3: public booking slug must not embed the owner id ──────────────────
test('L-3: buildSlug no longer derives its suffix from the owner User._id', () => {
    const c = stripComments(read('controllers', 'bookingPageController.js'));
    assert.doesNotMatch(
        c, /userId\.toString\(\)\.slice\(-8\)/,
        'the public slug must not publish 8 hex chars of the workspace owner id'
    );
    assert.match(c, /randomBytes\(4\)/, 'the suffix must be random');
});

test('L-3: an existing slug suffix is reused so public URLs stay stable', () => {
    const c = read('controllers', 'bookingPageController.js');
    assert.match(c, /existingSuffix/, 'renames must carry the suffix over');
    assert.match(
        c, /current\.slugPrefix\s*!==\s*updates\.slugPrefix/,
        'the slug must only be rebuilt when the prefix actually changes'
    );
});
