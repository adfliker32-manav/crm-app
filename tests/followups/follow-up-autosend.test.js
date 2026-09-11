// Regression tests for "Auto-send a message on this date" (2026-09-11).
//
// Reported as: the checkbox does not save, and the message is not sent on the
// same day. Three independent defects, all silent:
//
//   1. schemas.updateLead did not declare followUpTemplateType /
//      followUpTemplateName. validate() runs with stripUnknown, so Joi DELETED
//      both fields before updateLead saw them — its hasOwn() check never fired.
//      The form reported success and saved nothing. (Same defect class as the
//      createAgent permissions strip documented in validateRequest.js.)
//   2. EditLeadModal reset the checkbox to unchecked on every open and never
//      read the lead's saved schedule, so even once (1) was fixed it looked
//      unsaved — and the NEXT save posted followUpTemplateType: null and wiped
//      the real schedule.
//   3. The cron ran once a day at 09:00 and only ever queried leads whose
//      nextFollowUpDate was TODAY. A follow-up set for today after 9am missed
//      that day's only run, and the next day's run looked at the next day's
//      date — so it was never sent at all.
//
// Plus the reason the whole form often refused to save: GET /leads excludes
// customData, so every custom field opened blank and a REQUIRED one ("City *")
// failed client-side validation on a lead that already had a value.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const readSrc = (...p) => read('src', ...p);

const { schemas } = require(path.join(ROOT, 'src', 'middleware', 'validateRequest'));

// Exactly how validate() runs the schema — the strip is the whole bug.
const runUpdateLead = (body) => schemas.updateLead.validate(body, {
    abortEarly: false,
    stripUnknown: true,
    allowUnknown: false
});

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the schema must let the follow-up template through
// ─────────────────────────────────────────────────────────────────────────────

test('updateLead keeps the scheduled follow-up template instead of stripping it', () => {
    const { error, value } = runUpdateLead({
        name: 'Asha',
        nextFollowUpDate: '2026-09-11',
        followUpTemplateType: 'whatsapp',
        followUpTemplateName: 'welcome_msg'
    });

    assert.strictEqual(error, undefined, 'a valid follow-up schedule must not 400');
    assert.strictEqual(
        value.followUpTemplateType, 'whatsapp',
        'stripUnknown deleted this field, so updateLead never saw the checkbox at all'
    );
    assert.strictEqual(value.followUpTemplateName, 'welcome_msg');
});

test('an email follow-up carries the EmailTemplate id through', () => {
    const { error, value } = runUpdateLead({
        nextFollowUpDate: '2026-09-11',
        followUpTemplateType: 'email',
        followUpTemplateName: '66f1a2b3c4d5e6f7a8b9c0d1'
    });
    assert.strictEqual(error, undefined);
    assert.strictEqual(value.followUpTemplateName, '66f1a2b3c4d5e6f7a8b9c0d1');
});

test('clearing the checkbox still clears the schedule', () => {
    // The modal posts nulls when the box is unchecked; the controller reads them
    // through hasOwn(), so they must survive validation too.
    const { error, value } = runUpdateLead({
        nextFollowUpDate: '2026-09-11',
        followUpTemplateType: null,
        followUpTemplateName: null
    });
    assert.strictEqual(error, undefined);
    assert.ok('followUpTemplateType' in value, 'a null must reach the controller, not be dropped');
    assert.strictEqual(value.followUpTemplateType, null);
});

test('the fix did not loosen the schema', () => {
    const { error } = runUpdateLead({ followUpTemplateType: 'sms' });
    assert.ok(error, 'only whatsapp and email are real channels here');

    const { value } = runUpdateLead({ name: 'Asha', role: 'superadmin', userId: 'x' });
    assert.ok(!('role' in value) && !('userId' in value), 'unknown fields must still be stripped');
});

test('updateLead only applies the template when a follow-up date exists', () => {
    const src = readSrc('controllers', 'leadController.js');
    const start = src.indexOf("if (hasOwn(req.body, 'followUpTemplateName')");
    assert.notStrictEqual(start, -1, 'the follow-up template branch is gone — was it renamed?');
    const branch = src.slice(start, start + 400);

    assert.ok(/if \(lead\.nextFollowUpDate\)/.test(branch), 'a template with no date can never fire');
    assert.ok(/followUpTemplateSent = false/.test(branch), 'rescheduling must re-arm the send');
});

// ─────────────────────────────────────────────────────────────────────────────
// 3 — same-day sending
// ─────────────────────────────────────────────────────────────────────────────

const cronSrc = () => readSrc('services', 'cronJobs.js');
const followUpBody = () => {
    const src = cronSrc();
    const start = src.indexOf('const runFollowUpTemplateSend = ');
    assert.notStrictEqual(start, -1, 'runFollowUpTemplateSend not found — was it renamed?');
    return src.slice(start, src.indexOf('\n};', start));
};

test('the follow-up send runs through the day, not once at 09:00', () => {
    assert.ok(
        /cron\.schedule\('\*\/30 \* \* \* \*', \(\) => runFollowUpTemplateSend\(\)\)/.test(cronSrc()),
        'a single daily run cannot deliver a follow-up that was set later that same day'
    );
    assert.ok(
        !/cron\.schedule\('0 9 \* \* \*', runFollowUpTemplateSend\)/.test(cronSrc()),
        'the once-a-day schedule is the bug'
    );
});

