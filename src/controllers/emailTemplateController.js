const EmailTemplate = require('../models/EmailTemplate');
const { sendEmail } = require('../services/emailService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// SECURITY FIX: Define allowed file types for email attachments.
// The map is also the single source of the stored extension — see below.
const EXT_FOR_MIME = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'text/plain': '.txt', 'text/csv': '.csv'
};
const allowedMimeTypes = Object.keys(EXT_FOR_MIME);

// Uploads stage in uploads/temp/ only long enough to stream into object storage.
const TEMP_DIR = path.join('uploads', 'temp');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, TEMP_DIR);
    },
    filename: function (req, file, cb) {
        // The extension comes from the ACCEPTED MIME type, never from the
        // client's filename. `payload.html` sent as image/png used to be stored
        // as .html here — the sibling upload middlewares already fixed this.
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + (EXT_FOR_MIME[file.mimetype] || '.bin'));
    }
});

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

const { replaceVariables, wrapEmailHtml } = require('../utils/emailTemplateUtils');

// Get all email templates
exports.getTemplates = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const templates = await EmailTemplate.find({ userId }).sort({ createdAt: -1 });
        res.json(templates);
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ message: 'Error fetching templates', error: 'Server error' });
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
        res.status(500).json({ message: 'Error fetching template', error: 'Server error' });
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
        res.status(500).json({ message: 'Error creating template', error: 'Server error' });
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
        res.status(500).json({ message: 'Error updating template', error: 'Server error' });
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

        // Delete attachment bytes from wherever they live — ignore errors
        if (template.attachments && template.attachments.length > 0) {
            const { deleteAttachmentFile } = require('../utils/emailAttachments');
            await Promise.all(template.attachments.map(att =>
                deleteAttachmentFile(att).catch(() => {})
            ));
        }

        await EmailTemplate.findByIdAndDelete(req.params.id);
        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ message: 'Error deleting template', error: 'Server error' });
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
                    try { fs.unlinkSync(file.path); } catch (_) {}
                });
            }
            return res.status(404).json({ message: 'Template not found' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'No files uploaded' });
        }

        // Stream each staged file into object storage, then drop the temp copy.
        const objectStore = require('../services/storageService');
        for (const file of req.files) {
            // Keyed by the template's OWNER (the same id the lookup above used),
            // because that is the id the send path validates the prefix against.
            const storageKey = `email-attachments/${userId}/${file.filename}`;
            try {
                const stream = fs.createReadStream(file.path);
                await objectStore.putObject(storageKey, stream, file.mimetype, { contentLength: file.size });
                template.attachments.push({
                    filename: file.filename,
                    storageKey,
                    originalName: file.originalname,
                    mimetype: file.mimetype,
                    size: file.size
                });
            } catch (err) {
                console.error(`[EmailTemplate] Attachment upload failed (${file.filename}):`, err.message);
            } finally {
                try { fs.unlinkSync(file.path); } catch (_) { /* already gone */ }
            }
        }


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
        res.status(500).json({ message: 'Error uploading attachment', error: 'Server error' });
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

        // Delete the bytes (object storage, or legacy disk path)
        const { deleteAttachmentFile } = require('../utils/emailAttachments');
        await deleteAttachmentFile(attachment).catch(() => {});

        template.attachments.pull(attachmentId);
        await template.save();

        res.json(template);
    } catch (error) {
        console.error('Error removing attachment:', error);
        res.status(500).json({ message: 'Error removing attachment', error: 'Server error' });
    }
};

// Send email using template
exports.sendTemplateEmail = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { leadId, to, customData } = req.body;

        // FIX W3: the route is POST /email-templates/:id/send, but this handler
        // read req.body.templateId — which the route never supplies — so the
        // lookup always failed with 404. Accept the param, keeping the body
        // field as a fallback for any older caller.
        const templateId = req.params.id || req.body.templateId;

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
            
            // SECURITY FIX: Enforce Tenant Isolation (IDOR Patch)
            let ownerId = userId;
            if (req.user && req.user.role === 'agent') {
                const agentUser = await User.findById(userId).select('parentId').lean();
                if (agentUser && agentUser.parentId) {
                    ownerId = agentUser.parentId;
                }
            }
            
            const lead = await Lead.findOne({ _id: leadId, userId: ownerId });
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

        // Prepare attachments — resolved from object storage, with the key
        // constrained to this tenant's namespace (replaces the old path-prefix
        // check, which proved containment but not ownership).
        const { resolveAttachments } = require('../utils/emailAttachments');
        const attachments = await resolveAttachments(template.attachments, userId);

        const recipient = to || leadData.leadEmail;
        if (!recipient) {
            return res.status(400).json({ message: 'No recipient — provide `to` or a lead with an email address.' });
        }

        // Send email. Wrapped in the standard shell for consistency with the
        // automated senders; logging + Inbox threading happen inside sendEmail().
        const emailOptions = {
            to: recipient,
            subject: subject,
            html: wrapEmailHtml(body),
            bodyForInbox: body,
            attachments: attachments.length > 0 ? attachments : undefined,
            userId: userId, // Pass userId to use user-specific email config
            triggerType: 'template',
            templateId: template._id,
            leadId: leadId || null
        };

        const result = await sendEmail(emailOptions);

        res.json({
            success: true,
            message: 'Email sent successfully',
            messageId: result.messageId
        });
    } catch (error) {
        console.error('Error sending template email:', error);
        // sendEmail() already recorded the failure in EmailLog and the Inbox
        // thread — logging again here produced a duplicate row per failure.
        res.status(500).json({ message: 'Error sending email', error: 'Server error' });
    }
};

// Export multer upload for use in routes (if needed)
// exports.upload = upload;
