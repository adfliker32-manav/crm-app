const EmailTemplate = require('../models/EmailTemplate');
const { sendEmail } = require('../services/emailService');
const { logEmail } = require('../services/emailLogService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'uploads/email-attachments';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

// SECURITY FIX: Define allowed file types for email attachments
const allowedMimeTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain', 'text/csv'
];

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: function (req, file, cb) {
        // SECURITY FIX: Only accept safe file types
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} is not allowed. Allowed types: images, PDF, Office documents, text files.`), false);
        }
    }
});

// Helper function to replace template variables
const replaceVariables = (template, data) => {
    let result = template;
    const variables = {
        '{{leadName}}': data.leadName || '',
        '{{leadEmail}}': data.leadEmail || '',
        '{{leadPhone}}': data.leadPhone || '',
        '{{companyName}}': data.companyName || '',
        '{{userName}}': data.userName || '',
        '{{stageName}}': data.stageName || '',
        '{{date}}': new Date().toLocaleDateString(),
        '{{time}}': new Date().toLocaleTimeString()
    };

    Object.keys(variables).forEach(key => {
        const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
        result = result.replace(regex, variables[key]);
    });

    return result;
};

// Get all email templates
exports.getTemplates = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const templates = await EmailTemplate.find({ userId }).sort({ createdAt: -1 });
        res.json(templates);
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ message: 'Error fetching templates', error: error.message });
    }
};

// Get single email template
exports.getTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await EmailTemplate.findOne({ _id: req.params.id, userId });
        
        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }
        
        res.json(template);
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ message: 'Error fetching template', error: error.message });
    }
};

// Create email template
exports.createTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { name, subject, body, stage, isActive, isAutomated, triggerType } = req.body;

        if (!name || !subject || !body) {
            return res.status(400).json({ message: 'Name, subject, and body are required' });
        }

        const template = new EmailTemplate({
            userId,
            name,
            subject,
            body,
            stage: stage || null,
            isActive: isActive !== undefined ? isActive : true,
            isAutomated: isAutomated || false,
            triggerType: triggerType || 'manual',
            attachments: []
        });

        await template.save();
        res.status(201).json(template);
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ message: 'Error creating template', error: error.message });
    }
};

// Update email template
exports.updateTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await EmailTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        const { name, subject, body, stage, isActive, isAutomated, triggerType } = req.body;

        if (name) template.name = name;
        if (subject) template.subject = subject;
        if (body) template.body = body;
        if (stage !== undefined) template.stage = stage || null;
        if (isActive !== undefined) template.isActive = isActive;
        if (isAutomated !== undefined) template.isAutomated = isAutomated;
        if (triggerType) template.triggerType = triggerType;

        await template.save();
        res.json(template);
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ message: 'Error updating template', error: error.message });
    }
};

// Delete email template
exports.deleteTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await EmailTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        // Delete attachment files
        if (template.attachments && template.attachments.length > 0) {
            template.attachments.forEach(att => {
                const filePath = att.path;
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
        }

        await EmailTemplate.findByIdAndDelete(req.params.id);
        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ message: 'Error deleting template', error: error.message });
    }
};

// Upload attachment to template
exports.uploadAttachment = [
    upload.array('attachments', 5),
    async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await EmailTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            // Delete uploaded files if template not found
            if (req.files) {
                req.files.forEach(file => {
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                });
            }
            return res.status(404).json({ message: 'Template not found' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        // Add attachments to template
        req.files.forEach(file => {
            template.attachments.push({
                filename: file.filename,
                path: file.path,
                originalName: file.originalname,
                mimetype: file.mimetype,
                size: file.size
            });
        });

        await template.save();
        res.json(template);
    } catch (error) {
        console.error('Error uploading attachment:', error);
        // Delete uploaded files on error
        if (req.files) {
            req.files.forEach(file => {
                if (fs.existsSync(file.path)) {
                    fs.unlinkSync(file.path);
                }
            });
        }
        res.status(500).json({ message: 'Error uploading attachment', error: error.message });
    }
    }
];

// Remove attachment from template
exports.removeAttachment = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await EmailTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        const { attachmentId } = req.body;
        const attachment = template.attachments.id(attachmentId);

        if (!attachment) {
            return res.status(404).json({ message: 'Attachment not found' });
        }

        // Delete file from filesystem
        if (fs.existsSync(attachment.path)) {
            fs.unlinkSync(attachment.path);
        }

        template.attachments.pull(attachmentId);
        await template.save();

        res.json(template);
    } catch (error) {
        console.error('Error removing attachment:', error);
        res.status(500).json({ message: 'Error removing attachment', error: error.message });
    }
};

// Send email using template
exports.sendTemplateEmail = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { templateId, leadId, to, customData } = req.body;

        const template = await EmailTemplate.findOne({ _id: templateId, userId });
        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        if (!template.isActive) {
            return res.status(400).json({ message: 'Template is not active' });
        }

        // Get lead data if leadId provided
        let leadData = {};
        if (leadId) {
            const Lead = require('../models/Lead');
            const User = require('../models/User');
            const lead = await Lead.findById(leadId);
            if (lead) {
                const user = await User.findById(lead.userId);
                leadData = {
                    leadName: lead.name,
                    leadEmail: lead.email,
                    leadPhone: lead.phone,
                    companyName: user?.companyName || '',
                    userName: user?.name || '',
                    stageName: lead.status
                };
            }
        }

        // Merge custom data
        const finalData = { ...leadData, ...(customData || {}) };

        // Replace variables in subject and body
        const subject = replaceVariables(template.subject, finalData);
        const body = replaceVariables(template.body, finalData);

        // Prepare attachments
        const attachments = template.attachments.map(att => ({
            filename: att.originalName || att.filename,
            path: att.path
        }));

        // Send email
        const emailOptions = {
            to: to || leadData.leadEmail,
            subject: subject,
            html: body,
            attachments: attachments.length > 0 ? attachments : undefined,
            userId: userId // Pass userId to use user-specific email config
        };

        const result = await sendEmail(emailOptions);
        
        // Log successful email
        await logEmail({
            userId: userId,
            to: to || leadData.leadEmail,
            subject: subject,
            body: body,
            status: 'sent',
            messageId: result.messageId,
            isAutomated: false,
            triggerType: 'template',
            templateId: template._id,
            leadId: leadId || null,
            attachments: template.attachments || []
        });

        res.json({
            success: true,
            message: 'Email sent successfully',
            messageId: result.messageId
        });
    } catch (error) {
        console.error('Error sending template email:', error);
        
        // Log failed email
        try {
            await logEmail({
                userId: userId,
                to: to || leadData?.leadEmail || 'unknown',
                subject: template.subject,
                body: template.body,
                status: 'failed',
                error: error.message,
                isAutomated: false,
                triggerType: 'template',
                templateId: template._id,
                leadId: leadId || null,
                attachments: template.attachments || []
            });
        } catch (logError) {
            console.error('Error logging failed email:', logError);
        }
        
        res.status(500).json({ message: 'Error sending email', error: error.message });
    }
};

// Export multer upload for use in routes (if needed)
// exports.upload = upload;
