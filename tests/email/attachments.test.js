// tests/email/attachments.test.js
//
// Email template attachments, and specifically the Media Library path added so
// a template can be created WITH a document on it instead of being saved first
// and attached afterwards.
//
// The rules pinned here:
//   1. A library pick is a REFERENCE. The bytes stay in the shared library (the
//      one WhatsApp templates use); the template stores an id, never a copy,
//      and detaching must never delete the file.
//   2. Mail budgets are not storage budgets. The library takes 100 MB
//      documents; an email takes 10 MB per file and 25 MB in total, refused at
//      attach time rather than bounced at send time.
//   3. Ownership is proven against the MediaAsset ROW, not a key prefix — and
//      an agent's template, which is keyed to the agent rather than to the
//      workspace, must still resolve the workspace's library.
//
// Run: node --test tests/email/attachments.test.js

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { stub, unstub, makeModel } = require('./helpers/stub');

const MB = 1024 * 1024;

const OWNER  = '507f1f77bcf86cd799439011';
const AGENT  = '507f1f77bcf86cd799439012';
const STRANGER = '507f1f77bcf86cd799439013';

const PDF   = '607f1f77bcf86cd7994390a1';
const IMAGE = '607f1f77bcf86cd7994390a2';
const VIDEO = '607f1f77bcf86cd7994390a3';
const HUGE  = '607f1f77bcf86cd7994390a4';
const FOREIGN = '607f1f77bcf86cd7994390a5';

let emailAttachments, streamed, deleted;

function freshModules() {
    streamed = [];
    deleted = [];

    stub('models/MediaAsset', makeModel([
        { _id: PDF,   userId: OWNER, fileName: 'brochure.pdf', label: 'Brochure', mimeType: 'application/pdf', mediaType: 'DOCUMENT', size: 2 * MB, storageKey: `tenants/${OWNER}/media-library/a.pdf` },
        { _id: IMAGE, userId: OWNER, fileName: 'logo.png', label: null, mimeType: 'image/png', mediaType: 'IMAGE', size: 1 * MB, storageKey: `tenants/${OWNER}/media-library/b.png` },
        { _id: VIDEO, userId: OWNER, fileName: 'tour.mp4', label: 'Tour', mimeType: 'video/mp4', mediaType: 'VIDEO', size: 8 * MB, storageKey: `tenants/${OWNER}/media-library/c.mp4` },
        { _id: HUGE,  userId: OWNER, fileName: 'catalog.pdf', label: 'Catalog', mimeType: 'application/pdf', mediaType: 'DOCUMENT', size: 40 * MB, storageKey: `tenants/${OWNER}/media-library/d.pdf` },
        // Belongs to somebody else entirely.
        { _id: FOREIGN, userId: STRANGER, fileName: 'secret.pdf', label: 'Secret', mimeType: 'application/pdf', mediaType: 'DOCUMENT', size: 1 * MB, storageKey: `tenants/${STRANGER}/media-library/e.pdf` }
    ]));

    stub('models/User', makeModel([
        { _id: OWNER, parentId: null },
        { _id: AGENT, parentId: OWNER }
    ]));

    stub('services/storageService', {
        getStream: async (key) => { streamed.push(key); return { key }; },
        deleteObject: async (key) => { deleted.push(key); }
    });

    unstub('utils/emailAttachments');
    emailAttachments = require('../../src/utils/emailAttachments');
}

