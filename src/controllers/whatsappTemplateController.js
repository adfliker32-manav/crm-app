const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { sendWhatsAppTextMessage } = require('../services/whatsappService');
const { logWhatsApp } = require('../services/whatsAppLogService');

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

// Get all WhatsApp templates
exports.getTemplates = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const templates = await WhatsAppTemplate.find({ userId }).sort({ createdAt: -1 });
        res.json(templates);
    } catch (error) {
        console.error('Error fetching WhatsApp templates:', error);
        res.status(500).json({ message: 'Error fetching templates', error: error.message });
    }
};

// Get single WhatsApp template
exports.getTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });
        
        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }
        
        res.json(template);
    } catch (error) {
        console.error('Error fetching template:', error);
        res.status(500).json({ message: 'Error fetching template', error: error.message });
    }
};

// Create WhatsApp template
exports.createTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { name, message, stage, isActive, isAutomated, triggerType, isMarketing } = req.body;

        if (!name || !message) {
            return res.status(400).json({ message: 'Name and message are required' });
        }

        // Validate marketing template character limit (550 chars)
        if (isMarketing && message.length > 550) {
            return res.status(400).json({ message: 'Marketing templates cannot exceed 550 characters' });
        }

        const template = new WhatsAppTemplate({
            userId,
            name,
            message,
            stage: stage || null,
            isActive: isActive !== undefined ? isActive : true,
            isAutomated: isAutomated !== undefined ? isAutomated : false,
            triggerType: triggerType || 'manual',
            isMarketing: isMarketing !== undefined ? isMarketing : false,
            reviewStatus: 'draft' // New templates start as draft
        });

        await template.save();
        res.status(201).json(template);
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ message: 'Error creating template', error: error.message });
    }
};

// Update WhatsApp template
exports.updateTemplate = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        const { name, message, stage, isActive, isAutomated, triggerType, isMarketing } = req.body;

        if (name) template.name = name;
        if (message) {
            // Validate marketing template character limit
            if (template.isMarketing && message.length > 550) {
                return res.status(400).json({ message: 'Marketing templates cannot exceed 550 characters' });
            }
            template.message = message;
        }
        if (stage !== undefined) template.stage = stage || null;
        if (isActive !== undefined) template.isActive = isActive;
        if (isAutomated !== undefined) template.isAutomated = isAutomated;
        if (triggerType) template.triggerType = triggerType;
        if (isMarketing !== undefined) {
            template.isMarketing = isMarketing;
            // If changing to marketing, validate character limit
            if (isMarketing && template.message.length > 550) {
                return res.status(400).json({ message: 'Marketing templates cannot exceed 550 characters' });
            }
            // If changing from marketing to non-marketing, reset review status
            if (!isMarketing && template.reviewStatus !== 'draft') {
                template.reviewStatus = 'draft';
                template.rejectionReason = null;
            }
        }

        await template.save();
        res.json(template);
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ message: 'Error updating template', error: error.message });
    }
};

// Submit template for review
exports.submitForReview = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const template = await WhatsAppTemplate.findOne({ _id: req.params.id, userId });

        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        // Only marketing templates need review
        if (!template.isMarketing) {
            return res.status(400).json({ message: 'Only marketing templates need to be submitted for review' });
        }

        // Validate character limit
        if (template.message.length > 550) {
            return res.status(400).json({ message: 'Marketing templates cannot exceed 550 characters' });
        }

        // Can only submit from draft or rejected status
        if (template.reviewStatus === 'pending_review') {
            return res.status(400).json({ message: 'Template is already pending review' });
        }

        if (template.reviewStatus === 'approved') {
            return res.status(400).json({ message: 'Template is already approved' });
        }

        template.reviewStatus = 'pending_review';
        template.rejectionReason = null; // Clear previous rejection reason
        await template.save();

        res.json({ 
            message: 'Template submitted for review successfully',
            template 
        });
    } catch (error) {
        console.error('Error submitting template for review:', error);
        res.status(500).json({ message: 'Error submitting template for review', error: error.message });
    }
};

// Delete WhatsApp template
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

// Send WhatsApp message using template
exports.sendTemplateMessage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { templateId, leadId, phone, customData } = req.body;

        const template = await WhatsAppTemplate.findOne({ _id: templateId, userId });
        if (!template) {
            return res.status(404).json({ message: 'Template not found' });
        }

        if (!template.isActive) {
            return res.status(400).json({ message: 'Template is not active' });
        }

        // Get lead data if leadId provided
        let leadData = {};
        if (leadId) {
            const lead = await Lead.findById(leadId);
            if (lead) {
                const user = await User.findById(lead.userId);
                leadData = {
                    leadName: lead.name,
                    leadEmail: lead.email || '',
                    leadPhone: lead.phone,
                    companyName: user?.companyName || '',
                    userName: user?.name || '',
                    stageName: lead.status
                };
            }
        }

        // Merge custom data
        const finalData = { ...leadData, ...(customData || {}) };

        // Replace variables in message
        const message = replaceVariables(template.message, finalData);

        // Determine phone number
        const phoneNumber = phone || leadData.leadPhone;
        if (!phoneNumber) {
            return res.status(400).json({ message: 'Phone number is required' });
        }

        // Send WhatsApp text message
        const result = await sendWhatsAppTextMessage(phoneNumber, message, userId);
        const messageId = result?.messages?.[0]?.id;

        // Log successful message
        if (messageId) {
            logWhatsApp({
                userId,
                to: phoneNumber,
                message: message,
                status: 'sent',
                messageId,
                isAutomated: false,
                triggerType: 'template',
                templateId: template._id,
                leadId: leadId || null
            }).catch(err => console.error('Error logging WhatsApp message:', err));
        }

        res.json({
            success: true,
            message: 'WhatsApp message sent successfully',
            result
        });
    } catch (error) {
        console.error('Error sending WhatsApp template:', error);
        res.status(500).json({ message: 'Error sending message', error: error.message });
    }
};
