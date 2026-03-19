const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { sendWhatsAppTextMessage } = require('../services/whatsappService');
const mongoose = require('mongoose');

// Helper to resolve specific mapped variables
const resolveVariable = (mappingObj, varNum, data) => {
    // Handle Mongoose Map vs plain object
    const mapType = (mappingObj && typeof mappingObj.get === 'function') 
        ? mappingObj.get(varNum.toString()) 
        : (mappingObj?.[varNum.toString()] || '');
        
    switch (mapType) {
        case 'lead.name': return data.leadName || '';
        case 'lead.phone': return data.leadPhone || '';
        case 'lead.email': return data.leadEmail || '';
        case 'lead.status': return data.stageName || '';
        case 'company.name': return data.companyName || '';
        case 'user.name': return data.userName || '';
        case 'custom': 
            const customVal = (mappingObj && typeof mappingObj.get === 'function') 
                ? mappingObj.get(`${varNum}_custom`) 
                : (mappingObj?.[`${varNum}_custom`] || '');
            return customVal || '';
        default: 
            // Fallback to older static convention if unmapped
            if (varNum === 1) return data.leadName || 'Customer';
            if (varNum === 2) return data.stageName || 'New';
            if (varNum === 3) return data.companyName || 'Our Company';
            if (varNum === 4) return data.userName || 'Representative';
            return '';
    }
};

// Helper to build Meta API components
const buildMetaComponents = (dbComponents, variableMapping, data) => {
    const metaComponents = [];

    for (const comp of dbComponents) {
        if (comp.type === 'BODY' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a,b)=>a-b);
                for (const n of nums) parameters.push({ type: 'text', text: resolveVariable(variableMapping, n, data) });
                metaComponents.push({ type: 'body', parameters });
            }
        }
        if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a,b)=>a-b);
                for (const n of nums) parameters.push({ type: 'text', text: resolveVariable(variableMapping, n, data) });
                metaComponents.push({ type: 'header', parameters });
            }
        }
    }
    return metaComponents;
};

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
        const { phone, text, leadId, templateName } = req.body;

        if (!phone) {
            return res.status(400).json({ message: 'Phone number is required' });
        }

        if (!templateName && !text) {
            return res.status(400).json({ message: 'Template name or message text is required' });
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

        let result, waMessageId, messageContent, messageType;

        if (templateName) {
            // Send via Template API (required for new contacts / outside 24hr window)
            const templateObj = await WhatsAppTemplate.findOne({ userId, name: templateName });
            let metaComponents = null;
            
            if (templateObj) {
                const userObj = await User.findById(userId);
                const leadObj = leadId ? await Lead.findById(leadId) : await Lead.findOne({ user: userId, phone: normalizedPhone });
                
                const templateData = {
                    leadName: leadObj?.name || '',
                    leadEmail: leadObj?.email || '',
                    leadPhone: normalizedPhone || '',
                    companyName: userObj?.companyName || '',
                    userName: userObj?.name || '',
                    stageName: leadObj?.status || 'New'
                };
                
                metaComponents = buildMetaComponents(templateObj.components || [], templateObj.variableMapping, templateData);
            }

            const { sendWhatsAppMessage } = require('../services/whatsappService');
            result = await sendWhatsAppMessage(normalizedPhone, templateName, userId, metaComponents);
            waMessageId = result?.messages?.[0]?.id;
            messageContent = { text: `[Template: ${templateName}]` };
            messageType = 'template';
        } else {
            // Send via free-text (only works within 24hr window)
            result = await sendWhatsAppTextMessage(normalizedPhone, text.trim(), userId);
            waMessageId = result?.messages?.[0]?.id;
            messageContent = { text: text.trim() };
            messageType = 'text';
        }

        // Create message record
        const message = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: userId,
            waMessageId: waMessageId,
            direction: 'outbound',
            type: messageType,
            content: messageContent,
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: false
        });

        // Update conversation
        const preview = templateName ? `📋 Template: ${templateName}` : text.trim().substring(0, 100);
        conversation.lastMessage = preview;
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

// Send media message in a conversation
exports.sendMediaMessage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { mediaType, mediaUrl, caption } = req.body;

        const conversation = await WhatsAppConversation.findOne({ _id: id, userId });
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        const { sendMediaMessage: sendMedia } = require('../services/whatsappService');

        // Upload media to WhatsApp first, then send
        const axios = require('axios');
        const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
        let phoneNumberId, accessToken;

        const creds = await getUserWhatsAppCredentials(userId);
        if (creds?.phoneNumberId && creds?.accessToken) {
            phoneNumberId = creds.phoneNumberId;
            accessToken = creds.accessToken;
        } else {
            phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
            accessToken = process.env.WA_ACCESS_TOKEN;
        }

        // If mediaUrl is a link, send by link
        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
        const data = {
            messaging_product: "whatsapp",
            to: conversation.phone,
            type: mediaType,
            [mediaType]: { link: mediaUrl }
        };
        if (caption) data[mediaType].caption = caption;

        const response = await axios.post(url, data, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });

        const waMessageId = response.data.messages?.[0]?.id;

        // Save message record
        const message = new WhatsAppMessage({
            conversationId: conversation._id,
            userId,
            waMessageId,
            direction: 'outbound',
            type: mediaType,
            content: { mediaUrl, caption, text: caption || '' },
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: false
        });
        await message.save();

        conversation.lastMessage = caption || `📎 ${mediaType}`;
        conversation.lastMessageAt = new Date();
        conversation.lastMessageDirection = 'outbound';
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        conversation.metadata.totalOutbound = (conversation.metadata.totalOutbound || 0) + 1;
        await conversation.save();

        res.json({ success: true, message: message.toObject() });
    } catch (error) {
        console.error('Error sending media:', error);
        res.status(500).json({ message: 'Error sending media', error: error.response?.data?.error?.message || error.message });
    }
};

// Proxy to download media from WhatsApp (frontend can't call Meta API directly)
exports.downloadMediaProxy = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { mediaId } = req.params;

        const { downloadMedia } = require('../services/whatsappService');
        const result = await downloadMedia(mediaId, userId);

        res.set('Content-Type', result.mimeType);
        res.set('Content-Length', result.data.length);
        res.send(Buffer.from(result.data));
    } catch (error) {
        console.error('Error downloading media:', error);
        res.status(500).json({ message: 'Error downloading media' });
    }
};

