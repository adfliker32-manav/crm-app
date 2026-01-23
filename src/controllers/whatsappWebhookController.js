const crypto = require('crypto');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');

// Verify webhook - called by Meta to verify the endpoint
exports.verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Get verify token from environment
    const VERIFY_TOKEN = process.env.WA_WEBHOOK_VERIFY_TOKEN || 'whatsapp_webhook_verify_token';

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook verified successfully');
            res.status(200).send(challenge);
        } else {
            console.log('❌ Webhook verification failed - token mismatch');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

// Verify signature from Meta
const verifySignature = (req) => {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return false;

    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
        console.warn('⚠️ META_APP_SECRET not set, skipping signature verification');
        return true; // Skip verification if no secret configured
    }

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
};

// Handle incoming webhook
exports.handleWebhook = async (req, res) => {
    try {
        // Verify signature (optional but recommended)
        if (process.env.META_APP_SECRET && !verifySignature(req)) {
            console.error('❌ Invalid webhook signature');
            return res.sendStatus(403);
        }

        const body = req.body;

        // Check if this is a WhatsApp webhook
        if (body.object !== 'whatsapp_business_account') {
            return res.sendStatus(404);
        }

        // Respond immediately to acknowledge receipt
        res.sendStatus(200);

        // Process entries asynchronously
        if (body.entry && body.entry.length > 0) {
            for (const entry of body.entry) {
                await processEntry(entry);
            }
        }
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        // Still return 200 to prevent Meta from retrying
        if (!res.headersSent) {
            res.sendStatus(200);
        }
    }
};

// Process a single entry from the webhook
const processEntry = async (entry) => {
    const changes = entry.changes || [];

    for (const change of changes) {
        if (change.field === 'messages') {
            const value = change.value;
            const phoneNumberId = value.metadata?.phone_number_id;

            // Find the user who owns this phone number
            const user = await User.findOne({ waPhoneNumberId: phoneNumberId });
            if (!user) {
                console.log(`⚠️ No user found for phone number ID: ${phoneNumberId}`);
                continue;
            }

            // Process messages
            if (value.messages && value.messages.length > 0) {
                for (const message of value.messages) {
                    await processIncomingMessage(message, value.contacts, user._id);
                }
            }

            // Process status updates
            if (value.statuses && value.statuses.length > 0) {
                for (const status of value.statuses) {
                    await processStatusUpdate(status, user._id);
                }
            }
        }
    }
};

// Process an incoming message
const processIncomingMessage = async (message, contacts, userId) => {
    try {
        const from = message.from; // Sender's phone number
        const waMessageId = message.id;
        const timestamp = new Date(parseInt(message.timestamp) * 1000);

        // Get contact info
        const contact = contacts?.find(c => c.wa_id === from);
        const displayName = contact?.profile?.name || null;

        // Find or create conversation
        let conversation = await WhatsAppConversation.findOne({
            userId: userId,
            waContactId: from
        });

        if (!conversation) {
            // Try to link to existing lead by phone
            const lead = await Lead.findOne({
                userId: userId,
                phone: { $regex: from.slice(-10), $options: 'i' }
            });

            conversation = new WhatsAppConversation({
                userId: userId,
                waContactId: from,
                phone: from,
                displayName: displayName,
                leadId: lead?._id || null,
                metadata: {
                    firstMessageAt: timestamp
                }
            });
        }

        // Update conversation
        const messagePreview = extractMessagePreview(message);
        conversation.lastMessage = messagePreview;
        conversation.lastMessageAt = timestamp;
        conversation.lastMessageDirection = 'inbound';
        conversation.unreadCount = (conversation.unreadCount || 0) + 1;
        conversation.displayName = displayName || conversation.displayName;
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        conversation.metadata.totalInbound = (conversation.metadata.totalInbound || 0) + 1;

        await conversation.save();

        // Create message record
        const messageDoc = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: userId,
            waMessageId: waMessageId,
            direction: 'inbound',
            type: getMessageType(message),
            content: extractMessageContent(message),
            status: 'delivered',
            timestamp: timestamp,
            contextMessageId: message.context?.id || null
        });

        await messageDoc.save();

        console.log(`✅ Received message from ${from}: ${messagePreview.substring(0, 50)}...`);

        // Trigger chatbot/auto-reply logic
        const chatbotEngine = require('../services/chatbotEngineService');
        await chatbotEngine.processIncomingMessage(messageDoc, conversation._id, userId);

    } catch (error) {
        console.error('❌ Error processing incoming message:', error);
    }
};

