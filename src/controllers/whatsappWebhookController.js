const crypto = require('crypto');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const telemetryService = require('../services/telemetryService');

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

    // FIX: Use req.rawBody (the exact bytes Meta signed) instead of JSON.stringify(req.body).
    // JSON.stringify strips/changes whitespace, making the hash always mismatch.
    // The rawBody Buffer is attached in index.js via express.json({ verify: (req,res,buf) => req.rawBody=buf })
    const payloadToSign = req.rawBody || Buffer.from(JSON.stringify(req.body));

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(payloadToSign)
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
    // 1. Respond immediately to acknowledge receipt and prevent Meta timeouts/retries
    res.sendStatus(200);
    debug('✅ Sent 200 OK to Meta immediately');

    // 2. Process everything else in the background
    setImmediate(async () => {
        const start = process.hrtime();
        let isSuccess = false;

        try {
            console.log('📥 [WEBHOOK] POST /webhook/whatsapp received (Async processing)');
            debug('📋 Request headers:', JSON.stringify(req.headers, null, 2));
            debugJSON('📦 Request body (raw)', req.body);

            // Verify signature (optional but recommended)
            if (process.env.META_APP_SECRET && !verifySignature(req)) {
                console.error('❌ Invalid webhook signature - dropping request');
                telemetryService.recordWebhook(false, false, 0);
                return; // Exits the setImmediate block, response already sent
            }

            const body = req.body;

            // Check if this is a WhatsApp webhook
            debug(`🔍 body.object = "${body.object}"`);
            if (body.object !== 'whatsapp_business_account') {
                debug(`❌ Not a whatsapp_business_account event. Got: "${body.object}". Ignoring.`);
                telemetryService.recordWebhook(false, false, 0);
                return;
            }

            // Process entries asynchronously
            if (body.entry && body.entry.length > 0) {
                debug(`📋 Processing ${body.entry.length} entry/entries...`);
                // Process entries safely without blocking the main event loop for too long
                for (const entry of body.entry) {
                    await processEntry(entry);
                }
            } else {
                debug('⚠️  No entries found in webhook body');
            }

            isSuccess = true;
        } catch (error) {
            console.error('❌ Webhook background processing error:', error);
            debug('❌ Full error stack:', error.stack);
        } finally {
            const diff = process.hrtime(start);
            const timeInMs = (diff[0] * 1e3) + (diff[1] * 1e-6);
            telemetryService.recordWebhook(isSuccess, false, timeInMs);
        }
    });
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

            // Find the user who owns this phone number via IntegrationConfig
            debug(`🔎 Looking for tenant with waPhoneNumberId = "${phoneNumberId}" via IntegrationConfig...`);
            const config = await IntegrationConfig.findOne({ "whatsapp.waPhoneNumberId": phoneNumberId });
            
            let user = null;
            if (config) {
                user = await User.findById(config.userId).select('email role parentId').lean();
                if (user) {
                    debug(`✅ Found user by waPhoneNumberId: ${user.email} (${user._id})`);
                }
            } else {
                debug(`⚠️  No IntegrationConfig found by waPhoneNumberId. Trying environment fallback...`);
            }

            // FALLBACK: If no user found by ID, check if it matches the global environment ID
            if (!user) {
                const globalPhoneId = process.env.WA_PHONE_NUMBER_ID || process.env.Phone_Number_ID;
                debug(`   Env Phone_Number_ID = "${globalPhoneId}"`);
                debug(`   Incoming Phone ID   = "${phoneNumberId}"`);

                if (phoneNumberId && globalPhoneId && phoneNumberId === globalPhoneId) {
                    debug(`✅ Match! Falling back to Super Admin user`);
                    // Sort by createdAt to ensure we always get the primary root admin, not a random sub-admin
                    user = await User.findOne({ role: 'superadmin' }).sort({ createdAt: 1 });
                    if (user) {
                        debug(`✅ Found primary superadmin: ${user.email} (${user._id})`);
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
                    await processIncomingMessage(message, value.contacts, user._id, phoneNumberId);
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
const processIncomingMessage = async (message, contacts, userId, incomingPhoneNumberId) => {
    try {
        const from = message.from; // Sender's phone number
        const waMessageId = message.id;
        const timestamp = new Date(parseInt(message.timestamp) * 1000);

        debug(`💬 processIncomingMessage: from=${from}, msgId=${waMessageId}, ts=${timestamp.toISOString()}`);
        debugJSON('💬 Full message object', message);

        // --- 1. IDEMPOTENCY CHECK ---
        // Prevent crashing from Meta's duplicate webhooks (E11000 duplicate key error)
        const isDuplicate = await WhatsAppMessage.exists({ waMessageId: waMessageId });
        if (isDuplicate) {
            console.log(`⚠️  Idempotency caught duplicate Meta webhook for message ${waMessageId}. Ignoring softly.`);
            return;
        }

        // --- 2. CONTACT PIPELINE ---
        const contact = contacts?.find(c => c.wa_id === from);
        const displayName = contact?.profile?.name || null;
        debug(`   Contact display name: ${displayName || '(none)'}`);

        // Try to link to existing lead by phone if creating a new conversation
        const phoneLastTen = from.slice(-10);
        const lead = await Lead.findOne({
            userId: userId,
            phone: { $regex: phoneLastTen, $options: 'i' }
        });

        const messagePreview = extractMessagePreview(message);

        // --- 3. FIX: FIND REAL CONVERSATION OWNER ---
        // Webhooks often resolve to the Agency/SuperAdmin `userId`, but a Manager/Agent 
        // might have sent the outbound template under their own disjoint `userId` while sharing
        // the same WhatsApp Phone Number credentials in testing/production.
        const IntegrationConfig = require('../models/IntegrationConfig');
        const User = require('../models/User');

        const safePhoneNumberId = incomingPhoneNumberId || process.env.WA_PHONE_NUMBER_ID;

        // Find all users who are explicitly configured to use this incoming Phone Number ID
        const configs = await IntegrationConfig.find({ "whatsapp.waPhoneNumberId": safePhoneNumberId }).select('userId').lean();
        const usersProp = await User.find({ waPhoneNumberId: safePhoneNumberId }).select('_id').lean();
        
        const validUserIds = [
            userId, // The fallback owner resolved earlier
            ...configs.map(c => c.userId),
            ...usersProp.map(u => u._id)
        ];

        // Find if any user sharing this phone number already has a conversation
        const existingConversation = await WhatsAppConversation.findOne({
            userId: { $in: validUserIds },
            waContactId: from
        }).sort({ lastMessageAt: -1 }).lean();

        // If found, append to that specific user's conversation to prevent duplicates.
        const targetUserId = existingConversation ? existingConversation.userId : userId;

        // --- 4. ATOMIC UPSERT ---
        // Guaranteed to never throw duplicate key exceptions on concurrent inserts
        debug(`🔎 Upserting conversation: targetUserId=${targetUserId}, waContactId=${from}`);

        const updatePayload = {
            $setOnInsert: {
                userId: targetUserId,
                waContactId: from,
                phone: from,
                leadId: lead?._id || null,
                'metadata.firstMessageAt': timestamp
            },
            $set: {
                lastMessage: messagePreview,
                lastMessageAt: timestamp,
                lastInboundMessageAt: timestamp,
                lastMessageDirection: 'inbound'
            },
            $inc: {
                unreadCount: 1,
                'metadata.totalMessages': 1,
                'metadata.totalInbound': 1
            }
        };

        if (displayName) {
            updatePayload.$set.displayName = displayName;
        }

        const conversation = await WhatsAppConversation.findOneAndUpdate(
            { userId: targetUserId, waContactId: from },
            updatePayload,
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        debug(`✅ Conversation upserted: ${conversation._id}, unread: ${conversation.unreadCount}`);

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

        const updatePayload = {
            $set: {
                status: statusType,
                [`statusTimestamps.${statusType}`]: timestamp
            }
        };

        if (statusType === 'failed' && status.errors) {
            const errCode = status.errors[0]?.code;
            const errMsg = status.errors[0]?.title || status.errors[0]?.message;
            debug(`❌ Message failed! Code: ${errCode}, Reason: ${errMsg}`);
            updatePayload.$set.error = {
                code: errCode,
                message: errMsg
            };
        }

        const result = await WhatsAppMessage.updateOne(
            { waMessageId: waMessageId },
            updatePayload
        );

        if (result.matchedCount === 0) {
            console.log(`⚠️ Message not found for status update: ${waMessageId}`);
            debug('   The message may not have been saved by this server (e.g., sent via another tool)');
            return;
        }

        console.log(`📬 Message ${waMessageId} status: ${statusType}`);
        debug(`✅ Status atomic update completed`);

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
