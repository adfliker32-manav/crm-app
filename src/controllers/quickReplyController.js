const WorkspaceSettings = require('../models/WorkspaceSettings');

const MAX_QUICK_REPLIES = 10;

const sanitize = (entries) => {
    if (!Array.isArray(entries)) return [];
    return entries
        .filter(e => e && typeof e.keyword === 'string' && typeof e.message === 'string')
        .map((e, idx) => ({
            keyword: e.keyword.trim().slice(0, 40),
            message: e.message.slice(0, 1024),
            order: typeof e.order === 'number' ? e.order : idx
        }))
        .filter(e => e.keyword.length > 0 && e.message.trim().length > 0)
        .slice(0, MAX_QUICK_REPLIES);
};

exports.getQuickReplies = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const settings = await WorkspaceSettings.findOne({ userId: ownerId })
            .select('quickReplies')
            .lean();
        const list = (settings?.quickReplies || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        res.json(list);
    } catch (error) {
        console.error('Error fetching quick replies:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.saveQuickReplies = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const cleaned = sanitize(req.body?.quickReplies);

        const keywords = cleaned.map(c => c.keyword.toLowerCase());
        if (new Set(keywords).size !== keywords.length) {
            return res.status(400).json({ message: 'Quick reply keywords must be unique' });
        }

        const updated = await WorkspaceSettings.findOneAndUpdate(
            { userId: ownerId },
            { quickReplies: cleaned },
            { new: true, upsert: true }
        ).select('quickReplies');

        res.json({
            success: true,
            quickReplies: (updated.quickReplies || []).sort((a, b) => (a.order || 0) - (b.order || 0))
        });
    } catch (error) {
        console.error('Error saving quick replies:', error);
        res.status(500).json({ message: 'Failed to save quick replies' });
    }
};
