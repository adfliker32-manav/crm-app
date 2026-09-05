// Knowledge base document parsing + chunking.
//
// These run against REAL .csv/.xlsx/.docx/.pdf/.txt files built in fixtures.js,
// because every interesting failure in this layer is a library-contract failure:
// a spreadsheet cell that is an object rather than a string, a pdfjs entry point
// that moved between majors, an OOXML package a parser refuses to open. A test
// against hand-written strings would pass through all of those.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');

const parser = require('../../src/services/documentParserService');
const fixtures = require('./fixtures');

let dir, at;

before(async () => { ({ dir, at } = await fixtures.build()); });
after(() => fixtures.cleanup(dir));

// ─────────────────────────────────────────────────────────────────────────────
describe('1. tabular sources become one chunk per row', () => {

    test('CSV: each data row is a self-describing chunk', async () => {
        const chunks = await parser.parseDocument(at('cars.csv'), 'csv', 'cars.csv');

        // 4 data rows; the blank line between them must not become a chunk.
        assert.strictEqual(chunks.length, 4);

        // Headers are repeated into every chunk on purpose: without them the
        // embedding has no idea 18.2L is a PRICE rather than an engine size.
        assert.match(chunks[1].content, /Brand: Hyundai/);
        assert.match(chunks[1].content, /Price: 18\.2L/);
        assert.match(chunks[1].content, /Offer: 50K exchange bonus/);
    });

    test('CSV: a quoted field containing a comma stays one value', async () => {
        const chunks = await parser.parseDocument(at('cars.csv'), 'csv', 'cars.csv');
        const nexon = chunks.find(c => /Nexon/.test(c.content));
        // Naive splitting on "," would truncate this at "Free insurance".
        assert.match(nexon.content, /Offer: Free insurance, 3yr warranty/);
    });

    test('CSV: row metadata points at the line a user sees in Excel', async () => {
        const chunks = await parser.parseDocument(at('cars.csv'), 'csv', 'cars.csv');
        assert.strictEqual(chunks[0].metadata.row, 2);   // 1 is the header
        assert.strictEqual(chunks[0].metadata.source, 'cars.csv');
        assert.strictEqual(chunks[0].metadata.page, null);
    });

    test('CSV: a header row alone is rejected, not indexed as nothing', async () => {
        const fs = require('fs');
        const lonely = at('header-only.csv');
        fs.writeFileSync(lonely, 'Brand,Model\n');
        await assert.rejects(
            () => parser.parseDocument(lonely, 'csv', 'header-only.csv'),
            /header row plus at least one data row/
        );
    });

    test('XLSX: blank rows are skipped and the sheet name is recorded', async () => {
        const chunks = await parser.parseDocument(at('properties.xlsx'), 'xlsx', 'properties.xlsx');

        assert.strictEqual(chunks.length, 4);
        assert.strictEqual(chunks[0].metadata.sheet, 'Inventory');
        // Row 3 is blank, so the second chunk comes from row 4 — the numbering
        // must follow the real spreadsheet, not the chunk index.
        assert.strictEqual(chunks[1].metadata.row, 4);
    });

    test('XLSX: dates, rich text and formulas flatten to readable values', async () => {
        const chunks = await parser.parseDocument(at('properties.xlsx'), 'xlsx', 'properties.xlsx');
        const all = chunks.map(c => c.content).join('\n');

        // Each of these arrives from exceljs as an OBJECT. String()-ing one
        // yields "[object Object]", which would then be embedded verbatim.
        assert.match(all, /Available From: 2026-03-15/, 'date cell');
        assert.match(all, /Property: Ocean View/,       'rich text cell');
        assert.match(all, /Price: 3\.9 Cr/,             'formula cell (cached result)');
        assert.ok(!/\[object Object\]/.test(all), 'no cell stringified to [object Object]');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('2. prose sources become overlapping windows', () => {

    test('TXT: long text splits into multiple chunks', async () => {
        const chunks = await parser.parseDocument(at('faq.txt'), 'txt', 'faq.txt');
        assert.ok(chunks.length >= 2, `expected 2+ chunks, got ${chunks.length}`);
    });

    test('TXT: consecutive chunks overlap, so a straddling fact survives whole', async () => {
        const chunks = await parser.parseDocument(at('faq.txt'), 'txt', 'faq.txt');

        // The tail of one chunk must reappear at the head of the next; otherwise a
        // sentence cut by a boundary exists in neither chunk as a complete thought.
        const tailWords = chunks[0].content.trim().split(/\s+/).slice(-6).join(' ');
        assert.ok(
            chunks[1].content.includes(tailWords),
            `expected overlap; chunk0 tail "${tailWords}" not found in chunk1`
        );
    });

    test('TXT: chunks stay near the target size', async () => {
        const chunks = await parser.parseDocument(at('faq.txt'), 'txt', 'faq.txt');
        for (const c of chunks) {
            assert.ok(c.content.length >= parser.MIN_CHUNK_CHARS, 'chunk too small to be useful');
            // The sentence-boundary search only ever cuts EARLIER than the target.
            assert.ok(c.content.length <= parser.CHUNK_TARGET_CHARS + 50, 'chunk overshot the target size');
        }
    });

    test('chunkProse always terminates, even when a boundary lands early', () => {
        // Regression guard: advancing the cursor by (window - overlap) can move it
        // BACKWARDS when a sentence boundary is found early, which loops forever.
        const text = 'Short. ' + 'x'.repeat(3000);
        const chunks = parser.chunkProse([{ text, page: null }], 'loop.txt');
        assert.ok(chunks.length > 1);
        assert.ok(chunks.length < 200, 'chunk count suggests a runaway loop');
    });

    test('DOCX: text is extracted from a real OOXML package', async () => {
        const chunks = await parser.parseDocument(at('tours.docx'), 'docx', 'tours.docx');
        const all = chunks.map(c => c.content).join(' ');
        assert.match(all, /65000 rupees per person/);
        assert.match(all, /35 US dollars/);
    });

    test('PDF: text is extracted and tagged with its page number', async () => {
        const chunks = await parser.parseDocument(at('coaching.pdf'), 'pdf', 'coaching.pdf');
        const all = chunks.map(c => c.content).join(' ');
        assert.match(all, /85000 rupees/);
        assert.match(all, /scholarship test/i);
        assert.strictEqual(chunks[0].metadata.page, 1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('3. bad input fails with a message the tenant can act on', () => {

    test('an unreadable PDF is reported, not thrown as a raw library error', async () => {
        const fs = require('fs');
        const junk = at('not-really.pdf');
        fs.writeFileSync(junk, '%PDF-1.4\nthis is not a pdf body');
        await assert.rejects(
            () => parser.parseDocument(junk, 'pdf', 'not-really.pdf'),
            (err) => {
                assert.strictEqual(err.name, 'ParseError');
                // Must read as advice, not as a stack trace.
                assert.ok(err.message.length < 300);
                return true;
            }
        );
    });

    test('an empty text file is rejected rather than indexed as nothing', async () => {
        const fs = require('fs');
        const empty = at('empty.txt');
        fs.writeFileSync(empty, '   \n\n  ');
        await assert.rejects(() => parser.parseDocument(empty, 'txt', 'empty.txt'), /empty/i);
    });

    test('an unsupported type is refused', async () => {
        await assert.rejects(
            () => parser.parseDocument(at('cars.csv'), 'rtf', 'cars.csv'),
            /Unsupported file type/
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('4. row rendering', () => {

    test('empty cells are omitted rather than rendered as "Header: "', () => {
        const out = parser.renderRow(['Brand', 'Model', 'Note'], ['Tata', 'Nexon', '']);
        assert.strictEqual(out, 'Brand: Tata | Model: Nexon');
    });

    test('a value with no header still gets a positional label', () => {
        const out = parser.renderRow(['Brand'], ['Tata', 'orphan']);
        assert.match(out, /Column 2: orphan/);
    });

    test('cellText never returns "[object Object]" for any cell shape', () => {
        const shapes = [
            null, undefined, 42, 'plain', true,
            new Date('2026-01-02'),
            { richText: [{ text: 'a' }, { text: 'b' }] },
            { formula: 'A1', result: 7 },
            { text: 'link label', hyperlink: 'https://x.test' },
            { error: '#REF!' },
            {}
        ];
        for (const shape of shapes) {
            const out = parser.cellText(shape);
            assert.strictEqual(typeof out, 'string', `not a string for ${JSON.stringify(shape)}`);
            assert.ok(!out.includes('[object'), `leaked object for ${JSON.stringify(shape)}`);
        }
        assert.strictEqual(parser.cellText({ richText: [{ text: 'a' }, { text: 'b' }] }), 'ab');
        assert.strictEqual(parser.cellText({ formula: 'A1', result: 7 }), '7');
    });
});
