// ─────────────────────────────────────────────────────────────────────────────
// Media never lands on the application server's disk.
//
// Every media tree (WhatsApp inbound, support attachments, email attachments,
// Media Library) is backed by object storage. uploads/ is a staging area for
// in-flight uploads only. These are source-level assertions: they are cheap,
// need no running server, and they fail loudly if someone reintroduces a
// disk write on one of these paths.
// ─────────────────────────────────────────────────────────────────────────────

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

// ── Inbound WhatsApp media ───────────────────────────────────────────────────

test('inbound WhatsApp media is mirrored to object storage on webhook arrival', () => {
    const webhook = read('controllers', 'whatsappWebhookController.js');
    assert.match(webhook, /mirrorInboundMedia/,
        'the webhook must mirror media — Meta purges it after ~30 days');

    // Must not block the 200 back to Meta, or Meta retries the delivery.
    const call = webhook.slice(webhook.indexOf('mirrorInboundMedia'), webhook.indexOf('mirrorInboundMedia') + 500);
    assert.ok(!/await\s+mirrorInboundMedia/.test(call),
        'mirroring must be fire-and-forget; awaiting it delays the webhook response');
});

test('downloadMedia no longer writes the media cache to disk', () => {
    const svc = read('services', 'whatsappService.js');
    const fn = svc.slice(svc.indexOf('const downloadMedia'), svc.indexOf('const submitTemplateToMeta'));

    assert.ok(!/writeFile/.test(fn),
        'downloadMedia must not persist to local disk — the 7-day cleanup cron ' +
        'used to delete the only surviving copy of media Meta had already purged');
});

test('the media proxy prefers the durable copy and still checks ownership first', () => {
    const ctrl = read('controllers', 'whatsappConversationController.js');
    const fn = ctrl.slice(ctrl.indexOf('exports.downloadMediaProxy'));

    const ownerIdx = fn.indexOf('companyUserIds');
    const fetchIdx = fn.indexOf('getBuffer');
    assert.ok(ownerIdx > -1 && fetchIdx > -1, 'both the ownership check and the storage read must exist');
    assert.ok(ownerIdx < fetchIdx,
        'ownership must be proven BEFORE any bytes are fetched');

    assert.match(fn, /content\.storageKey/,
        'the proxy must resolve the mirrored object, not only the Meta media id');
});

// ── Support attachments ──────────────────────────────────────────────────────

test('support uploads stage in temp and are pushed to object storage', () => {
    const mw = read('middleware', 'supportUploadMiddleware.js');
    assert.match(mw, /SUPPORT_TEMP_DIR/, 'support uploads must stage in a temp dir');
    assert.ok(!/path\.join\(SUPPORT_UPLOAD_ROOT,\s*ticketId\)/.test(mw),
        'the multer destination must not be built from a URL-supplied ticket id');

    const ctrl = read('controllers', 'supportController.js');
    assert.match(ctrl, /storageKey/, 'attachments must record an object-storage key');
    assert.match(ctrl, /putObject/, 'attachment bytes must go to object storage');
});

test('deleting a ticket purges its objects, not just its rows', () => {
    const ctrl = read('controllers', 'supportController.js');
    const fn = ctrl.slice(ctrl.indexOf('const closeTicket'));

    const collectIdx = fn.indexOf('storageKeys');
    const deleteRowsIdx = fn.indexOf('SupportMessage.deleteMany');
    assert.ok(collectIdx > -1 && deleteRowsIdx > -1, 'both steps must exist');
    assert.ok(collectIdx < deleteRowsIdx,
        'storage keys must be collected BEFORE the messages holding them are deleted, ' +
        'or the objects are orphaned in the bucket forever');
    assert.match(fn, /deleteObject/, 'the objects themselves must be removed');
});

// ── Email attachments ────────────────────────────────────────────────────────

test('email template attachments go to object storage with a MIME-derived extension', () => {
    const ctrl = read('controllers', 'emailTemplateController.js');

    assert.ok(!/path\.extname\(file\.originalname\)/.test(ctrl),
        'the stored extension must come from the MIME allowlist, not the client filename');
    assert.match(ctrl, /EXT_FOR_MIME\[file\.mimetype\]/, 'extension must map through the allowlist');
    assert.match(ctrl, /putObject/, 'attachment bytes must go to object storage');
});

test('attachment keys are confined to the owning tenant', () => {
    const util = read('utils', 'emailAttachments.js');
    assert.match(util, /email-attachments\/\$\{tenantId\}\//,
        'the expected key prefix must be tenant-scoped');
    assert.match(util, /startsWith\(expectedPrefix\)/,
        'a tampered attachment row must not be able to read another tenant\'s object');
});

test('the dead email upload middleware stays unmounted', () => {
    const files = fs.readdirSync(path.join(SRC, 'routes'));
    for (const f of files) {
        const src = fs.readFileSync(path.join(SRC, 'routes', f), 'utf8');
        assert.ok(!/require\(.*uploadMiddleware.*\)/.test(src),
            `${f}: uploadMiddleware writes tenant files to local disk — it must stay unmounted`);
    }
});

// ── Disk hygiene ─────────────────────────────────────────────────────────────

test('the cleanup cron sweeps temp orphans', () => {
    const cron = read('services', 'cronJobs.js');
    assert.match(cron, /cleanupLocalMediaDirs/, 'the disk cleanup job must exist');
    assert.match(cron, /'uploads',\s*'temp'/,
        'aborted uploads leave temp files behind — they must be swept');
});
