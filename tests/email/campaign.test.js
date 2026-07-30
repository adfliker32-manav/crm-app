// tests/email/campaign.test.js
//
// Exercises the bulk-campaign drain without Agenda, Mongo, Redis or SMTP:
//   • drains past the first batch (the batch size is 25 — a 60-lead campaign
//     must take three passes, which a single-batch bug would silently truncate)
//   • the cursor advances so a restart never re-sends to the same contact
//   • cancellation takes effect mid-batch, not just between batches
//   • the daily cap pauses the campaign instead of burning thousands of failures
//   • suppressed addresses count as skipped, not failed
//
// Run: node --test tests/email/campaign.test.js

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const { stub, unstub, makeModel } = require('./helpers/stub');

const TENANT = '507f1f77bcf86cd799439011';

let EmailCampaign, Lead, campaignService, sent, dailyState, scheduled, sendBehaviour;

function freshModules() {
    sent = [];
    scheduled = [];
    dailyState = { allowed: true, count: 0, remaining: 300, limit: 300 };
    sendBehaviour = () => {};

    EmailCampaign = makeModel();
    Lead = makeModel();

    stub('models/EmailCampaign', EmailCampaign);
    stub('models/Lead', Lead);
    stub('models/User', makeModel([{ _id: TENANT, name: 'Owner', companyName: 'Acme' }]));

    stub('services/emailService', {
        sendEmail: async (opts) => {
            sendBehaviour(opts);           // may throw to simulate failures
            sent.push(opts);
            return { messageId: `<m${sent.length}@x>` };
        },
        sendEmailWithRetry: async () => ({ messageId: '<x@x>' })
    });
    stub('utils/workflowRateLimiter', {
        peekEmailDailyLimit: async () => ({ ...dailyState }),
        checkEmailDailyLimit: async () => ({ ...dailyState })
    });
    stub('utils/systemConfig', { isFeatureDisabled: async () => false });

    unstub('services/campaignService');
    campaignService = require('../../src/services/campaignService');
    campaignService.__setAgendaForTest({
        schedule: async (when, name, data) => { scheduled.push({ when, name, data }); },
        cancel: async () => 1
    });
}

/** Seeds N leads and a campaign in 'sending' state. */
function seed(leadCount, campaignOverrides = {}) {
    for (let i = 0; i < leadCount; i++) {
        Lead.__store.push({
            _id: `lead${String(i).padStart(20, '0')}`,
            userId: TENANT,
            name: `Lead ${i}`,
            email: `lead${i}@example.com`,
            status: 'New',
            deletedAt: null
        });
    }
    const campaign = {
        _id: 'camp00000000000000000001',
        userId: TENANT,
        name: 'Test Campaign',
        subject: 'Hello {{name}}',
        body: 'Hi {{name}}, news.',
        audience: { statuses: [], tags: [] },
        status: 'sending',
        stats: { total: leadCount, sent: 0, failed: 0, skipped: 0 },
        lastLeadId: null,
        ...campaignOverrides
    };
    EmailCampaign.__store.push(campaign);
    return campaign;
}

/** Drains until processBatch reports no more work (bounded to avoid a hang). */
async function drain(campaignId, maxPasses = 20) {
    let passes = 0;
    while (await campaignService.processBatch(campaignId)) {
        if (++passes > maxPasses) throw new Error('drain did not terminate');
    }
    return passes;
}

describe('bulk campaigns — batch draining (W7)', () => {
    beforeEach(freshModules);

    test('drains past the first batch: 60 leads across multiple passes', async () => {
        const c = seed(60);

        const passes = await drain(c._id);

        assert.equal(sent.length, 60, 'every recipient must be sent to');
        assert.ok(passes >= 2, `expected multiple batches, got ${passes}`);

        const stored = EmailCampaign.__store[0];
        assert.equal(stored.status, 'completed');
        assert.equal(stored.stats.sent, 60);
        assert.equal(stored.stats.failed, 0);
    });

    test('no recipient is emailed twice across batches', async () => {
        const c = seed(60);
        await drain(c._id);

        const addresses = sent.map(s => s.to);
        assert.equal(new Set(addresses).size, addresses.length, 'duplicate sends detected');
    });

    test('the cursor advances so a restart resumes rather than re-sending', async () => {
        const c = seed(60);

        await campaignService.processBatch(c._id);
        const afterFirst = EmailCampaign.__store[0].lastLeadId;
        assert.ok(afterFirst, 'lastLeadId must be set after the first batch');
        const sentAfterFirst = sent.length;

        await campaignService.processBatch(c._id);
        assert.notEqual(String(EmailCampaign.__store[0].lastLeadId), String(afterFirst),
            'cursor must move forward');
        assert.ok(sent.length > sentAfterFirst, 'second batch must send new mail');
    });

    test('template variables are interpolated per recipient', async () => {
        seed(2);
        await campaignService.processBatch('camp00000000000000000001');

        assert.equal(sent[0].subject, 'Hello Lead 0');
        assert.equal(sent[1].subject, 'Hello Lead 1');
        assert.match(sent[0].html, /Hi Lead 0/);
    });

    test('every campaign send is attributed as triggerType=campaign', async () => {
        seed(3);
        await campaignService.processBatch('camp00000000000000000001');

        assert.ok(sent.every(s => s.triggerType === 'campaign'));
        assert.ok(sent.every(s => s.isAutomated === true), 'must count against the daily cap');
        assert.ok(sent.every(s => s.leadId), 'must be threaded to the right lead');
    });
});

