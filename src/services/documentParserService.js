// ─────────────────────────────────────────────────────────────────────────────
// documentParserService.js — uploaded file  →  retrievable text chunks.
// ─────────────────────────────────────────────────────────────────────────────
// Pure text processing: no database, no network, no billing. Everything here is
// synchronous-in-spirit and unit-testable from a fixture file, which is why it is
// split out of knowledgeBaseService.
//
// TWO CHUNKING STRATEGIES, because the two kinds of source behave differently:
//
//   TABULAR (.csv, .xlsx) — ONE ROW = ONE CHUNK, rendered as
//       "Brand: Hyundai | Model: Creta | Variant: SX(O) | Price: 18.2L"
//     Row-per-chunk is what makes "what does a Creta SX cost?" retrievable: the
//     row is a self-contained fact. Column headers are repeated into every chunk
//     on purpose — without them the embedding of "Hyundai | Creta | 18.2L" has no
//     idea 18.2L is a PRICE, and the retrieved text handed to the AI would be
//     equally ambiguous.
//
//   PROSE (.pdf, .docx, .txt) — ~500-char windows with ~100 chars of OVERLAP.
//     The overlap exists so a fact that straddles a boundary ("...the warranty
//     period is" / "5 years from purchase") survives in at least one whole chunk.
//     Windows are cut at sentence boundaries where possible so a chunk does not
//     start mid-word.
//
// PARSER SUPPORT (deliberately narrow)
//   exceljs reads OOXML .xlsx only, mammoth reads .docx only. The legacy OLE2
//   .xls/.doc formats are NOT parseable here and are rejected before upload.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const Papa = require('papaparse');

// Target size of a prose chunk, and how much of the previous chunk is repeated
// at the start of the next. ~500 chars ≈ 125 tokens: large enough to hold a
// complete thought, small enough that injecting 5 of them costs ~625 tokens.
const CHUNK_TARGET_CHARS = 500;
const CHUNK_OVERLAP_CHARS = 100;

// A chunk shorter than this carries no retrievable meaning (a stray "Page 3",
// an empty spreadsheet row) and is dropped rather than embedded — every chunk
// costs credits and dilutes the similarity ranking.
const MIN_CHUNK_CHARS = 25;

// Hard ceiling on chunks from ONE document, independent of plan limits. Guards
// against a pathological 500k-row spreadsheet exhausting memory during parse.
const MAX_CHUNKS_PER_DOCUMENT = 20000;

// Matches KnowledgeChunk.content's maxlength; a single spreadsheet row wider
// than this is truncated rather than failing the whole document.
const MAX_CHUNK_CHARS = 4000;

class ParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ParseError';
    }
}

const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Render one spreadsheet row as a self-describing "Header: value" chunk. */
function renderRow(headers, values) {
    const parts = [];
    for (let i = 0; i < values.length; i++) {
        const value = norm(values[i]);
        if (!value) continue;                        // skip empty cells entirely
        const header = norm(headers[i]) || `Column ${i + 1}`;
        parts.push(`${header}: ${value}`);
    }
    const text = parts.join(' | ');
    return text.length > MAX_CHUNK_CHARS ? text.slice(0, MAX_CHUNK_CHARS) : text;
}

// ── Tabular ─────────────────────────────────────────────────────────────────
async function parseCsv(filePath, sourceName) {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    // Papa handles quoted fields, embedded newlines and delimiter sniffing.
    const result = Papa.parse(raw.trim(), { skipEmptyLines: 'greedy' });

    if (result.errors?.length) {
        // Row-level errors are common in real exports (a ragged trailing row) and
        // must not fail the upload; only a total failure to produce rows does.
        const fatal = result.errors.filter(e => e.type === 'Delimiter');
        if (fatal.length && !result.data?.length) {
            throw new ParseError(`Could not read this CSV: ${fatal[0].message}`);
        }
    }

    const rows = result.data || [];
    if (rows.length < 2) {
        throw new ParseError('This CSV needs a header row plus at least one data row.');
    }

    const headers = rows[0].map(norm);
    const chunks = [];
    for (let i = 1; i < rows.length && chunks.length < MAX_CHUNKS_PER_DOCUMENT; i++) {
        const content = renderRow(headers, rows[i]);
        if (content.length < MIN_CHUNK_CHARS) continue;
        chunks.push({
            content,
            // +1 so `row` is the 1-based line number the tenant sees in Excel.
            metadata: { source: sourceName, sheet: null, row: i + 1, page: null }
        });
    }
    return chunks;
}

