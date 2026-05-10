const EmailConversation = require('../models/EmailConversation');
const EmailMessage = require('../models/EmailMessage');
const { escapeRegex } = require('../utils/controllerHelpers');

exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { status = 'active', search, page = 1, limit = 30 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const query = { userId, status };

        if (search) {
            const safe = escapeRegex(search);
            query.$or = [
                { email: { $regex: safe, $options: 'i' } },
                { displayName: { $regex: safe, $options: 'i' } }
            ];
        }

        const [conversations, total] = await Promise.all([
            EmailConversation.find(query)
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('leadId', 'name email status'),
            EmailConversation.countDocuments(query)
        ]);

        res.json({
            success: true,
            conversations,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        console.error('Error fetching email conversations:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId || req.user.id;
        
        const conversation = await EmailConversation.findOne({ _id: conversationId, userId })
            .populate('leadId');
            
        if (!conversation) {
            return res.status(404).json({ success: false, message: 'Conversation not found' });
        }
        
        const { page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [messages, totalMessages] = await Promise.all([
            EmailMessage.find({ conversationId, userId })
                .sort({ timestamp: 1 })
                .skip(skip)
                .limit(parseInt(limit)),
            EmailMessage.countDocuments({ conversationId, userId })
        ]);

        res.json({
            success: true,
            conversation,
            messages,
            pagination: { total: totalMessages, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(totalMessages / parseInt(limit)) }
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

exports.markRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user.userId || req.user.id;
        
        await EmailConversation.findOneAndUpdate(
            { _id: conversationId, userId },
            { $set: { unreadCount: 0 } }
        );
        
        await EmailMessage.updateMany(
            { conversationId, userId, direction: 'inbound', status: 'received' },
            { $set: { status: 'read' } }
        );
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