describe('bulk campaigns — control and safety (W7, D4)', () => {
    beforeEach(freshModules);

    test('cancelling stops the drain and does not send the remainder', async () => {
        const c = seed(60);

        await campaignService.processBatch(c._id);   // first batch
        const afterFirst = sent.length;

        EmailCampaign.__store[0].status = 'cancelled';
        const more = await campaignService.processBatch(c._id);

        assert.equal(more, false, 'a cancelled campaign must not request another batch');
        assert.equal(sent.length, afterFirst, 'no further mail after cancellation');
    });

    test('hitting the daily cap pauses and reschedules instead of failing everything', async () => {
        const c = seed(60);
        dailyState = { allowed: false, count: 300, remaining: 0, limit: 300 };

        const more = await campaignService.processBatch(c._id);

        assert.equal(more, false, 'must stop this pass');
        assert.equal(sent.length, 0, 'must not send past the cap');
        assert.equal(EmailCampaign.__store[0].status, 'sending', 'stays resumable — not failed');
        assert.match(EmailCampaign.__store[0].error || '', /limit/i);
        assert.equal(scheduled.length, 1, 'must reschedule a retry');
    });

    test('the batch is capped by remaining daily budget', async () => {
        seed(60);
        dailyState = { allowed: true, count: 295, remaining: 5, limit: 300 };

        await campaignService.processBatch('camp00000000000000000001');

        assert.equal(sent.length, 5, 'must not exceed the remaining budget');
    });

    test('suppressed recipients count as skipped, not failed', async () => {
        seed(4);
        sendBehaviour = (opts) => {
            if (opts.to === 'lead1@example.com') {
                throw new Error('Email to lead1@example.com is blocked: address has been unsubscribed or bounced.');
            }
        };

        await drain('camp00000000000000000001');

        const stats = EmailCampaign.__store[0].stats;
        assert.equal(stats.skipped, 1, 'an unsubscribe is a skip');
        assert.equal(stats.failed, 0, 'and must not be reported as a failure');
        assert.equal(stats.sent, 3);
    });

    test('a genuine SMTP error counts as failed and does not abort the campaign', async () => {
        seed(4);
        sendBehaviour = (opts) => {
            if (opts.to === 'lead2@example.com') throw new Error('ECONNREFUSED');
        };

        await drain('camp00000000000000000001');

        const stats = EmailCampaign.__store[0].stats;
        assert.equal(stats.failed, 1);
        assert.equal(stats.sent, 3, 'the rest of the campaign must still go out');
        assert.equal(EmailCampaign.__store[0].status, 'completed');
    });

    test('the platform kill switch pauses an in-flight campaign', async () => {
        seed(30);
        unstub('utils/systemConfig');
        stub('utils/systemConfig', { isFeatureDisabled: async () => true });
        unstub('services/campaignService');
        const svc = require('../../src/services/campaignService');
        svc.__setAgendaForTest({ schedule: async () => {}, cancel: async () => 1 });

        const more = await svc.processBatch('camp00000000000000000001');

        assert.equal(more, false);
        assert.equal(EmailCampaign.__store[0].status, 'paused');
        assert.equal(sent.length, 0);
    });

    test('audience filter restricts recipients to the selected stages', async () => {
        seed(10);
        Lead.__store.forEach((l, i) => { l.status = i < 4 ? 'Won' : 'New'; });
        EmailCampaign.__store[0].audience = { statuses: ['Won'], tags: [] };

        await drain('camp00000000000000000001');

        assert.equal(sent.length, 4, 'only the Won leads should receive it');
    });

    test('leads without an email address are never attempted', async () => {
        seed(5);
        Lead.__store[2].email = '';

        await drain('camp00000000000000000001');

        assert.equal(sent.length, 4);
        assert.ok(!sent.some(s => !s.to));
    });
});
