// src/controllers/emailController.js

const { sendEmail } = require('../services/emailService');

// Send Email Controller
const sendEmailController = async (req, res) => {
    try {
        console.log("📧 Email Controller Hit!");
        console.log("Request Data:", req.body);

        const { to, subject, text, html, cc, bcc, scheduledFor } = req.body;

        // Validation
        if (!to) {
            return res.status(400).json({ 
                success: false, 
                message: "Recipient email (to) is required" 
            });
        }

        if (!subject) {
            return res.status(400).json({ 
                success: false, 
                message: "Email subject is required" 
            });
        }

        if (!text && !html) {
            return res.status(400).json({ 
                success: false, 
                message: "Email content (text or html) is required" 
            });
        }

        // Email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(to)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid recipient email address" 
            });
        }

        // Get userId
        const userId = req.user?.userId || req.user?.id;
        // Conversations/leads belong to the tenant, not the individual agent.
        const tenantId = req.tenantId || userId;

        // FIX F5: attachments uploaded with the compose form (memory storage —
        // handed straight to nodemailer, so nothing lands on disk).
        const attachments = (req.files || []).map(file => ({
            filename: file.originalname,
            content: file.buffer,
            contentType: file.mimetype,
            size: file.size
        }));

        // Prepare email options (include userId for user-specific credentials).
        // `conversational` marks this as a human-typed 1:1 message: no
        // unsubscribe footer, and a marketing opt-out does not block the reply.
        const emailOptions = {
            to: to,
            subject: subject,
            text: text,
            html: html,
            userId: userId, // Pass userId to use user-specific email config
            cc: cc || null,
            bcc: bcc || null,
            conversational: true,
            attachments: attachments.length > 0 ? attachments : undefined
        };

        // FIX F4: Add In-Reply-To / References headers for proper email threading
        try {
            const Lead = require('../models/Lead');
            const EmailConversation = require('../models/EmailConversation');
            const lead = await Lead.findOne({ email: to.toLowerCase().trim(), userId: tenantId }).select('_id').lean();
            if (lead) {
                const conversation = await EmailConversation.findOne({ userId: tenantId, leadId: lead._id })
                    .select('lastInboundMessageId').lean();
                if (conversation?.lastInboundMessageId) {
                    emailOptions.inReplyTo = conversation.lastInboundMessageId;
                    emailOptions.references = conversation.lastInboundMessageId;
                }
            }
        } catch (threadErr) {
            // Non-critical — continue without threading headers
            console.warn('⚠️ Could not set reply threading headers:', threadErr.message);
        }

        // If scheduledFor is provided, queue the email instead of sending now
        if (scheduledFor) {
            // Agenda persists job data in MongoDB, so file buffers cannot ride
            // along — a 10MB attachment would be stored as BSON and blow the
            // document limit. Reject the combination explicitly rather than
            // silently dropping the files at send time.
            if (attachments.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Attachments cannot be used with scheduled emails. Send now, or schedule without attachments.'
                });
            }

            const sendAt = new Date(scheduledFor);

            // FIX F6: a malformed or past date used to be accepted and then fire
            // immediately, which looks to the user like the schedule was ignored.
            if (isNaN(sendAt.getTime())) {
                return res.status(400).json({ success: false, message: 'Invalid schedule date.' });
            }
            if (sendAt.getTime() <= Date.now()) {
                return res.status(400).json({ success: false, message: 'Schedule time must be in the future.' });
            }

            try {
                const { scheduleEmail } = require('../services/emailQueueService');
                const job = await scheduleEmail(emailOptions, sendAt);
                return res.status(200).json({
                    success: true,
                    message: `Email scheduled for ${sendAt.toLocaleString()}`,
                    scheduled: true,
                    scheduledFor: sendAt.toISOString(),
                    jobId: job?.attrs?._id || null
                });
            } catch (scheduleErr) {
                console.error('❌ Email scheduling failed:', scheduleErr);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to schedule email. Please try again.'
                });
            }
        }

        // Send email. Logging and Inbox threading now happen inside sendEmail()
        // via emailSyncService, so every sender records identically — this
        // controller no longer maintains its own copy of that logic.
        const result = await sendEmail(emailOptions);

        console.log("✅ Email sent successfully to:", to);

        res.status(200).json({ 
            success: true, 
            message: "Email sent successfully!",
            messageId: result.messageId,
            to: to,
            subject: subject
        });

    } catch (error) {
        console.error("❌ Email Error:", error);

        // The failure is already logged and threaded by sendEmail() — no
        // controller-side logging here, which previously produced a second
        // EmailLog row for the same failed send.

        // Handle specific error types
        let errorMessage = "Failed to send email";
        if (error.message.includes("not configured")) {
            errorMessage = "Email service not configured. Please contact administrator.";
        } else if (error.message.includes("Invalid login")) {
            errorMessage = "Email authentication failed. Please check email credentials.";
        } else if (error.message.includes("ECONNECTION")) {
            errorMessage = "Could not connect to email server. Please try again later.";
        } else {
            errorMessage = error.message || "Server Error during email sending";
        }

        res.status(500).json({ 
            success: false,
            message: errorMessage 
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// FIX W7: these four handlers were routed and reachable but every one returned
// 501 "not yet implemented".
// ═══════════════════════════════════════════════════════════════════════════

const tenantOf = (req) => req.tenantId || req.user?.userId || req.user?.id;

// ── Bulk campaigns ──────────────────────────────────────────────────────────

const listCampaigns = async (req, res) => {
    try {
        const EmailCampaign = require('../models/EmailCampaign');
        const campaigns = await EmailCampaign.find({ userId: tenantOf(req) })
            .sort({ createdAt: -1 })
            .limit(50)
            .populate('templateId', 'name')
            .lean();
        res.json({ success: true, campaigns });
    } catch (error) {
        console.error('Error listing campaigns:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

/**
 * Reports how many leads an audience filter matches, so the user sees the blast
 * radius before committing.
 */
const previewCampaignAudience = async (req, res) => {
    try {
        const { countAudience } = require('../services/campaignService');
        const { statuses = [], tags = [] } = req.body || {};
        const total = await countAudience({
            userId: tenantOf(req),
            audience: {
                statuses: Array.isArray(statuses) ? statuses : [],
                tags: Array.isArray(tags) ? tags : []
            }
        });
        res.json({ success: true, total });
    } catch (error) {
        console.error('Error previewing audience:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

const sendBulkCampaign = async (req, res) => {
    try {
        const EmailCampaign = require('../models/EmailCampaign');
        const { launchCampaign, countAudience } = require('../services/campaignService');

        const { name, subject, body, templateId, statuses = [], tags = [], launch = true } = req.body || {};

        if (!name?.trim())    return res.status(400).json({ success: false, message: 'Campaign name is required' });
        if (!subject?.trim()) return res.status(400).json({ success: false, message: 'Subject is required' });
        if (!body?.trim())    return res.status(400).json({ success: false, message: 'Body is required' });

        const userId = tenantOf(req);
        const audience = {
            statuses: Array.isArray(statuses) ? statuses.filter(Boolean) : [],
            tags: Array.isArray(tags) ? tags.filter(Boolean) : []
        };

        // Fail fast on an empty audience rather than creating a campaign that
        // immediately completes having sent nothing.
        const total = await countAudience({ userId, audience });
        if (total === 0) {
            return res.status(400).json({
                success: false,
                message: 'No leads match this audience — adjust the filters and try again.'
            });
        }

        const campaign = await EmailCampaign.create({
            userId,
            createdBy: req.user?.userId || req.user?.id || null,
            name: name.trim(),
            subject: subject.trim(),
            body,
            templateId: templateId || null,
            audience,
            status: 'draft',
            stats: { total, sent: 0, failed: 0, skipped: 0 }
        });

        if (!launch) {
            return res.status(201).json({ success: true, campaign, message: 'Campaign saved as draft' });
        }

        await launchCampaign(campaign._id);
        const started = await EmailCampaign.findById(campaign._id).lean();

        res.status(201).json({
            success: true,
            campaign: started,
            message: `Campaign started — sending to ${total} recipient${total === 1 ? '' : 's'}.`
        });
    } catch (error) {
        console.error('Error starting campaign:', error);
        res.status(500).json({ success: false, message: error.message || 'Failed to start campaign' });
    }
};

const cancelCampaign = async (req, res) => {
    try {
        const EmailCampaign = require('../models/EmailCampaign');
        const { cancelCampaign: doCancel } = require('../services/campaignService');

        // Ownership check before touching the campaign.
        const owned = await EmailCampaign.findOne({ _id: req.params.campaignId, userId: tenantOf(req) }).select('_id');
        if (!owned) return res.status(404).json({ success: false, message: 'Campaign not found' });

        const campaign = await doCancel(owned._id);
        res.json({ success: true, campaign, message: 'Campaign cancelled' });
    } catch (error) {
        console.error('Error cancelling campaign:', error);
        res.status(400).json({ success: false, message: error.message || 'Failed to cancel campaign' });
    }
};

// ── Drafts ──────────────────────────────────────────────────────────────────

const getDrafts = async (req, res) => {
    try {
        const EmailDraft = require('../models/EmailDraft');
        const drafts = await EmailDraft.find({ userId: tenantOf(req) })
            .sort({ updatedAt: -1 })
            .limit(50)
            .lean();
        res.json({ success: true, drafts });
    } catch (error) {
        console.error('Error fetching drafts:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

const saveDraft = async (req, res) => {
    try {
        const EmailDraft = require('../models/EmailDraft');
        const { draftId, to = '', cc = '', bcc = '', subject = '', body = '', leadId = null } = req.body || {};

        if (!to.trim() && !subject.trim() && !body.trim()) {
            return res.status(400).json({ success: false, message: 'Draft is empty — nothing to save.' });
        }

        const userId = tenantOf(req);
        const fields = { to, cc, bcc, subject, body, leadId: leadId || null };

        // Updating an existing draft must not let one tenant write another's.
        if (draftId) {
            const updated = await EmailDraft.findOneAndUpdate(
                { _id: draftId, userId },
                { $set: fields },
                { returnDocument: 'after' }
            ).lean();
            if (!updated) return res.status(404).json({ success: false, message: 'Draft not found' });
            return res.json({ success: true, draft: updated });
        }

        const draft = await EmailDraft.create({
            userId,
            createdBy: req.user?.userId || req.user?.id || null,
            ...fields
        });
        res.status(201).json({ success: true, draft });
    } catch (error) {
        console.error('Error saving draft:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

const deleteDraft = async (req, res) => {
    try {
        const EmailDraft = require('../models/EmailDraft');
        const result = await EmailDraft.deleteOne({ _id: req.params.draftId, userId: tenantOf(req) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Draft not found' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting draft:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

module.exports = {
    sendEmail: sendEmailController,
    sendBulkCampaign,
    listCampaigns,
    previewCampaignAudience,
    cancelCampaign,
    getDrafts,
    saveDraft,
    deleteDraft
};