describe('buildLibraryAttachments — validating a Media Library pick', () => {
    beforeEach(freshModules);

    test('turns a document into a reference row, copying nothing', async () => {
        const { rows, error } = await emailAttachments.buildLibraryAttachments([PDF], OWNER, []);

        assert.equal(error, null);
        assert.equal(rows.length, 1);
        assert.equal(String(rows[0].mediaAssetId), PDF);
        assert.equal(rows[0].originalName, 'Brochure');
        assert.equal(rows[0].mimetype, 'application/pdf');
        assert.equal(rows[0].size, 2 * MB);
        assert.ok(!rows[0].storageKey,
            'a library row must not carry its own key — the asset owns the bytes, ' +
            'and a stale copied key would outlive a re-upload');
        assert.ok(!rows[0].path, 'nothing about a library pick lives on local disk');
    });

    test('falls back to the file name when the asset has no label', async () => {
        const { rows } = await emailAttachments.buildLibraryAttachments([IMAGE], OWNER, []);
        assert.equal(rows[0].originalName, 'logo.png');
    });

    test("refuses an asset from another tenant's library", async () => {
        const { rows, error } = await emailAttachments.buildLibraryAttachments([FOREIGN], OWNER, []);
        assert.equal(rows.length, 0);
        assert.match(error, /no longer in your Media Library/i);
    });

    test('refuses an id that does not exist at all', async () => {
        const { error } = await emailAttachments.buildLibraryAttachments(['607f1f77bcf86cd7994390ff'], OWNER, []);
        assert.match(error, /no longer in your Media Library/i);
    });

    test('ignores ids that are not object ids rather than querying with them', async () => {
        const { rows, error } = await emailAttachments.buildLibraryAttachments(['../../etc/passwd', ''], OWNER, []);
        assert.equal(error, null);
        assert.equal(rows.length, 0);
    });

    test('refuses a video — 16 MB of MP4 bounces off the recipient', async () => {
        const { error } = await emailAttachments.buildLibraryAttachments([VIDEO], OWNER, []);
        assert.match(error, /only documents and images/i);
    });

    test('refuses a file over the 10 MB per-file ceiling, naming the file', async () => {
        const { error } = await emailAttachments.buildLibraryAttachments([HUGE], OWNER, []);
        assert.match(error, /Catalog/);
        assert.match(error, /10 MB/);
    });

    test('counts what is already attached towards the 25 MB total', async () => {
        const existing = [{ size: 24 * MB }];
        const { error } = await emailAttachments.buildLibraryAttachments([PDF], OWNER, existing);
        assert.match(error, /25 MB/);
    });

    test('refuses to push a template past the attachment count limit', async () => {
        const existing = Array.from({ length: emailAttachments.MAX_ATTACHMENT_COUNT }, () => ({ size: 1024 }));
        const { error } = await emailAttachments.buildLibraryAttachments([PDF], OWNER, existing);
        assert.match(error, /at most/i);
    });

    test('skips a file the template already carries instead of attaching it twice', async () => {
        const existing = [{ mediaAssetId: PDF, size: 2 * MB }];
        const { rows, error } = await emailAttachments.buildLibraryAttachments([PDF, IMAGE], OWNER, existing);

        assert.equal(error, null);
        assert.equal(rows.length, 1, 'only the genuinely new pick is added');
        assert.equal(String(rows[0].mediaAssetId), IMAGE);
    });

    test('de-duplicates repeated ids inside one request', async () => {
        const { rows } = await emailAttachments.buildLibraryAttachments([PDF, PDF, PDF], OWNER, []);
        assert.equal(rows.length, 1);
    });
});

describe('resolveAttachments — reading the bytes at send time', () => {
    beforeEach(freshModules);

    test('streams a library pick from the asset it points at', async () => {
        const out = await emailAttachments.resolveAttachments(
            [{ mediaAssetId: PDF, originalName: 'Brochure', size: 2 * MB }],
            OWNER
        );

        assert.equal(out.length, 1);
        assert.equal(out[0].filename, 'Brochure');
        assert.deepEqual(streamed, [`tenants/${OWNER}/media-library/a.pdf`]);
    });

    test("an agent's template resolves the workspace library it belongs to", async () => {
        // Email templates are keyed to their creator; the library is keyed to
        // the workspace owner. Without the parent lookup every asset an agent
        // attached would vanish silently at send time.
        const out = await emailAttachments.resolveAttachments(
            [{ mediaAssetId: PDF, originalName: 'Brochure' }],
            AGENT
        );
        assert.equal(out.length, 1, 'the agent must still reach their workspace library');
    });

    test("refuses an asset belonging to a different workspace", async () => {
        const out = await emailAttachments.resolveAttachments(
            [{ mediaAssetId: FOREIGN, originalName: 'Secret' }],
            OWNER
        );
        assert.equal(out.length, 0);
        assert.equal(streamed.length, 0, 'nothing may be read before ownership is proven');
    });

    test('skips a pick whose asset was deleted from the library', async () => {
        const out = await emailAttachments.resolveAttachments(
            [{ mediaAssetId: '607f1f77bcf86cd7994390fe', originalName: 'gone.pdf' }],
            OWNER
        );
        assert.equal(out.length, 0, 'a missing asset must not fail the whole send');
    });

    test('still confines a privately uploaded attachment to its own tenant', async () => {
        const mine = { storageKey: `tenants/${OWNER}/email-attachments/x.pdf`, originalName: 'mine.pdf' };
        const theirs = { storageKey: `tenants/${STRANGER}/email-attachments/y.pdf`, originalName: 'theirs.pdf' };

        const out = await emailAttachments.resolveAttachments([mine, theirs], OWNER);

        assert.equal(out.length, 1);
        assert.equal(out[0].filename, 'mine.pdf');
        assert.deepEqual(streamed, [`tenants/${OWNER}/email-attachments/x.pdf`]);
    });

    test('mixes library picks and private uploads in one email', async () => {
        const out = await emailAttachments.resolveAttachments([
            { mediaAssetId: PDF, originalName: 'Brochure' },
            { storageKey: `tenants/${OWNER}/email-attachments/x.pdf`, originalName: 'quote.pdf' }
        ], OWNER);

        assert.deepEqual(out.map(o => o.filename), ['Brochure', 'quote.pdf']);
    });
});

