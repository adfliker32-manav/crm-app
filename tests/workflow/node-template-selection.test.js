// tests/workflow/node-template-selection.test.js
//
// Workflow nodes that send a saved template must let the author PICK that
// template on the canvas. The WhatsApp node always could; the email and voice
// nodes made you retype the subject, body or prompt by hand, which then drifted
// from the template every time the template was edited.
//
// The second test here is the important one: a node can declare a field type
// that the builder has no renderer for, and the field simply does not appear.
// Nothing errors, nothing logs — the author just never sees the picker.
//
// Run: node --test tests/workflow/node-template-selection.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const NODES_DIR = path.join(ROOT, 'src', 'workflow-engine', 'nodes');
const SIDEBAR = fs.readFileSync(
    path.join(ROOT, 'client', 'src', 'components', 'WorkflowBuilder', 'ConfigSidebar.jsx'),
    'utf8'
);

const readNode = (...p) => fs.readFileSync(path.join(NODES_DIR, ...p), 'utf8');

/** Every .js file under src/workflow-engine/nodes. */
function allNodeFiles(dir = NODES_DIR, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) allNodeFiles(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('senders let the author choose a saved template', () => {
    const CASES = [
        { label: 'WhatsApp', file: ['communication', 'SendWhatsAppNode.js'], field: 'whatsapp_template_select', key: 'templateName' },
        { label: 'Email',    file: ['communication', 'SendEmailNode.js'],    field: 'email_template_select',    key: 'emailTemplateId' },
        { label: 'Voice',    file: ['communication', 'VoiceCallNode.js'],    field: 'voice_template_select',    key: 'voiceTemplateId' }
    ];

    for (const { label, file, field, key } of CASES) {
        test(`the ${label} node offers a template picker`, () => {
            const src = readNode(...file);
            assert.match(src, new RegExp(field), `${label}: the picker field is missing`);
            assert.match(src, new RegExp(key), `${label}: the picked value has nowhere to live`);
        });
    }

    test('choosing an email template stops demanding a subject and body', () => {
        const src = readNode('communication', 'SendEmailNode.js');
        assert.match(src, /if \(!data\.emailTemplateId\) \{/,
            'the template supplies both — still requiring them makes the node unsavable');
        assert.match(src, /userId: tenantId/,
            "a workflow must not be able to read another workspace's template");
    });

    test('choosing a voice template stops demanding a prompt and mode', () => {
        const src = readNode('communication', 'VoiceCallNode.js');
        assert.match(src, /if \(!data\.voiceTemplateId\) \{/,
            'the template supplies both — still requiring them makes the node unsavable');
        assert.match(src, /\$or: \[\{ tenantId \}, \{ isGlobal: true \}\]/,
            'the picker lists the tenant\'s templates plus the global ones — the ' +
            'node must accept exactly that set, no wider and no narrower');
        assert.match(src, /no_prompt/,
            'a deleted template must not place a call with an empty prompt');
    });

    test('a template is read live, never snapshotted onto the node', () => {
        // A copy taken at save time goes stale the moment the template is edited —
        // the defect drip sequences already had to be fixed for.
        for (const file of [['communication', 'SendEmailNode.js'], ['communication', 'VoiceCallNode.js']]) {
            const src = readNode(...file);
            assert.match(src, /execute:[\s\S]*findOne\(\{[\s\S]*_id: data\.\w+TemplateId/,
                `${file[1]}: the template must be looked up at execution time`);
        }
    });
});

test('every custom field type a node declares has a renderer in the builder', () => {
    // Without this, adding `type: 'foo_select'` to a node schema ships a field
    // that renders as nothing at all: no error, no log, no picker.
    const declared = new Set();
    for (const file of allNodeFiles()) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/type:\s*'([a-z0-9_]*_select)'/g)) declared.add(m[1]);
    }

    assert.ok(declared.size > 0, 'the scan must find field types — a schema change would pass silently otherwise');

    const missing = [...declared].filter(t => !SIDEBAR.includes(`'${t}'`));
    assert.deepEqual(missing, [],
        'these field types are declared by a node but have no renderer in ' +
        `ConfigSidebar, so the author sees nothing: ${missing.join(', ')}`);
});

test('the builder loads the option lists its pickers need', () => {
    for (const endpoint of ['/whatsapp/templates', '/email-templates', '/voice-templates']) {
        assert.ok(SIDEBAR.includes(endpoint),
            `the builder never fetches ${endpoint}, so that picker is always empty`);
    }
    // Voice is a paid module: a 404 for workspaces without it must not blank the
    // whole sidebar, which loads every list in one Promise.all.
    assert.match(SIDEBAR, /api\.get\('\/voice-templates'\)\.catch/,
        'the voice fetch must be individually caught');
});
