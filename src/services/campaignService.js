// src/services/campaignService.js
//
// ═══════════════════════════════════════════════════════════════════════════
// FIX W7: bulk campaign sending.
//
// Drains a campaign in small batches on Agenda, rather than looping inside the
// HTTP request. That matters for three reasons:
//   • a 5,000-recipient send cannot run inside a request without timing out
//   • the per-tenant daily cap must be able to pause a campaign and resume it
//     the next day instead of failing thousands of sends
//   • a restart mid-campaign must not re-send to everyone already contacted
//
// Progress is a cursor over Lead._id, so resumption is exact and stateless.
// ═══════════════════════════════════════════════════════════════════════════

const EmailCampaign = require('../models/EmailCampaign');
const Lead = require('../models/Lead');
const { sendEmail } = require('./emailService');
const { wrapEmailHtml } = require('../utils/emailTemplateUtils');
const { resolveTemplate, buildTemplateContext } = require('../utils/templateResolver');
const { peekEmailDailyLimit } = require('../utils/workflowRateLimiter');
const { isFeatureDisabled } = require('../utils/systemConfig');

// Small batches keep each job short so cancellation is responsive and one
// failing tenant cannot monopolise the worker.
const BATCH_SIZE = 25;
// Spacing between individual sends — SMTP providers throttle aggressive bursts.
const SEND_SPACING_MS = 250;
// Gap between batches.
const BATCH_GAP_SECONDS = 5;
// When the daily cap is hit, retry after this long rather than failing.
const CAP_RETRY_SECONDS = 60 * 60;

let sharedAgenda = null;

/**
 * Builds the Lead query for a campaign's audience.
 * `after` advances the cursor for batch draining.
 */
const buildAudienceQuery = (campaign, after = null) => {
    const query = {
        userId: campaign.userId,
        email: { $exists: true, $nin: [null, ''] },
        deletedAt: null
    };

    if (campaign.audience?.statuses?.length) {
        query.status = { $in: campaign.audience.statuses };
    }
    if (campaign.audience?.tags?.length) {
        query.tags = { $in: campaign.audience.tags };
    }
    if (after) {
        query._id = { $gt: after };
    }
    return query;
};

/**
 * How many leads a campaign would send to. Used for the pre-launch preview and
 * to seed stats.total at launch.
 */
const countAudience = async (campaign) =>
    Lead.countDocuments(buildAudienceQuery(campaign));

/**
 * Processes one batch. Returns true when more work remains.
 */
const processBatch = async (campaignId) => {
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) return false;

    // Cancelled or paused between batches — stop cleanly.
    if (campaign.status !== 'sending') {
        console.log(`⏹️ [Campaign] ${campaign.name} is ${campaign.status} — halting batch drain.`);
        return false;
    }

    if (await isFeatureDisabled('DISABLE_EMAILS')) {
        campaign.status = 'paused';
        campaign.error = 'Paused: email sending is disabled platform-wide.';
        await campaign.save();
        return false;
    }

    // Check the tenant's remaining daily budget BEFORE sending. sendEmail also
    // enforces it per-message, but checking here lets the campaign pause and
    // resume tomorrow instead of burning through thousands of hard failures.
    const daily = await peekEmailDailyLimit(String(campaign.userId));
    if (!daily.allowed) {
        console.log(`⏸️ [Campaign] ${campaign.name} paused — daily cap ${daily.count}/${daily.limit} reached.`);
        campaign.error = `Daily send limit (${daily.limit}) reached — resuming automatically.`;
        await campaign.save();
        await scheduleNextBatch(campaignId, CAP_RETRY_SECONDS);
        return false;
    }

    const batchSize = Math.min(BATCH_SIZE, Math.max(1, daily.remaining));
    const leads = await Lead.find(buildAudienceQuery(campaign, campaign.lastLeadId))
        .sort({ _id: 1 })
        .limit(batchSize)
        .select('_id name email phone status')
        .lean();

    if (leads.length === 0) {
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        campaign.error = null;
        await campaign.save();
        console.log(`✅ [Campaign] ${campaign.name} completed — ${campaign.stats.sent} sent, ${campaign.stats.failed} failed, ${campaign.stats.skipped} skipped.`);
        return false;
    }

    const User = require('../models/User');
    const owner = await User.findById(campaign.userId).select('name companyName').lean();

    let sent = 0, failed = 0, skipped = 0;

    for (const lead of leads) {
        // Re-read status each iteration so Cancel takes effect within a batch,
        // not only between batches.
        const live = await EmailCampaign.findById(campaignId).select('status').lean();
        if (live?.status !== 'sending') {
            console.log(`⏹️ [Campaign] ${campaign.name} ${live?.status} mid-batch — stopping.`);
            break;
        }

        campaign.lastLeadId = lead._id;

        if (!lead.email) { skipped++; continue; }

        const tplContext = buildTemplateContext({
            lead,
            user: owner
        });

        const subject = resolveTemplate(campaign.subject, tplContext);
        const body = resolveTemplate(campaign.body, tplContext);

        try {
            await sendEmail({
                to: lead.email,
                subject,
                html: wrapEmailHtml(body),
                bodyForInbox: body,
                userId: campaign.userId,
                isAutomated: true,
                triggerType: 'campaign',
                templateId: campaign.templateId || null,
                leadId: lead._id
            });
            sent++;
        } catch (err) {
            // A suppressed address is an expected skip, not a failure.
            if (/suppress|unsubscrib|bounced/i.test(err.message)) {
                skipped++;
            } else {
                failed++;
                console.error(`❌ [Campaign] ${campaign.name} → ${lead.email}: ${err.message}`);
            }
        }

        if (SEND_SPACING_MS > 0) {
            await new Promise(r => setTimeout(r, SEND_SPACING_MS));
        }
    }

    campaign.stats.sent += sent;
    campaign.stats.failed += failed;
    campaign.stats.skipped += skipped;
    await campaign.save();

    return true;
};

