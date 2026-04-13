const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { sendWhatsAppTextMessage } = require('../services/whatsappService');
const { cancelActiveChatbots } = require('../services/chatbotEngineService');
const { emitToUser, emitToConversation } = require('../services/socketService');
const mongoose = require('mongoose');

const { buildMetaComponents } = require('../utils/templateVariableResolver');
const { escapeRegex } = require('../utils/controllerHelpers');

const { getUserWhatsAppCredentials, getCompanyUserIds } = require('../utils/whatsappUtils');

// Get all conversations for the user (shared across same WhatsApp phone number within same company)
exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { status = 'active', search, page = 1, limit = 50 } = req.query;

        const userIds = await getCompanyUserIds(userId);

        // Build query — include conversations from all shared users
        const query = { userId: { $in: userIds } };

        if (status && status !== 'all') {
            query.status = status;
        }

        if (search) {
            const safe = escapeRegex(search);
            query.$or = [
                { displayName: { $regex: safe, $options: 'i' } },
                { phone: { $regex: safe, $options: 'i' } }
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
        res.status(500).json({ message: 'Error fetching conversations', error: 'Server error' });
    }
};

// Get single conversation with messages
exports.getConversation = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { page = 1, limit = 50 } = req.query;

        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOne({
            _id: id,
            userId: { $in: companyUserIds }
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
        res.status(500).json({ message: 'Error fetching conversation', error: 'Server error' });
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

        const companyUserIds = await getCompanyUserIds(userId);

        // Find conversation
        const conversation = await WhatsAppConversation.findOne({
            _id: id,
            userId: { $in: companyUserIds }
        });

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Cancel any active chatbot sessions — agent is taking over
        setImmediate(() => cancelActiveChatbots(conversation._id).catch(e => console.error('cancelActiveChatbots error:', e)));

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

        // Update conversation atomically to avoid race conditions with concurrent sends
        await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
            $set: {
                lastMessage: text.trim().substring(0, 100),
                lastMessageAt: new Date(),
                lastMessageDirection: 'outbound'
            },
            $inc: {
                'metadata.totalMessages': 1,
                'metadata.totalOutbound': 1
            }
        });

        res.json({
            success: true,
            message: message.toObject(),
            waMessageId
        });

        // 🔌 Push to frontend via Socket.IO (real-time for other tabs/agents)
        const savedMsg = message.toObject();
        emitToUser(userId, 'whatsapp:newMessage', {
            conversationId: conversation._id,
            message: savedMsg
        });
        emitToConversation(conversation._id.toString(), 'whatsapp:newMessage', {
            conversationId: conversation._id,
            message: savedMsg
        });
        emitToUser(userId, 'whatsapp:conversationUpdate', {
            conversationId: conversation._id,
            updates: {
                lastMessage: text.trim().substring(0, 100),
                lastMessageAt: new Date(),
                lastMessageDirection: 'outbound'
            }
        });
    } catch (error) {
        let errorMsg = error.message;
        if (error.response && error.response.data && error.response.data.error) {
            const metaError = error.response.data.error;
            errorMsg = metaError.message || metaError.error_user_msg || 'WhatsApp API Error';
            if (metaError.code === 131009) {
                errorMsg = "User must register a valid template format before sending (Wait for approval)";
            } else if (metaError.code === 131026) {
                errorMsg = "Message undeliverable. User has not interacted with the business or is outside the 24h window.";
            } else if (metaError.code) {
                errorMsg = `Meta API Error (${metaError.code}): ${errorMsg}`;
            }
        }
        console.error('Error sending message:', errorMsg);
        
        let statusCode = error.response?.status || 500;
        // Prevent Meta's 401 Unauthorized from triggering frontend logout interceptor
        if (statusCode === 401) statusCode = 400;

        res.status(statusCode).json({
            success: false,
            message: `Failed to send message: ${errorMsg}`,
            error: errorMsg
        });
    }
};

// Mark conversation as read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, userId: { $in: companyUserIds } },
            { $set: { unreadCount: 0 } },
            { new: true }
        );

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error marking as read:', error);
        res.status(500).json({ message: 'Error marking as read', error: 'Server error' });
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
            const lead = await Lead.findOne({ _id: leadId, ...req.dataScope });
            if (!lead) {
                return res.status(404).json({ message: 'Lead not found' });
            }
        }

        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, userId: { $in: companyUserIds } },
            { $set: { leadId: leadId || null } },
            { new: true }
        ).populate('leadId', 'name email phone status source dealValue');

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error linking to lead:', error);
        res.status(500).json({ message: 'Error linking to lead', error: 'Server error' });
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

        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, userId: { $in: companyUserIds } },
            { $set: { status } },
            { new: true }
        );

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        res.json({ success: true, conversation });
    } catch (error) {
        console.error('Error updating status:', error);
        res.status(500).json({ message: 'Error updating status', error: 'Server error' });
    }
};

