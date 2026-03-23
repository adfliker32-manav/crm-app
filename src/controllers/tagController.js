const User = require('../models/User');

exports.getTags = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const user = await User.findById(ownerId).select('tags');
        res.json(user?.tags || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createTag = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { name, color } = req.body;
        
        if (!name || !name.trim()) {
            return res.status(400).json({ message: 'Tag name is required' });
        }
        
        const user = await User.findById(ownerId);
        if (!user.tags) user.tags = [];
        
        if (user.tags.some(t => t.name.toLowerCase() === name.trim().toLowerCase())) {
            return res.status(400).json({ message: 'Tag already exists' });
        }
        
        user.tags.push({ name: name.trim(), color: color || '#e2e8f0' });
        await user.save();
        
        res.json(user.tags[user.tags.length - 1]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateTag = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { id } = req.params;
        const { name, color } = req.body;
        
        const user = await User.findById(ownerId);
        if (!user.tags) return res.status(404).json({ message: 'No tags found' });
        
        const tag = user.tags.id(id);
        if (!tag) return res.status(404).json({ message: 'Tag not found' });
        
        if (name) tag.name = name.trim();
        if (color) tag.color = color;
        
        await user.save();
        res.json(tag);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteTag = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { id } = req.params;
        
        const user = await User.findById(ownerId);
        if (!user.tags) return res.status(404).json({ message: 'No tags found' });
        
        user.tags.pull(id);
        await user.save();
        
        res.json({ success: true, message: 'Tag deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
