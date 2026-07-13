const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const { submitTemplateToMeta, syncTemplateFromMeta } = require('../services/whatsappService');
const { escapeRegex } = require('../utils/controllerHelpers');
const { parseMetaError } = require('../utils/metaErrorUtils');

// Get all templates (shared across users with same WhatsApp phone number)
exports.getTemplates = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { status, category, search } = req.query;

        // Find current user's tenant (manager or self) and their WhatsApp phone number
        const currentUser = await User.findById(userId).select('role parentId').lean();
        const tenantId = (currentUser?.role === 'agent' && currentUser?.parentId) ? currentUser.parentId : userId;
        const tenantConfig = await IntegrationConfig.findOne({ userId: tenantId })
            .select('whatsapp.waPhoneNumberId').lean();

        // Build userId filter: include ALL users sharing the same WhatsApp phone number
        let userFilter;
        if (tenantConfig?.whatsapp?.waPhoneNumberId) {
            const sharedConfigs = await IntegrationConfig.find(
                { 'whatsapp.waPhoneNumberId': tenantConfig.whatsapp.waPhoneNumberId },
                { userId: 1 }
            ).lean();
            const sharedIds = sharedConfigs.map(c => c.userId);
            userFilter = { userId: { $in: sharedIds } };
        } else {
            userFilter = { userId };
        }

        const query = { ...userFilter };
        if (status) query.status = status;
        if (category) query.category = category;
        if (search) {
            query.name = { $regex: escapeRegex(search), $options: 'i' };
        }

        const templates = await WhatsAppTemplate.find(query)
            .sort({ createdAt: -1 });

        res.json({ templates });
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ message: 'Error fetching templates', error: 'Server error' });
    }
};

// Get single template
exports.getTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        
        // FIX #53: Use shared user IDs so agents can view manager's templates
        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const companyUserIds = await getCompanyUserIds(userId);
        
        const template = await WhatsAppTemplate.findOne({ 
            _id: req.params.id, 
            userId: { $in: companyUserIds } 
        });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        res.json({ template });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ message: 'Error fetching template', error: 'Server error' });
    }
};

// Create template
exports.createTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { name, language, category, components, variableMapping, isAutomated, triggerType, stage, isActive } = req.body;

        // Validation
        if (!name || !language || !category || !components) {
            return res.status(400).json({ message: 'Name, language, category, and components are required' });
        }

        // Validate name format
        if (!/^[a-z0-9_]+$/.test(name)) {
            return res.status(400).json({ message: 'Template name must be lowercase with underscores only' });
        }

        // Check for duplicate name across the whole company (all users sharing the same
        // WhatsApp number). Meta enforces template-name uniqueness per WABA, so catch it
        // here instead of failing later at submit time.
        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const companyUserIds = await getCompanyUserIds(userId);
        const existing = await WhatsAppTemplate.findOne({ userId: { $in: companyUserIds }, name });
        if (existing) {
            return res.status(400).json({ message: 'A template with this name already exists' });
        }

        // Validate components
        const bodyComponent = components.find(c => c.type === 'BODY');
        if (!bodyComponent || !bodyComponent.text) {
            return res.status(400).json({ message: 'BODY component with text is required' });
        }

        const template = new WhatsAppTemplate({
            userId,
            name,
            language,
            category,
            components,
            variableMapping: variableMapping || {},
            // Automation settings are CRM-side — persist them on create too
            // (otherwise a new template saved with automation ON would silently lose it).
            isAutomated: isAutomated || false,
            triggerType: triggerType || 'manual',
            stage: stage || null,
            isActive: isActive || false,
            status: 'DRAFT'
        });

        await template.save();
        res.status(201).json({ template });
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ message: 'Error creating template', error: 'Server error' });
    }
};

// Update template
exports.updateTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        const isDraft = ['DRAFT', 'REJECTED'].includes(template.status);
        const { name, language, category, components, isActive, variableMapping, isAutomated, triggerType, stage } = req.body;

        // Automation fields are CRM-side settings — allow them to be saved for ANY status.
        if (isAutomated !== undefined) template.isAutomated = isAutomated;
        if (triggerType !== undefined) template.triggerType = triggerType;
        if (stage !== undefined) template.stage = stage;
        if (isActive !== undefined) template.isActive = isActive;

        // Structural fields (content/format) can only be changed on DRAFT or REJECTED templates
        if (isDraft) {
            if (name && name !== template.name) {
                if (!/^[a-z0-9_]+$/.test(name)) {
                    return res.status(400).json({ message: 'Template name must be lowercase with underscores only' });
                }
                const { getCompanyUserIds } = require('../utils/whatsappUtils');
                const companyUserIds = await getCompanyUserIds(userId);
                const clash = await WhatsAppTemplate.findOne({ userId: { $in: companyUserIds }, name, _id: { $ne: template._id } });
                if (clash) {
                    return res.status(400).json({ message: 'A template with this name already exists' });
                }
                template.name = name;
            }
            if (language) template.language = language;
            if (category) template.category = category;
            if (components) template.components = components;
            if (variableMapping !== undefined) template.variableMapping = variableMapping;
        }

        await template.save();
        res.json({ template });
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ message: 'Error updating template', error: 'Server error' });
    }
};

