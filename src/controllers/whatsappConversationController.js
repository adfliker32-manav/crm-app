const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const WhatsAppTemplate = require('../models/WhatsAppTemplate');
const { sendWhatsAppTextMessage } = require('../services/whatsappService');
const { cancelActiveChatbots } = require('../services/chatbotEngineService');
// NOTE: conversation events go out through broadcastConversationEvent (below),
// never through emitToUser/emitToUsers directly — `user:<id>` rooms are
// reachable via join:company, so a per-user loop leaks to any agent who joined
// their manager's room. See whatsappAssignmentService + socketService.
const mongoose = require('mongoose');

const { buildMetaComponents, buildTemplateContext } = require('../utils/templateResolver');
const { escapeRegex } = require('../utils/controllerHelpers');

const { getUserWhatsAppCredentials, getCompanyUserIds } = require('../utils/whatsappUtils');
const { parseMetaError } = require('../utils/metaErrorUtils');

// 🔐 Visibility scope. Every handler below resolves its row through this BEFORE
// touching it, so a conversation outside the caller's scope 404s rather than
// leaking a 403 (same convention as teamTaskService/leadDocumentService).
// With WorkspaceSettings.whatsappFollowsLeadAssignment off it returns exactly
// the company-wide filter this controller always used.
const {
    conversationScope,
    withPredicate,
    resolveAssigneeForConversation,
    resolveAssignmentForConversation,
    isAssignmentRestricted,
    broadcastConversationEvent
} = require('../services/whatsappAssignmentService');


