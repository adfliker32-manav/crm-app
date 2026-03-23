const crypto = require('crypto');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');

// ============================================================
// 🐛 DEBUG MODE - controlled via WA_WEBHOOK_DEBUG env variable
// Set WA_WEBHOOK_DEBUG=true in your .env to enable verbose logs
// ============================================================
const DEBUG = process.env.WA_WEBHOOK_DEBUG === 'true';

const debug = (...args) => {
    if (DEBUG) {
        const ts = new Date().toISOString();
        console.log(`[WA-DEBUG ${ts}]`, ...args);
    }
};

const debugJSON = (label, obj) => {
    if (DEBUG) {
        const ts = new Date().toISOString();
        console.log(`[WA-DEBUG ${ts}] ${label}:\n`, JSON.stringify(obj, null, 2));
    }
};

// Verify webhook - called by Meta to verify the endpoint
exports.verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Get verify token from environment (support both names)
    const VERIFY_TOKEN = process.env.WA_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN || 'whatsapp_webhook_verify_token';

    debug('🔍 Webhook verification request received');
    debug(`   hub.mode      = ${mode}`);
    debug(`   hub.verify_token = ${token}`);
    debug(`   hub.challenge  = ${challenge}`);
    debug(`   Expected token = ${VERIFY_TOKEN}`);

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('✅ Webhook verified successfully');
            res.status(200).send(challenge);
        } else {
            console.log('❌ Webhook verification failed - token mismatch');
            debug(`   Received: "${token}"  |  Expected: "${VERIFY_TOKEN}"`);
            res.sendStatus(403);
        }
    } else {
        debug('❌ Webhook verification failed - missing mode or token');
        res.sendStatus(400);
    }
};

// Verify signature from Meta
const verifySignature = (req) => {
    const signature = req.headers['x-hub-signature-256'];
    debug(`🔐 Signature header: ${signature || '(not present)'}`);

    if (!signature) {
        debug('⚠️  No x-hub-signature-256 header - returning false');
        return false;
    }

    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
        console.warn('⚠️ META_APP_SECRET not set, skipping signature verification');
        return true; // Skip verification if no secret configured
    }

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(JSON.stringify(req.body))
        .digest('hex');

    debug(`🔐 Expected signature: ${expectedSignature}`);
    debug(`🔐 Received signature: ${signature}`);

    const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
    );
    debug(`🔐 Signature valid: ${isValid}`);
    return isValid;
};

// Handle incoming webhook
exports.handleWebhook = async (req, res) => {
    try {
        console.log('📥 [WEBHOOK] POST /webhook/whatsapp received');
        debug('📋 Request headers:', JSON.stringify(req.headers, null, 2));
        debugJSON('📦 Request body (raw)', req.body);

        // Verify signature (optional but recommended)
        if (process.env.META_APP_SECRET && !verifySignature(req)) {
            console.error('❌ Invalid webhook signature - rejecting request');
            return res.sendStatus(403);
        }

        const body = req.body;

        // Check if this is a WhatsApp webhook
        debug(`🔍 body.object = "${body.object}"`);
        if (body.object !== 'whatsapp_business_account') {
            debug(`❌ Not a whatsapp_business_account event. Got: "${body.object}". Ignoring.`);
            return res.sendStatus(404);
        }

        // Respond immediately to acknowledge receipt
        res.sendStatus(200);
        debug('✅ Sent 200 OK to Meta immediately');

        // Process entries asynchronously
        if (body.entry && body.entry.length > 0) {
            debug(`📋 Processing ${body.entry.length} entry/entries...`);
            for (const entry of body.entry) {
                await processEntry(entry);
            }
        } else {
            debug('⚠️  No entries found in webhook body');
        }
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        debug('❌ Full error stack:', error.stack);
        // Still return 200 to prevent Meta from retrying
        if (!res.headersSent) {
            res.sendStatus(200);
        }
    }
};

