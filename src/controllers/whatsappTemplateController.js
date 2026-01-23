const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { submitTemplateToMeta, syncTemplateFromMeta } = require('../services/whatsappService');

// Get all templates
exports.getTemplates = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { status, category, search } = req.query;

        const query = { userId };
        if (status) query.status = status;
        if (category) query.category = category;
        if (search) {
            query.name = { $regex: search, $options: 'i' };
        }

        const templates = await WhatsAppTemplate.find(query)
            .sort({ createdAt: -1 });

        res.json({ templates });
    } catch (error) {
        console.error('Error fetching templates:', error);
        res.status(500).json({ message: 'Error fetching templates', error: error.message });
    }
};

// Get single template
exports.getTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        res.json({ template });
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ message: 'Error fetching template', error: error.message });
    }
};

// Create template
exports.createTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { name, language, category, components } = req.body;

        // Validation
        if (!name || !language || !category || !components) {
            return res.status(400).json({ message: 'Name, language, category, and components are required' });
        }

        // Validate name format
        if (!/^[a-z0-9_]+$/.test(name)) {
            return res.status(400).json({ message: 'Template name must be lowercase with underscores only' });
        }

        // Check for duplicate name
        const existing = await WhatsAppTemplate.findOne({ userId, name });
        if (existing) {
            return res.status(400).json({ message: 'Template with this name already exists' });
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
            status: 'DRAFT'
        });

        await template.save();
        res.status(201).json({ template });
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ message: 'Error creating template', error: error.message });
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

        // Can only edit DRAFT or REJECTED templates
        if (!['DRAFT', 'REJECTED'].includes(template.status)) {
            return res.status(400).json({ message: 'Can only edit DRAFT or REJECTED templates' });
        }

        const { name, language, category, components, isActive } = req.body;

        if (name && name !== template.name) {
            if (!/^[a-z0-9_]+$/.test(name)) {
                return res.status(400).json({ message: 'Template name must be lowercase with underscores only' });
            }
            template.name = name;
        }

        if (language) template.language = language;
        if (category) template.category = category;
        if (components) template.components = components;
        if (isActive !== undefined) template.isActive = isActive;

        await template.save();
        res.json({ template });
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ message: 'Error updating template', error: error.message });
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
        res.status(500).json({ message: 'Error submitting template', error: error.message });
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

        await WhatsAppTemplate.findByIdAndDelete(req.params.id);
        res.json({ message: 'Template deleted successfully' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ message: 'Error deleting template', error: error.message });
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
        res.status(500).json({ message: 'Error syncing template', error: error.message });
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

        const duplicate = new WhatsAppTemplate({
            userId,
            name: `${original.name}_copy`,
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
        res.status(500).json({ message: 'Error duplicating template', error: error.message });
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
        res.status(500).json({ message: 'Error fetching analytics', error: error.message });
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
        console.error('Error sending template message:', error);
        res.status(500).json({ message: 'Error sending template message', error: error.message });
    }
};

module.exports = exports;