async function parseXlsx(filePath, sourceName) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();

    try {
        await workbook.xlsx.readFile(filePath);
    } catch (err) {
        throw new ParseError(
            `Could not read this Excel file: ${err.message}. ` +
            'If it was saved in the older .xls format, re-save it as .xlsx or CSV.'
        );
    }

    const chunks = [];
    for (const sheet of workbook.worksheets) {
        if (chunks.length >= MAX_CHUNKS_PER_DOCUMENT) break;

        // exceljs rows are 1-based and sparse; actualRowCount ignores blank rows
        // but rowCount is the real upper bound for iteration.
        let headers = [];
        let headerSeen = false;

        for (let r = 1; r <= sheet.rowCount; r++) {
            if (chunks.length >= MAX_CHUNKS_PER_DOCUMENT) break;

            const row = sheet.getRow(r);
            // `values` is 1-based with a leading hole — drop it so the array
            // lines up with the header array index-for-index.
            const values = (row.values || []).slice(1).map(cellText);

            if (!values.some(v => norm(v))) continue;   // wholly blank row

            if (!headerSeen) {
                headers = values.map(norm);
                headerSeen = true;
                continue;
            }

            const content = renderRow(headers, values);
            if (content.length < MIN_CHUNK_CHARS) continue;
            chunks.push({
                content,
                metadata: { source: sourceName, sheet: sheet.name, row: r, page: null }
            });
        }
    }

    if (!chunks.length) {
        throw new ParseError('No data rows found. The sheet needs a header row plus at least one data row.');
    }
    return chunks;
}

/**
 * Flatten one exceljs cell value to text.
 * Cells are not always primitives: dates, hyperlinks, formulas and rich text all
 * arrive as objects, and String()-ing them yields "[object Object]" — which would
 * be embedded verbatim and pollute retrieval.
 */
function cellText(value) {
    if (value == null) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value !== 'object') return String(value);

    if (typeof value.text === 'string') return value.text;                 // hyperlink
    if (Array.isArray(value.richText)) return value.richText.map(t => t.text).join('');
    // Formula cell: the cached result is what a reader sees.
    if ('result' in value) return cellText(value.result);
    if ('hyperlink' in value) return String(value.hyperlink);
    if ('error' in value) return '';                                        // #REF!, #N/A
    return '';
}

// ── Prose ───────────────────────────────────────────────────────────────────
async function parseTxt(filePath) {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    if (!norm(raw)) throw new ParseError('This text file is empty.');
    return [{ text: raw, page: null }];
}

async function parseDocx(filePath) {
    const mammoth = require('mammoth');
    let result;
    try {
        result = await mammoth.extractRawText({ path: filePath });
    } catch (err) {
        throw new ParseError(
            `Could not read this Word file: ${err.message}. ` +
            'If it was saved in the older .doc format, re-save it as .docx.'
        );
    }
    if (!norm(result?.value)) {
        throw new ParseError('No text found in this document. Scanned images cannot be read.');
    }
    return [{ text: result.value, page: null }];
}

/**
 * A pdfjs "factory URL" for one of its bundled asset directories.
 * Must be a real URL ending in "/" — see the call site.
 */
function assetUrl(root, dir) {
    return pathToFileURL(path.join(root, dir)).href + '/';
}