test('it still refuses to message before 9am', () => {
    assert.ok(
        /if \(!ignoreSendHour && new Date\(\)\.getHours\(\) < FOLLOW_UP_SEND_HOUR\) return;/.test(followUpBody()),
        'running every 30 minutes without this floor would fire follow-ups at 00:30'
    );
});

test('overdue follow-ups are caught, but only within a bounded window', () => {
    const body = followUpBody();

    assert.ok(
        /windowStart\.setDate\(windowStart\.getDate\(\) - FOLLOW_UP_LOOKBACK_DAYS\)/.test(body),
        'a day missed entirely (restart, or a lead set late yesterday) must still go out'
    );
    assert.ok(
        /nextFollowUpDate: \{ \$gte: windowStart, \$lte: windowEnd \}/.test(body),
        'the query must span the catch-up window, not just today'
    );

    const lookback = Number(/const FOLLOW_UP_LOOKBACK_DAYS = (\d+)/.exec(cronSrc())?.[1]);
    assert.ok(
        lookback >= 1 && lookback <= 7,
        'unbounded lookback would blast months-old schedules on the first run after deploy'
    );
});

test('overlapping ticks cannot send the same follow-up twice', () => {
    const src = cronSrc();
    assert.ok(/let followUpSendInFlight = false;/.test(src), 'ticks are 30 min apart — a long batch can overlap itself');
    assert.ok(/if \(followUpSendInFlight\) \{/.test(followUpBody()), 'the guard must actually be checked');
    assert.ok(
        /\} finally \{\s*[\r\n]+\s*followUpSendInFlight = false;/.test(src),
        'a throw must release the guard, or the sweep stops forever'
    );
});

test('a sent follow-up is disarmed so it cannot repeat on the next tick', () => {
    const body = followUpBody();
    const disarms = body.match(/followUpTemplateSent: true/g) || [];
    assert.ok(disarms.length >= 4, 'every exit path — sent, no phone, no email, missing template, failure — must disarm');
    assert.ok(
        /followUpTemplateSent: \{ \$ne: true \}/.test(body),
        'the query must skip anything already sent'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — the modal must show what is actually scheduled
// ─────────────────────────────────────────────────────────────────────────────

const modal = () => read('client', 'src', 'components', 'Dashboard', 'EditLeadModal.jsx');

test('opening a lead shows its saved follow-up template', () => {
    const src = modal();

    assert.ok(
        /const scheduled = !!\(lead\.followUpTemplateType && lead\.followUpTemplateName\);/.test(src) &&
        /setSendTemplate\(scheduled\)/.test(src),
        'resetting to unchecked made a saved schedule look unsaved'
    );
    assert.ok(/setTemplateType\(lead\.followUpTemplateType \|\| 'whatsapp'\)/.test(src));
    assert.ok(/setSelectedTemplate\(lead\.followUpTemplateName \|\| ''\)/.test(src));
    assert.ok(
        !/setSendTemplate\(false\);\s*[\r\n]+\s*setTemplateType\('whatsapp'\);/.test(src),
        'the unconditional reset is the bug'
    );
});

test('loading the template list does not wipe the saved pick', () => {
    const src = modal();
    const start = src.indexOf('const fetchTemplates = async () => {');
    assert.notStrictEqual(start, -1, 'fetchTemplates not found — was it renamed?');
    const body = src.slice(start, src.indexOf('};', start));

    assert.ok(
        !/setSelectedTemplate\(''\)/.test(body),
        'this effect runs on open too, so clearing here erased the schedule before it was seen'
    );
    // Switching channel is the one case where the previous pick is meaningless.
    assert.ok(
        /setTemplateType\('email'\); setSelectedTemplate\(''\);/.test(src) &&
        /setTemplateType\('whatsapp'\); setSelectedTemplate\(''\);/.test(src),
        'changing channel must reset the pick'
    );
});

test('a checked box with no template is refused instead of saved as a dud', () => {
    assert.ok(
        /if \(sendTemplate && formData\.nextFollowUpDate && !selectedTemplate\)/.test(modal()),
        'the cron only looks at leads with a followUpTemplateName — no name is a schedule that never fires'
    );
});

// ─────────────────────────────────────────────────────────────────────────────
// Why the form often refused to save at all
// ─────────────────────────────────────────────────────────────────────────────

test('the edit modal loads real custom field values, not the stripped list row', () => {
    const src = modal();

    assert.ok(
        /api\.get\(`\/leads\/\$\{listRow\._id\}`\)/.test(src),
        'GET /leads excludes customData, so the row handed to this modal has none — ' +
        'every custom field opened blank and a required one blocked the save'
    );
    assert.ok(
        /fullRes\?\.data\?\.customData \?\? listRow\?\.customData \?\? \{\}/.test(src),
        'fall back to the row rather than losing values if the fetch fails'
    );

    // The exclusion this compensates for — if the projection ever starts including
    // customData, this fetch is redundant rather than wrong, but the assertion
    // documents the coupling.
    assert.ok(
        /\.select\('-history -messages -followUpHistory -customData'\)/.test(readSrc('controllers', 'leadController.js')),
        'if the list projection changed, revisit the extra fetch in EditLeadModal'
    );
});