// Get unread count for badge
exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const companyUserIds = await getCompanyUserIds(userId);

        const result = await WhatsAppConversation.aggregate([
            { $match: { userId: { $in: companyUserIds }, status: 'active' } },
            { $group: { _id: null, totalUnread: { $sum: '$unreadCount' } } }
        ]);

        const totalUnread = result[0]?.totalUnread || 0;

        res.json({ success: true, unreadCount: totalUnread });
    } catch (error) {
        console.error('Error getting unread count:', error);
        res.status(500).json({ message: 'Error getting unread count', error: 'Server error' });
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

        const companyUserIds = await getCompanyUserIds(userId);

        // Check if conversation already exists
        let conversation = await WhatsAppConversation.findOne({
            userId: { $in: companyUserIds },
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
                const leadObj = leadId ? await Lead.findById(leadId) : await Lead.findOne({ userId: userId, phone: normalizedPhone });
                
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
        let errorMsg = error.message;
        if (error.response && error.response.data && error.response.data.error) {
            const metaError = error.response.data.error;
            errorMsg = metaError.message || metaError.error_user_msg || 'WhatsApp API Error';
            if (metaError.code === 131009) {
                errorMsg = "User must register a valid template format before sending (Wait for approval)";
            } else if (metaError.code === 131026) {
                errorMsg = "Message undeliverable. User has not interacted with the business or is outside the 24h window.";
            } else if (metaError.code) {
                errorMsg = `Meta API Error (${metaError.code}): ${errorMsg}`;
            }
        }
        console.error('Error starting conversation:', errorMsg);
        
        let statusCode = error.response?.status || 500;
        // Prevent Meta's 401 Unauthorized from triggering frontend logout interceptor
        if (statusCode === 401) statusCode = 400;
        
        res.status(statusCode).json({
            success: false,
            message: `Failed to start conversation: ${errorMsg}`,
            error: errorMsg
        });
    }
};

// Send media message in a conversation (file upload via multer)
exports.sendMediaMessage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const caption = req.body.caption || '';

        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOne({ _id: id, userId: { $in: companyUserIds } });
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Cancel any active chatbot sessions — agent is taking over
        setImmediate(() => cancelActiveChatbots(conversation._id).catch(e => console.error('cancelActiveChatbots error:', e)));

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const { mimetype, buffer, originalname, size } = req.file;

        // Determine media type and validate
        let mediaType;
        const MB = 1024 * 1024;

        if (mimetype.startsWith('image/')) {
            mediaType = 'image';
            if (size > 5 * MB) return res.status(400).json({ message: 'Image must be under 5 MB' });
        } else if (mimetype.startsWith('video/')) {
            mediaType = 'video';
            if (size > 16 * MB) return res.status(400).json({ message: 'Video must be under 16 MB' });
        } else {
            // Treat everything else as document (PDF, DOC, XLSX, etc.)
            mediaType = 'document';
            if (size > 100 * MB) return res.status(400).json({ message: 'Document must be under 100 MB' });
        }

        // Step 1: Upload file to Meta via Resumable Upload API
        const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
        const axios = require('axios');
        const creds = await getUserWhatsAppCredentials(userId);
        if (!creds?.phoneNumberId || !creds?.accessToken) {
            return res.status(400).json({ 
                message: 'WhatsApp not configured. Go to Settings → WhatsApp Config to set up your credentials.' 
            });
        }
        const { phoneNumberId, accessToken } = creds;

        // Upload media to WhatsApp
        const uploadUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/media`;
        const FormData = require('form-data');
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', buffer, { filename: originalname, contentType: mimetype });
        form.append('type', mimetype);

        const uploadRes = await axios.post(uploadUrl, form, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...form.getHeaders()
            },
            maxContentLength: 100 * MB,
            maxBodyLength: 100 * MB
        });

        const mediaId = uploadRes.data.id;
        console.log(`✅ Media uploaded to WhatsApp, ID: ${mediaId}`);

        // Step 2: Send media message using the uploaded media ID
        const sendUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
        const msgData = {
            messaging_product: 'whatsapp',
            to: conversation.phone,
            type: mediaType,
            [mediaType]: { id: mediaId }
        };
        if (caption && ['image', 'video', 'document'].includes(mediaType)) {
            msgData[mediaType].caption = caption;
        }
        if (mediaType === 'document') {
            msgData[mediaType].filename = originalname;
        }

        const sendRes = await axios.post(sendUrl, msgData, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
        });

        const waMessageId = sendRes.data.messages?.[0]?.id;
        console.log(`✅ Media message sent (${mediaType}):`, waMessageId);

        // Step 3: Save message record
        const message = new WhatsAppMessage({
            conversationId: conversation._id,
            userId,
            waMessageId,
            direction: 'outbound',
            type: mediaType,
            content: {
                mediaId: mediaId,
                caption: caption || undefined,
                fileName: originalname,
                mimeType: mimetype,
                text: caption || `📎 ${originalname}`
            },
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: false
        });
        await message.save();

        conversation.lastMessage = caption || `📎 ${originalname}`;
        conversation.lastMessageAt = new Date();
        conversation.lastMessageDirection = 'outbound';
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        conversation.metadata.totalOutbound = (conversation.metadata.totalOutbound || 0) + 1;
        await conversation.save();

        res.json({ success: true, message: message.toObject() });
    } catch (error) {
        console.error('Error sending media:', error.response?.data || error.message);
        const metaError = error.response?.data?.error?.message || error.message;
        
        let statusCode = error.response?.status || 500;
        // Prevent Meta's 401 Unauthorized from triggering frontend logout interceptor
        if (statusCode === 401) statusCode = 400;

        res.status(statusCode).json({ message: `Error sending media: ${metaError}`, error: metaError });
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

// Resume/Unpause chatbot for a conversation (manually override the 24h human pause)
exports.resumeChatbot = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const companyUserIds = await getCompanyUserIds(userId);

        // Find conversation and reset chatbotPausedUntil
        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, userId: { $in: companyUserIds } },
            { $set: { chatbotPausedUntil: new Date(0) } },
            { new: true }
        );

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Emit update to frontend
        emitToUser(userId, 'whatsapp:conversationUpdate', {
            conversationId: conversation._id,
            updates: { chatbotPausedUntil: conversation.chatbotPausedUntil }
        });

        res.json({ success: true, message: 'Chatbot resumed successfully', conversation });
    } catch (error) {
        console.error('Error resuming chatbot:', error);
        res.status(500).json({ message: 'Error resuming chatbot', error: 'Server error' });
    }
};

