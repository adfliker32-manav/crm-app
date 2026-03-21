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

// Get all conversations for the user (shared across same WhatsApp phone number within same company)
exports.getConversations = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { status = 'active', search, page = 1, limit = 50 } = req.query;

        // Determine the company boundary:
        // - If the current user is a manager, their companyId IS their own _id
        // - If the current user is an agent, their companyId is their parentId
        const currentUser = await User.findById(userId).select('waPhoneNumberId role parentId').lean();
        const companyManagerId = currentUser.role === 'agent' ? currentUser.parentId : userId;

        // Collect all userIds in the same company that share the same WhatsApp phone number.
        // SECURITY: We scope this query to users within the same company tree ONLY,
        // preventing cross-company data leaks even if two companies configure the same phone number.
        let userIds = [new mongoose.Types.ObjectId(userId)];
        if (currentUser?.waPhoneNumberId) {
            const sharedUsers = await User.find(
                {
                    waPhoneNumberId: currentUser.waPhoneNumberId,
                    // Restrict to users within the SAME company
                    $or: [
                        { _id: companyManagerId },             // the manager themselves
                        { parentId: companyManagerId }         // agents under this manager
                    ]
                },
                { _id: 1 }
            ).lean();
            userIds = sharedUsers.map(u => new mongoose.Types.ObjectId(u._id));
        }
        // Always ensure current user is included (edge case: agent with no waPhoneNumberId)
        if (!userIds.some(id => id.equals(new mongoose.Types.ObjectId(userId)))) {
            userIds.push(new mongoose.Types.ObjectId(userId));
        }

        // Build query — include conversations from all shared users
        const query = { userId: { $in: userIds } };

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

        const conversation = await WhatsAppConversation.findOne({ _id: id, userId });
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

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
        let phoneNumberId, accessToken;

        const creds = await getUserWhatsAppCredentials(userId);
        if (creds?.phoneNumberId && creds?.accessToken) {
            phoneNumberId = creds.phoneNumberId;
            accessToken = creds.accessToken;
        } else {
            phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
            accessToken = process.env.WA_ACCESS_TOKEN;
        }

        // Upload media to WhatsApp
        const uploadUrl = `https://graph.facebook.com/v17.0/${phoneNumberId}/media`;
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
        const sendUrl = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
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

