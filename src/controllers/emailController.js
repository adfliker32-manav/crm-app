// src/controllers/emailController.js

const { sendEmail } = require('../services/emailService');
const { logEmail } = require('../services/emailLogService');

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
        
        // Prepare email options (include userId for user-specific credentials)
        const emailOptions = {
            to: to,
            subject: subject,
            text: text,
            html: html,
            userId: userId, // Pass userId to use user-specific email config
            cc: cc || null,
            bcc: bcc || null
        };

        // FIX F4: Add In-Reply-To / References headers for proper email threading
        try {
            const Lead = require('../models/Lead');
            const EmailConversation = require('../models/EmailConversation');
            const lead = await Lead.findOne({ email: to, userId }).lean();
            if (lead) {
                const conversation = await EmailConversation.findOne({ userId, leadId: lead._id }).lean();
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
            try {
                const { scheduleEmail } = require('../services/emailQueueService');
                await scheduleEmail(emailOptions, new Date(scheduledFor));
                return res.status(200).json({
                    success: true,
                    message: `Email scheduled for ${new Date(scheduledFor).toLocaleString()}`,
                    scheduled: true,
                    scheduledFor: scheduledFor
                });
            } catch (scheduleErr) {
                console.error('❌ Email scheduling failed:', scheduleErr);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to schedule email. Sending immediately instead.'
                });
            }
        }

        // Send email
        const result = await sendEmail(emailOptions);
        
        // Log successful email
        if (userId) {
            await logEmail({
                userId: userId,
                to: to,
                subject: subject,
                body: html || text || '',
                status: 'sent',
                messageId: result.messageId,
                isAutomated: false,
                triggerType: 'manual',
                attachments: []
            });

            // NEW: 2-Way Sync Tracking
            try {
                const Lead = require('../models/Lead');
                const EmailConversation = require('../models/EmailConversation');
                const EmailMessage = require('../models/EmailMessage');
                
                let lead = await Lead.findOne({ email: to, userId: userId });
                if (!lead) {
                    lead = new Lead({ userId, email: to, name: to.split('@')[0], source: 'Email', status: 'New' });
                    await lead.save();
                }
                
                let conversation = await EmailConversation.findOne({ userId, leadId: lead._id });
                if (!conversation) {
                    conversation = new EmailConversation({ userId, leadId: lead._id, email: to, displayName: lead.name });
                    await conversation.save(); // FIX C2: Must save before referencing conversation._id
                }
                
                const messageRecord = new EmailMessage({
                    conversationId: conversation._id,
                    userId: userId,
                    leadId: lead._id,
                    messageId: result.messageId,
                    direction: 'outbound',
                    from: 'CRM',
                    to: to,
                    subject: subject,
                    text: text,
                    html: html,
                    status: 'sent',
                    timestamp: new Date()
                });
                await messageRecord.save();
                
                conversation.lastMessage = subject || 'Outgoing Email';
                conversation.lastMessageAt = new Date();
                conversation.lastMessageDirection = 'outbound';
                conversation.metadata.totalMessages += 1;
                conversation.metadata.totalOutbound += 1;
                await conversation.save();
            } catch (err) {
                console.error("Error saving outbound to EmailMessage sync:", err);
            }
        }

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
        
        // Log failed email
        const userId = req.user?.userId || req.user?.id;
        if (userId) {
            await logEmail({
                userId: userId,
                to: req.body?.to || 'unknown',
                subject: req.body?.subject || 'No subject',
                body: req.body?.html || req.body?.text || '',
                status: 'failed',
                error: 'Server error',
                isAutomated: false,
                triggerType: 'manual',
                attachments: []
            });
        }
        
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

// Phase 3 Feature Stubs
const sendBulkCampaign = async (req, res) => res.status(501).json({ message: "Bulk campaigns not yet implemented." });
const getDrafts = async (req, res) => res.status(501).json({ message: "Drafts not yet implemented." });
const saveDraft = async (req, res) => res.status(501).json({ message: "Drafts not yet implemented." });
const deleteDraft = async (req, res) => res.status(501).json({ message: "Drafts not yet implemented." });

module.exports = { 
    sendEmail: sendEmailController,
    sendBulkCampaign,
    getDrafts,
    saveDraft,
    deleteDraft
};