// Get all conversations visible to the caller. Shared across the company by
// default; narrowed to the caller's own leads when lead-based assignment is on
// and they lack `viewAllWhatsApp`.
exports.getConversations = async (req, res) => {
    try {
        const { status = 'active', search, page = 1, limit = 50 } = req.query;

        const scope = await conversationScope(req);

        // Build query — starts from the authorization scope, never widens it
        let query = { ...scope };

        if (status && status !== 'all') {
            query.status = status;
        }

        if (search) {
            const safe = escapeRegex(search);
            // ⚠️ Must be ANDed in, NOT assigned as `query.$or`. A bare
            // assignment would overwrite any $or the scope itself needs and
            // reads as an OR *against* the scope instead of a filter within it.
            query = withPredicate(query, {
                $or: [
                    { displayName: { $regex: safe, $options: 'i' } },
                    { phone: { $regex: safe, $options: 'i' } }
                ]
            });
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [conversations, total] = await Promise.all([
            WhatsAppConversation.find(query)
                .populate('leadId', 'name email status assignedTo')
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
        const { id } = req.params;
        const { page = 1, limit = 50 } = req.query;

        const scope = await conversationScope(req);

        const conversation = await WhatsAppConversation.findOne({ _id: id, ...scope })
            .populate('leadId', 'name email phone status source dealValue assignedTo')
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

        const scope = await conversationScope(req);
        const companyUserIds = await getCompanyUserIds(userId);

        // Find conversation — scoped, so an agent cannot send into a thread
        // they are not allowed to see just by knowing its id.
        const conversation = await WhatsAppConversation.findOne({ _id: id, ...scope });

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Cancel any active chatbot sessions — agent is taking over
        setImmediate(() => cancelActiveChatbots(conversation._id).catch(e => console.error('cancelActiveChatbots error:', e)));

        // Send via WhatsApp API
        // Resolve recipient: use phone if available, else BSUID for username-only contacts
        const recipient = conversation.phone || conversation.waBsuid;
        if (!recipient) {
            return res.status(400).json({ message: 'Cannot send message: contact has no phone number or BSUID.' });
        }
        const recipientType = conversation.phone ? undefined : 'user_id';
        const result = await sendWhatsAppTextMessage(recipient, text.trim(), userId, { recipientType, skipConversationRecord: true });
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

        // 🔌 Push to everyone allowed to see this conversation
        const savedMsg = message.toObject();
        broadcastConversationEvent({
            tenantId: req.tenantId,
            companyUserIds,
            conversationId: conversation._id,
            assignedTo: conversation.assignedTo,
            events: [
                { event: 'whatsapp:newMessage', data: { conversationId: conversation._id, message: savedMsg } },
                {
                    event: 'whatsapp:conversationUpdate',
                    data: {
                        conversationId: conversation._id,
                        updates: {
                            lastMessage: text.trim().substring(0, 100),
                            lastMessageAt: new Date(),
                            lastMessageDirection: 'outbound'
                        }
                    }
                }
            ]
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
        const { id } = req.params;

        const scope = await conversationScope(req);

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, ...scope },
            { $set: { unreadCount: 0 } },
            { returnDocument: 'after' }
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
        const { id } = req.params;
        const { leadId } = req.body;

        // Verify lead belongs to user
        let lead = null;
        if (leadId) {
            lead = await Lead.findOne({ _id: leadId, ...req.dataScope });
            if (!lead) {
                return res.status(404).json({ message: 'Lead not found' });
            }
        }

        const scope = await conversationScope(req);

        // Re-derive the owner from the newly linked Lead in the SAME write —
        // the Lead is the source of truth, so a conversation must never keep an
        // assignment justified by a lead it is no longer linked to.
        const assignedTo = await resolveAssigneeForConversation({
            tenantId: req.tenantId,
            lead: lead ? { _id: lead._id, assignedTo: lead.assignedTo } : null
        });

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, ...scope },
            { $set: { leadId: leadId || null, assignedTo } },
            { returnDocument: 'after' }
        ).populate('leadId', 'name email phone status source dealValue assignedTo');

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
        const { id } = req.params;
        const { status } = req.body;

        if (!['active', 'archived', 'spam'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status' });
        }

        const scope = await conversationScope(req);

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, ...scope },
            { $set: { status } },
            { returnDocument: 'after' }
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

// Clear all message history for a conversation while keeping the contact/thread itself
exports.clearConversationMessages = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;

        const scope = await conversationScope(req);
        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOne({ _id: id, ...scope });

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        await WhatsAppMessage.deleteMany({ conversationId: conversation._id });

        const updates = {
            lastMessage: '',
            unreadCount: 0,
            metadata: {
                ...((conversation.metadata && conversation.metadata.toObject)
                    ? conversation.metadata.toObject()
                    : (conversation.metadata || {})),
                totalMessages: 0,
                totalInbound: 0,
                totalOutbound: 0
            }
        };

        conversation.lastMessage = updates.lastMessage;
        conversation.unreadCount = updates.unreadCount;
        conversation.metadata.totalMessages = 0;
        conversation.metadata.totalInbound = 0;
        conversation.metadata.totalOutbound = 0;
        await conversation.save();

        const payload = {
            conversationId: conversation._id,
            updates
        };

        broadcastConversationEvent({
            tenantId: req.tenantId,
            companyUserIds,
            conversationId: conversation._id,
            assignedTo: conversation.assignedTo,
            events: [
                { event: 'whatsapp:conversationUpdate', data: payload },
                { event: 'whatsapp:conversationCleared', data: payload }
            ]
        });

        res.json({
            success: true,
            message: 'Chat history cleared successfully',
            updates
        });
    } catch (error) {
        console.error('Error clearing conversation messages:', error);
        res.status(500).json({ message: 'Error clearing chat history', error: 'Server error' });
    }
};

// Get unread count for badge
exports.getUnreadCount = async (req, res) => {
    try {
        // forAggregate: a $match stage does NOT coerce a string to an ObjectId,
        // so without the cast a restricted agent's badge would always read 0.
        const scope = await conversationScope(req, { forAggregate: true });

        const result = await WhatsAppConversation.aggregate([
            { $match: { ...scope, status: 'active' } },
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

        // Normalize phone — uses workspace's defaultCountryCode (set in Settings → Workspace)
        const { normalizePhoneForWhatsApp, getWorkspaceCountryCode } = require('../utils/phoneUtils');
        const countryCode = await getWorkspaceCountryCode(userId);
        const normalizedPhone = normalizePhoneForWhatsApp(phone, countryCode);

        const companyUserIds = await getCompanyUserIds(userId);
        const phoneLast10 = normalizedPhone.slice(-10);

        // 🔐 Resolve the requested lead ONCE, SCOPED to this workspace.
        // Every later use of `leadId` (the derived owner, the conversation's
        // lead link, the template variable context) previously went through a
        // bare `Lead.findById(req.body.leadId)` with no tenant filter, so a
        // caller could name another workspace's lead and get it written onto
        // this conversation — along with a foreign user as its derived owner,
        // and that lead's data rendered into the outgoing template.
        let requestedLead = null;
        if (leadId) {
            requestedLead = await Lead.findOne({ _id: leadId, ...req.dataScope });
            if (!requestedLead) {
                return res.status(404).json({ message: 'Lead not found or access denied' });
            }
        }

        // The lead this thread belongs to: the one named by the caller, or the
        // most recently touched lead carrying this phone number.
        const findLeadByPhone = () => Lead.findOne({
            userId: { $in: companyUserIds },
            phone: { $regex: phoneLast10 + '$' }
        }).sort({ updatedAt: -1 });

        // Company-wide lookup so we never create a duplicate thread for a
        // contact that already exists somewhere in the workspace — but the
        // access check below decides whether this caller may USE it.
        const companyFilter = { userId: { $in: companyUserIds } };

        let conversation = await WhatsAppConversation.findOne({
            ...companyFilter,
            waContactId: normalizedPhone
        });

        if (!conversation) {
            // Fallback: try matching by last 10 digits
            conversation = await WhatsAppConversation.findOne({
                ...companyFilter,
                waContactId: { $regex: phoneLast10 + '$' }
            });
        }

        // 🔐 An assignment-restricted agent may only open a thread they would be
        // allowed to see. Without this, "start a conversation" is a trivial
        // bypass: message anyone, then read the replies in the new thread.
        if (isAssignmentRestricted(req)) {
            if (conversation) {
                // Existing thread — it must already be theirs.
                if (String(conversation.assignedTo || '') !== String(userId)) {
                    return res.status(403).json({
                        message: 'This conversation belongs to another agent.'
                    });
                }
            } else {
                // New thread — the contact's lead must be theirs. An unknown
                // number has no lead, and therefore no owner, so it is refused.
                const targetLead = requestedLead
                    || await findLeadByPhone().select('assignedTo').lean();

                if (!targetLead || String(targetLead.assignedTo || '') !== String(userId)) {
                    return res.status(403).json({
                        message: 'You can only start conversations with leads assigned to you.'
                    });
                }
            }
        }

        // The lead behind this thread, however it was identified. Only looked
        // up when it can actually be used — a thread that already carries a
        // leadId is never re-pointed, so the phone lookup would be wasted.
        const needsLeadLookup = !conversation || !conversation.leadId;
        const resolvedLead = needsLeadLookup
            ? (requestedLead || await findLeadByPhone().select('assignedTo').lean())
            : null;

        if (!conversation) {
            const assignedTo = await resolveAssigneeForConversation({
                tenantId: req.tenantId,
                lead: resolvedLead || null
            });

            // Create new conversation
            conversation = new WhatsAppConversation({
                userId: userId,
                waContactId: normalizedPhone,
                phone: normalizedPhone,
                leadId: resolvedLead?._id || null,
                assignedTo,
                initiatedBy: 'user',
                metadata: {
                    firstMessageAt: new Date()
                }
            });
        } else if (!conversation.leadId && resolvedLead?._id) {
            // An EXISTING thread that was never linked to a lead. The link and
            // the derived owner used to be set only on the create path, so
            // starting a conversation with a lead whose thread already existed
            // left it orphaned (leadId: null) forever — invisible to lead-based
            // assignment, which filters on leadId.
            //
            // STRICTLY ADDITIVE, matching the webhook's rule: only ever
            // null -> a real link. Re-pointing a thread that already belongs to
            // another lead would silently steal it.
            conversation.leadId = resolvedLead._id;

            const { enabled, assignedTo } = await resolveAssignmentForConversation({
                tenantId: req.tenantId,
                lead: resolvedLead
            });
            if (enabled) conversation.assignedTo = assignedTo;
        }

        let result, waMessageId, messageContent, messageType;

        if (templateName) {
            // Send via Template API (required for new contacts / outside 24hr window)
            const templateObj = await WhatsAppTemplate.findOne({ userId, name: templateName });
            let metaComponents = null;
            
            if (templateObj) {
                const userObj = await User.findById(userId);
                // Scoped: `requestedLead` was already resolved through
                // req.dataScope, so a foreign lead's fields can never be
                // rendered into this workspace's outgoing template.
                const leadObj = requestedLead
                    || await Lead.findOne({ userId: userId, phone: normalizedPhone });
                
                const { resolveTemplateMedia } = require('../services/mediaLibraryService');
                const media = await resolveTemplateMedia(templateObj, userId);

                const tplContext = buildTemplateContext({
                    lead: leadObj,
                    user: userObj,
                    system: { customData: { media } }
                });

                metaComponents = buildMetaComponents(
                    templateObj.components || [], templateObj.variableMapping, tplContext
                );
            }

            const { sendWhatsAppMessage } = require('../services/whatsappService');
            const languageCode = templateObj ? templateObj.language : 'en_US';
            result = await sendWhatsAppMessage(normalizedPhone, templateName, userId, metaComponents, languageCode, { skipConversationRecord: true });
            waMessageId = result?.messages?.[0]?.id;
            messageContent = { text: `[Template: ${templateName}]`, templateName: templateName };
            messageType = 'template';
        } else {
            // Send via free-text (only works within 24hr window)
            result = await sendWhatsAppTextMessage(normalizedPhone, text.trim(), userId, { skipConversationRecord: true });
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

        const savedMsg = message.toObject();
        res.json({
            success: true,
            conversation: conversation.toObject(),
            message: savedMsg
        });

        // 🔌 Push to everyone allowed to see this conversation
        broadcastConversationEvent({
            tenantId: req.tenantId,
            companyUserIds,
            conversationId: conversation._id,
            assignedTo: conversation.assignedTo,
            events: [
                { event: 'whatsapp:newMessage', data: { conversationId: conversation._id, message: savedMsg } },
                {
                    event: 'whatsapp:conversationUpdate',
                    data: {
                        conversationId: conversation._id,
                        updates: {
                            lastMessage: conversation.lastMessage,
                            lastMessageAt: conversation.lastMessageAt,
                            lastMessageDirection: 'outbound'
                        }
                    }
                }
            ]
        });
    } catch (error) {
        const { msg: errorMsg, code: errorCode, category } = parseMetaError(error);
        console.error(`Error starting conversation [${category}/${errorCode}]:`, errorMsg);

        let statusCode = error.response?.status || 500;
        // Prevent Meta's 401 Unauthorized from triggering frontend logout interceptor
        if (statusCode === 401) statusCode = 400;

        res.status(statusCode).json({
            success: false,
            message: errorMsg,
            error: errorMsg,
            errorCode,
            errorCategory: category
        });
    }
};

// Send media message in a conversation (file upload via multer)
exports.sendMediaMessage = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const caption = req.body.caption || '';

        const scope = await conversationScope(req);
        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOne({ _id: id, ...scope });
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Cancel any active chatbot sessions — agent is taking over
        setImmediate(() => cancelActiveChatbots(conversation._id).catch(e => console.error('cancelActiveChatbots error:', e)));

        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        let { mimetype, buffer, originalname, size } = req.file;

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

        // Normalize images before uploading to Meta.
        // WhatsApp's delivery pipeline rejects PNGs with alpha transparency, unusual
        // color profiles, or very large dimensions even when the file is under 5 MB.
        // Converting to a flat JPEG (quality 92, max 1600px) eliminates all these cases.
        if (mediaType === 'image') {
            try {
                const sharp = require('sharp');
                buffer = await sharp(buffer)
                    .flatten({ background: { r: 255, g: 255, b: 255 } }) // replace transparency with white
                    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 92 })
                    .toBuffer();
                mimetype = 'image/jpeg';
                originalname = originalname.replace(/\.[^.]+$/, '.jpg');
                size = buffer.length;
                console.log(`🖼️ [Media] Image normalized to JPEG, size: ${(size / 1024).toFixed(0)} KB`);
            } catch (sharpErr) {
                // Non-fatal: upload the original if normalization fails
                console.warn('⚠️ [Media] Image normalization failed, uploading original:', sharpErr.message);
            }
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
        const uploadUrl = `https://graph.facebook.com/v26.0/${phoneNumberId}/media`;
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
        const sendUrl = `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`;
        const mediaRecipient = conversation.phone || conversation.waBsuid;
        const msgData = {
            messaging_product: 'whatsapp',
            to: mediaRecipient,
            type: mediaType,
            [mediaType]: { id: mediaId }
        };
        // BSUID support: username-only contacts need recipient_type: 'user_id'
        if (!conversation.phone && conversation.waBsuid) {
            msgData.recipient_type = 'user_id';
        }
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

        const savedMsg = message.toObject();
        res.json({ success: true, message: savedMsg });

        // 🔌 Push to the whole team via Socket.IO (shared inbox — all company users)
        broadcastConversationEvent({
            tenantId: req.tenantId,
            companyUserIds,
            conversationId: conversation._id,
            assignedTo: conversation.assignedTo,
            events: [
                { event: 'whatsapp:newMessage', data: { conversationId: conversation._id, message: savedMsg } },
                {
                    event: 'whatsapp:conversationUpdate',
                    data: {
                        conversationId: conversation._id,
                        updates: {
                            lastMessage: conversation.lastMessage,
                            lastMessageAt: conversation.lastMessageAt,
                            lastMessageDirection: 'outbound'
                        }
                    }
                }
            ]
        });
    } catch (error) {
        console.error('Error sending media:', error.response?.data || error.message);
        const metaError = error.response?.data?.error?.message || error.message;
        
        let statusCode = error.response?.status || 500;
        // Prevent Meta's 401 Unauthorized from triggering frontend logout interceptor
        if (statusCode === 401) statusCode = 400;

        res.status(statusCode).json({ message: `Error sending media: ${metaError}`, error: metaError });
    }
};

// Send media from the Media Library (no file upload — bytes come from object storage)
exports.sendMediaFromLibrary = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { id } = req.params;
        const { mediaAssetId, caption = '' } = req.body;

        if (!mediaAssetId) {
            return res.status(400).json({ message: 'mediaAssetId is required' });
        }

        const scope = await conversationScope(req);
        const companyUserIds = await getCompanyUserIds(userId);

        const conversation = await WhatsAppConversation.findOne({ _id: id, ...scope });
        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Cancel any active chatbot sessions — agent is taking over
        setImmediate(() => cancelActiveChatbots(conversation._id).catch(e => console.error('cancelActiveChatbots error:', e)));

        // Look up the media asset (tenant-scoped)
        const MediaAsset = require('../models/MediaAsset');
        const storage = require('../services/storageService');
        const asset = await MediaAsset.findOne({ _id: mediaAssetId, userId: { $in: companyUserIds } });
        if (!asset) {
            return res.status(404).json({ message: 'Media asset not found in your library' });
        }

        // Map library mediaType to WhatsApp message type
        const typeMap = { IMAGE: 'image', VIDEO: 'video', DOCUMENT: 'document', AUDIO: 'audio' };
        const mediaType = typeMap[asset.mediaType] || 'document';

        // Fetch bytes from object storage
        let buffer = await storage.getBuffer(asset.storageKey);
        let mimetype = asset.mimeType;
        let originalname = asset.fileName;
        let size = buffer.length;

        // Normalize images (same as sendMediaMessage) to avoid Meta rejections
        if (mediaType === 'image') {
            try {
                const sharp = require('sharp');
                buffer = await sharp(buffer)
                    .flatten({ background: { r: 255, g: 255, b: 255 } })
                    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 92 })
                    .toBuffer();
                mimetype = 'image/jpeg';
                originalname = originalname.replace(/\.[^.]+$/, '.jpg');
                size = buffer.length;
                console.log(`🖼️ [MediaLibrary] Image normalized to JPEG, size: ${(size / 1024).toFixed(0)} KB`);
            } catch (sharpErr) {
                console.warn('⚠️ [MediaLibrary] Image normalization failed, uploading original:', sharpErr.message);
            }
        }

        // Upload to Meta
        const axios = require('axios');
        const creds = await getUserWhatsAppCredentials(userId);
        if (!creds?.phoneNumberId || !creds?.accessToken) {
            return res.status(400).json({
                message: 'WhatsApp not configured. Go to Settings → WhatsApp Config to set up your credentials.'
            });
        }
        const { phoneNumberId, accessToken } = creds;

        const uploadUrl = `https://graph.facebook.com/v26.0/${phoneNumberId}/media`;
        const FormData = require('form-data');
        const form = new FormData();
        form.append('messaging_product', 'whatsapp');
        form.append('file', buffer, { filename: originalname, contentType: mimetype });
        form.append('type', mimetype);

        const MB = 1024 * 1024;
        const uploadRes = await axios.post(uploadUrl, form, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                ...form.getHeaders()
            },
            maxContentLength: 100 * MB,
            maxBodyLength: 100 * MB
        });

        const metaMediaId = uploadRes.data.id;
        console.log(`✅ [MediaLibrary] Media uploaded to WhatsApp, ID: ${metaMediaId}`);

        // Send the message
        const sendUrl = `https://graph.facebook.com/v26.0/${phoneNumberId}/messages`;
        const mediaRecipient = conversation.phone || conversation.waBsuid;
        const msgData = {
            messaging_product: 'whatsapp',
            to: mediaRecipient,
            type: mediaType,
            [mediaType]: { id: metaMediaId }
        };
        if (!conversation.phone && conversation.waBsuid) {
            msgData.recipient_type = 'user_id';
        }
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
        console.log(`✅ [MediaLibrary] Media message sent (${mediaType}):`, waMessageId);

        // Save message record
        const message = new WhatsAppMessage({
            conversationId: conversation._id,
            userId,
            waMessageId,
            direction: 'outbound',
            type: mediaType,
            content: {
                mediaId: metaMediaId,
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

        // Bump usage stats on the library asset
        MediaAsset.updateOne(
            { _id: asset._id },
            { $inc: { usageCount: 1 }, $set: { lastUsedAt: new Date() } }
        ).catch(e => console.error('[MediaLibrary] usageCount bump failed:', e.message));

        const savedMsg = message.toObject();
        res.json({ success: true, message: savedMsg });

        // Push to the whole team via Socket.IO
        broadcastConversationEvent({
            tenantId: req.tenantId,
            companyUserIds,
            conversationId: conversation._id,
            assignedTo: conversation.assignedTo,
            events: [
                { event: 'whatsapp:newMessage', data: { conversationId: conversation._id, message: savedMsg } },
                {
                    event: 'whatsapp:conversationUpdate',
                    data: {
                        conversationId: conversation._id,
                        updates: {
                            lastMessage: conversation.lastMessage,
                            lastMessageAt: conversation.lastMessageAt,
                            lastMessageDirection: 'outbound'
                        }
                    }
                }
            ]
        });
    } catch (error) {
        console.error('[MediaLibrary] Error sending media from library:', error.response?.data || error.message);
        const metaError = error.response?.data?.error?.message || error.message;

        let statusCode = error.response?.status || 500;
        if (statusCode === 401) statusCode = 400;

        res.status(statusCode).json({ message: `Error sending media: ${metaError}`, error: metaError });
    }
};

// Proxy to download media from WhatsApp (frontend can't call Meta API directly)
exports.downloadMediaProxy = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { mediaId } = req.params;

        // ⚠️ TENANT ISOLATION: this used to hand `mediaId` straight to Meta with no
        // local ownership check, delegating isolation entirely to Meta's token
        // scoping. That delegation fails whenever two workspaces share one WABA
        // phone number, and it also meant the on-disk media cache
        // (uploads/whatsapp/<mediaId>.<ext>) could be populated/served for a media
        // id belonging to someone else. Prove the caller's own workspace actually
        // has a message carrying this media id before fetching anything.
        if (!mediaId || !/^\d{5,40}$/.test(String(mediaId))) {
            return res.status(400).json({ message: 'Invalid media id' });
        }

        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const companyUserIds = await getCompanyUserIds(userId);
        // One query proves ownership AND yields the storage key — the ownership
        // gate stays exactly where it was, before any bytes are fetched.
        const owningMsg = await WhatsAppMessage.findOne(
            { 'content.mediaId': String(mediaId), userId: { $in: companyUserIds } },
            { 'content.storageKey': 1, 'content.mimeType': 1, conversationId: 1 }
        ).lean();
        if (!owningMsg) {
            console.warn(`🛑 [Media] Denied: user ${userId} -> mediaId ${mediaId}`);
            return res.status(404).json({ message: 'Media not found' });
        }

        // Company ownership alone is not enough once the inbox is assignment-
        // based: a restricted agent could otherwise pull attachments out of a
        // thread they cannot open, just by guessing a media id. Prove the
        // OWNING CONVERSATION is in scope too.
        const scope = await conversationScope(req);
        const visible = await WhatsAppConversation.exists({ _id: owningMsg.conversationId, ...scope });
        if (!visible) {
            console.warn(`🛑 [Media] Denied (conversation out of scope): user ${userId} -> mediaId ${mediaId}`);
            return res.status(404).json({ message: 'Media not found' });
        }

        // Prefer the durable mirror in object storage. Meta purges media after
        // ~30 days, so for anything older this is the ONLY surviving copy.
        // Messages that predate the mirror fall through to the Meta fetch.
        let result = null;
        const storageKey = owningMsg.content?.storageKey;
        if (storageKey) {
            try {
                const storage = require('../services/storageService');
                const data = await storage.getBuffer(storageKey);
                result = { data, mimeType: owningMsg.content?.mimeType || 'application/octet-stream' };
            } catch (storageErr) {
                console.warn(`[Media] Storage read failed for ${storageKey}, falling back to Meta:`, storageErr.message);
            }
        }

        if (!result) {
            const { downloadMedia } = require('../services/whatsappService');
            result = await downloadMedia(mediaId, userId);

            // Backfill on demand: an un-mirrored media that is still fetchable
            // gets persisted now, so it survives Meta's retention window.
            if (!storageKey) {
                const { mirrorInboundMedia } = require('../services/inboundMediaService');
                mirrorInboundMedia({ mediaId, userId, mimeType: result.mimeType })
                    .catch(err => console.error('[Media] Lazy mirror failed:', err.message));
            }
        }

        const buffer = Buffer.from(result.data);
        const total = buffer.length;

        // WhatsApp media is immutable per media ID — safe to cache aggressively.
        res.set('Content-Type', result.mimeType);
        res.set('Cache-Control', 'private, max-age=86400, immutable');
        res.set('Accept-Ranges', 'bytes');

        // Optional forced download (documents) with a friendly filename.
        if (req.query.download) {
            const safeName = String(req.query.name || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
            res.set('Content-Disposition', `attachment; filename="${safeName}"`);
        }

        // Range request (audio/video seeking) → 206 Partial Content.
        const match = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
        if (match && (match[1] || match[2])) {
            let start, end;
            if (match[1] === '') {
                // Suffix range "bytes=-N" → last N bytes.
                const suffix = parseInt(match[2], 10);
                start = Math.max(total - suffix, 0);
                end = total - 1;
            } else {
                start = parseInt(match[1], 10);
                end = match[2] ? parseInt(match[2], 10) : total - 1;
            }
            if (isNaN(start) || start < 0) start = 0;
            if (isNaN(end) || end >= total) end = total - 1;
            if (start > end) { start = 0; end = total - 1; }
            const chunk = buffer.subarray(start, end + 1);
            res.status(206);
            res.set('Content-Range', `bytes ${start}-${end}/${total}`);
            res.set('Content-Length', chunk.length);
            return res.end(chunk);
        }

        res.set('Content-Length', total);
        res.end(buffer);
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

        const scope = await conversationScope(req);
        const companyUserIds = await getCompanyUserIds(userId);

        // Find conversation and reset chatbotPausedUntil
        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { _id: id, ...scope },
            { $set: { chatbotPausedUntil: new Date(0) } },
            { returnDocument: 'after' }
        );

        if (!conversation) {
            return res.status(404).json({ message: 'Conversation not found' });
        }

        // Emit update to everyone allowed to see this conversation
        broadcastConversationEvent({
            tenantId: req.tenantId,
            companyUserIds,
            conversationId: conversation._id,
            assignedTo: conversation.assignedTo,
            events: [{
                event: 'whatsapp:conversationUpdate',
                data: {
                    conversationId: conversation._id,
                    updates: { chatbotPausedUntil: conversation.chatbotPausedUntil }
                }
            }]
        });

        res.json({ success: true, message: 'Chatbot resumed successfully', conversation });
    } catch (error) {
        console.error('Error resuming chatbot:', error);
        res.status(500).json({ message: 'Error resuming chatbot', error: 'Server error' });
    }
};