// Process a single entry from the webhook
const processEntry = async (entry) => {
    debug(`📂 Processing entry ID: ${entry.id}`);
    const changes = entry.changes || [];
    debug(`   Found ${changes.length} change(s)`);

    for (const change of changes) {
        debug(`   Change field: "${change.field}"`);
        if (change.field === 'messages') {
            const value = change.value;
            const phoneNumberId = value.metadata?.phone_number_id;
            const displayPhoneNumber = value.metadata?.display_phone_number;

            debug(`📱 Phone Number ID from metadata: ${phoneNumberId}`);
            debug(`📱 Display Phone Number:          ${displayPhoneNumber}`);
            debugJSON('📋 Change value', value);

            // Find the user who owns this phone number
            debug(`🔎 Looking for user with waPhoneNumberId = "${phoneNumberId}"...`);
            let user = await User.findOne({ waPhoneNumberId: phoneNumberId });

            if (user) {
                debug(`✅ Found user by waPhoneNumberId: ${user.email} (${user._id})`);
            } else {
                debug(`⚠️  No user found by waPhoneNumberId. Trying environment fallback...`);
            }

            // FALLBACK: If no user found by ID, check if it matches the global environment ID
            if (!user) {
                const globalPhoneId = process.env.WA_PHONE_NUMBER_ID || process.env.Phone_Number_ID;
                debug(`   Env Phone_Number_ID = "${globalPhoneId}"`);
                debug(`   Incoming Phone ID   = "${phoneNumberId}"`);

                if (phoneNumberId && globalPhoneId && phoneNumberId === globalPhoneId) {
                    debug(`✅ Match! Falling back to Super Admin user`);
                    user = await User.findOne({ role: 'superadmin' });
                    if (user) {
                        debug(`✅ Found superadmin: ${user.email} (${user._id})`);
                    } else {
                        debug('❌ No superadmin user found in DB!');
                    }
                } else {
                    debug(`❌ No match between incoming ID and env ID — cannot find owner`);
                }
            }

            if (!user) {
                console.log(`⚠️ No user found for phone number ID: ${phoneNumberId}`);
                debug('   Skipping this change — no user to assign it to');
                continue;
            }

            // Process messages
            if (value.messages && value.messages.length > 0) {
                debug(`💬 Found ${value.messages.length} incoming message(s)`);
                for (const message of value.messages) {
                    debug(`   → Processing message ID: ${message.id}, type: ${message.type}, from: ${message.from}`);
                    await processIncomingMessage(message, value.contacts, user._id);
                }
            } else {
                debug('   ℹ️  No messages array in this change (could be status update only)');
            }

            // Process status updates
            if (value.statuses && value.statuses.length > 0) {
                debug(`📊 Found ${value.statuses.length} status update(s)`);
                for (const status of value.statuses) {
                    debug(`   → Status: "${status.status}" for message ID: ${status.id}`);
                    await processStatusUpdate(status, user._id);
                }
            } else {
                debug('   ℹ️  No statuses array in this change');
            }
        } else {
            debug(`   ⏭️  Skipping change with field: "${change.field}"`);
        }
    }
};

