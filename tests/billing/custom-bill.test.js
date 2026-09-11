// Tests for the Custom Bill feature (2026-09-11).
//
// A custom bill is a hand-composed invoice: free-text service, an explicit validity
// window, an amount already received, a note and its own terms — and optionally a
// one-off customer who was never saved as an AgencyClient.
//
// That last part is the dangerous one. AgencyPayment.agencyClientId is null on such a
// bill, and `AgencyClient.findById(undefined)` does not return null — Mongoose drops
// the empty filter and returns the FIRST document in the collection. Left unguarded,
// a client-less bill would resolve to an unrelated client and be emailed to them.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const AgencyPayment = require(path.join(ROOT, 'src', 'models', 'AgencyPayment'));
const { buildInvoiceHtml } = require(path.join(ROOT, 'src', 'utils', 'invoiceHtmlBuilder'));
const { findClientById, resolveBillRecipient } = require(path.join(ROOT, 'src', 'utils', 'billRecipient'));

const baseCustomBill = () => ({
    isCustomBill: true,
    invoiceNumber: 'BILL-2026-09-0007',
    clientName: 'Ravi Traders',
    customServiceName: 'Website Maintenance + Hosting',
    serviceValidityFrom: new Date('2026-09-01'),
    serviceValidityTo: new Date('2027-08-31'),
    amount: 50000,
    receivedAmount: 20000,
    status: 'partial',
    billingMonth: 9,
    billingYear: 2026,
    invoiceDate: new Date('2026-08-15'),
    invoiceGeneratedDate: new Date('2026-09-11'),
    notes: 'Second installment due after Diwali.',
    termsAndConditions: '1. Payment due within 15 days.\n2. Services pause past 30 days.'
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the model must allow a client-less bill, but only a custom one
// ─────────────────────────────────────────────────────────────────────────────

test('a custom bill validates without an agencyClientId', () => {
    const err = new AgencyPayment(baseCustomBill()).validateSync();
    assert.ok(!err?.errors?.agencyClientId,
        'a one-off custom bill has no client row to point at');
});

test('a normal recurring payment still requires an agencyClientId', () => {
    const err = new AgencyPayment({
        amount: 15000, billingMonth: 9, billingYear: 2026
    }).validateSync();
    assert.ok(err?.errors?.agencyClientId,
        'the requirement must only be relaxed for custom bills, never dropped');
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the findById(undefined) footgun
// ─────────────────────────────────────────────────────────────────────────────

test('findClientById short-circuits on a missing id instead of querying', async () => {
    // No DB connection here on purpose: a query would hang or throw. Returning null
    // without touching Mongoose is exactly the behaviour being pinned.
    for (const empty of [undefined, null, '']) {
        assert.strictEqual(await findClientById(empty), null,
            `findClientById(${JSON.stringify(empty)}) must be null, never the first client row`);
    }
});

test('resolveBillRecipient falls back to the details typed on a custom bill', async () => {
    const recipient = await resolveBillRecipient({
        isCustomBill: true,
        agencyClientId: null,
        clientName: 'Ravi Traders',
        clientCompany: 'Ravi Traders Pvt Ltd',
        clientEmail: 'ravi@example.com',
        clientPhone: '919900000000',
        billingAddressSnapshot: 'Shop 4, MG Road',
        gstNumberSnapshot: '24ABCDE1234F1Z5'
    });

    assert.ok(recipient, 'a one-off customer must still be billable');
    assert.strictEqual(recipient.name, 'Ravi Traders');
    assert.strictEqual(recipient.email, 'ravi@example.com');
    assert.strictEqual(recipient.phone, '919900000000');
    assert.strictEqual(recipient.isOneOff, true, 'callers need to know there is no client row');
});

test('resolveBillRecipient returns null rather than guessing for a normal payment', async () => {
    assert.strictEqual(
        await resolveBillRecipient({ isCustomBill: false, agencyClientId: null }), null,
        'a non-custom payment with no client is a data problem, not a one-off bill'
    );
});

test('no caller looks an agency client up without the guard', () => {
    for (const file of ['src/controllers/agencyFinanceController.js', 'src/services/agencyBillingQueue.js']) {
        const src = read(file);
        assert.ok(
            !/AgencyClient\.findById\(\s*payment\.agencyClientId/.test(src),
            `${file} must go through findClientById/resolveBillRecipient — a raw ` +
            'findById(payment.agencyClientId) returns the first client when the id is null'
        );
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — what the bill actually prints
// ─────────────────────────────────────────────────────────────────────────────

test('the invoice prints the custom service name and validity window', () => {
    const html = buildInvoiceHtml(baseCustomBill(), {}, {});
    assert.ok(html.includes('Website Maintenance + Hosting'), 'free-text service name');
    assert.ok(html.includes('1 September 2026 — 31 August 2027'), 'service validity window');
    assert.ok(html.includes('Service Validity'), 'validity is called out in the summary strip');
});

test('the invoice honours the chosen bill date instead of stamping today', () => {
    const html = buildInvoiceHtml(baseCustomBill(), {}, {});
    assert.ok(html.includes('15 August 2026'), 'the invoiceDate stored on the bill must win');

    const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    assert.ok(
        !html.includes(`<label>Invoice Date</label><span>${today}`),
        'invoiceDate was hardcoded to new Date(), silently overriding the chosen date'
    );
});

test('the invoice shows payment received and the balance remaining', () => {
    const html = buildInvoiceHtml(baseCustomBill(), {}, {});
    assert.ok(html.includes('Payment Received'), 'received line');
    assert.ok(html.includes('20,000'), 'amount received');
    assert.ok(html.includes('Balance Due'), 'balance label');
    assert.ok(html.includes('30,000'), 'balance = 50000 - 20000');
});

test('the grand-total line is right in all three payment states', () => {
    // Regression: keying this off "is there a balance left" instead of "was anything
    // received" relabelled every ordinary UNPAID invoice as Balance Due, and made a
    // fully paid bill deduct the whole amount and then print it again as Total.
    const grand = (html) => {
        const i = html.lastIndexOf('total-row grand');
        return html.slice(i, i + 220).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    };
    const base = {
        invoiceNumber: 'B', clientName: 'X', customServiceName: 'Hosting',
        amount: 50000, billingMonth: 9, billingYear: 2026
    };

    const unpaid = buildInvoiceHtml({ ...base, status: 'pending' }, {}, {});
    assert.match(grand(unpaid), /Total ₹50,000\.00/,
        'nothing received: the final line is the Total, as it always was');
    assert.ok(!grand(unpaid).includes('Balance Due'),
        'an unpaid invoice must not be relabelled — this changed every existing invoice');

    const part = buildInvoiceHtml({ ...base, receivedAmount: 20000, status: 'partial' }, {}, {});
    assert.match(grand(part), /Balance Due ₹30,000\.00/);

    const paid = buildInvoiceHtml({ ...base, receivedAmount: 50000, status: 'received' }, {}, {});
    assert.match(grand(paid), /Balance Due ₹0\.00/,
        'fully paid settles to zero — it must not re-print the full amount as Total');
});

test('the balance comes from the numbers, not from the status string', () => {
    // A part-paid bill left on any status other than 'partial' used to print no
    // balance at all, because the template branched on status.
    const html = buildInvoiceHtml({ ...baseCustomBill(), status: 'pending' }, {}, {});
    assert.ok(html.includes('Balance Due') && html.includes('30,000'));
});

test('the invoice prints the note and the terms', () => {
    const html = buildInvoiceHtml(baseCustomBill(), {}, {});
    assert.ok(html.includes('Second installment due after Diwali.'), 'note body');
    assert.ok(html.includes('Terms &amp; Conditions'), 'terms heading');
    assert.ok(html.includes('Payment due within 15 days.'), 'terms body');
    assert.ok(html.includes('within 15 days.<br/>2. Services pause'), 'newlines survive as <br/>');
});

test('an ordinary payment never prints its internal notes on the invoice', () => {
    // AgencyPayment.notes predates custom bills as an ADMIN-ONLY field — the client
    // form labels it "Internal notes…" and no invoice or billing email has ever shown
    // it. Rendering it for every payment would publish years of internal remarks to
    // customers, including through the public HMAC invoice link.
    const secret = 'slow payer, chase hard';
    const base = {
        invoiceNumber: 'X', clientName: 'C', amount: 1000,
        billingMonth: 9, billingYear: 2026, notes: secret
    };

    const retainer = buildInvoiceHtml({ ...base, clientServiceType: 'seo' }, {}, {});
    assert.ok(!retainer.includes(secret),
        'internal notes must never reach a recurring invoice');
    // The rendered block, not the class name — `.notes-box { … }` lives in the
    // stylesheet of every invoice whether or not a note is printed.
    assert.ok(!retainer.includes('<div class="notes-box">'),
        'no note block at all on a non-custom bill');

    const custom = buildInvoiceHtml({ ...base, isCustomBill: true, customServiceName: 'Hosting' }, {}, {});
    assert.ok(custom.includes(secret),
        'a custom bill note is typed into a box that says it goes on the bill');
});

test('terms and notes are HTML-escaped', () => {
    const html = buildInvoiceHtml({
        ...baseCustomBill(),
        notes: '<script>alert(1)</script>',
        termsAndConditions: '<img src=x onerror=alert(1)>'
    }, {}, {});
    assert.ok(!html.includes('<script>alert(1)</script>'), 'note must not inject markup');
    assert.ok(!html.includes('<img src=x'), 'terms must not inject markup');
});

test('a plain recurring retainer still renders exactly as before', () => {
    const html = buildInvoiceHtml({
        invoiceNumber: 'INV-2026-09-0001', clientName: 'Old Client',
        clientServiceType: 'seo', amount: 15000, status: 'pending',
        billingMonth: 9, billingYear: 2026
    }, {}, {});

    assert.ok(html.includes('SEO Services'), 'fixed service label still resolves');
    assert.ok(html.includes('September 2026'), 'billing month is still the period');
    assert.ok(!html.includes('Payment Received'), 'an unpaid bill shows no received line');
    assert.ok(!html.includes('Service Validity'), 'no validity cell when there is no validity');
    assert.ok(!html.includes('Terms &amp; Conditions'), 'no empty terms block');
});

// ─────────────────────────────────────────────────────────────────────────────
// 4 — the two copies of the invoice template must not drift
// ─────────────────────────────────────────────────────────────────────────────

test('the client-side print template carries the same custom-bill fields', () => {
    // src/utils/invoiceHtmlBuilder.js (emails + public link) and the printInvoice
    // copy inside AgencyFinanceView.jsx (the Download button) are parallel templates.
    // They already drifted once — both had the hardcoded invoice date.
    const client = read('client/src/components/SuperAdmin/AgencyFinanceView.jsx');

    for (const token of [
        'payment.customServiceName',
        'payment.serviceValidityFrom',
        'payment.termsAndConditions',
        'payment.invoiceDate',
        'Payment Received'
    ]) {
        assert.ok(
            client.includes(token),
            `printInvoice in AgencyFinanceView.jsx is missing "${token}" — the downloaded ` +
            'PDF would not match the emailed invoice'
        );
    }

    assert.ok(
        !/const invoiceDate = new Date\(\);/.test(client),
        'the client copy must not re-hardcode the invoice date'
    );
});

test('a custom bill for a one-off customer can still be edited', () => {
    // PaymentModal requires a client, both in its submit guard and as a required
    // <select>. A one-off custom bill has no agencyClientId, so both blocked it —
    // the bill could be deleted but never corrected.
    const src = read('client/src/components/SuperAdmin/AgencyFinanceView.jsx');
    const start = src.indexOf('const PaymentModal');
    assert.notStrictEqual(start, -1, 'PaymentModal not found — was it renamed?');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.match(body, /const isOneOffBill = /,
        'PaymentModal must recognise a client-less custom bill');
    assert.match(body, /if \(!isOneOffBill && !form\.agencyClientId\)/,
        'the submit guard must not demand a client for a one-off bill');
    assert.match(body, /isOneOffBill \? 'Customer' : 'Client \*'/,
        'the required client picker must be swapped for the stored customer name');
});

// ─────────────────────────────────────────────────────────────────────────────
// 5 — the endpoints exist and are superadmin-only
// ─────────────────────────────────────────────────────────────────────────────

test('custom bill routes are mounted behind requireSuperAdmin', () => {
    const routes = read('src/routes/superAdminRoutes.js');
    for (const p of ['/agency-finance/custom-bill', '/agency-finance/bill-defaults']) {
        const line = routes.split('\n').find(l => l.includes(p));
        assert.ok(line, `route ${p} is not mounted`);
        assert.ok(line.includes('requireSuperAdmin'), `route ${p} must be superadmin-only`);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6 — the Joi schema must not silently eat the form
// ─────────────────────────────────────────────────────────────────────────────

const { schemas } = require(path.join(ROOT, 'src', 'middleware', 'validateRequest'));

// validate() runs with stripUnknown, so any field the schema forgets to declare is
// deleted before the controller sees it — producing a blank bill, not a 400. This
// payload is exactly what CustomBillModal posts.
const formPayload = () => ({
    agencyClientId: '',
    clientName: 'Ravi Traders', clientCompany: '', clientEmail: '', clientPhone: '',
    billingAddress: '', gstNumber: '',
    serviceName: 'Website Maintenance + Hosting',
    serviceValidityFrom: '2026-09-01', serviceValidityTo: '2027-08-31',
    amount: '50000', receivedAmount: '20000',
    billDate: '2026-08-15', generatedDate: '2026-09-11', dueDate: '',
    paymentMethod: 'bank_transfer', reference: '',
    notes: 'Second installment after Diwali.',
    termsAndConditions: '1. Due in 15 days.',
    saveTermsAsDefault: true
});

const runSchema = (schema, payload) => schema.validate(payload, {
    abortEarly: false, stripUnknown: true, allowUnknown: false
});

test('the custom-bill schema keeps every field the form sends', () => {
    const payload = formPayload();
    const { error, value } = runSchema(schemas.createCustomBill, payload);

    assert.ok(!error, error && error.details.map(d => d.message).join('; '));
    assert.deepStrictEqual(
        Object.keys(payload).filter(k => !(k in value)), [],
        'stripUnknown deleted a field the controller reads — the bill would come out blank'
    );
});

test('the schema accepts saved-client mode too', () => {
    const { error } = runSchema(schemas.createCustomBill, {
        ...formPayload(),
        agencyClientId: '507f1f77bcf86cd799439011',
        clientName: '', clientCompany: '', clientEmail: '', clientPhone: '',
        billingAddress: '', gstNumber: ''
    });
    assert.ok(!error, error && error.details.map(d => d.message).join('; '));
});

test('the schema rejects bills that cannot be billed', () => {
    const bad = {
        'missing service name': { serviceName: '' },
        'zero amount':          { amount: '0' },
        'negative amount':      { amount: '-5' },
        'bad email':            { clientEmail: 'not-an-email' },
        'unknown payment method': { paymentMethod: 'bitcoin' },
        'negative received':    { receivedAmount: '-1' }
    };
    for (const [label, patch] of Object.entries(bad)) {
        const { error } = runSchema(schemas.createCustomBill, { ...formPayload(), ...patch });
        assert.ok(error, `${label} should have been rejected`);
    }
});

test('clearing the default terms is allowed', () => {
    const { error } = runSchema(schemas.saveBillDefaults, { termsAndConditions: '' });
    assert.ok(!error, 'an empty string means "no default terms", not a validation failure');
});

// ─────────────────────────────────────────────────────────────────────────────
// 7 — a custom bill must not be mistaken for the monthly retainer invoice
// ─────────────────────────────────────────────────────────────────────────────

test('the duplicate-invoice guard ignores custom bills', () => {
    // Otherwise raising one ad-hoc bill for a client in September makes that
    // client's September retainer invoice un-creatable: a 409 with no way round it.
    const src = read('src/controllers/agencyFinanceController.js');
    const start = src.indexOf('const existingBill = await AgencyPayment.exists(');
    assert.notStrictEqual(start, -1, 'the duplicate guard is gone — was it renamed?');
    const query = src.slice(start, src.indexOf('});', start));

    assert.match(query, /isCustomBill:\s*\{\s*\$ne:\s*true\s*\}/,
        'createPayment must only count recurring invoices when checking for duplicates');
});

test('the monthly auto-biller ignores custom bills', () => {
    // This one is worse than a 409: the cron simply skips the client, so the real
    // monthly invoice is never generated and nothing anywhere reports an error.
    const src = read('src/services/cronJobs.js');
    const start = src.indexOf('const exists = await AgencyPayment.exists(');
    assert.notStrictEqual(start, -1, 'the auto-bill guard is gone — was it renamed?');
    const query = src.slice(start, src.indexOf('});', start));

    assert.match(query, /isCustomBill:\s*\{\s*\$ne:\s*true\s*\}/,
        'a custom bill must never suppress the auto-generated retainer invoice');
});

test('the billing period comes from the UTC date parts', () => {
    // Joi turns a bare YYYY-MM-DD into UTC midnight. Reading it with local getters
    // returns the previous calendar day on any server west of UTC, filing a bill
    // dated the 1st under the previous month.
    const { value } = runSchema(schemas.createCustomBill, {
        serviceName: 'X', amount: '100', billDate: '2026-09-01'
    });
    assert.ok(value.billDate instanceof Date);
    assert.strictEqual(value.billDate.toISOString(), '2026-09-01T00:00:00.000Z',
        'precondition: a date-only input arrives as UTC midnight');
    assert.strictEqual(value.billDate.getUTCMonth() + 1, 9);

    const src = read('src/controllers/agencyFinanceController.js');
    const start = src.indexOf('exports.createCustomBill');
    const body = src.slice(start, src.indexOf('\n};', start));
    assert.match(body, /billDateFinal\.getUTCMonth\(\)/,
        'billingMonth must use the UTC date parts, not the server-local ones');
    assert.match(body, /billDateFinal\.getUTCFullYear\(\)/,
        'billingYear must use the UTC date parts, not the server-local ones');
});

test('createCustomBill derives status from the money and never trusts the body', () => {
    const src = read('src/controllers/agencyFinanceController.js');
    const start = src.indexOf('exports.createCustomBill');
    assert.notStrictEqual(start, -1, 'createCustomBill not found — was it renamed?');
    const body = src.slice(start, src.indexOf('\n};', start));

    assert.ok(
        /const status = received >= total \? 'received' : received > 0 \? 'partial' : 'pending';/.test(body),
        'status must be derived, so the bill and the invoice can never disagree'
    );
    assert.ok(
        /received > total/.test(body),
        'a received amount larger than the total must be rejected'
    );
    assert.ok(
        !/status\s*:\s*status\s*\|\|\s*req\.body/.test(body),
        'status must never come from the request body'
    );
});
