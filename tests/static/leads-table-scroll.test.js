// tests/static/leads-table-scroll.test.js
//
// The leads table scrolls sideways. It used to do that inside a box with no
// height limit, so the box grew as tall as every loaded row and its horizontal
// scrollbar sat underneath the last one — with 100 leads you had to scroll the
// whole page down before you could scroll right at all.
//
// The fix bounds the box so it owns both axes. Two things are easy to undo by
// accident afterwards, and both fail silently:
//
//   1. Re-adding a scroller on the page wrapper, which hands the height back to
//      the content and puts the scrollbar below the fold again.
//   2. Leaving the infinite-scroll sentinel outside the box. An
//      IntersectionObserver root must be an ancestor of its target, so the
//      sentinel would never fire and "load more" would quietly stop after the
//      first page.
//
// Run: node --test tests/static/leads-table-scroll.test.js

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '..', '..', 'client', 'src');
const TABLE = fs.readFileSync(path.join(CLIENT, 'components', 'Dashboard', 'LeadsTable.jsx'), 'utf8');
const PAGE  = fs.readFileSync(path.join(CLIENT, 'pages', 'Leads.jsx'), 'utf8');

describe('the leads table keeps its horizontal scrollbar on screen', () => {
    test('the scroll box is height-bounded and owns both axes', () => {
        assert.match(TABLE, /ref=\{scrollRef\} className="flex-1 min-h-0 overflow-auto"/,
            'the table box must be flex-1 + min-h-0 + overflow-auto. Plain ' +
            '"overflow-x-auto" grows to the full height of the rows and parks the ' +
            'horizontal scrollbar below the last one');
    });

    test('the page wrapper does not scroll the rows as well', () => {
        const view = PAGE.slice(PAGE.indexOf('// Table View'), PAGE.indexOf('<LeadsTable'));
        assert.ok(!/overflow-auto|overflow-y-auto/.test(view),
            'a scroller on the wrapper gives the height back to the content, which ' +
            'is what pushed the scrollbar off screen in the first place');
        assert.match(view, /flex-1 min-h-0 p-6 flex flex-col/,
            'the wrapper has to be a bounded flex column for the box to size itself');
    });

    test('the header row stays put while the rows scroll', () => {
        // Sticky has to sit on the CELLS — Safari ignores it on <thead> — and each
        // needs its own background or rows show through underneath.
        const thead = TABLE.slice(TABLE.indexOf('<thead'), TABLE.indexOf('</thead>'));
        // Start after <thead>'s own tag so its className is not mistaken for a
        // cell's, and read class strings rather than trying to match whole tags —
        // a `onClick={() => …}` arrow contains a '>' that ends the match early.
        const cellClasses = [...thead.slice(thead.indexOf('<tr>')).matchAll(/className="([^"]*)"/g)]
            .map(m => m[1])
            // Cells only — the select-all <input> inside the first one has a
            // className too, and it is not what has to stick.
            .filter(c => /\bpx-\d/.test(c) && /\bpy-4\b/.test(c));

        assert.ok(cellClasses.length >= 8, `the scan must find the header cells (found ${cellClasses.length})`);
        for (const cls of cellClasses) {
            assert.match(cls, /sticky/, `a header cell is not sticky: "${cls}"`);
            assert.match(cls, /top-0/, `a header cell is not pinned to the top: "${cls}"`);
            assert.match(cls, /bg-slate-50/,
                `a sticky header cell needs its own background or rows scroll through it: "${cls}"`);
        }
    });
});

describe('infinite scroll still works inside the bounded box', () => {
    test('the observer watches the box, not the viewport', () => {
        assert.match(TABLE, /root: scrollRef\.current/,
            'left on the viewport the sentinel sits permanently off-screen below ' +
            'the box and never fires, so "load more" stops after the first page');
    });

    test('the sentinel lives inside the scroll box', () => {
        const tableEnd = TABLE.indexOf('</table>');
        const sentinel = TABLE.indexOf('ref={sentinelRef}');
        assert.ok(tableEnd > -1 && sentinel > tableEnd, 'the sentinel follows the table');

        // Nothing may close between the table and the sentinel — a </div> there
        // means the scroll box ended first and the sentinel is outside its root.
        const between = TABLE.slice(tableEnd, sentinel);
        assert.ok(!between.includes('</div>'),
            'the scroll box closes before the sentinel, putting the sentinel outside ' +
            'the observer root — IntersectionObserver silently never fires');
    });
});