// Process an incoming message
const processIncomingMessage = async (message, contacts, userId) => {
    try {
        const from = message.from; // Sender's phone number
        const waMessageId = message.id;
        const timestamp = new Date(parseInt(message.timestamp) * 1000);

        debug(`💬 processIncomingMessage: from=${from}, msgId=${waMessageId}, ts=${timestamp.toISOString()}`);
        debugJSON('💬 Full message object', message);

        // Get contact info
        const contact = contacts?.find(c => c.wa_id === from);
        const displayName = contact?.profile?.name || null;
        debug(`   Contact display name: ${displayName || '(none)'}`);

        // Find or create conversation
        debug(`🔎 Looking for conversation: userId=${userId}, waContactId=${from}`);
        let conversation = await WhatsAppConversation.findOne({
            userId: userId,
            waContactId: from
        });

        if (conversation) {
            debug(`✅ Existing conversation found: ${conversation._id}`);
        } else {
            debug('ℹ️  No existing conversation — creating new one');
            // Try to link to existing lead by phone
            const phoneLastTen = from.slice(-10);
            debug(`🔎 Looking for lead with phone ending in: ${phoneLastTen}`);
            const lead = await Lead.findOne({
                userId: userId,
                phone: { $regex: phoneLastTen, $options: 'i' }
            });

            if (lead) {
                debug(`✅ Linked to existing lead: ${lead.name} (${lead._id})`);
            } else {
                debug('ℹ️  No matching lead found — conversation will be unlinked');
            }

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
        conversation.lastInboundMessageAt = timestamp;
        conversation.lastMessageDirection = 'inbound';
        conversation.unreadCount = (conversation.unreadCount || 0) + 1;
        conversation.displayName = displayName || conversation.displayName;
        conversation.metadata.totalMessages = (conversation.metadata.totalMessages || 0) + 1;
        conversation.metadata.totalInbound = (conversation.metadata.totalInbound || 0) + 1;

        await conversation.save();
        debug(`✅ Conversation saved: ${conversation._id}, unread: ${conversation.unreadCount}`);

        // Create message record
        const messageType = getMessageType(message);
        const messageContent = extractMessageContent(message);
        debug(`💾 Saving message: type=${messageType}, preview="${messagePreview}"`);
        debugJSON('💾 Message content', messageContent);

        const messageDoc = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: userId,
            waMessageId: waMessageId,
            direction: 'inbound',
            type: messageType,
            content: messageContent,
            status: 'delivered',
            timestamp: timestamp,
            contextMessageId: message.context?.id || null
        });

        await messageDoc.save();
        debug(`✅ WhatsAppMessage saved to DB: ${messageDoc._id}`);

        console.log(`✅ Received message from ${from}: ${messagePreview.substring(0, 50)}...`);

        // Trigger chatbot/auto-reply logic asynchronously (decoupled)
        debug('🤖 Queuing chatbot engine safely in background...');
        const chatbotEngine = require('../services/chatbotEngineService');
        
        // Execute in next tick of event loop without blocking current execution
        setImmediate(() => {
            chatbotEngine.processIncomingMessage(messageDoc, conversation._id, userId)
                .then(() => debug('🤖 Chatbot engine finished in background'))
                .catch(err => console.error('❌ Background chatbot error:', err));
        });

    } catch (error) {
        console.error('❌ Error processing incoming message:', error);
        debug('❌ Full error stack:', error.stack);
    }
};

// Process status updates (sent, delivered, read)
const processStatusUpdate = async (status, userId) => {
    try {
        const waMessageId = status.id;
        const statusType = status.status; // sent, delivered, read, failed
        const timestamp = new Date(parseInt(status.timestamp) * 1000);

        debug(`📊 processStatusUpdate: msgId=${waMessageId}, status=${statusType}, ts=${timestamp.toISOString()}`);

        const message = await WhatsAppMessage.findOne({ waMessageId: waMessageId });
        if (!message) {
            console.log(`⚠️ Message not found for status update: ${waMessageId}`);
            debug('   The message may not have been saved by this server (e.g., sent via another tool)');
            return;
        }

        // Update message status
        message.status = statusType;
        message.statusTimestamps = message.statusTimestamps || {};
        message.statusTimestamps[statusType] = timestamp;

        if (statusType === 'failed' && status.errors) {
            const errCode = status.errors[0]?.code;
            const errMsg = status.errors[0]?.title || status.errors[0]?.message;
            debug(`❌ Message failed! Code: ${errCode}, Reason: ${errMsg}`);
            message.error = {
                code: errCode,
                message: errMsg
            };
        }

        await message.save();
        console.log(`📬 Message ${waMessageId} status: ${statusType}`);
        debug(`✅ Status saved for message ${message._id}`);

    } catch (error) {
        console.error('❌ Error processing status update:', error);
        debug('❌ Full error stack:', error.stack);
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