// Submit template to Meta for approval
exports.submitTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        if (template.status !== 'DRAFT' && template.status !== 'REJECTED') {
            return res.status(400).json({ message: 'Can only submit DRAFT or REJECTED templates' });
        }

        // Submit to Meta API
        const result = await submitTemplateToMeta(userId, template);

        if (result.success) {
            template.status = 'PENDING';
            template.metaTemplateId = result.templateId;
            template.rejectionReason = null;
            await template.save();

            res.json({
                message: 'Template submitted successfully. Meta will review within 24 hours.',
                template
            });
        } else {
            res.status(400).json({ message: result.error || 'Failed to submit template' });
        }
    } catch (error) {
        console.error('Error submitting template:', error);
        res.status(500).json({ message: 'Error submitting template', error: 'Server error' });
    }
};

// Delete template
exports.deleteTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        // If it was submitted to Meta, remove it there too (otherwise the name lingers on
        // Meta and blocks re-creating it). Local delete proceeds regardless so the user is
        // never stuck with an undeletable record.
        let metaWarning = null;
        if (template.metaTemplateId) {
            const { deleteTemplateFromMeta } = require('../services/whatsappService');
            const del = await deleteTemplateFromMeta(userId, template.name);
            if (!del.success) metaWarning = del.error;
        }

        await WhatsAppTemplate.findByIdAndDelete(req.params.id);
        res.json({
            message: 'Template deleted successfully',
            ...(metaWarning && { warning: `Removed from CRM, but Meta deletion failed: ${metaWarning}` })
        });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ message: 'Error deleting template', error: 'Server error' });
    }
};

// Sync template status from Meta
exports.syncTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        if (!template.metaTemplateId) {
            return res.status(400).json({ message: 'Template not submitted to Meta yet' });
        }

        const result = await syncTemplateFromMeta(userId, template.metaTemplateId);

        if (result.success) {
            template.status = result.status;
            template.quality = result.quality || 'UNKNOWN';
            if (result.status === 'APPROVED') {
                template.approvedAt = new Date();
            } else if (result.status === 'REJECTED') {
                template.rejectedAt = new Date();
                template.rejectionReason = result.rejectionReason;
            }
            await template.save();

            res.json({ template });
        } else {
            res.status(400).json({ message: result.error || 'Failed to sync template' });
        }
    } catch (error) {
        console.error('Error syncing template:', error);
        res.status(500).json({ message: 'Error syncing template', error: 'Server error' });
    }
};

// Duplicate template
exports.duplicateTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const original = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!original) {
            return res.status(404).json({ message: 'Template not found' });
        }

        // Pick the first free "<name>_copy", "<name>_copy_2", … so duplicating never 500s
        // on the unique index and never collides with a teammate's name (Meta-unique per WABA).
        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const companyUserIds = await getCompanyUserIds(userId);
        const baseName = `${original.name}_copy`;
        let name = baseName;
        for (let n = 2; n <= 100 && await WhatsAppTemplate.findOne({ userId: { $in: companyUserIds }, name }); n++) {
            name = `${baseName}_${n}`;
        }

        const duplicate = new WhatsAppTemplate({
            userId,
            name,
            language: original.language,
            category: original.category,
            components: original.components,
            status: 'DRAFT',
            isActive: false
        });

        await duplicate.save();
        res.status(201).json({ template: duplicate });
    } catch (error) {
        console.error('Error duplicating template:', error);
        res.status(500).json({ message: 'Error duplicating template', error: 'Server error' });
    }
};

// Get template analytics
exports.getTemplateAnalytics = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        res.json({ analytics: template.analytics });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ message: 'Error fetching analytics', error: 'Server error' });
    }
};

// Send template message
exports.sendTemplateMessage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { to, templateName } = req.body;

        if (!to || !templateName) {
            return res.status(400).json({ message: 'To and Template Name are required' });
        }

        const { sendWhatsAppMessage } = require('../services/whatsappService');
        const result = await sendWhatsAppMessage(to, templateName, userId);

        res.json({ success: true, message: 'Template sent successfully', data: result });
    } catch (error) {
        const { msg: errorMsg, code: errorCode, category } = parseMetaError(error);
        console.error(`Error sending template message [${category}/${errorCode}]:`, errorMsg);
        res.status(error.response?.status || 500).json({
            success: false,
            message: errorMsg,
            error: errorMsg,
            errorCode,
            errorCategory: category
        });
    }
};

module.exports = exports;
