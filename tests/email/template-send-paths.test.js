// tests/email/template-send-paths.test.js
//
// Every way the CRM sends a saved email template must send the files attached
// to it. They kept diverging: each new sender (sequences, the follow-up cron,
// the MCP stage-send, the workflow node, the partner API) copied the
// subject/body handling and forgot the attachments, so the covering note went
// out and the brochure it exists to deliver did not — silently, with a green
// "sent" in the logs.
//
// These are source-level guards. They are cheap, need no database, and they
// fail the moment somebody adds a sixth sender that forgets again.
//
// Run: node --test tests/email/template-send-paths.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'src');
const read = (...p) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

/** Every file that loads an EmailTemplate in order to SEND it. */
const SENDERS = [
    { label: 'manual "send this template"', file: ['controllers', 'emailTemplateController.js'] },
    { label: 'compose window',              file: ['controllers', 'emailController.js'] },
    { label: 'stage/lead-create automation', file: ['services', 'emailAutomationService.js'] },
    { label: 'email campaigns',             file: ['services', 'campaignService.js'] },
    { label: 'drip sequences',              file: ['services', 'sequenceService.js'] },
    { label: 'follow-up cron',              file: ['services', 'cronJobs.js'] },
    { label: 'MCP send-to-stage',           file: ['controllers', 'mcpController.js'] },
    { label: 'partner/external API',        file: ['controllers', 'extApiController.js'] },
    { label: 'workflow Send Email node',    file: ['workflow-engine', 'nodes', 'communication', 'SendEmailNode.js'] }
];

describe('every email-template sender delivers its attachments', () => {
    for (const { label, file } of SENDERS) {
        test(`${label} resolves attachments`, () => {
            const src = read(...file);
            assert.match(src, /resolveAttachments/,
                `${file.join('/')} sends email templates but never resolves their ` +
                'attachments — the files silently do not go out');
            assert.match(src, /attachments:/,
                `${file.join('/')} resolves attachments but never passes them to the send`);
        });
    }
});

test('no sender hands raw database rows to nodemailer', () => {
    // An EmailTemplate.attachments row is { filename, storageKey, mimetype, … }
    // with no `content` and no `path`. Nodemailer accepts it and produces a
    // real-looking, completely EMPTY file — which is how the MCP stage-send
    // shipped 0-byte brochures to every lead in a stage.
    const offenders = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.js')) continue;
            const src = fs.readFileSync(full, 'utf8');
            // `attachments: <something template-ish>.attachments` — a stored row
            // list, unresolved. Scoped to template-shaped names on purpose:
            // `attachments: options.attachments` inside emailService is the
            // already-resolved list being handed on, which is correct.
            const raw = src.match(/attachments:\s*\w*(?:[Tt]emplate|tpl)\w*(?:\.\w+)*\.attachments\b/g);
            if (raw) offenders.push(`${path.relative(SRC, full)} → ${raw.join(', ')}`);
        }
    };
    walk(SRC);

    assert.deepEqual(offenders, [],
        'these pass stored attachment ROWS straight to the mailer; they must go ' +
        'through resolveAttachments() first:\n  ' + offenders.join('\n  '));
});

describe('optional template mode on the generic senders', () => {
    test('the partner API can send a template, not only free text', () => {
        const ctrl = read('controllers', 'extApiController.js');
        const fn = ctrl.slice(ctrl.indexOf('exports.sendEmail'));

        assert.match(fn, /templateId/, 'POST /email/send must accept a templateId');
        assert.match(fn, /userId: req\.tenantId/,
            "a partner must not be able to send another workspace's template");
        assert.match(fn, /subject` and `body` are required \(or send a `templateId`\)/,
            'subject/body stay required only when no template is named');
    });

    test('the workflow Send Email node can point at a template', () => {
        const node = read('workflow-engine', 'nodes', 'communication', 'SendEmailNode.js');

        assert.match(node, /email_template_select/, 'the node needs a template picker field');
        assert.match(node, /userId: tenantId/,
            "a workflow must not be able to read another workspace's template");
        // A template supplies both, so requiring them too makes the node unsavable.
        assert.match(node, /if \(!data\.emailTemplateId\) \{/,
            'subject/body must stop being required once a template is chosen');
    });

    test('the workflow builder renders the template picker', () => {
        const sidebar = fs.readFileSync(
            path.join(__dirname, '..', '..', 'client', 'src', 'components', 'WorkflowBuilder', 'ConfigSidebar.jsx'),
            'utf8'
        );
        assert.match(sidebar, /email_template_select/,
            'an unrendered field type leaves the author with no way to pick a template');
        assert.match(sidebar, /\/email-templates/, 'and the options have to come from somewhere');
    });
});

describe('attachments are managed where the template is written', () => {
    const readClient = (...p) =>
        fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src', 'components', 'Email', ...p), 'utf8');

    test('the create/edit form owns attachments, including drag and drop', () => {
        const modal = readClient('TemplateModal.jsx');
        assert.match(modal, /onDrop=\{handleDrop\}/, 'dropping a PDF on the form must attach it');
        assert.match(modal, /MediaLibraryPickerModal/, 'and the library must be reachable');
    });

    test('the view modal no longer edits attachments', () => {
        const details = readClient('TemplateDetailsModal.jsx');
        assert.ok(!/AttachmentUploadModal|MediaLibraryPickerModal/.test(details),
            'attachments are added while writing the template, not from its preview');
        assert.ok(!/handleDeleteAttachment/.test(details),
            'and removed there too — one place to manage them');
        assert.match(details, /Manage in Edit/, 'the preview should say where to go instead');
    });
});
