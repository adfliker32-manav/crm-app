const crypto = require('crypto');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const WhatsAppLog = require('../models/WhatsAppLog');
const Lead = require('../models/Lead');
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const telemetryService = require('../services/telemetryService');
const { emitToUser, emitToConversation } = require('../services/socketService');

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
    const VERIFY_TOKEN = process.env.WA_WEBHOOK_VERIFY_TOKEN || process.env.VERIFY_TOKEN;
    if (!VERIFY_TOKEN) {
        console.error('❌ WA_WEBHOOK_VERIFY_TOKEN not set in environment. Rejecting verification.');
        return res.sendStatus(403);
    }

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

// Verify signature from Meta using the provided app secret
const verifySignature = (req, appSecret) => {
    const signature = req.headers['x-hub-signature-256'];
    debug(`🔐 Signature header: ${signature || '(not present)'}`);

    if (!signature) {
        debug('⚠️  No x-hub-signature-256 header - returning false');
        return false;
    }

    if (!appSecret) {
        console.error('❌ No app secret available for signature verification. Rejecting webhook.');
        return false;
    }

    // Use req.rawBody (the exact bytes Meta signed). It is attached in index.js via
    // express.json({ verify: (req, res, buf) => req.rawBody = buf }).
    // Falling back to JSON.stringify will always produce a wrong hash — warn loudly.
    if (!req.rawBody) {
        console.error('❌ [Webhook] req.rawBody is missing — express.json verify callback not firing. Signature check will fail. Check index.js middleware order.');
    }
    const payloadToSign = req.rawBody || Buffer.from(JSON.stringify(req.body));

    debug(`🔐 Has req.rawBody: ${!!req.rawBody}`);
    debug(`🔐 Using App Secret starting with: ${appSecret.substring(0, 4)}...`);

    const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(payloadToSign)
        .digest('hex');

    debug(`🔐 Expected signature: ${expectedSignature}`);
    debug(`🔐 Received signature: ${signature}`);

    // timingSafeEqual requires both buffers to be the same length — guard against
    // a malformed or truncated signature header to prevent an unhandled throw.
    const sigBuf      = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expectedBuf.length) {
        console.error(`❌ [Webhook] Signature length mismatch: received ${sigBuf.length} bytes, expected ${expectedBuf.length}. Rejecting.`);
        return false;
    }

    const isValid = crypto.timingSafeEqual(sigBuf, expectedBuf);
    debug(`🔐 Signature valid: ${isValid}`);
    return isValid;
};

