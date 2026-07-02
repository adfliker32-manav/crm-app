const VoiceTemplate = require('../models/VoiceTemplate');

exports.getTemplates = async (req, res) => {
    try {
        const tenantId = req.user.id;
        
        // Fetch tenant's templates AND global templates
        const templates = await VoiceTemplate.find({
            $or: [
                { tenantId },
                { isGlobal: true }
            ]
        }).sort({ createdAt: -1 });

        res.json({ success: true, templates });
    } catch (error) {
        console.error('[VoiceTemplate] Error fetching templates:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch templates' });
    }
};

exports.createTemplate = async (req, res) => {
    try {
        const tenantId = req.user.id;
        const templateData = { ...req.body, tenantId };
        
        const template = await VoiceTemplate.create(templateData);
        res.status(201).json({ success: true, template });
    } catch (error) {
        console.error('[VoiceTemplate] Error creating template:', error);
        res.status(500).json({ success: false, error: 'Failed to create template' });
    }
};

exports.deleteTemplate = async (req, res) => {
    try {
        const tenantId = req.user.id;
        const { id } = req.params;

        const template = await VoiceTemplate.findOneAndDelete({ _id: id, tenantId });
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found or unauthorized' });
        }

        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        console.error('[VoiceTemplate] Error deleting template:', error);
        res.status(500).json({ success: false, error: 'Failed to delete template' });
    }
};
