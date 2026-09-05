// Builds one real file of each supported type into a temp directory.
//
// The parsers are thin wrappers over exceljs / mammoth / pdfjs, so asserting
// against hand-written strings would only test the wrapper. These fixtures are
// genuine .xlsx / .docx / .pdf containers, which is the only way to catch the
// things that actually break: a cell object stringifying to "[object Object]",
// a pdfjs API that moved, an OOXML package the library will not open.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CSV = [
    'Brand,Model,Variant,Price,Offer',
    'Hyundai,Creta,EX Petrol Manual,11.0L,None',
    'Hyundai,Creta,SX(O) Turbo DCT,18.2L,50K exchange bonus',
    'Tata,Nexon,XZ+ Diesel,14.5L,"Free insurance, 3yr warranty"',
    '',                                        // blank line — must be skipped
    'Maruti,Baleno,Alpha CVT,12.1L,None',
    ''
].join('\n');

const TXT =
    'Our clinic is open Monday to Saturday from 9am to 7pm. ' +
    'We are closed on Sundays and national holidays. ' +
    'A general consultation costs 800 rupees and takes about 20 minutes. ' +
    'Specialist consultations start at 1500 rupees depending on the department. ' +
    'The warranty period on all dental implants is 5 years from the date of the procedure. ' +
    'We accept cash, UPI, and all major credit cards. Insurance claims are processed within 14 days. ' +
    'Parking is available in the basement at no charge for patients. ' +
    'Please arrive fifteen minutes before your appointment time to complete registration.';

async function build() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-fixtures-'));
    const at = (name) => path.join(dir, name);

    fs.writeFileSync(at('cars.csv'), CSV);
    fs.writeFileSync(at('faq.txt'), TXT);

    // ── XLSX: exercises blank rows, dates, rich text and formula cells ──────
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventory');
    ws.addRow(['Property', 'Type', 'Area', 'Price', 'Available From']);
    ws.addRow(['Sunrise Tower', '3BHK', '1200 sq ft', '2.5 Cr', new Date('2026-03-15')]);
    ws.addRow([]);
    ws.addRow(['Green Villas', '3BHK', '1050 sq ft', '1.8 Cr', new Date('2026-04-01')]);
    const rich = ws.addRow(['placeholder', '2BHK', '900 sq ft', '1.2 Cr', 'Immediate']);
    rich.getCell(1).value = { richText: [{ text: 'Ocean ' }, { text: 'View' }] };
    ws.addRow(['Hill Crest', '4BHK', '2000 sq ft', { formula: 'A1', result: '3.9 Cr' }, 'Immediate']);
    await wb.xlsx.writeFile(at('properties.xlsx'));

    // ── DOCX: a minimal but valid OOXML package ─────────────────────────────
    const JSZip = require('jszip');
    const zip = new JSZip();
    zip.file('[Content_Types].xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>');
    zip.folder('_rels').file('.rels',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>');
    const para = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
    zip.folder('word').file('document.xml',
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        para('Tour Package Terms and Conditions') +
        para('The Bali 5 night package is priced at 65000 rupees per person on twin sharing basis. It includes return airfare, airport transfers and daily breakfast.') +
        para('Visa on arrival is available for Indian passport holders and costs 35 US dollars. The passport must have at least six months validity remaining.') +
        para('Cancellation within 15 days of departure attracts a 50 percent charge. Cancellation within 7 days is non refundable under all circumstances.') +
        '</w:body></w:document>');
    fs.writeFileSync(at('tours.docx'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

    // ── PDF: hand-assembled with correct xref byte offsets ──────────────────
    const lines = [
        'JEE Main one year program fee is 85000 rupees payable in two instalments.',
        'JEE Main plus Advanced two year program fee is 120000 rupees.',
        'A scholarship test is held on 15th March offering up to 50 percent fee waiver.',
        'Batch size is capped at 30 students. Classes run Monday to Friday 4pm to 8pm.'
    ];
    const stream = 'BT /F1 11 Tf 50 750 Td 16 TL\n' +
        lines.map(l => `(${l.replace(/([()\\])/g, '\\$1')}) Tj T*`).join('\n') + '\nET';
    const objs = [
        '<</Type/Catalog/Pages 2 0 R>>',
        '<</Type/Pages/Kids[3 0 R]/Count 1>>',
        '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
        `<</Length ${Buffer.byteLength(stream)}>>\nstream\n${stream}\nendstream`,
        '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((body, i) => {
        offsets.push(Buffer.byteLength(pdf));
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefAt = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach(o => { pdf += String(o).padStart(10, '0') + ' 00000 n \n'; });
    pdf += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefAt}\n%%EOF\n`;
    fs.writeFileSync(at('coaching.pdf'), Buffer.from(pdf, 'latin1'));

    return { dir, at };
}

function cleanup(dir) {
    fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { build, cleanup };
