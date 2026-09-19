const EmailTemplate = require('../models/EmailTemplate');
const { sendEmail } = require('../services/emailService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { tenantKey, AREAS } = require('../services/storageKeys');

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
        // Random UUID rather than a timestamp: this name becomes the object key.
        cb(null, require('crypto').randomUUID() + (EXT_FOR_MIME[file.mimetype] || '.bin'));
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

const { wrapEmailHtml } = require('../utils/emailTemplateUtils');
const { resolveTemplate, buildTemplateContext } = require('../utils/templateResolver');
const {
    buildLibraryAttachments,
    totalBytes,
    MAX_TOTAL_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_COUNT
} = require('../utils/emailAttachments');

const MB = 1024 * 1024;

// A library file counts as "used" the moment a template points at it — the
// Media Library surfaces this as "Used in N" and the same counter is bumped by
// WhatsApp sends and chatbot flows. Best-effort: a failed counter must never
// fail the attach.
function bumpLibraryUsage(rows) {
    const ids = (rows || []).map(r => r.mediaAssetId).filter(Boolean);
    if (ids.length === 0) return Promise.resolve();
    const MediaAsset = require('../models/MediaAsset');
    return MediaAsset.updateMany(
        { _id: { $in: ids } },
        { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
    ).catch(e => console.error('[EmailTemplate] usageCount bump failed:', e.message));
}

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
        const { name, subject, body, stage, isActive, isAutomated, triggerType, mediaAssetIds } = req.body;

        if (!name || !subject || !body) {
            return res.status(400).json({ message: 'Name, subject, and body are required' });
        }

        // Media Library picks arrive with the create request, so a template can
        // be saved WITH its brochure attached instead of forcing a save-then-
        // reopen-then-attach round trip. The library is keyed to the workspace
        // owner (req.tenantId), which is not the template's userId for an agent.
        const { rows: libraryRows, error: libraryError } =
            await buildLibraryAttachments(mediaAssetIds, req.tenantId || userId, []);
        if (libraryError) {
            return res.status(400).json({ message: libraryError });
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
            attachments: libraryRows
        });

        await template.save();
        await bumpLibraryUsage(libraryRows);
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

        // Budget check BEFORE anything is stored. Multer caps a single file at
        // 10 MB, but nothing stopped ten of them piling onto one template until
        // the send bounced off the recipient's server with no explanation.
        const cleanupTemp = () => (req.files || []).forEach(f => {
            try { fs.unlinkSync(f.path); } catch (_) { /* already gone */ }
        });

        if (template.attachments.length + req.files.length > MAX_ATTACHMENT_COUNT) {
            cleanupTemp();
            return res.status(400).json({
                message: `A template can carry at most ${MAX_ATTACHMENT_COUNT} attachments.`
            });
        }

        const incoming = req.files.reduce((sum, f) => sum + (f.size || 0), 0);
        if (totalBytes(template.attachments) + incoming > MAX_TOTAL_ATTACHMENT_BYTES) {
            cleanupTemp();
            return res.status(400).json({
                message: `Attachments would total more than ${MAX_TOTAL_ATTACHMENT_BYTES / MB} MB. Most mail servers reject emails that large.`
            });
        }

        // Stream each staged file into object storage, then drop the temp copy.
        const objectStore = require('../services/storageService');
        for (const file of req.files) {
            // Keyed by the template's OWNER (the same id the lookup above used),
            // because that is the id the send path validates the prefix against.
            const storageKey = tenantKey(userId, AREAS.EMAIL_ATTACHMENTS, file.filename);
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

// Attach files from the shared Media Library — POST /:id/attachments/library
//
// The counterpart to uploadAttachment for files that are ALREADY stored: the
// brochure used by a WhatsApp template, an image from a broadcast, anything in
// the library. Nothing is copied — the template stores a reference, so one file
// serves every channel and the library stays the single source of truth.
exports.attachLibraryMedia = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await EmailTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        const { mediaAssetIds } = req.body;
        if (!mediaAssetIds || (Array.isArray(mediaAssetIds) && mediaAssetIds.length === 0)) {
            return res.status(400).json({ message: 'No files selected' });
        }

        const { rows, error } = await buildLibraryAttachments(
            mediaAssetIds,
            req.tenantId || userId,
            template.attachments
        );
        if (error) {
            return res.status(400).json({ message: error });
        }
        if (rows.length === 0) {
            // Everything picked is already on the template — nothing to do, and
            // re-adding would send the same file twice.
            return res.json(template);
        }

        template.attachments.push(...rows);
        await template.save();
        await bumpLibraryUsage(rows);

        res.json(template);
    } catch (error) {
        console.error('Error attaching library media:', error);
        res.status(500).json({ message: 'Error attaching files', error: 'Server error' });
    }
};

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

        let leadObj = null;
        let userObj = null;

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
            
            leadObj = await Lead.findOne({ _id: leadId, userId: ownerId });
            if (leadObj) {
                userObj = await User.findById(leadObj.userId);
            }
        }

        const tplContext = buildTemplateContext({
            lead: leadObj,
            user: userObj,
            system: { customData }
        });

        // Replace variables in subject and body
        const subject = resolveTemplate(template.subject, tplContext);
        const body = resolveTemplate(template.body, tplContext);

        // Prepare attachments — resolved from object storage, with the key
        // constrained to this tenant's namespace (replaces the old path-prefix
        // check, which proved containment but not ownership).
        const { resolveAttachments } = require('../utils/emailAttachments');
        const attachments = await resolveAttachments(template.attachments, userId);

        const recipient = to || (leadObj ? leadObj.email : null);
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
