// Regression tests for the mass-assignment / input-validation gaps (audit C4).
//
// Mongoose strict:true already drops fields that don't exist on a schema, so the
// exploitable surface is narrower than "unvalidated route count" suggests: it is
// the `{ ...req.body }` spread sites, where fields that DO exist on the schema
// but should never be user-settable get written. These tests pin those.

const { test } = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = 'test-secret-for-mass-assignment-tests';

const { pickWritableTemplateFields, TEMPLATE_WRITABLE_FIELDS } =
    require('../../src/controllers/voiceTemplateController');
const { schemas } = require('../../src/middleware/validateRequest');

// ── Voice templates ─────────────────────────────────────────────────────────

test('voice template whitelist strips isGlobal (cross-tenant publish)', () => {
    // createTemplate previously did `{ ...req.body, tenantId }` WITHOUT forcing
    // isGlobal. getTemplates matches `{ isGlobal: true }` across every tenant, so
    // any user could push a template — and its call-driving basePrompt — into
    // every workspace on the platform.
    const hostile = {
        name: 'Legit',
        basePrompt: 'say hello',
        isGlobal: true,
        tenantId: 'someone-elses-id',
        deletedAt: new Date(),
        agencyId: 'another-agency'
    };

    const safe = pickWritableTemplateFields(hostile);

    assert.strictEqual(safe.isGlobal, undefined, 'isGlobal must never survive the whitelist');
    assert.strictEqual(safe.tenantId, undefined, 'tenantId is forced from the session');
    assert.strictEqual(safe.deletedAt, undefined, 'saasPlugin soft-delete state is not user input');
    assert.strictEqual(safe.agencyId, undefined, 'saasPlugin tenancy state is not user input');
    assert.strictEqual(safe.name, 'Legit', 'legitimate fields still pass through');
    assert.strictEqual(safe.basePrompt, 'say hello');
});

test('voice template whitelist omits privileged fields entirely', () => {
    for (const forbidden of ['isGlobal', 'tenantId', 'agencyId', 'deletedAt', '_id']) {
        assert.ok(
            !TEMPLATE_WRITABLE_FIELDS.includes(forbidden),
            `${forbidden} must not be in the writable list`
        );
    }
});

test('voice template schema rejects isGlobal outright', () => {
    const { error } = schemas.createVoiceTemplate.validate(
        { name: 'x', basePrompt: 'y', isGlobal: true },
        { abortEarly: false, stripUnknown: false, allowUnknown: false }
    );
    assert.ok(error, 'isGlobal must be rejected, not silently accepted');
});

// ── Appointments ────────────────────────────────────────────────────────────

test('appointment schema accepts a real booking payload', () => {
    // appointmentTime is a display string ("10:00 AM"), NOT 24h "HH:MM".
    // A stricter regex here would reject every genuine booking.
    const { error, value } = schemas.createAppointment.validate({
        customerName: 'Asha Rao',
        customerPhone: '+919876543210',
        serviceType: 'Consultation',
        appointmentDate: '2026-08-14',
        appointmentTime: '10:00 AM',
        notes: 'first visit'
    });
    assert.strictEqual(error, undefined, error && error.message);
    assert.strictEqual(value.customerName, 'Asha Rao');
});

test('appointment schema rejects object-typed fields (NoSQL operator shapes)', () => {
    const { error } = schemas.createAppointment.validate({
        customerName: { $ne: null },
        customerPhone: '+919876543210',
        serviceType: 'Consultation',
        appointmentDate: '2026-08-14',
        appointmentTime: '10:00 AM'
    });
    assert.ok(error, 'an object where a string is expected must 400, not reach Mongo');
});

test('appointment schema enforces required fields', () => {
    // abortEarly:false so ALL missing fields are reported — Joi's default stops
    // at the first one, which would make this assertion vacuous.
    const { error } = schemas.createAppointment.validate(
        { notes: 'nothing else' },
        { abortEarly: false }
    );
    assert.ok(error);
    const missing = error.details.map(d => d.path[0]);
    for (const field of ['customerName', 'customerPhone', 'serviceType', 'appointmentDate', 'appointmentTime']) {
        assert.ok(missing.includes(field), `${field} must be required`);
    }
});

test('appointment update schema rejects an empty body', () => {
    const { error } = schemas.updateAppointment.validate({});
    assert.ok(error, 'an empty PUT should 400 rather than silently no-op');
});

test('appointment update schema enforces the status enum', () => {
    assert.ok(schemas.updateAppointment.validate({ status: 'Deleted' }).error);
    assert.strictEqual(schemas.updateAppointment.validate({ status: 'Confirmed' }).error, undefined);
});

// ── Agency clients ──────────────────────────────────────────────────────────

test('agency client schema uses the real money field and blocks billing state', () => {
    // The model field is `monthlyFee` — an earlier draft of this fix guessed
    // `monthlyAmount`, which would have silently dropped every fee update.
    assert.strictEqual(
        schemas.updateAgencyClient.validate({ monthlyFee: 5000 }).error,
        undefined
    );
    assert.ok(
        schemas.updateAgencyClient.validate({ lastBilledDate: new Date() }).error,
        'lastBilledDate is billing-engine state and must be rejected'
    );
});

test('agency client schema enforces the serviceType enum', () => {
    assert.ok(schemas.updateAgencyClient.validate({ serviceType: 'anything' }).error);
    assert.strictEqual(schemas.updateAgencyClient.validate({ serviceType: 'seo' }).error, undefined);
});
