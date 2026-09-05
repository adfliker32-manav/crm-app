// Partner App module — regression tests for the 2026-09-05 audit.
//
// The module had NO test coverage at all, which is how a cross-tenant account
// takeover, a feature that could not render in any browser, and a delete-any-user
// endpoint all shipped together. Each test below pins one of those fixes.
//
// Mix of behavioural (pure functions exercised directly) and static-source
// assertions, matching the existing suites in this repo — the partner paths need
// Mongo and an Express app to exercise end-to-end, but the invariants that
// actually broke are all checkable without either.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const readRoot = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

// A minimal Express-ish res double: records status + body, supports chaining.
const mockRes = () => {
    const res = { statusCode: null, body: null, headers: {} };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.set = (k, v) => { res.headers[k] = v; return res; };
    return res;
};

// ═══════════════════════════════════════════════════════════════════════════
// PA-C1 — embed-token account confusion (account takeover)
// ═══════════════════════════════════════════════════════════════════════════

const { requireAccountScope } = require('../../src/middleware/partnerApiAuthMiddleware');

const OWNED = '507f1f77bcf86cd799439011';
const VICTIM = '507f1f77bcf86cd799439099';
const partnerWithOwnedAccount = { accountIds: [{ toString: () => OWNED }] };

test('PA-C1: a header naming an owned account cannot authorise a different account in the path', () => {
    // THE EXPLOIT. requireAccountScope validated `headers['x-account-id'] ||
    // params.accountId` while generateEmbedToken minted its token for
    // `params.accountId`. Sending an owned id in the header and a victim id in
    // the path passed the ownership check, then produced an embed token for the
    // victim — exchangeable for an 8h JWT carrying THEIR role and permissions.
    const req = {
        params: { accountId: VICTIM },
        headers: { 'x-account-id': OWNED },
        partner: partnerWithOwnedAccount
    };
    const res = mockRes();
    let nextCalled = false;

    requireAccountScope(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false, 'the request must not reach the controller');
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, 'account_id_conflict');
    assert.strictEqual(req.tenantId, undefined, 'no tenant may be authorised');
});

test('PA-C1: a victim id in the path with no header is rejected as not owned', () => {
    const req = { params: { accountId: VICTIM }, headers: {}, partner: partnerWithOwnedAccount };
    const res = mockRes();
    let nextCalled = false;

    requireAccountScope(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.error, 'account_not_found');
});

test('PA-C1: the legitimate path (own account, matching or absent header) still works', () => {
    for (const headers of [{}, { 'x-account-id': OWNED }]) {
        const req = { params: { accountId: OWNED }, headers, partner: partnerWithOwnedAccount };
        const res = mockRes();
        let nextCalled = false;

        requireAccountScope(req, res, () => { nextCalled = true; });

        assert.strictEqual(nextCalled, true, `should pass with headers ${JSON.stringify(headers)}`);
        assert.strictEqual(req.tenantId, OWNED, 'tenantId must be the authorised account');
    }
});

