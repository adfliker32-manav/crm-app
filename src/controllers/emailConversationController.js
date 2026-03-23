const EmailConversation = require('../models/EmailConversation');
const EmailMessage = require('../models/EmailMessage');

exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { status = 'active', search } = req.query;
        
        const query = { userId, status };
        
        if (search) {
            query.$or = [
                { email: { $regex: search, $options: 'i' } },
                { displayName: { $regex: search, $options: 'i' } }
            ];
        }
        
        const conversations = await EmailConversation.find(query)
            .sort({ lastMessageAt: -1 })
            .populate('leadId', 'name email status');
            
        res.json({ success: true, conversations });
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
        
        const messages = await EmailMessage.find({ conversationId, userId })
            .sort({ timestamp: 1 });
            
        res.json({ success: true, conversation, messages });
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
