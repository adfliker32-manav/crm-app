// src/controllers/emailController.js

const { sendEmail } = require('../services/emailService');
const { logEmail } = require('../services/emailLogService');

// Send Email Controller
const sendEmailController = async (req, res) => {
    try {
        console.log("📧 Email Controller Hit!");
        console.log("Request Data:", req.body);

        const { to, subject, text, html } = req.body;

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
            userId: userId // Pass userId to use user-specific email config
        };

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
                to: to || 'unknown',
                subject: subject || 'No subject',
                body: html || text || '',
                status: 'failed',
                error: error.message,
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

module.exports = { sendEmail: sendEmailController };