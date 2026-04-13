const WorkspaceSettings = require('../models/WorkspaceSettings');

exports.getTags = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const settings = await WorkspaceSettings.findOne({ userId: ownerId }).select('tags');
        res.json(settings?.tags || []);
    } catch (err) {
        console.error("Get Tags Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.createTag = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { name, color } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Tag name is required' });
        }
        
        const settings = await WorkspaceSettings.findOne({ userId: ownerId });
        if (!settings) return res.status(404).json({ message: 'Workspace settings not found' });
        
        if (!settings.tags) settings.tags = [];
        
        if (settings.tags.some(t => t.name.toLowerCase() === name.trim().toLowerCase())) {
            return res.status(400).json({ message: 'Tag already exists' });
        }
        
        settings.tags.push({ name: name.trim(), color: color || '#e2e8f0' });
        await settings.save();
        
        res.json(settings.tags[settings.tags.length - 1]);
    } catch (err) {
        console.error("Create Tag Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.updateTag = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { id } = req.params;
        const { name, color } = req.body;
        
        const settings = await WorkspaceSettings.findOne({ userId: ownerId });
        if (!settings || !settings.tags) return res.status(404).json({ message: 'No tags found' });
        
        const tag = settings.tags.id(id);
        if (!tag) return res.status(404).json({ message: 'Tag not found' });
        
        if (name) tag.name = name.trim();
        if (color) tag.color = color;
        
        await settings.save();
        res.json(tag);
    } catch (err) {
        console.error("Update Tag Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.deleteTag = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { id } = req.params;
        
        const settings = await WorkspaceSettings.findOne({ userId: ownerId });
        if (!settings || !settings.tags) return res.status(404).json({ message: 'No tags found' });
        
        settings.tags.pull(id);
        await settings.save();
        
        res.json({ success: true, message: 'Tag deleted successfully' });
    } catch (err) {
        console.error("Delete Tag Error:", err);
        res.status(500).json({ message: 'Server error' });
    }
};