describe('deleteAttachmentFile — detaching must not destroy shared bytes', () => {
    beforeEach(freshModules);

    test('a library pick is detached, never deleted', async () => {
        await emailAttachments.deleteAttachmentFile({
            mediaAssetId: PDF,
            originalName: 'Brochure'
        });
        assert.deepEqual(deleted, [],
            'the file is shared with WhatsApp templates and broadcasts — ' +
            'removing it from one email template must leave it in the library');
    });

    test('a private upload is still deleted with the template', async () => {
        await emailAttachments.deleteAttachmentFile({
            storageKey: `tenants/${OWNER}/email-attachments/x.pdf`
        });
        assert.deepEqual(deleted, [`tenants/${OWNER}/email-attachments/x.pdf`]);
    });
});

// ── Source-level guards ──────────────────────────────────────────────────────
// Cheap checks that the wiring around the helper above cannot be quietly undone.

const ROOT = path.join(__dirname, '..', '..');
const readSrc = (...p) => fs.readFileSync(path.join(ROOT, 'src', ...p), 'utf8');
const readClient = (...p) => fs.readFileSync(path.join(ROOT, 'client', 'src', ...p), 'utf8');

describe('wiring', () => {
    test('a template can be created with library files already attached', () => {
        const ctrl = readSrc('controllers', 'emailTemplateController.js');
        const create = ctrl.slice(ctrl.indexOf('exports.createTemplate'), ctrl.indexOf('exports.updateTemplate'));

        assert.match(create, /mediaAssetIds/,
            'create must accept picks, or attaching is impossible until after the first save');
        assert.match(create, /buildLibraryAttachments/, 'and validate them');
        assert.ok(!/attachments: \[\]/.test(create),
            'a create carrying picks must not overwrite them with an empty list');
    });

    test('the library attach route exists and is permission-gated', () => {
        const routes = readSrc('routes', 'emailTemplateRoutes.js');
        const line = routes.split('\n').find(l => l.includes("/:id/attachments/library"));
        assert.ok(line, 'POST /:id/attachments/library must be mounted');
        assert.match(line, /checkPermission\('manageEmailTemplates'\)/,
            'attaching a file edits the template — it needs the same permission as every other mutation');
    });

    test('the Media Library refuses to delete a file an email template still uses', () => {
        const ctrl = readSrc('controllers', 'mediaLibraryController.js');
        const fn = ctrl.slice(ctrl.indexOf('exports.deleteAsset'));

        assert.match(fn, /EmailTemplate/,
            'deleting a file an email template points at would leave it unsendable with no clue why');
        const guardIdx = fn.indexOf('attachments.mediaAssetId');
        const deleteIdx = fn.indexOf('deleteObject');
        assert.ok(guardIdx > -1 && deleteIdx > -1 && guardIdx < deleteIdx,
            'the in-use check must run BEFORE the bytes are removed');
    });

    test('the template modal offers both attach paths at create time', () => {
        const modal = readClient('components', 'Email', 'TemplateModal.jsx');
        assert.match(modal, /MediaLibraryPickerModal/, 'the library picker must be reachable from the create form');
        assert.match(modal, /type="file"/, 'and so must a direct upload');
        assert.match(modal, /mediaAssetIds/, 'picks must ride along with the create request');
    });

    test('compose sends library picks as repeated form fields, not one joined string', () => {
        const inbox = readClient('components', 'Email', 'EmailInbox.jsx');
        const fn = inbox.slice(inbox.indexOf('const buildSendRequest'), inbox.indexOf('const handleSendMessage'));
        assert.match(fn, /Array\.isArray\(v\)/,
            'appending an array whole yields "a,b" — the server would read one id made of two');
    });
});