test('PA-C1: header-only scoping (no route param) still authorises normally', () => {
    // The WhatsApp operation routes carry no :accountId — they scope by header.
    const req = { params: {}, headers: { 'x-account-id': OWNED }, partner: partnerWithOwnedAccount };
    const res = mockRes();
    let nextCalled = false;

    requireAccountScope(req, res, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(req.tenantId, OWNED);
});

test('PA-C1: the route parameter is authoritative in requireAccountScope', () => {
    const mw = stripComments(read('middleware/partnerApiAuthMiddleware.js'));
    // The exact expression that caused the divergence must not come back.
    assert.doesNotMatch(
        mw,
        /const\s+accountId\s*=\s*req\.headers\['x-account-id'\]\s*\|\|\s*req\.params\.accountId/,
        'header-first resolution is what made the takeover possible'
    );
});

test('PA-C1: generateEmbedToken mints for the AUTHORISED id, not the raw route param', () => {
    const ctrl = stripComments(read('controllers/partnerApiController.js'));
    const fn = ctrl.slice(ctrl.indexOf('exports.generateEmbedToken'));
    const body = fn.slice(0, fn.indexOf('exports.', 10));

    assert.match(body, /req\.tenantId/, 'must read the guard\'s verdict');
    assert.doesNotMatch(
        body,
        /const\s*\{\s*accountId\s*\}\s*=\s*req\.params/,
        'must not re-derive the account id from the route'
    );
});

test('PA-C1: exchangeEmbedToken re-verifies partner membership before issuing a JWT', () => {
    const src = stripComments(read('controllers/embedAuthController.js'));
    // Defence in depth: this endpoint trades a token for a JWT carrying the
    // target user's role, so it must not rely solely on the mint-side check.
    assert.match(src, /accountIds/, 'must load the partner\'s account list');
    assert.match(
        src,
        /belongsToPartner/,
        'must confirm the token subject is one of this partner\'s accounts'
    );
    // The membership check has to run BEFORE the token is signed.
    assert.ok(
        src.indexOf('belongsToPartner') < src.indexOf('jwt.sign'),
        'membership must be verified before signing'
    );
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-C2 — the embed could not be framed by any partner
// ═══════════════════════════════════════════════════════════════════════════

const { normaliseOrigin } = require('../../src/services/embedFramingService');

test('PA-C2: embed origins accept exact origins and reject everything dangerous', () => {
    assert.strictEqual(normaliseOrigin('https://crm.partner.com'), 'https://crm.partner.com');
    assert.strictEqual(normaliseOrigin('https://crm.partner.com:8443'), 'https://crm.partner.com:8443');
    // A pasted path is normalised away rather than rejected — CSP takes origins.
    assert.strictEqual(normaliseOrigin('https://crm.partner.com/embed/page'), 'https://crm.partner.com');

    // A wildcard would hand an authenticated WhatsApp inbox to any site.
    assert.strictEqual(normaliseOrigin('https://*.partner.com'), null);
    assert.strictEqual(normaliseOrigin('*'), null);
    assert.strictEqual(normaliseOrigin('javascript:alert(1)'), null);
    assert.strictEqual(normaliseOrigin('data:text/html,x'), null);
    assert.strictEqual(normaliseOrigin('not a url'), null);
    assert.strictEqual(normaliseOrigin(''), null);
    assert.strictEqual(normaliseOrigin(null), null);
    assert.strictEqual(normaliseOrigin(undefined), null);
});

test('PA-C2: /embed responses swap X-Frame-Options for a frame-ancestors allowlist', () => {
    // Comments stripped: the explanatory note above this middleware mentions
    // `frame-ancestors *` as the thing NOT to do, which would trip the
    // wildcard assertion below.
    const idx = stripComments(readRoot('index.js'));

    // helmet's SAMEORIGIN default made the iframe unrenderable from any partner
    // domain — the entire product premise was dead outside localhost.
    assert.match(idx, /app\.use\('\/embed'/, 'the embed route needs its own framing middleware');
    assert.match(idx, /removeHeader\('X-Frame-Options'\)/);
    assert.match(idx, /frame-ancestors/);
    assert.match(idx, /resolveEmbedFrameAncestors/);

    // Fail closed: no registered origins must mean 'none', never a wildcard.
    assert.match(idx, /frame-ancestors \$\{origins\.length \? origins\.join\(' '\) : "'none'"\}/);
    assert.doesNotMatch(idx, /frame-ancestors \*/, 'a wildcard would reintroduce clickjacking');
});

test('PA-C2: PartnerApp carries the per-partner origin allowlist, defaulting to empty', () => {
    const model = read('models/PartnerApp.js');
    assert.match(model, /allowedOrigins:\s*\{[\s\S]*?type:\s*\[String\][\s\S]*?default:\s*\[\]/,
        'must default to no grant, so framing is opt-in per partner');
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-C3 — delete-any-user + orphaned data
// ═══════════════════════════════════════════════════════════════════════════

test('PA-C3: deletePartnerAccount verifies ownership before deleting anything', () => {
    const ctrl = stripComments(read('controllers/partnerAppAdminController.js'));
    const fn = ctrl.slice(ctrl.indexOf('exports.deletePartnerAccount'));

    const ownershipAt = fn.indexOf('Account not found under this partner');
    const deleteAt = fn.indexOf('User.deleteOne');

    assert.ok(ownershipAt > -1, 'the handler must reject accounts that are not this partner\'s');
    assert.ok(deleteAt > -1);
    assert.ok(
        ownershipAt < deleteAt,
        'the $pull is a silent no-op for a foreign account — the guard must precede the delete'
    );
});

test('PA-C3: deletePartnerAccount cascades through accountCleanupService', () => {
    const ctrl = stripComments(read('controllers/partnerAppAdminController.js'));
    assert.match(ctrl, /deleteOwnedRecords/,
        'every other delete path in this codebase cascades; this one must too');

    const fn = ctrl.slice(ctrl.indexOf('exports.deletePartnerAccount'));
    assert.match(fn.slice(0, fn.indexOf('exports.', 10)), /await deleteOwnedRecords\(accountId\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-H1 — embed session hijacked the operator's own session
// ═══════════════════════════════════════════════════════════════════════════

test('PA-H1: the embed page never writes the main app\'s session keys', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/pages/EmbedWhatsApp.jsx'), 'utf8');
    const code = stripComments(src);

    // Same origin as the CRM ⇒ same localStorage. Writing `token`/`user` replaced
    // the session of anyone with the CRM open elsewhere, and the unmount cleanup
    // then logged them out of the real app.
    assert.doesNotMatch(code, /localStorage\.setItem\(\s*'token'/);
    assert.doesNotMatch(code, /localStorage\.setItem\(\s*'user'/);
    assert.doesNotMatch(code, /localStorage\.removeItem\(\s*'token'/);
    assert.match(code, /setAuthSession/, 'must use the embed-scoped session helper');
});

test('PA-H1: embed sessions are stored under distinct keys in sessionStorage', () => {
    const api = fs.readFileSync(path.join(ROOT, 'client/src/services/api.js'), 'utf8');
    assert.match(api, /embed_token/);
    assert.match(api, /embed_user/);
    assert.match(api, /sessionStorage/);
    // The request interceptor must go through the helper, not read 'token' raw.
    assert.match(api, /const token = getAuthToken\(\)/);
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-H2 — allowedModules was decorative
// ═══════════════════════════════════════════════════════════════════════════

test('PA-H2: embed mode no longer grants blanket module access', () => {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/pages/WhatsAppManagement.jsx'), 'utf8');
    const code = stripComments(src);

    // The single line that made the whole SuperAdmin module grid decorative.
    assert.doesNotMatch(code, /if \(embedded\) return true;/);
    assert.match(code, /embedModules/, 'the partner grant must be consulted');
    assert.match(code, /EMBED_TAB_MODULE/, 'tabs must map to partner module keys');
});

test('PA-H2: the module grant is enforced server-side, not only in the UI', () => {
    const auth = stripComments(read('middleware/authMiddleware.js'));
    assert.match(auth, /embedModules/, 'authMiddleware must clamp embed sessions');

    // The clamp must run BEFORE entitlements are resolved, or requireFeature
    // would still see the unclamped module list.
    assert.ok(
        auth.indexOf('embedModules') < auth.indexOf('resolveValues(req.workspace)'),
        'the clamp must precede entitlement resolution'
    );

    const embed = stripComments(read('controllers/embedAuthController.js'));
    assert.match(embed, /embedModules:\s*allowedModules/, 'the grant must be signed into the JWT');
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-H3 — deactivation did not stop embed access
// ═══════════════════════════════════════════════════════════════════════════

test('PA-H3: a deactivated partner cannot exchange embed tokens', () => {
    const src = stripComments(read('controllers/embedAuthController.js'));
    assert.match(src, /partner\.isActive/, 'the partner state must gate the exchange');
    assert.ok(
        src.indexOf('isActive') < src.indexOf('jwt.sign'),
        'the check must precede issuing a session'
    );
});

test('PA-H3: deactivating a partner revokes its accounts\' live sessions', () => {
    const ctrl = stripComments(read('controllers/partnerAppAdminController.js'));
    const fn = ctrl.slice(ctrl.indexOf('exports.deactivatePartner'));
    const body = fn.slice(0, fn.indexOf('exports.', 10));

    // Without this, already-issued 8h embed JWTs kept working for the rest of
    // the day while the UI claimed access was blocked "immediately".
    assert.match(body, /tokenVersion/);
    assert.match(body, /clearTokenVersionCache/);
    assert.match(body, /Partner not found/, 'must 404 rather than report success for a bogus id');
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-H4 / PA-M7 / PA-M8 — webhook delivery
// ═══════════════════════════════════════════════════════════════════════════

const { PARTNER_WEBHOOK_EVENTS } = require('../../src/constants/partnerWebhookEvents');

test('PA-M7: every advertised webhook event has a real emitter', () => {
    // account.created and account.frozen were offered as checkboxes in the
    // Settings tab while nothing in the codebase ever emitted them, so partners
    // could subscribe to events that would never arrive.
    const sources = [
        read('controllers/partnerApiController.js'),
        read('controllers/partnerAppAdminController.js'),
        read('controllers/whatsappWebhookController.js')
    ].join('\n');

    for (const event of PARTNER_WEBHOOK_EVENTS) {
        assert.match(
            sources,
            new RegExp(`forwardIfPartnerAccount\\([^)]*['"]${event.replace('.', '\\.')}['"]`, 's'),
            `${event} is advertised but never emitted`
        );
    }
});

test('PA-M7: the UI event list matches the backend catalogue exactly', () => {
    const settings = fs.readFileSync(
        path.join(ROOT, 'client/src/components/SuperAdmin/PartnerSettingsTab.jsx'), 'utf8');
    const uiEvents = [...settings.matchAll(/\{\s*key:\s*'(message\.[a-z_]+|account\.[a-z_]+)'/g)]
        .map(m => m[1]);

    assert.deepStrictEqual(
        uiEvents.slice().sort(),
        PARTNER_WEBHOOK_EVENTS.slice().sort(),
        'the checkbox list and the emitter catalogue must not drift'
    );
});

test('PA-M8: an empty webhook URL disables webhooks instead of failing forever', () => {
    const svc = stripComments(read('services/partnerWebhookService.js'));
    // `$ne: null` matched the empty string the settings form submits, so clearing
    // the URL left the partner "configured" and logged an axios failure on every
    // single inbound message.
    assert.match(svc, /webhookUrl:\s*\{\s*\$nin:\s*\[null,\s*''\]\s*\}/);

    // Both write paths must normalise blank → null.
    const api = stripComments(read('controllers/partnerApiController.js'));
    assert.match(api, /update\.webhookUrl = url \? url\.trim\(\) : null/);
    const admin = stripComments(read('controllers/partnerAppAdminController.js'));
    assert.match(admin, /update\.webhookUrl = update\.webhookUrl \? update\.webhookUrl\.trim\(\) : null/);
});

test('PA-H4: webhook deliveries are durable, retried and inspectable', () => {
    const svc = stripComments(read('services/partnerWebhookService.js'));

    // Persisted BEFORE the first attempt, so a crash mid-send cannot lose it.
    assert.match(svc, /PartnerWebhookDelivery\.create/);
    assert.ok(
        svc.indexOf('PartnerWebhookDelivery.create') < svc.indexOf('attemptDelivery(row'),
        'the row must exist before the first send attempt'
    );

    // Retry machinery.
    assert.match(svc, /backoffMinutes/);
    assert.match(svc, /MAX_ATTEMPTS/);
    // Idempotency + replay-safety headers a partner can actually use.
    assert.match(svc, /X-Partner-Delivery-Id/);
    assert.match(svc, /X-Partner-Signature/);

    const drain = stripComments(read('services/partnerWebhookOutboxService.js'));
    assert.match(drain, /status:\s*'pending'/);
    assert.match(drain, /nextRetryAt:\s*\{\s*\$lte:/);

    // And the drain has to actually be scheduled.
    const cron = readRoot('src/services/cronJobs.js');
    assert.match(cron, /drainPartnerWebhooks/, 'the outbox drain must be registered as a cron job');
});

test('PA-H4: a 4xx from the partner is permanent, a 5xx/timeout is retried', () => {
    const svc = stripComments(read('services/partnerWebhookService.js'));
    // Hammering an endpoint that rejected the payload for seven hours helps
    // nobody; 408/429 are the two 4xx that genuinely mean "try again".
    assert.match(svc, /code >= 400 && code < 500 && code !== 408 && code !== 429/);
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-H5 — SSRF on webhook URLs
// ═══════════════════════════════════════════════════════════════════════════

test('PA-H5: both webhook-URL write paths validate against SSRF', () => {
    for (const file of ['controllers/partnerApiController.js', 'controllers/partnerAppAdminController.js']) {
        const src = stripComments(read(file));
        assert.match(src, /validateOutboundUrl/, `${file} must run the SSRF guard`);
        assert.match(src, /https:\\?\/\\?\//, `${file} must require https`);
    }
});

test('PA-H5: the SSRF guard actually blocks metadata and private addresses', async () => {
    const { validateOutboundUrl } = require('../../src/utils/ssrfGuard');
    const blocked = [
        'http://169.254.169.254/latest/meta-data/',   // cloud metadata
        'http://127.0.0.1:6379',                      // local redis
        'http://10.0.0.5/hook',                       // RFC1918
        'http://192.168.1.1/hook',
        'file:///etc/passwd'
    ];
    for (const url of blocked) {
        await assert.rejects(() => validateOutboundUrl(url), `${url} must be blocked`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-H6 — provisioning atomicity and the account cap
// ═══════════════════════════════════════════════════════════════════════════

test('PA-H6: provisioning rolls back so a failed create does not strand the email', () => {
    const ctrl = stripComments(read('controllers/partnerApiController.js'));
    const fn = ctrl.slice(ctrl.indexOf('exports.createAccount'));
    const body = fn.slice(0, fn.indexOf('exports.', 10));

    // A mid-sequence failure used to leave an orphaned User: invisible to both
    // the partner and SuperAdmin, but holding the email so every retry returned
    // email_exists with no recovery path.
    assert.match(body, /allSettled/, 'must compensate on failure');
    assert.match(body, /User\.deleteOne\(\{ _id: newUser\._id \}\)/);
    assert.match(body, /\$pull: \{ accountIds: reservationId \}/);
});

test('PA-H6: the account cap is enforced atomically, not read-then-write', () => {
    const ctrl = stripComments(read('controllers/partnerApiController.js'));
    const fn = ctrl.slice(ctrl.indexOf('exports.createAccount'));
    const body = fn.slice(0, fn.indexOf('exports.', 10));

    // The conditional $push is what makes concurrent calls unable to both win
    // the last slot.
    assert.match(body, /accountIds\.\$\{maxAccounts - 1\}/);
    assert.match(body, /\$exists: false/);
    assert.match(body, /reserved\.modifiedCount === 0/);
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-M1 — the configured lead limit was ignored
// ═══════════════════════════════════════════════════════════════════════════

test('PA-M1: provisioning writes planFeatures.leadLimit, which is what is enforced', () => {
    const ctrl = stripComments(read('controllers/partnerApiController.js'));
    const fn = ctrl.slice(ctrl.indexOf('exports.createAccount'));
    const body = fn.slice(0, fn.indexOf('exports.', 10));

    // accountDefaults.leadLimit was stored but never applied, so every partner
    // account silently kept the schema default of 100 leads.
    assert.match(body, /planFeatures:\s*\{[\s\S]*?leadLimit:\s*defaults\.leadLimit/);

    // Confirm the enforcement path really reads planFeatures.leadLimit.
    const lead = read('controllers/leadController.js');
    assert.match(lead, /workspace\??\.?\.planFeatures\?\.leadLimit|planFeatures\?\.leadLimit/);
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-M3 / PA-M4 — billing consistency
// ═══════════════════════════════════════════════════════════════════════════

test('PA-M3: one active-account definition drives every revenue figure', () => {
    const ctrl = stripComments(read('controllers/partnerAppAdminController.js'));
    assert.match(ctrl, /ACTIVE_ACCOUNT_FILTER/);

    // The list view billed on total accounts (including frozen), the detail view
    // on active ones, and generateBill on a third query — three numbers for one
    // partner. No handler may re-spell the filter inline any more.
    const inlineFilters = ctrl.match(/is_active:\s*true,\s*\n?\s*accountStatus:\s*\{\s*\$ne:\s*'Frozen'\s*\}/g) || [];
    assert.strictEqual(inlineFilters.length, 1,
        'the active-account filter must be defined exactly once');
});

test('PA-M4: bills are month-bounded, numbered, and attributed', () => {
    const ctrl = stripComments(read('controllers/partnerAppAdminController.js'));
    const fn = ctrl.slice(ctrl.indexOf('exports.generateBill'));
    const body = fn.slice(0, fn.indexOf('exports.', 10));

    // "2026-03" generated in September used to invoice September's roster.
    assert.match(body, /periodEnd/, 'accounts must be bounded to the billed period');
    assert.match(body, /createdAt:\s*\{\s*\$lt:\s*periodEnd\s*\}/);
    assert.match(body, /Cannot bill a future month/);
    assert.match(body, /invoiceNumber/);
    assert.match(body, /generatedBy/);
    // Currency frozen so a later switch cannot restate history.
    assert.match(body, /currency:\s*partner\.currency/);
});

test('PA-M4: marking a bill paid is attributable and reversible', () => {
    const ctrl = stripComments(read('controllers/partnerAppAdminController.js'));
    assert.match(ctrl, /billingHistory\.\$\.paidBy/);
    assert.match(ctrl, /exports\.markBillDue/, 'mark-as-paid must be undoable');
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-M5 / PA-M6 — UI correctness
// ═══════════════════════════════════════════════════════════════════════════

test('PA-M5: money is never rendered by concatenating the raw currency code', () => {
    const billing = fs.readFileSync(
        path.join(ROOT, 'client/src/components/SuperAdmin/PartnerBillingTab.jsx'), 'utf8');

    // `{partner.currency || '₹'}{amount}` rendered "INR500" while sibling totals
    // on the same screen hardcoded '₹'.
    assert.doesNotMatch(billing, /\{partner\.currency \|\| '₹'\}/);
    assert.match(billing, /formatMoney/);
});

test('PA-M5: formatMoney maps codes to symbols', () => {
    const { formatMoney, currencySymbol } = require('../../client/src/utils/currency.js');
    assert.strictEqual(currencySymbol('INR'), '₹');
    assert.strictEqual(currencySymbol('USD'), '$');
    assert.ok(formatMoney(500, 'INR').startsWith('₹'));
    assert.ok(!formatMoney(500, 'INR').includes('INR'));
});

test('PA-M6: the copy button cannot copy a masked key', () => {
    const tab = fs.readFileSync(
        path.join(ROOT, 'client/src/components/SuperAdmin/PartnerApiKeyTab.jsx'), 'utf8');
    const code = stripComments(tab);

    // It fell back to partner.apiKey, which the API returns masked — so an admin
    // copying outside the regenerate flow handed the partner a dead string.
    assert.doesNotMatch(code, /writeText\(newlyGeneratedKey \|\| partner\.apiKey/);
    assert.match(code, /if \(!newlyGeneratedKey\) return;/);
});

// ═══════════════════════════════════════════════════════════════════════════
// PA-M10 / PA-M11 / low-severity invariants
// ═══════════════════════════════════════════════════════════════════════════

test('PA-M10: freezing an account revokes its live sessions', () => {
    for (const file of ['controllers/partnerApiController.js', 'controllers/partnerAppAdminController.js']) {
        const src = stripComments(read(file));
        // is_active:false alone left the account working for the 60s auth cache TTL.
        assert.match(src, /tokenVersion/, `${file} must bump the session generation on freeze`);
        assert.match(src, /clearTokenVersionCache/, `${file} must invalidate the auth cache`);
    }
});

test('PA-M11: API keys are stored hashed, never in plaintext', () => {
    const model = read('models/PartnerApp.js');
    assert.match(model, /apiKeyHash/);
    assert.match(model, /apiKeyPrefix/);

    const admin = stripComments(read('controllers/partnerAppAdminController.js'));
    // Creation and rotation must both persist only the hash.
    assert.match(admin, /apiKeyHash:\s*hashPartnerKey\(apiKey\)/);
    assert.match(admin, /apiKeyHash:\s*hashPartnerKey\(newKey\)/);
    assert.doesNotMatch(admin, /\$set:\s*\{\s*apiKey:\s*newKey\s*\}/,
        'rotation must not write plaintext back');

    const mw = stripComments(read('middleware/partnerApiAuthMiddleware.js'));
    assert.match(mw, /findOne\(\{ apiKeyHash: keyHash \}\)/, 'lookup must be by hash');
});

test('rate-limit defaults agree across the schema, the middleware and the UI', () => {
    const model = read('models/PartnerApp.js');
    const mw = stripComments(read('middleware/partnerApiAuthMiddleware.js'));
    const apiKeyTab = fs.readFileSync(
        path.join(ROOT, 'client/src/components/SuperAdmin/PartnerApiKeyTab.jsx'), 'utf8');

    // Schema said 30/500/30; the middleware and both UI previews said
    // 200/5000/200, so legacy partners silently got a different quota than shown.
    const schemaPerMin = model.match(/perAccountPerMinute:\s*\{\s*type:\s*Number,\s*default:\s*(\d+)/)?.[1];
    const schemaPerDay = model.match(/perAccountPerDay:\s*\{\s*type:\s*Number,\s*default:\s*(\d+)/)?.[1];

    assert.strictEqual(schemaPerMin, '30');
    assert.strictEqual(schemaPerDay, '500');

    assert.match(mw, new RegExp(`perAccountPerMinute \\?\\? ${schemaPerMin}`));
    assert.match(mw, new RegExp(`perAccountPerDay\\s+\\?\\? ${schemaPerDay}`));
    assert.match(apiKeyTab, new RegExp(`perAccountPerMinute \\?\\? ${schemaPerMin}`));
    assert.match(apiKeyTab, new RegExp(`perAccountPerDay \\?\\? ${schemaPerDay}`));
});

test('the in-memory partner caches are bounded', () => {
    const mw = stripComments(read('middleware/partnerApiAuthMiddleware.js'));
    // invalidKeyCache is filled by UNAUTHENTICATED traffic — unbounded, it is a
    // memory-exhaustion vector for anyone spraying random keys.
    assert.match(mw, /MAX_INVALID_KEYS/);
    assert.match(mw, /MAX_RATE_BUCKETS/);
    assert.match(mw, /setInterval\(sweepCaches/);
    assert.match(mw, /unref/, 'the sweep timer must not hold the event loop open');

    const svc = stripComments(read('services/partnerWebhookService.js'));
    assert.match(svc, /MAX_CACHE_ENTRIES/);
});

test('auth runs before ObjectId validation on every partner-app admin route', () => {
    const routes = readRoot('src/routes/superAdminRoutes.js');
    const partnerRoutes = routes
        .split('\n')
        .filter(l => l.includes("'/partner-apps") && l.includes('router.'));

    assert.ok(partnerRoutes.length >= 12, 'expected the full partner-app route set');
    for (const line of partnerRoutes) {
        if (!line.includes('validateObjectId')) continue;
        assert.ok(
            line.indexOf('authMiddleware') < line.indexOf('validateObjectId'),
            `unauthenticated callers must get 401, not 400: ${line.trim()}`
        );
    }
});

test('the partner API never leaks secret material back to the admin UI', () => {
    const ctrl = stripComments(read('controllers/partnerAppAdminController.js'));
    // getPartner used to spread the whole document, webhookSecret included.
    assert.match(ctrl, /const \{ apiKeyHash, apiKey, webhookSecret, \.\.\.safePartner \} = partner/);
    assert.match(ctrl, /hasWebhookSecret/);
});

test('the webhook signing secret is obtainable exactly once, and rotatable', () => {
    const admin = stripComments(read('controllers/partnerAppAdminController.js'));
    assert.match(admin, /exports\.rotateWebhookSecret/);

    const modal = fs.readFileSync(
        path.join(ROOT, 'client/src/components/SuperAdmin/CreatePartnerModal.jsx'), 'utf8');
    // The create response returned the secret and the modal threw it away, so
    // nobody could ever give it to the partner.
    assert.match(modal, /setCreatedSecret\(res\.data\.data\.webhookSecret/);

    const api = stripComments(read('controllers/partnerApiController.js'));
    // The partner-facing update used to echo the secret in full on every call,
    // turning "change my subscribed events" into a credential disclosure.
    assert.match(api, /if \(isFirstSecret\)/);
});
