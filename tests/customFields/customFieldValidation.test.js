const test = require('node:test');
const assert = require('node:assert');

const {
    normalizeOptions,
    coerceOptionValue,
    validateCustomData,
    coerceCustomData,
    validateFieldDefinition,
    toPlainObject
} = require('../../src/utils/customFieldValidation');

const DEFS = [
    { key: 'budget', label: 'Budget', type: 'dropdown', options: ['Under 50k', '50k-1 Lakh', 'Above 1 Lakh'], required: false },
    { key: 'services', label: 'Services', type: 'multiselect', options: ['SEO', 'Ads', 'Email'], required: false },
    { key: 'city', label: 'City', type: 'text', required: false }
];

// ── normalizeOptions ────────────────────────────────────────────────────────
test('normalizeOptions trims, drops blanks and dedupes case-insensitively', () => {
    assert.deepStrictEqual(
        normalizeOptions(['  SEO ', 'seo', '', null, 'Ads']),
        ['SEO', 'Ads']
    );
});

test('normalizeOptions caps the list at 100 entries', () => {
    const many = Array.from({ length: 150 }, (_, i) => `opt${i}`);
    assert.strictEqual(normalizeOptions(many).length, 100);
});

// ── coerceOptionValue ───────────────────────────────────────────────────────
test('coerceOptionValue matches exactly, then case/punctuation-insensitively', () => {
    const options = ['50k-1 Lakh', 'SEO'];
    assert.deepStrictEqual(coerceOptionValue('50k-1 Lakh', options), { matched: true, value: '50k-1 Lakh' });
    assert.deepStrictEqual(coerceOptionValue('  seo ', options), { matched: true, value: 'SEO' });
    // A Meta answer spelled differently still lands on the canonical option
    assert.deepStrictEqual(coerceOptionValue('50k 1 lakh', options), { matched: true, value: '50k-1 Lakh' });
});

test('coerceOptionValue reports no match rather than inventing one', () => {
    assert.deepStrictEqual(coerceOptionValue('Crypto', ['SEO']), { matched: false, value: 'Crypto' });
});

// ── validateCustomData: strict mode ─────────────────────────────────────────
test('strict mode accepts a valid dropdown value and canonicalises casing', () => {
    const res = validateCustomData({ budget: 'under 50k' }, DEFS);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleaned.budget, 'Under 50k');
});

test('strict mode rejects a dropdown value outside the option list', () => {
    const res = validateCustomData({ budget: 'A trillion' }, DEFS);
    assert.strictEqual(res.valid, false);
    assert.match(res.errors[0], /not a valid option for "Budget"/);
});

test('strict mode accepts multiselect arrays and dedupes them', () => {
    const res = validateCustomData({ services: ['SEO', 'ads', 'SEO'] }, DEFS);
    assert.strictEqual(res.valid, true);
    assert.deepStrictEqual(res.cleaned.services, ['SEO', 'Ads']);
});

test('strict mode parses a comma string into a multiselect array', () => {
    const res = validateCustomData({ services: 'SEO, Email' }, DEFS);
    assert.strictEqual(res.valid, true);
    assert.deepStrictEqual(res.cleaned.services, ['SEO', 'Email']);
});

test('strict mode enforces required fields', () => {
    const defs = [{ key: 'budget', label: 'Budget', type: 'dropdown', options: ['A'], required: true }];
    const res = validateCustomData({}, defs);
    assert.strictEqual(res.valid, false);
    assert.match(res.errors[0], /"Budget" is required/);
});

test('a required multiselect needs at least one selection', () => {
    const defs = [{ key: 's', label: 'Services', type: 'multiselect', options: ['SEO'], required: true }];
    const res = validateCustomData({ s: [] }, defs);
    assert.strictEqual(res.valid, false);
    assert.match(res.errors[0], /at least one selection/);
});

// This is the trap that makes "edit an option list" safe: an admin removes an
// option, and every lead still holding it must remain editable.
test('an UNCHANGED legacy value survives after its option was removed', () => {
    const res = validateCustomData(
        { budget: 'Retired Tier' },
        DEFS,
        { existingData: { budget: 'Retired Tier' }, partial: true }
    );
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleaned.budget, 'Retired Tier');
});

test('a CHANGED value is still rejected even when a legacy value exists', () => {
    const res = validateCustomData(
        { budget: 'Something Else' },
        DEFS,
        { existingData: { budget: 'Retired Tier' }, partial: true }
    );
    assert.strictEqual(res.valid, false);
});