async function parsePdf(filePath) {
    // pdfjs-dist v6 ships ESM only, so a CommonJS caller must import() it.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

    const data = new Uint8Array(await fs.promises.readFile(filePath));

    // getDocument() returns the LOADING TASK; the resolved document proxy has no
    // destroy() of its own in v6 (only cleanup()), so the task is what must be
    // kept around and torn down.
    const loadingTask = pdfjs.getDocument({
        data,
        // No worker thread: this already runs inside a background job, and a
        // worker would need a separate bundled file at a resolvable path.
        disableWorker: true,
        // Font/canvas machinery is useless for text extraction and pulls in
        // browser-only paths under Node.
        disableFontFace: true,
        isEvalSupported: false,
        // Without these two, pdfjs logs a warning per document about missing
        // standard font data, and CJK/symbol text extracts as blanks. They must
        // be file:// URLs with a TRAILING SLASH — pdfjs rejects a bare path, and
        // a Windows path.sep backslash fails its endsWith('/') check outright.
        standardFontDataUrl: assetUrl(pdfjsRoot, 'standard_fonts'),
        cMapUrl: assetUrl(pdfjsRoot, 'cmaps'),
        cMapPacked: true,
        verbosity: 0   // errors only — a malformed PDF is reported via ParseError
    });

    let doc;
    try {
        doc = await loadingTask.promise;
    } catch (err) {
        const message = /password/i.test(err.message)
            ? 'This PDF is password-protected. Remove the password and upload it again.'
            : `Could not read this PDF: ${err.message}`;
        throw new ParseError(message);
    }

    const pages = [];
    try {
        for (let p = 1; p <= doc.numPages; p++) {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            // PDF text arrives as positioned fragments with no spaces between
            // them; join on a space and let the normaliser collapse the excess.
            const text = content.items.map(i => (typeof i.str === 'string' ? i.str : '')).join(' ');
            if (norm(text)) pages.push({ text, page: p });
            page.cleanup();
        }
    } finally {
        // Frees the parsed document's buffers; without it a large PDF stays
        // resident for the life of the process.
        await loadingTask.destroy();
    }

    if (!pages.length) {
        throw new ParseError(
            'No selectable text found in this PDF. Scanned or image-only PDFs need OCR before upload.'
        );
    }
    return pages;
}

/**
 * Slice prose into overlapping windows, preferring sentence boundaries.
 * Each input section keeps its own page number so a retrieved chunk can be
 * traced back to "page 7".
 */
function chunkProse(sections, sourceName) {
    const chunks = [];

    for (const section of sections) {
        const text = norm(section.text);
        if (text.length < MIN_CHUNK_CHARS) continue;

        let cursor = 0;
        while (cursor < text.length && chunks.length < MAX_CHUNKS_PER_DOCUMENT) {
            let end = Math.min(cursor + CHUNK_TARGET_CHARS, text.length);

            // Prefer to cut after a sentence ending in the last quarter of the
            // window, so chunks read as whole thoughts rather than fragments.
            if (end < text.length) {
                const tail = text.slice(cursor, end);
                const lastStop = Math.max(
                    tail.lastIndexOf('. '), tail.lastIndexOf('? '),
                    tail.lastIndexOf('! '), tail.lastIndexOf('\n')
                );
                if (lastStop > CHUNK_TARGET_CHARS * 0.6) end = cursor + lastStop + 1;
            }

            const content = text.slice(cursor, end).trim();
            if (content.length >= MIN_CHUNK_CHARS) {
                chunks.push({
                    content,
                    metadata: { source: sourceName, sheet: null, row: null, page: section.page }
                });
            }

            if (end >= text.length) break;
            // Step forward by the window minus the overlap. Math.max guarantees
            // forward progress even if a sentence boundary landed early, which
            // would otherwise loop forever on the same window.
            cursor = Math.max(cursor + 1, end - CHUNK_OVERLAP_CHARS);
        }
    }

    return chunks;
}

/**
 * Parse an uploaded file into embeddable chunks.
 *
 * @param {string} filePath   local path to the staged file
 * @param {string} fileType   one of csv | xlsx | pdf | docx | txt
 * @param {string} sourceName original filename, recorded on every chunk
 * @returns {Promise<Array<{content:string, metadata:object}>>}
 * @throws  {ParseError} with a message written for the tenant, not the log
 */
async function parseDocument(filePath, fileType, sourceName) {
    let chunks;

    switch (fileType) {
        case 'csv':
            chunks = await parseCsv(filePath, sourceName);
            break;
        case 'xlsx':
            chunks = await parseXlsx(filePath, sourceName);
            break;
        case 'txt':
            chunks = chunkProse(await parseTxt(filePath), sourceName);
            break;
        case 'docx':
            chunks = chunkProse(await parseDocx(filePath), sourceName);
            break;
        case 'pdf':
            chunks = chunkProse(await parsePdf(filePath), sourceName);
            break;
        default:
            throw new ParseError(`Unsupported file type: ${fileType}`);
    }

    if (!chunks.length) {
        throw new ParseError('No readable content was found in this file.');
    }
    return chunks;
}

module.exports = {
    parseDocument,
    chunkProse,
    ParseError,
    CHUNK_TARGET_CHARS,
    CHUNK_OVERLAP_CHARS,
    MIN_CHUNK_CHARS,
    MAX_CHUNKS_PER_DOCUMENT,
    // exported for tests
    renderRow,
    cellText
};