const scheduleNextBatch = async (campaignId, delaySeconds = BATCH_GAP_SECONDS) => {
    if (!sharedAgenda) throw new Error('Agenda is not initialized.');
    await sharedAgenda.schedule(`in ${delaySeconds} seconds`, 'send_campaign_batch', { campaignId: String(campaignId) });
};

/**
 * Registers the campaign job. Called from index.js before agenda.start().
 */
const defineCampaignJobs = (agenda) => {
    sharedAgenda = agenda;

    agenda.define('send_campaign_batch', { priority: 'low', concurrency: 2 }, async (job) => {
        const { campaignId } = job.attrs.data || {};
        if (!campaignId) return;

        try {
            const more = await processBatch(campaignId);
            if (more) await scheduleNextBatch(campaignId);
        } catch (err) {
            console.error(`❌ [Campaign] Batch failed for ${campaignId}:`, err.message);
            await EmailCampaign.findByIdAndUpdate(campaignId, {
                $set: { status: 'failed', error: err.message, completedAt: new Date() }
            }).catch(() => {});
            throw err;
        }
    });
};

/**
 * Moves a campaign into 'sending' and kicks off the first batch.
 */
const launchCampaign = async (campaignId) => {
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (campaign.status === 'sending') throw new Error('Campaign is already sending');
    if (campaign.status === 'completed') throw new Error('Campaign has already been sent');

    const total = await countAudience(campaign);
    if (total === 0) throw new Error('No leads match this audience — nothing to send.');

    campaign.status = 'sending';
    campaign.startedAt = new Date();
    campaign.completedAt = null;
    campaign.error = null;
    // Restarting a cancelled campaign resets progress and counters.
    campaign.lastLeadId = null;
    campaign.stats = { total, sent: 0, failed: 0, skipped: 0 };
    await campaign.save();

    await scheduleNextBatch(campaignId, 1);
    return campaign;
};

/**
 * Cancels an in-flight campaign. Already-sent emails obviously cannot be
 * recalled; this stops everything not yet sent.
 */
const cancelCampaign = async (campaignId) => {
    const campaign = await EmailCampaign.findById(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    if (!['sending', 'paused'].includes(campaign.status)) {
        throw new Error(`Campaign is ${campaign.status} and cannot be cancelled`);
    }

    campaign.status = 'cancelled';
    campaign.completedAt = new Date();
    await campaign.save();

    // Drop any queued batch so it doesn't fire after cancellation.
    if (sharedAgenda) {
        await sharedAgenda.cancel({ name: 'send_campaign_batch', 'data.campaignId': String(campaignId) })
            .catch(() => {});
    }
    return campaign;
};

module.exports = {
    defineCampaignJobs,
    launchCampaign,
    cancelCampaign,
    countAudience,
    buildAudienceQuery,
    // Exported for tests — verifies multi-batch draining, cursor advance and
    // mid-batch cancellation without a live Agenda/Mongo/SMTP stack.
    processBatch,
    __setAgendaForTest: (a) => { sharedAgenda = a; }
};