// Resolve the app secret for a given WABA ID from the tenant's stored credentials.
//
// Two connect flows exist (see whatsappConfigController.js):
//  - Manual credentials (WABA ID + Phone Number ID + Access Token only, no App ID/Secret
//    collected — an intentional product choice for simpler onboarding). The WABA's webhook
//    subscription is tied to whatever Meta App issued the tenant's own access token, which
//    we never learn — there is no secret anywhere in this system that could verify it.
//  - Embedded Signup — the OAuth exchange runs through THIS platform's own Meta App
//    (META_APP_ID/META_APP_SECRET), so its webhooks genuinely are signed with
//    process.env.META_APP_SECRET.
// `embeddedSignupConnected` is the stored discriminator between the two. Returns
// { secret, verifiable } — verifiable=false means "no signature check is possible for this
// WABA by design", which must NOT be treated as a rejectable/fail-closed case.
const resolveAppSecret = async (wabaId) => {
    if (!wabaId) return { secret: null, verifiable: false };
    try {
        const { decryptToken } = require('../utils/encryptionUtils');
        const config = await IntegrationConfig.findOne({ 'whatsapp.wabaId': wabaId })
            .select('+whatsapp.waAppSecret whatsapp.embeddedSignupConnected');
        const raw = config?.whatsapp?.waAppSecret;
        if (raw) {
            // Mongoose getters may or may not fire depending on access pattern —
            // manually decrypt to be safe (same guard used in whatsappUtils.js).
            const secret = (raw.includes(':') && raw.split(':')[0].length === 32)
                ? decryptToken(raw)
                : raw;
            return { secret, verifiable: true };
        }
        if (config?.whatsapp?.embeddedSignupConnected) {
            return { secret: process.env.META_APP_SECRET || null, verifiable: true };
        }
        return { secret: null, verifiable: false };
    } catch (e) {
        // F5 FIX: Fail CLOSED on DB errors. The previous code returned
        // { verifiable: false } which told the caller "skip signature checks" —
        // meaning a DB timeout would silently disable ALL webhook security.
        // Returning verifiable: true with no secret makes the caller reject the
        // request. Meta retries on 5xx, so a transient DB outage causes a brief
        // delay rather than accepting potentially spoofed payloads.
        console.error('❌ [Webhook] DB error resolving app secret — failing closed. Webhooks will be rejected until DB recovers:', e.message);
        return { secret: null, verifiable: true };
    }
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

            // Resolve per-tenant app secret using the WABA ID in the payload,
            // then verify the HMAC signature before processing any content.
            const wabaIdFromPayload = req.body?.entry?.[0]?.id;
            const { secret: resolvedSecret, verifiable } = await resolveAppSecret(wabaIdFromPayload);
            if (verifiable) {
                // Either an explicit per-tenant secret, or an Embedded Signup WABA that
                // should be signed with META_APP_SECRET. A missing/invalid signature here
                // IS suspicious — reject regardless of environment.
                if (!resolvedSecret || !verifySignature(req, resolvedSecret)) {
                    console.error(`❌ Invalid webhook signature - dropping request. WABA: ${wabaIdFromPayload} | Has rawBody: ${!!req.rawBody} | Had secret: ${!!resolvedSecret}`);
                    telemetryService.recordWebhook(false, false, 0);
                    return;
                }
            } else {
                // Manual-credentials connection (or unknown WABA) — no secret exists
                // anywhere for us to check against; this is an accepted trade-off of
                // that connect flow, not a misconfiguration. Do not fail closed here.
                // BUG #2 FIX: Always log this at warn (not debug) so it is visible in
                // production when troubleshooting missing inbound messages.
                console.warn(`⚠️ [Webhook] WABA ${wabaIdFromPayload} — no app secret found (manual-credentials connection). Proceeding without signature verification.`);
            }

            const body = req.body;

            // Check if this is a WhatsApp webhook
            debug(`🔍 body.object = "${body.object}"`);
            if (body.object !== 'whatsapp_business_account') {
                // BUG #5 FIX: Use console.log (always visible) not debug() for non-WA events
                // so dropped webhooks from other Meta products are traceable in production.
                console.log(`[Webhook] Non-WhatsApp event dropped: object="${body.object}" — ignoring.`);
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

// Handle Meta's template approval / rejection webhook event.
// Meta sends this when a submitted template changes status (APPROVED, REJECTED, DISABLED, etc.).
const processTemplateStatusUpdate = async (wabaId, value) => {
    try {
        const event = value?.event;           // 'APPROVED', 'REJECTED', 'DISABLED', 'PAUSED'
        const metaTemplateId = value?.message_template_id?.toString();
        const templateName = value?.message_template_name;
        const reason = value?.reason || null;

        if (!metaTemplateId || !event) {
            console.warn('⚠️ [TemplateWebhook] Missing template ID or event in payload', value);
            return;
        }

        // Map Meta event names to our DB status values
        const statusMap = {
            APPROVED: 'APPROVED',
            REJECTED: 'REJECTED',
            DISABLED: 'DISABLED',
            PAUSED: 'PAUSED',
            PENDING_DELETION: 'DISABLED'
        };
        const newStatus = statusMap[event];
        if (!newStatus) {
            console.log(`ℹ️ [TemplateWebhook] Unhandled event type "${event}" for template ${templateName} — ignoring`);
            return;
        }

        const WhatsAppTemplate = require('../models/WhatsAppTemplate');
        const { emitToUser } = require('../services/socketService');

        // Find template by metaTemplateId (set when it was submitted)
        // Also try by name as fallback (Meta sometimes omits the ID on first approval),
        // but scope to the correct tenant to avoid cross-tenant name collisions.
        let template = await WhatsAppTemplate.findOne({ metaTemplateId });
        if (!template && templateName) {
            const ownerConfig = await IntegrationConfig.findOne({ 'whatsapp.wabaId': wabaId }).select('userId').lean();
            const tenantFilter = ownerConfig ? { userId: ownerConfig.userId, name: templateName } : { name: templateName };
            template = await WhatsAppTemplate.findOne(tenantFilter);
        }

        if (!template) {
            console.warn(`⚠️ [TemplateWebhook] Template not found: id=${metaTemplateId} name=${templateName}`);
            return;
        }

        const prevStatus = template.status;
        template.status = newStatus;
        if (reason) template.rejectionReason = reason;
        if (event === 'APPROVED') template.rejectionReason = null;
        await template.save();

        console.log(`✅ [TemplateWebhook] Template "${templateName}" status: ${prevStatus} → ${newStatus}${reason ? ` (reason: ${reason})` : ''}`);

        // Notify the tenant in real-time via socket
        const notifMessage = event === 'APPROVED'
            ? `✅ WhatsApp template "${templateName}" has been approved and is now active.`
            : `⚠️ WhatsApp template "${templateName}" was ${newStatus.toLowerCase()}${reason ? `: ${reason}` : ''}.`;

        emitToUser(template.userId.toString(), 'notification:agent', {
            type: 'template_status_update',
            templateId: template._id,
            templateName,
            status: newStatus,
            message: notifMessage,
            timestamp: new Date()
        });
    } catch (err) {
        console.error('❌ [TemplateWebhook] Error processing template status update:', err.message);
    }
};

// Process a single entry from the webhook
const processEntry = async (entry) => {
    debug(`📂 Processing entry ID: ${entry.id}`);
    const changes = entry.changes || [];
    debug(`   Found ${changes.length} change(s)`);

    for (const change of changes) {
        debug(`   Change field: "${change.field}"`);

        // Auto-update template status when Meta approves or rejects a submitted template.
        // Without this, templates stay PENDING forever and the automated WhatsApp send never fires.
        if (change.field === 'message_template_status_update') {
            await processTemplateStatusUpdate(entry.id, change.value);
            continue;
        }

        if (change.field === 'messages') {
            const value = change.value;
            const phoneNumberId = value.metadata?.phone_number_id;
            const displayPhoneNumber = value.metadata?.display_phone_number;

            debug(`📱 Phone Number ID from metadata: ${phoneNumberId}`);
            debug(`📱 Display Phone Number:          ${displayPhoneNumber}`);
            debugJSON('📋 Change value', value);

            // W13 FIX: Guard against a missing/undefined phone_number_id BEFORE the DB lookup.
            // Without this guard, `undefined` is silently stripped by Mongoose so the query
            // degenerates to findOne({}) → first IntegrationConfig in the collection → wrong tenant.
            // A disconnected WABA sets this field to null ($unset needed on disconnect — see W34),
            // so we must also guard the null case.
            if (!phoneNumberId) {
                console.warn(`[Webhook] W13: Missing phone_number_id in metadata — dropping change to prevent mis-routing. metadata=${JSON.stringify(value.metadata)}`);
                continue;
            }

            // Find the user who owns this phone number via IntegrationConfig and populate user directly
            debug(`🔎 Looking for tenant with waPhoneNumberId = "${phoneNumberId}" via IntegrationConfig...`);
            const config = await IntegrationConfig.findOne({ "whatsapp.waPhoneNumberId": phoneNumberId })
                .populate('userId', 'email role parentId')
                .lean();
            
            let user = null;
            if (config && config.userId) {
                user = config.userId;
                // BUG #5 FIX: Always log successful tenant resolution (not just in debug mode)
                console.log(`[Webhook] Tenant resolved: phoneNumberId=${phoneNumberId} → userId=${user._id}`);
            } else {
                // BUG #5 FIX: This is the most common reason messages silently vanish.
                // Always log at warn (not debug) so it is visible without WA_WEBHOOK_DEBUG=true.
                console.warn(`[Webhook] ⚠️  No IntegrationConfig found for waPhoneNumberId="${phoneNumberId}". Message dropped. Check that this Phone Number ID is saved in Settings → WhatsApp Config.`);
            }

            if (!user) {
                // Already warned above — just skip cleanly.
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
        // --- 3. FIX: FIND REAL CONVERSATION OWNER ---
        // Webhooks often resolve to the Agency/SuperAdmin `userId`, but a Manager/Agent 
        // might have sent the outbound template under their own disjoint `userId` while sharing
        // the same WhatsApp Phone Number credentials in testing/production.
        // IntegrationConfig & User already imported at the top of this file

        // Phone number ID is always present in webhook payload metadata
        const safePhoneNumberId = incomingPhoneNumberId;

        const messagePreview = extractMessagePreview(message);

        // Parallelize independent database reads to save significant overhead
        const { getCompanyUserIds } = require('../utils/whatsappUtils');
        const validUserIds = await getCompanyUserIds(userId);
        // Match across the whole company so shared WhatsApp inboxes still link the right CRM lead.
        const lead = await Lead.findOne({
            userId: { $in: validUserIds },
            phone: { $regex: phoneLastTen + '$' }
        })
            .sort({ updatedAt: -1, createdAt: -1 })
            .lean();

        // Find if any user sharing this phone number already has a conversation
        // Use flexible matching: try exact match first, then last-10-digits suffix match
        // This prevents duplicate conversations when phone formats differ
        // (e.g., "New Chat" stores "9427177611" but webhook sends "919427177611")
        let existingConversation = await WhatsAppConversation.findOne({
            userId: { $in: validUserIds },
            waContactId: from
        }).sort({ lastMessageAt: -1 }).lean();

        if (!existingConversation) {
            // Fallback: match by last 10 digits (handles country code mismatches)
            existingConversation = await WhatsAppConversation.findOne({
                userId: { $in: validUserIds },
                waContactId: { $regex: phoneLastTen + '$' }
            }).sort({ lastMessageAt: -1 }).lean();
            if (existingConversation) {
                debug(`📱 Found existing conversation via phone suffix match: ${existingConversation._id} (waContactId: ${existingConversation.waContactId} → incoming: ${from})`);
            }
        }

        // If found, append to that specific user's conversation to prevent duplicates.
        const targetUserId = existingConversation ? existingConversation.userId : userId;
        // Use the EXISTING conversation's waContactId to prevent creating a duplicate
        const upsertContactId = existingConversation ? existingConversation.waContactId : from;

        // --- 4. ATOMIC UPSERT ---
        // Guaranteed to never throw duplicate key exceptions on concurrent inserts
        debug(`🔎 Upserting conversation: targetUserId=${targetUserId}, waContactId=${upsertContactId} (incoming from: ${from})`);

        const updatePayload = {
            $setOnInsert: {
                userId: targetUserId,
                waContactId: upsertContactId,
                phone: from,
                leadId: lead?._id || null,
                initiatedBy: 'customer',
                'metadata.firstMessageAt': timestamp
            },
            $set: {
                lastMessage: messagePreview,
                lastMessageAt: timestamp,
                lastInboundMessageAt: timestamp,
                lastMessageDirection: 'inbound',
                status: 'active' // Re-activate archived/spam conversations on new inbound message
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

        let conversation;
        try {
            conversation = await WhatsAppConversation.findOneAndUpdate(
                { userId: targetUserId, waContactId: upsertContactId },
                updatePayload,
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
            );
        } catch (upsertErr) {
            // E11000: two concurrent webhooks for the same new contact raced on insert.
            // The document was created by the other request — retry as a plain update.
            if (upsertErr.code === 11000) {
                debug('⚠️ E11000 on conversation upsert — retrying as update after race');
                conversation = await WhatsAppConversation.findOneAndUpdate(
                    { userId: targetUserId, waContactId: upsertContactId },
                    { $set: updatePayload.$set, $inc: updatePayload.$inc },
                    { returnDocument: 'after' }
                );
                if (!conversation) throw new Error(`Conversation not found after E11000 retry for contact ${upsertContactId}`);
            } else {
                throw upsertErr;
            }
        }

        debug(`✅ Conversation upserted: ${conversation._id}, unread: ${conversation.unreadCount}`);

        // Create message record
        const messageType = getMessageType(message);
        const messageContent = extractMessageContent(message);
        debug(`💾 Saving message: type=${messageType}, preview="${messagePreview}"`);
        debugJSON('💾 Message content', messageContent);

        const messageDoc = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: targetUserId,
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

        // ── Mirror inbound media to object storage ────────────────────────────
        // Meta deletes media after ~30 days, so the mediaId alone is not durable.
        // Fire-and-forget: the webhook must return 200 to Meta promptly or Meta
        // retries the delivery, and a storage hiccup must never lose the message.
        if (messageContent?.mediaId) {
            const { mirrorInboundMedia } = require('../services/inboundMediaService');
            mirrorInboundMedia({
                mediaId: messageContent.mediaId,
                userId: targetUserId,
                mimeType: messageContent.mimeType,
                waMessageId
            }).catch(err => console.error('[Webhook] Inbound media mirror error:', err.message));
        }

        // 🔌 Push to frontend via Socket.IO (real-time)
        const savedMsg = messageDoc.toObject();
        const conversationIdStr = conversation._id.toString();
        const socketPayload = {
            conversationId: conversationIdStr,
            message: savedMsg
        };
        // NOTE: conversation.unreadCount is POST-increment (findOneAndUpdate with returnDocument: 'after')
        const updatePayloadSocket = {
            conversationId: conversationIdStr,
            updates: {
                lastMessage: messagePreview.substring(0, 100),
                lastMessageAt: timestamp,
                lastMessageDirection: 'inbound',
                unreadCount: conversation.unreadCount,
                displayName: displayName || conversation.displayName
            }
        };

        // Emit newMessage + conversationUpdate to ALL company users (shared inbox)
        for (const uid of validUserIds) {
            emitToUser(String(uid), 'whatsapp:newMessage', socketPayload);
            emitToUser(String(uid), 'whatsapp:conversationUpdate', updatePayloadSocket);
        }
        // Also emit directly to anyone watching this specific conversation room
        emitToConversation(conversationIdStr, 'whatsapp:newMessage', socketPayload);
        emitToConversation(conversationIdStr, 'whatsapp:conversationUpdate', updatePayloadSocket);

        console.log(`✅ Received message from ${from}: ${messagePreview.substring(0, 50)}...`);

        // ─── AUTOMATION + CHATBOT (Sequential, non-blocking) ────────────
        // CRITICAL: Run watcher FIRST (it may set chatbotPausedUntil), then chatbot.
        // Previously these ran in separate setImmediate blocks causing a race condition.
        //
        // BUG #6 FIX: Skip the entire automation + chatbot pipeline for 'system' messages.
        // System messages are Meta-generated events (number changes, business notifications)
        // from the WhatsApp Business app — they are NOT real customer replies. Running them
        // through the pipeline would: trigger unwanted bot responses, falsely mark leads as
        // "replied", pause drip sequences, and inflate lead scores.
        if (messageType === 'system') {
            console.log(`[Webhook] System message stored (id=${waMessageId}) — automation/chatbot pipeline skipped.`);
        } else {
        setImmediate(async () => {
            try {
                // Step 1: Check if this inbound message resolves a pending WAIT_FOR_REPLY watcher (legacy engine)
                const { handleWatcherReply } = require('../services/AutomationService');
                await handleWatcherReply(conversation._id);
            } catch (err) {
                console.error('❌ handleWatcherReply error:', err);
            }

            try {
                // Step 1b: Resolve any pending Workflow Engine WHATSAPP_REPLY wait signal (new engine)
                const WorkflowEngine = require('../workflow-engine/WorkflowEngine');
                await WorkflowEngine.resolveWaitSignal({
                    signalType:   'WHATSAPP_REPLY',
                    channelId:    conversation._id,
                    tenantId:     conversation.userId,   // BUG #3 FIX: scope to this tenant
                    payload:      { message: messageDoc.content?.text || '' },
                    resolvedPort: 'replied'
                });

                // Step 1c: Fire new Workflow Engine WHATSAPP_REPLY start trigger
                // WF-H1: pass the reply text as a first-class field. The raw Meta
                // object nests it at message.text.body, so a workflow branching on
                // "did they say yes" had to know Meta's wire format — and before the
                // trigger.* namespace existed it could not read the message at all.
                await WorkflowEngine.fireTrigger('WHATSAPP_REPLY', {
                    lead,
                    tenantId: conversation.userId,
                    messageText: messageDoc.content?.text || '',
                    messageType,
                    conversationId: conversation._id,
                    message
                });
            } catch (err) {
                console.error('❌ WorkflowEngine WHATSAPP_REPLY error:', err);
            }

            try {
                // Step 2: Score the reply and pause any active drip sequences
                if (conversation.leadId) {
                    const { updateLeadScore } = require('../services/leadScoringService');
                    const { pauseLeadSequences } = require('../services/sequenceService');
                    await Promise.all([
                        updateLeadScore(conversation.leadId, 'WHATSAPP_REPLIED'),
                        pauseLeadSequences(conversation.leadId)
                    ]);
                }
            } catch (err) {
                console.error('❌ Scoring/sequence pause error:', err);
            }

            try {
                // Step 3: Trigger chatbot/auto-reply logic (runs AFTER watcher completes)
                debug('🤖 Running chatbot engine in background...');
                const chatbotEngine = require('../services/chatbotEngineService');
                await chatbotEngine.processIncomingMessage(messageDoc, conversation._id, targetUserId);
                debug('🤖 Chatbot engine finished in background');
            } catch (err) {
                console.error('❌ Background chatbot error:', err);
            }
        });
        } // end if (messageType !== 'system')

    } catch (error) {
        console.error('❌ Error processing incoming message:', error);
        debug('❌ Full error stack:', error.stack);
    }
};

// Process status updates (sent, delivered, read, failed)
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
            const err = status.errors[0] || {};
            const errCode = err.code;
            const errMsg  = err.title || err.message;
            const errData = err.error_data?.details || null;
            // Always log — not just in debug mode — so production logs show the real reason
            console.error(`❌ [WA-FAILED] msgId=${waMessageId} code=${errCode} reason="${errMsg}"${errData ? ` detail="${errData}"` : ''}`);
            updatePayload.$set.error = {
                code: errCode,
                message: errMsg,
                ...(errData && { detail: errData })
            };
        }

        // ── Atomic update returning the OLD document (returnDocument: 'before') ──────────────
        // Returning the pre-update doc lets us detect first-time status transitions
        // vs duplicate webhooks without any extra DB round-trips.
        let oldMsg = await WhatsAppMessage.findOneAndUpdate(
            { waMessageId: waMessageId },
            updatePayload,
            { returnDocument: 'before', select: 'conversationId userId automationSource broadcastId content statusTimestamps' }
        ).lean();

        if (!oldMsg) {
            // Check if it's a system notification logged only in WhatsAppLog
            const isSystemLog = await WhatsAppLog.findOne({ messageId: waMessageId }).lean();
            if (isSystemLog) {
                debug(`✅ Message ${waMessageId} found in WhatsAppLog (system notification). Skipping retry loop.`);
                if (statusType === 'failed') {
                    await WhatsAppLog.updateOne(
                        { messageId: waMessageId },
                        { $set: { status: 'failed', error: updatePayload.$set.error?.message } }
                    );
                }
                return;
            }

            // RACE CONDITION MITIGATION:
            // Meta webhooks for 'sent' or 'delivered' can arrive faster than our own backend
            // finishes writing the initial message to the DB (especially during batch broadcasts).
            // Retry up to 5 times (total ~7.5 seconds) to allow DB writes to catch up.
            let retries = 5;
            while (retries > 0 && !oldMsg) {
                debug(`⏳ Message ${waMessageId} not found in DB. Waiting 1.5s for DB write to finish... (${retries} retries left)`);
                await new Promise(resolve => setTimeout(resolve, 1500));
                oldMsg = await WhatsAppMessage.findOneAndUpdate(
                    { waMessageId: waMessageId },
                    updatePayload,
                    { returnDocument: 'before', select: 'conversationId userId automationSource broadcastId content statusTimestamps' }
                ).lean();
                retries--;
            }

            if (!oldMsg) {
                console.log(`⚠️ Message not found for status update after ${5} retries: ${waMessageId}`);
                debug('   The message may not have been saved by this server (e.g., sent via another tool)');
                return;
            }
        }

        // Was this the FIRST time this status was set on this message?
        // If oldMsg already had statusTimestamps[statusType], it's a duplicate webhook.
        const isFirstTimeStatus = !oldMsg.statusTimestamps?.[statusType];

        console.log(`📬 Message ${waMessageId} status: ${statusType}${isFirstTimeStatus ? '' : ' (duplicate webhook — skipping stat increment)'}`);
        debug(`✅ Status atomic update completed`);

        // 🔌 Push status update to frontend via Socket.IO
        const statusPayload = {
            waMessageId,
            status: statusType,
            conversationId: oldMsg.conversationId,
            statusTimestamp: timestamp,
            ...(statusType === 'failed' && updatePayload.$set.error && { error: updatePayload.$set.error })
        };
        emitToUser(String(oldMsg.userId), 'whatsapp:statusUpdate', statusPayload);
        emitToConversation(oldMsg.conversationId.toString(), 'whatsapp:statusUpdate', {
            waMessageId,
            status: statusType
        });

        // ── Broadcast stats (DEDUP-SAFE) ──────────────────────────────────────
        // Only increment if this is the FIRST time the message transitions to this status.
        // Meta sends duplicate webhooks — without this guard, delivered/read/failed counts inflate
        // beyond the actual number of messages sent (the #1 analytics bug).
        if (isFirstTimeStatus && oldMsg.automationSource === 'broadcast' && oldMsg.broadcastId && ['delivered', 'read', 'failed'].includes(statusType)) {
            try {
                const WhatsAppBroadcast = require('../models/WhatsAppBroadcast');
                await WhatsAppBroadcast.updateOne(
                    { _id: oldMsg.broadcastId },
                    { $inc: { [`stats.${statusType}`]: 1 } }
                );
            } catch (bcErr) {
                console.error(`⚠️ Could not update broadcast stats for broadcast ${oldMsg.broadcastId}:`, bcErr.message);
            }
        }

        // FIX #21: Update template analytics counters (also dedup-safe)
        if (isFirstTimeStatus && oldMsg.content?.templateName && ['delivered', 'read', 'failed'].includes(statusType)) {
            try {
                const WhatsAppTemplate = require('../models/WhatsAppTemplate');
                await WhatsAppTemplate.updateOne(
                    { userId: oldMsg.userId, name: oldMsg.content.templateName },
                    { $inc: { [`analytics.${statusType}`]: 1 } }
                );
            } catch (tplErr) {
                debug(`⚠️ Could not update template analytics: ${tplErr.message}`);
            }
        }

    } catch (error) {
        console.error('❌ Error processing status update:', error);
        debug('❌ Full error stack:', error.stack);
    }
};

// Helper: Get message type
// BUG #6 FIX: Added 'system' type for messages originating from the WhatsApp Business
// app itself (e.g. number-change notifications, ephemeral messages, business-initiated
// conversation starters sent from the app). Without this, Meta's 'system' message
// objects fall through to 'unknown', which the WhatsAppMessage model accepts but the
// DB save still succeeds — however the chatbot/automation pipeline should NOT react
// to these system events as if they were customer replies.
const getMessageType = (message) => {
    if (message.system) return 'system';    // Business-app system notification (number change etc.)
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
    // BUG #6 FIX: Log unknown types in production so we learn about new Meta message types
    // before they silently cause ValidationErrors on the WhatsAppMessage model.
    console.warn(`[Webhook] Unrecognised message type — keys: ${Object.keys(message).join(', ')}. Saving as 'unknown'. Please report to dev team.`);
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
            content.buttonId = interactive.button_reply.id;
            content.buttons = [{ id: interactive.button_reply.id, text: interactive.button_reply.title }];
        } else if (interactive.list_reply) {
            content.text = interactive.list_reply.title;
            content.buttonId = interactive.list_reply.id;
        }
    } else if (message.contacts) {
        content.contacts = (message.contacts || []).map(c => ({
            name: c.name?.formatted_name
                || [c.name?.first_name, c.name?.last_name].filter(Boolean).join(' ')
                || 'Contact',
            phones: (c.phones || []).map(p => p.phone).filter(Boolean)
        }));
    } else if (message.button) {
        // Quick-reply button tapped on a template. The payload carries the
        // configured button value; the chatbot engine matches on it like any
        // other button id.
        content.text = message.button.text;
        content.buttonId = message.button.payload || undefined;
    } else if (message.reaction) {
        content.reactionEmoji = message.reaction.emoji;
        content.reactedMessageId = message.reaction.message_id;
    } else if (message.system) {
        // BUG #6 FIX: Capture system message body so it is human-readable in the inbox
        // instead of appearing as an empty message. Common bodies: "Phone number changed",
        // "Customer changed phone number", etc.
        content.text = message.system.body || '🔔 System notification';
    }

    if (message.referral) {
        content.referral = {
            source_url: message.referral.source_url,
            source_type: message.referral.source_type,
            source_id: message.referral.source_id,
            headline: message.referral.headline,
            body: message.referral.body,
            media_image_url: message.referral.media_image_url
        };
        console.log(`📢 [CTWA Referral] Ad click detected — source_id="${message.referral.source_id}", headline="${message.referral.headline}", source_type="${message.referral.source_type}"`);
    }

    return content;
};

// Helper: Extract message preview for conversation list
const extractMessagePreview = (message) => {
    if (message.system) return `🔔 ${message.system.body || 'System notification'}`;
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