test('partial mode carries over fields the client did not send', () => {
    const res = validateCustomData(
        { city: 'Delhi' },
        DEFS,
        { existingData: { budget: 'Under 50k', services: ['SEO'] }, partial: true }
    );
    assert.strictEqual(res.valid, true);
    // Editing City must not wipe Budget/Services — callers replace customData wholesale.
    assert.strictEqual(res.cleaned.budget, 'Under 50k');
    assert.deepStrictEqual(res.cleaned.services, ['SEO']);
    assert.strictEqual(res.cleaned.city, 'Delhi');
});

test('partial mode reads a Mongoose Map as existing data', () => {
    const existing = new Map([['budget', 'Under 50k']]);
    const res = validateCustomData({ city: 'Pune' }, DEFS, { existingData: existing, partial: true });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleaned.budget, 'Under 50k');
});

test('undefined keys (raw Meta answers) are preserved, not dropped', () => {
    const res = validateCustomData({ city: 'Delhi', how_did_you_hear: 'Instagram' }, DEFS);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.cleaned.how_did_you_hear, 'Instagram');
});

test('customData that is not an object is rejected', () => {
    assert.strictEqual(validateCustomData([1, 2], DEFS).valid, false);
});

// ── coerceCustomData: sync mode ─────────────────────────────────────────────
test('coerce mode snaps a near-miss onto the canonical option', () => {
    const { cleaned, unmapped } = coerceCustomData({ budget: 'under 50K' }, DEFS);
    assert.strictEqual(cleaned.budget, 'Under 50k');
    assert.strictEqual(unmapped.length, 0);
});

test('coerce mode KEEPS an unmatched value and flags it — never drops it', () => {
    const { cleaned, unmapped } = coerceCustomData({ budget: 'Ten Rupees' }, DEFS);
    assert.strictEqual(cleaned.budget, 'Ten Rupees');
    assert.deepStrictEqual(unmapped, [{ key: 'budget', label: 'Budget', value: 'Ten Rupees' }]);
});

test('coerce mode never throws on junk input', () => {
    assert.doesNotThrow(() => coerceCustomData(null, DEFS));
    assert.doesNotThrow(() => coerceCustomData({ services: 42 }, DEFS));
    assert.deepStrictEqual(coerceCustomData('nope', DEFS), { cleaned: {}, unmapped: [] });
});

test('coerce mode splits a multiselect CSV cell and flags only the bad parts', () => {
    const { cleaned, unmapped } = coerceCustomData({ services: 'seo, Crypto' }, DEFS);
    assert.deepStrictEqual(cleaned.services, ['SEO', 'Crypto']);
    assert.strictEqual(unmapped.length, 1);
    assert.strictEqual(unmapped[0].value, 'Crypto');
});

// ── validateFieldDefinition ─────────────────────────────────────────────────
test('a dropdown definition with no options is rejected', () => {
    const res = validateFieldDefinition({ label: 'Budget', type: 'dropdown', options: [] }, { key: 'budget', order: 0 });
    assert.strictEqual(res.valid, false);
    assert.match(res.error, /needs at least one option/);
});

test('a multiselect definition with no options is rejected', () => {
    const res = validateFieldDefinition({ label: 'Services', type: 'multiselect', options: ['  '] }, { key: 's', order: 0 });
    assert.strictEqual(res.valid, false);
});

test('a non-option field ignores any options passed to it', () => {
    const res = validateFieldDefinition({ label: 'City', type: 'text', options: ['X'] }, { key: 'city', order: 2 });
    assert.strictEqual(res.valid, true);
    assert.deepStrictEqual(res.field.options, []);
    assert.strictEqual(res.field.order, 2);
});

test('an unknown type falls back to text rather than being stored', () => {
    const res = validateFieldDefinition({ label: 'X', type: 'hacker' }, { key: 'x', order: 0 });
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.field.type, 'text');
});

test('a blank label is rejected', () => {
    assert.strictEqual(validateFieldDefinition({ label: '   ' }, { key: 'a', order: 0 }).valid, false);
});

// ── toPlainObject ───────────────────────────────────────────────────────────
test('toPlainObject normalises Maps, plain objects and junk', () => {
    assert.deepStrictEqual(toPlainObject(new Map([['a', 1]])), { a: 1 });
    assert.deepStrictEqual(toPlainObject({ a: 1 }), { a: 1 });
    assert.deepStrictEqual(toPlainObject(null), {});
    assert.deepStrictEqual(toPlainObject('str'), {});
});