// Process status updates (sent, delivered, read)
const processStatusUpdate = async (status, userId) => {
    try {
        const waMessageId = status.id;
        const statusType = status.status; // sent, delivered, read, failed
        const timestamp = new Date(parseInt(status.timestamp) * 1000);

        const message = await WhatsAppMessage.findOne({ waMessageId: waMessageId });
        if (!message) {
            console.log(`⚠️ Message not found for status update: ${waMessageId}`);
            return;
        }

        // Update message status
        message.status = statusType;
        message.statusTimestamps = message.statusTimestamps || {};
        message.statusTimestamps[statusType] = timestamp;

        if (statusType === 'failed' && status.errors) {
            message.error = {
                code: status.errors[0]?.code,
                message: status.errors[0]?.title || status.errors[0]?.message
            };
        }

        await message.save();

        console.log(`📬 Message ${waMessageId} status: ${statusType}`);

    } catch (error) {
        console.error('❌ Error processing status update:', error);
    }
};

// Helper: Get message type
const getMessageType = (message) => {
    if (message.text) return 'text';
    if (message.image) return 'image';
    if (message.document) return 'document';
    if (message.audio) return 'audio';
    if (message.video) return 'video';
    if (message.sticker) return 'sticker';
    if (message.location) return 'location';
    if (message.contacts) return 'contacts';
    if (message.interactive) return 'interactive';
    if (message.button) return 'interactive';
    if (message.reaction) return 'reaction';
    return 'unknown';
};

// Helper: Extract message content
const extractMessageContent = (message) => {
    const content = {};

    if (message.text) {
        content.text = message.text.body;
    } else if (message.image) {
        content.mediaId = message.image.id;
        content.caption = message.image.caption;
        content.mimeType = message.image.mime_type;
    } else if (message.document) {
        content.mediaId = message.document.id;
        content.caption = message.document.caption;
        content.fileName = message.document.filename;
        content.mimeType = message.document.mime_type;
    } else if (message.audio) {
        content.mediaId = message.audio.id;
        content.mimeType = message.audio.mime_type;
    } else if (message.video) {
        content.mediaId = message.video.id;
        content.caption = message.video.caption;
        content.mimeType = message.video.mime_type;
    } else if (message.sticker) {
        content.mediaId = message.sticker.id;
        content.mimeType = message.sticker.mime_type;
    } else if (message.location) {
        content.latitude = message.location.latitude;
        content.longitude = message.location.longitude;
        content.locationName = message.location.name;
        content.address = message.location.address;
    } else if (message.interactive) {
        const interactive = message.interactive;
        content.interactiveType = interactive.type;
        if (interactive.button_reply) {
            content.text = interactive.button_reply.title;
            content.buttons = [{ id: interactive.button_reply.id, text: interactive.button_reply.title }];
        } else if (interactive.list_reply) {
            content.text = interactive.list_reply.title;
        }
    } else if (message.button) {
        content.text = message.button.text;
    } else if (message.reaction) {
        content.reactionEmoji = message.reaction.emoji;
        content.reactedMessageId = message.reaction.message_id;
    }

    return content;
};

// Helper: Extract message preview for conversation list
const extractMessagePreview = (message) => {
    if (message.text) return message.text.body;
    if (message.image) return message.image.caption || '📷 Image';
    if (message.document) return `📄 ${message.document.filename || 'Document'}`;
    if (message.audio) return '🎵 Audio';
    if (message.video) return message.video.caption || '🎬 Video';
    if (message.sticker) return '🎨 Sticker';
    if (message.location) return `📍 ${message.location.name || 'Location'}`;
    if (message.contacts) return '👤 Contact';
    if (message.interactive?.button_reply) return message.interactive.button_reply.title;
    if (message.interactive?.list_reply) return message.interactive.list_reply.title;
    if (message.button) return message.button.text;
    if (message.reaction) return `${message.reaction.emoji} Reaction`;
    return 'Message';
};
