const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const { sendWhatsAppTextMessage } = require('../services/whatsappService');
const mongoose = require('mongoose');

// Get all conversations for the user
exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { status = 'active', search, page = 1, limit = 50 } = req.query;

        // Build query
        const query = { userId: new mongoose.Types.ObjectId(userId) };

        if (status && status !== 'all') {
            query.status = status;
        }

        if (search) {
            query.$or = [
                { displayName: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [conversations, total] = await Promise.all([
            WhatsAppConversation.find(query)
                .populate('leadId', 'name email status')
                .populate('assignedTo', 'name email')
                .sort({ lastMessageAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            WhatsAppConversation.countDocuments(query)
        ]);

        res.json({
            success: true,
            conversations,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ message: 'Error fetching conversations', error: error.message });
    }
};

// Get single conversation with messages
exports.getConversation = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { page = 1, limit = 50 } = req.query;

        const conversation = await WhatsAppConversation.findOne({
            _id: id,
            userId: userId
        })
            .populate('leadId', 'name email phone status source dealValue')
            .populate('assignedTo', 'name email')
            .lean();

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Get messages with pagination (newest first)
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [messages, totalMessages] = await Promise.all([
            WhatsAppMessage.find({ conversationId: id })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .lean(),
            WhatsAppMessage.countDocuments({ conversationId: id })
        ]);

        // Reverse to show oldest first in UI
        messages.reverse();

        res.json({
            success: true,
            conversation,
            messages,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalMessages,
                pages: Math.ceil(totalMessages / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Error fetching conversation:', error);
        res.status(500).json({ message: 'Error fetching conversation', error: error.message });
    }
};

// Send a message in a conversation
exports.sendMessage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { text, type = 'text' } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({ message: 'Message text is required' });
        }

        // Find conversation
        const conversation = await WhatsAppConversation.findOne({
            _id: id,
            userId: userId
        });

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Send via WhatsApp API
        const result = await sendWhatsAppTextMessage(conversation.phone, text.trim(), userId);
        const waMessageId = result?.messages?.[0]?.id;

        // Create message record
        const message = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: userId,
            waMessageId: waMessageId,
            direction: 'outbound',
            type: type,
            content: { text: text.trim() },
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: false
        });

        await message.save();

        // Update conversation
        conversation.lastMessage = text.trim().substring(0, 100);
        conversation.lastMessageAt = new Date();
        conversation.lastMessageDirection = 'outbound';
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        conversation.metadata.totalOutbound = (conversation.metadata.totalOutbound || 0) + 1;
        await conversation.save();

        res.json({
            success: true,
            message: message.toObject(),
            waMessageId
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            message: 'Error sending message',
            error: error.response?.data?.error?.message || error.message
        });
    }
};

// Mark conversation as read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, userId: userId },
            { $set: { unreadCount: 0 } },
            { new: true }
        );

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ message: 'Error marking as read', error: error.message });
    }
};

// Link conversation to a lead
exports.linkToLead = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { leadId } = req.body;

        // Verify lead belongs to user
        if (leadId) {
            const lead = await Lead.findOne({ _id: leadId, userId: userId });
            if (!lead) {
                return res.status(404).json({ message: 'Lead not found' });
            }
        }

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, userId: userId },
            { $set: { leadId: leadId || null } },
            { new: true }
        ).populate('leadId', 'name email phone status source dealValue');

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error linking to lead:', error);
        res.status(500).json({ message: 'Error linking to lead', error: error.message });
    }
};

// Archive/unarchive conversation
exports.updateStatus = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'archived', 'spam'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, userId: userId },
            { $set: { status } },
            { new: true }
        );

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ message: 'Error updating status', error: error.message });
    }
};

// Get unread count for badge
exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;

        const result = await WhatsAppConversation.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId), status: 'active' } },
            { $group: { _id: null, totalUnread: { $sum: '$unreadCount' } } }
        ]);

        const totalUnread = result[0]?.totalUnread || 0;

        res.json({ success: true, unreadCount: totalUnread });
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ message: 'Error getting unread count', error: error.message });
    }
};

// Start new conversation (send first message to a phone number)
exports.startConversation = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { phone, text, leadId } = req.body;

        if (!phone || !text) {
            return res.status(400).json({ message: 'Phone number and message text are required' });
        }

        // Normalize phone number
        const normalizedPhone = phone.replace(/[^0-9]/g, '');

        // Check if conversation already exists
        let conversation = await WhatsAppConversation.findOne({
            userId: userId,
            waContactId: normalizedPhone
        });

        if (!conversation) {
            // Create new conversation
            conversation = new WhatsAppConversation({
                userId: userId,
                waContactId: normalizedPhone,
                phone: normalizedPhone,
                leadId: leadId || null,
                metadata: {
                    firstMessageAt: new Date()
                }
            });
        }

        // Send message via WhatsApp API
        const result = await sendWhatsAppTextMessage(normalizedPhone, text.trim(), userId);
        const waMessageId = result?.messages?.[0]?.id;

        // Create message record
        const message = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: userId,
            waMessageId: waMessageId,
            direction: 'outbound',
            type: 'text',
            content: { text: text.trim() },
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: false
        });

        // Update conversation
        conversation.lastMessage = text.trim().substring(0, 100);
        conversation.lastMessageAt = new Date();
        conversation.lastMessageDirection = 'outbound';
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        conversation.metadata.totalOutbound = (conversation.metadata.totalOutbound || 0) + 1;

        await conversation.save();
        await message.save();

        res.json({
            success: true,
            conversation: conversation.toObject(),
            message: message.toObject()
        });
    } catch (error) {
        console.error('Error starting conversation:', error);
        res.status(500).json({
            message: 'Error starting conversation',
            error: error.response?.data?.error?.message || error.message
        });
    }
};
