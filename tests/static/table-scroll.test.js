// tests/static/table-scroll.test.js
//
// A table that scrolls sideways inside a box with no height limit grows as tall
// as its rows, which puts its horizontal scrollbar underneath the LAST one —
// unreachable until you scroll the whole page to the bottom. Every data table in
// the app had this; `.table-scroll` (client/src/index.css) caps the height so the
// scrollbar stays on screen and the header row stays put.
//
// This is a ratchet: a new table wrapped in a bare `overflow-x-auto` brings the
// bug straight back, and nothing about it looks wrong in code review.
//
// Run: node --test tests/static/table-scroll.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '..', '..', 'client', 'src');

function allJsx(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) allJsx(full, out);
        else if (entry.name.endsWith('.jsx')) out.push(full);
    }
    return out;
}

describe('data tables keep their horizontal scrollbar reachable', () => {
    test('no table is wrapped in an unbounded overflow-x-auto', () => {
        const offenders = [];
        for (const file of allJsx(CLIENT)) {
            const lines = fs.readFileSync(file, 'utf8').split('\n');
            lines.forEach((line, i) => {
                if (!line.includes('overflow-x-auto')) return;
                // Only the ones that actually wrap a table: code blocks, tab
                // strips and the kanban board scroll sideways on purpose and
                // must keep doing so.
                const window = lines.slice(i, i + 12).join('\n');
                if (window.includes('<table')) {
                    offenders.push(`${path.relative(CLIENT, file)}:${i + 1}`);
                }
            });
        }

        assert.deepEqual(offenders, [],
            'these wrap a <table> in a height-unbounded scroll box, which parks the ' +
            'horizontal scrollbar below the last row. Use "table-scroll" instead:\n  ' +
            offenders.join('\n  '));
    });

    test('the utility itself is still defined, and opaquely', () => {
        const css = fs.readFileSync(path.join(CLIENT, 'index.css'), 'utf8');
        const block = css.slice(css.indexOf('.table-scroll'));

        assert.match(block, /max-height:\s*70vh/, 'the height cap is the whole point');
        assert.match(block, /overflow:\s*auto/, 'the box has to own both axes');
        assert.match(block, /thead th[\s\S]*position:\s*sticky/,
            'sticky belongs on the CELLS — a sticky <thead> is ignored by Safari');
        assert.match(block, /background-color:\s*var\(--table-head-bg/,
            'a sticky header with no background of its own has the rows scroll ' +
            'straight through it; a background on <thead> alone is not painted');
    });

    test('tables whose header is not slate-50 say so', () => {
        // The default is slate-50. A dark or white header that does not override
        // it renders as a pale band over dark rows — visibly wrong, but only on
        // the few screens that use one.
        const KNOWN_OVERRIDES = {
            'components/SuperAdmin/AuditLogsView.jsx': '#0f172a',
            'components/SuperAdmin/SystemHealthView.jsx': '#1e293b',
            'components/WhatsApp/WhatsAppBroadcasts.jsx': '#f1f5f9',
            'pages/Agency/AgencyClients.jsx': '#ffffff',
            'pages/Agency/AgencyDashboard.jsx': '#ffffff',
            'pages/Automations.jsx': '#f9fafb',
            'pages/Sequences.jsx': '#f9fafb'
        };
        for (const [rel, colour] of Object.entries(KNOWN_OVERRIDES)) {
            const src = fs.readFileSync(path.join(CLIENT, rel), 'utf8');
            assert.ok(src.includes(`'--table-head-bg': '${colour}'`),
                `${rel} has a non-slate-50 header and must set --table-head-bg to ${colour}`);
        }
    });
});