// ============================================================
// SETTINGS: Lead-based WhatsApp conversation assignment
// ============================================================
// Lives here (rather than in metaController alongside the other lead-assignment
// settings) because those endpoints are each gated by
// requireFeature('leads.metaSync'), which is the wrong gate for a setting that
// governs the WhatsApp inbox regardless of whether Meta sync is in the plan.

// GET /api/leads/whatsapp-assignment-config
exports.getAssignmentConfig = async (req, res) => {
    try {
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const ws = await WorkspaceSettings.findOne({ userId: req.tenantId })
            .select('whatsappFollowsLeadAssignment')
            .lean();

        res.json({
            success: true,
            whatsappFollowsLeadAssignment: ws?.whatsappFollowsLeadAssignment === true
        });
    } catch (error) {
        console.error('Error reading WhatsApp assignment config:', error);
        res.status(500).json({ message: 'Error reading configuration', error: 'Server error' });
    }
};

// PUT /api/leads/whatsapp-assignment-config
exports.updateAssignmentConfig = async (req, res) => {
    try {
        const { whatsappFollowsLeadAssignment } = req.body;

        if (typeof whatsappFollowsLeadAssignment !== 'boolean') {
            return res.status(400).json({
                message: 'whatsappFollowsLeadAssignment must be true or false'
            });
        }

        const WorkspaceSettings = require('../models/WorkspaceSettings');
        // upsert: a workspace row should always exist, but a missing one must
        // not silently swallow the setting.
        await WorkspaceSettings.findOneAndUpdate(
            { userId: req.tenantId },
            { $set: { whatsappFollowsLeadAssignment } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        // WorkspaceSettings' post-findOneAndUpdate hook clears req.workspace's
        // tenantCache entry. The assignment service keeps its OWN 5-minute cache
        // for the contexts that have no req (webhook, cron, broadcasts), so that
        // one has to be invalidated explicitly or the toggle would appear to do
        // nothing to inbound traffic for up to five minutes.
        const { invalidateFollowLeadCache } = require('../services/whatsappAssignmentService');
        invalidateFollowLeadCache(req.tenantId);

        res.json({ success: true, whatsappFollowsLeadAssignment });
    } catch (error) {
        console.error('Error saving WhatsApp assignment config:', error);
        res.status(500).json({ message: 'Error saving configuration', error: 'Server error' });
    }
};
