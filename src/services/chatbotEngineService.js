const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { sendWhatsAppTextMessage, sendInteractiveMessage, sendMediaMessage } = require('./whatsappService');
const { emitToUser } = require('./socketService');
const whatsappQueueService = require('./whatsappQueueService');
const NodeCache = require('node-cache');
const flowCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const normalizeId = (value) => value ? value.toString() : null;
const buildFlowCacheKey = (ownerIds) => `flows_${[...new Set(ownerIds.map(normalizeId).filter(Boolean))].sort().join('|')}`;
const getSessionFlowId = (session) => session?.flowId?._id || session?.flowId || null;
const RESERVED_LEAD_VARIABLES = new Set([
    'name',
    'full_name',
    'fullName',
    'customer_name',
    'customerName',
    'email',
    'email_address',
    'emailAddress',
    'phone',
    'phone_number',
    'phoneNumber',
    'mobile',
    'mobile_number',
    'mobileNumber',
    'status',
    'source',
    'tags',
    'lead_name',
    'lead_email',
    'lead_phone',
    'lead_status',
    'lead_tags'
]);

const getFirstPopulatedVariable = (variables, candidateKeys = []) => {
    for (const key of candidateKeys) {
        const value = variables?.get?.(key);
        if (value !== undefined && value !== null && value.toString().trim() !== '') {
            return value.toString().trim();
        }
    }

    return '';
};

// ─────────────────────────────────────────────────────────────────────────────
// evaluateCondition — powers the 'condition' (IF/ELSE) node in executeNode.
// Checks one condition object against the session's captured variables.
// ─────────────────────────────────────────────────────────────────────────────
const evaluateCondition = (cond, variables) => {
    try {
        if (!cond || !cond.variable || !cond.operator) return false;

        // Session variables are stored as a Mongoose Map → use .get()
        // Fall back to plain JS object access for safety
        let rawValue = variables?.get?.(cond.variable);
        if (rawValue === undefined && variables && typeof variables === 'object') {
            rawValue = variables[cond.variable];
        }

        const actualStr = (rawValue !== undefined && rawValue !== null)
            ? String(rawValue).trim().toLowerCase()
            : '';
        const expectedStr = (cond.value !== undefined && cond.value !== null)
            ? String(cond.value).trim().toLowerCase()
            : '';

        switch (cond.operator) {
            case 'equals':         return actualStr === expectedStr;
            case 'not_equals':     return actualStr !== expectedStr;
            case 'contains':       return expectedStr !== '' && actualStr.includes(expectedStr);
            case 'not_contains':   return expectedStr !== '' && !actualStr.includes(expectedStr);
            case 'starts_with':    return expectedStr !== '' && actualStr.startsWith(expectedStr);
            case 'ends_with':      return expectedStr !== '' && actualStr.endsWith(expectedStr);
            case 'greater_than':   return !isNaN(parseFloat(actualStr)) && !isNaN(parseFloat(expectedStr)) && parseFloat(actualStr) > parseFloat(expectedStr);
            case 'less_than':      return !isNaN(parseFloat(actualStr)) && !isNaN(parseFloat(expectedStr)) && parseFloat(actualStr) < parseFloat(expectedStr);
            case 'is_set':         return actualStr !== '';
            case 'is_empty':       return actualStr === '';
            default:               return false;
        }
    } catch (e) {
        console.warn(`[Chatbot] evaluateCondition error for "${cond?.variable}":`, e.message);
        return false;
    }
};

const buildLeadCustomDataFromVariables = (variables) => {
    const customData = {};

    if (!variables?.forEach) {
        return customData;
    }

    variables.forEach((value, key) => {
        if (!key || RESERVED_LEAD_VARIABLES.has(key) || key.startsWith('lead_')) {
            return;
        }

        if (value === undefined || value === null) {
            return;
        }

        const normalizedValue = typeof value === 'string' ? value.trim() : value;
        if (normalizedValue === '') {
            return;
        }

        customData[key] = normalizedValue;
    });

    return customData;
};

const buildLeadPayloadFromSession = (session, conversation, overrides = {}) => {
    const variables = session?.variables;
    const mergedTags = [
        ...(conversation?.tags || []),
        ...(overrides.tags || [])
    ].filter(Boolean);

    const payload = {
        userId: session.userId,
        name:
            getFirstPopulatedVariable(variables, [
                'name',
                'full_name',
                'fullName',
                'customer_name',
                'customerName',
                'lead_name'
            ]) || conversation?.displayName || 'WhatsApp Lead',
        phone:
            getFirstPopulatedVariable(variables, [
                'phone',
                'phone_number',
                'phoneNumber',
                'mobile',
                'mobile_number',
                'mobileNumber',
                'lead_phone'
            ]) || conversation?.phone,
        email:
            getFirstPopulatedVariable(variables, [
                'email',
                'email_address',
                'emailAddress',
                'lead_email'
            ]) || null,
        source: overrides.source || 'WhatsApp Chatbot',
        status: overrides.status || 'New',
        customData: buildLeadCustomDataFromVariables(variables),
        tags: [...new Set(mergedTags)]
    };

    if (conversation?.assignedTo) {
        payload.assignedTo = conversation.assignedTo;
    }

    if (overrides.qualificationLevel) {
        payload.qualificationLevel = overrides.qualificationLevel;
    }

    if (overrides.history) {
        payload.history = overrides.history;
    }

    return payload;
};

const getSafeLeadCustomDataEntries = (leadCustomData) => {
    if (!leadCustomData) {
        return [];
    }

    const entries = [];

    if (typeof leadCustomData.forEach === 'function') {
        leadCustomData.forEach((value, key) => {
            if (typeof key === 'string' && key && !key.startsWith('$')) {
                entries.push([key, value]);
            }
        });

        if (entries.length > 0) {
            return entries;
        }
    }

    const plainObject =
        typeof leadCustomData.toJSON === 'function'
            ? leadCustomData.toJSON({ flattenMaps: true })
            : (leadCustomData instanceof Map
                ? Object.fromEntries(leadCustomData)
                : leadCustomData);

    return Object.entries(plainObject || {}).filter(([key]) =>
        typeof key === 'string' && key && !key.startsWith('$')
    );
};

const triggerChatbotLeadCreatedEffects = (lead, userId, leadStatus = null) => {
    setImmediate(async () => {
        try {
            const { evaluateLead } = require('./AutomationService');
            evaluateLead(lead, 'LEAD_CREATED').catch(e => console.error('[Chatbot] Automation engine error:', e));

            const IntegrationConfig = require('../models/IntegrationConfig');
            const config = await IntegrationConfig.findOne({ userId })
                .select('+meta.metaCapiEnabled +meta.metaPixelId +meta.metaCapiAccessToken +meta.metaStageMapping +meta.metaTestEventCode');

            if (config?.meta?.metaCapiEnabled) {
                const { sendMetaEvent } = require('./metaConversionService');
                sendMetaEvent(config, lead, leadStatus || lead.status, null).catch(e => console.error('[Chatbot] Meta CAPI error:', e));
            }
        } catch (err) {
            console.error('[Chatbot] Background trigger error:', err);
        }
    });
};

// ============================================================
// 🔧 HELPER: Persist automated outbound messages to the DB
// Without this, chatbot replies are invisible in the inbox UI.
// ============================================================
const saveBotMessage = async (conversationId, userId, text, type = 'text', waResult = null, mediaData = null) => {
    try {
        const waMessageId = waResult?.messages?.[0]?.id || undefined;
        
        const content = { text };
        if (['image', 'video', 'document', 'audio'].includes(type)) {
            content.caption = text;
            if (mediaData) {
                if (mediaData.mediaUrl) content.mediaUrl = mediaData.mediaUrl;
                if (mediaData.mediaId) content.mediaId = mediaData.mediaId;
            }
        }

        const messageDoc = new WhatsAppMessage({
            conversationId,
            userId,
            waMessageId,
            direction: 'outbound',
            type,
            content,
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: true,
            automationSource: 'chatbot'
        });
        await messageDoc.save();

        // Update conversation metadata
        const lastMsgPreview = type === 'text' ? text.substring(0, 100) : `[${type}] ${text?.substring(0, 50) || ''}`;
        await WhatsAppConversation.findByIdAndUpdate(conversationId, {
            $set: {
                lastMessage: lastMsgPreview,
                lastMessageAt: new Date(),
                lastMessageDirection: 'outbound'
            },
            $inc: {
                'metadata.totalMessages': 1,
                'metadata.totalOutbound': 1
            }
        });

        // Push to frontend via Socket.IO (real-time)
        const savedMsg = messageDoc.toObject();
        emitToUser(userId, 'whatsapp:newMessage', {
            conversationId,
            message: savedMsg
        });
        emitToUser(userId, 'whatsapp:conversationUpdate', {
            conversationId,
            updates: {
                lastMessage: lastMsgPreview,
                lastMessageAt: new Date(),
                lastMessageDirection: 'outbound'
            }
        });

        return savedMsg;
    } catch (err) {
        console.error('Error saving bot message to DB:', err);
        return null;
    }
};

exports.invalidateFlowCache = (userId) => {
    const normalizedUserId = normalizeId(userId);
    const matchingKeys = flowCache.keys().filter((key) => {
        if (!key.startsWith('flows_')) return false;
        return key.slice(6).split('|').includes(normalizedUserId);
    });

    if (matchingKeys.length > 0) {
        flowCache.del(matchingKeys);
    } else {
        flowCache.del(`flows_${normalizedUserId}`);
    }
    console.log(`🧹 Cleared chatbot flow cache for user ${userId}`);
};

// FIX #22: Cache tenant→ownerIds mapping to avoid 2 DB queries per incoming message
const contextCache = new NodeCache({ stdTTL: 300, checkperiod: 60 }); // 5-min TTL

const resolveChatbotContext = async (userId) => {
    const normalizedUserId = normalizeId(userId);
    
    // Check cache first
    const cacheKey = `ctx_${normalizedUserId}`;
    const cached = contextCache.get(cacheKey);
    if (cached) return cached;
    
    const owner = await User.findById(userId).select('role parentId').lean();
    const tenantId = owner?.role === 'agent' && owner.parentId
        ? normalizeId(owner.parentId)
        : normalizedUserId;

    let flowOwnerIds = tenantId && tenantId !== normalizedUserId
        ? [tenantId, normalizedUserId]
        : [tenantId || normalizedUserId];

    if (tenantId) {
        const relatedUsers = await User.find({
            $or: [{ _id: tenantId }, { parentId: tenantId }]
        }).select('_id').lean();

        flowOwnerIds = [
            ...flowOwnerIds,
            ...relatedUsers.map((user) => normalizeId(user._id))
        ];
    }

    const result = {
        tenantId: tenantId || normalizedUserId,
        flowOwnerIds: [...new Set(flowOwnerIds.filter(Boolean))]
    };
    
    contextCache.set(cacheKey, result);
    return result;
};

const getActiveFlows = async (ownerIds, preferredOwnerId) => {
    const cacheKey = buildFlowCacheKey(ownerIds);
    let flows = flowCache.get(cacheKey);
    if (!flows) {
        flows = await ChatbotFlow.find({
            userId: { $in: ownerIds },
            isActive: true
        }).lean();
        flowCache.set(cacheKey, flows);
    }

    const preferredId = normalizeId(preferredOwnerId);
    const ownerPriority = [...new Set(ownerIds.map(normalizeId).filter(Boolean))];
    return [...flows].sort((a, b) => {
        const aUserId = normalizeId(a.userId);
        const bUserId = normalizeId(b.userId);
        const aPriority = aUserId === preferredId ? -1 : ownerPriority.indexOf(aUserId);
        const bPriority = bUserId === preferredId ? -1 : ownerPriority.indexOf(bUserId);
        return aPriority - bPriority;
    });
};

// Helper to evaluate if currently within business hours
const isWithinBusinessHours = (settings) => {
    if (!settings || !settings.businessHours) return true; // Default to open
    
    try {
        const tz = settings.businessHours.timezone || 'UTC';
        const now = new Date();
        
        // Get day and time in the specified timezone
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        
        const parts = formatter.formatToParts(now);
        let dayName = ''; let hour = ''; let minute = '';
        
        for (const part of parts) {
            if (part.type === 'weekday') dayName = part.value.toLowerCase();
            if (part.type === 'hour') hour = part.value;
            if (part.type === 'minute') minute = part.value;
        }
        
        if (hour === '24') hour = '00';
        const currentTime = `${hour}:${minute}`;
        
        const dayConfig = settings.businessHours[dayName];
        if (!dayConfig || !dayConfig.isOpen) return false;
        
        return currentTime >= dayConfig.start && currentTime <= dayConfig.end;
    } catch (err) {
        console.error('Error evaluating business hours:', err);
        return true; // Fallback to open
    }
};

// Process incoming message and check if it should trigger a chatbot or auto-reply
exports.processIncomingMessage = async (message, conversationId, userId) => {
    try {
        const conversation = await WhatsAppConversation.findById(conversationId);
        if (!conversation) {
            console.log(`🤖 [Chatbot] Conversation ${conversationId} not found. Skipping.`);
            return null;
        }
        const { tenantId, flowOwnerIds } = await resolveChatbotContext(userId);

        const isPaused = conversation.chatbotPausedUntil && new Date() < conversation.chatbotPausedUntil;
        if (isPaused) {
            console.log(`⏸️ [Chatbot] Conversation ${conversationId} is paused until ${conversation.chatbotPausedUntil} (will check if keyword can bypass)`);
        }

        // 1. Check Global Automations (Welcome & Out-of-Office) — only when NOT paused
        if (!isPaused) {
            const IntegrationConfig = require('../models/IntegrationConfig');
            const config = await IntegrationConfig.findOne({ userId: tenantId }).select('whatsapp').lean();
            
            if (config && config.whatsapp && config.whatsapp.autoReply) {
                const autoReply = config.whatsapp.autoReply;
                const settings = config.whatsapp;

                // Out-Of-Office logic (checked first — takes priority over welcome)
                let sentOOO = false;
                if (autoReply.outOfOfficeEnabled && autoReply.outOfOfficeMessage) {
                    const isOpen = isWithinBusinessHours(settings);
                    if (!isOpen) {
                        const isNewConversationBurst = !conversation.lastMessageAt ||
                            (new Date() - new Date(conversation.lastMessageAt)) > (4 * 60 * 60 * 1000);

                        if (conversation.metadata.totalInbound === 1 || isNewConversationBurst) {
                            const oooResult = await sendWhatsAppTextMessage(conversation.phone, autoReply.outOfOfficeMessage, tenantId);
                            await saveBotMessage(conversationId, tenantId, autoReply.outOfOfficeMessage, 'text', oooResult);
                            sentOOO = true;
                        }
                    }
                }

                // Welcome Message logic — ONLY fires if OOO was NOT sent (mutually exclusive)
                if (!sentOOO && autoReply.welcomeEnabled && autoReply.welcomeMessage) {
                    if (conversation.metadata.totalInbound === 1) {
                        const welcomeResult = await sendWhatsAppTextMessage(conversation.phone, autoReply.welcomeMessage, tenantId);
                        await saveBotMessage(conversationId, tenantId, autoReply.welcomeMessage, 'text', welcomeResult);
                    }
                }
            }
        }

        // 2. Chatbot Flow Evaluation
        const messageText = message.content?.text?.toLowerCase().trim();
        const mediaType = message.type; // 'image' | 'video' | 'document' | 'audio' | 'text' | ...
        const isMedia = ['image', 'video', 'document', 'audio'].includes(mediaType);
        console.log(`🤖 [Chatbot] Message text: "${messageText || '(empty/media)'}" | Type: ${mediaType} | Conversation: ${conversationId} | Paused: ${isPaused}`);

        // Inbound media: route to active session if it's waiting on a request_media node,
        // otherwise reject with a friendly message.
        if (!messageText) {
            if (isPaused) return null;

            const activeSession = await ChatbotSession.findOne({
                conversationId: conversationId,
                status: 'active'
            }).populate('flowId');

            if (activeSession && isMedia) {
                const currentNode = activeSession.flowId?.nodes?.find(n => n.id === activeSession.currentNodeId);
                if (currentNode?.type === 'request_media') {
                    console.log(`🤖 [Chatbot] Forwarding ${mediaType} to request_media node ${currentNode.id}`);
                    return await continueSession(activeSession, null, conversationId, userId, message);
                }
            }

            if (activeSession) {
                const replyText = isMedia
                    ? 'Please send a text response to continue this conversation.'
                    : 'Please send a text message to continue. Media files are not supported in this conversation flow.';
                const result = await sendWhatsAppTextMessage(conversation.phone, replyText, tenantId);
                await saveBotMessage(conversationId, tenantId, replyText, 'text', result);
            }
            return null;
        }

        // Check for active session first (only if NOT paused)
        if (!isPaused) {
            let session = await ChatbotSession.findOne({
                conversationId: conversationId,
                status: 'active'
            }).populate('flowId');

            if (session) {
                console.log(`🤖 [Chatbot] Continuing active session ${session._id} for flow "${session.flowId?.name || 'unknown'}" at node ${session.currentNodeId}`);
                // If user sent text but the active node expects media, reject and stay on the node.
                const currentNode = session.flowId?.nodes?.find(n => n.id === session.currentNodeId);
                if (currentNode?.type === 'request_media') {
                    const replyText = 'Please upload a file (image, video, or document) to continue.';
                    const result = await sendWhatsAppTextMessage(conversation.phone, replyText, tenantId);
                    await saveBotMessage(conversationId, tenantId, replyText, 'text', result);
                    return null;
                }
                return await continueSession(session, messageText, conversationId, userId, message);
            }

            // No active session. Diagnostic: count any sessions for this conversation by status
            // so it's obvious whether the session was never created vs. ended early.
            const sessionCounts = await ChatbotSession.aggregate([
                { $match: { conversationId: new (require('mongoose').Types.ObjectId)(conversationId.toString()) } },
                { $group: { _id: '$status', count: { $sum: 1 }, last: { $max: '$updatedAt' } } }
            ]);
            if (sessionCounts.length > 0) {
                const summary = sessionCounts.map(s => `${s._id}=${s.count} (last ${s.last?.toISOString?.() || s.last})`).join(', ');
                console.log(`🤖 [Chatbot] No ACTIVE session for conversation ${conversationId}. Existing sessions: ${summary}`);
            } else {
                console.log(`🤖 [Chatbot] No sessions at all for conversation ${conversationId}. User has not yet triggered any flow.`);
            }

            // If the user tapped an interactive button but there is no active session,
            // those buttons came from an old (now-ended) flow. Reply with a hint instead
            // of silently dropping the tap so the user knows they need to restart.
            if (mediaType === 'interactive') {
                const replyText = 'This conversation has ended. Please send a new message to start again.';
                try {
                    const result = await sendWhatsAppTextMessage(conversation.phone, replyText, tenantId);
                    await saveBotMessage(conversationId, tenantId, replyText, 'text', result);
                } catch (sendErr) {
                    console.error('Failed to send stale-button hint:', sendErr.message);
                }
                return null;
            }
        }

        // ─── KEYWORD + FLOW MATCHING ───────────────────────────────
        // NOTE: Keyword matching runs EVEN when paused — a keyword trigger is an
        // explicit new intent from the customer and should restart the chatbot.
        const allActiveFlows = await getActiveFlows(flowOwnerIds, tenantId);
        console.log(`🤖 [Chatbot] Found ${allActiveFlows.length} active flow(s) for owners: [${flowOwnerIds.join(', ')}]`);
        
        if (allActiveFlows.length === 0) {
            console.log(`🤖 [Chatbot] No active flows found. Chatbot will not trigger.`);
            return null;
        }

        let targetFlow = null;

        // Function to calculate Levenshtein distance for typo tolerance
        const getLevenshteinDistance = (a, b) => {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;
            const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
            for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
            for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                    matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
                }
            }
            return matrix[a.length][b.length];
        };

        // Log all keyword flows for diagnostics
        const keywordFlows = allActiveFlows.filter(f => f.triggerType === 'keyword');
        for (const f of keywordFlows) {
            console.log(`🤖 [Chatbot] Keyword flow "${f.name}" (ID: ${f._id}) | Keywords: [${(f.triggerKeywords || []).join(', ')}] | Active: ${f.isActive}`);
        }

        // 1. Fuzzy Keyword Flow Match (Intent parsing with typo-tolerance)
        targetFlow = allActiveFlows.find(f => {
            if (f.triggerType !== 'keyword' || !f.triggerKeywords || f.triggerKeywords.length === 0) return false;
            
            const wordsInMessage = messageText.split(/\s+/);
            
            return f.triggerKeywords.some(k => {
                const kl = k.toLowerCase().trim();
                
                // Exact or inclusion match
                if (messageText.includes(kl)) {
                    console.log(`🎯 [Chatbot] Exact keyword match: "${kl}" found in message "${messageText}"`);
                    return true;
                }
                
                // Fuzzy match for typo tolerance (distance of 1 for short words, 2 for longer words)
                // We compare the keyword against every word in the message
                const maxDistance = kl.length <= 4 ? 1 : 2;
                for (const word of wordsInMessage) {
                    const cleanWord = word.replace(/[^a-z0-9]/gi, ''); // remove punctuation
                    if (Math.abs(cleanWord.length - kl.length) <= maxDistance) {
                        const distance = getLevenshteinDistance(cleanWord, kl);
                        if (distance <= maxDistance) {
                            console.log(`🎯 [Chatbot] Fuzzy matched keyword '${kl}' with typed word '${cleanWord}' (distance: ${distance})`);
                            return true;
                        }
                    }
                }
                
                return false;
            });
        });

        // If a keyword matched AND chatbot is paused → BYPASS the pause (keyword = new intent)
        if (targetFlow && isPaused) {
            console.log(`🔓 [Chatbot] Keyword trigger "${targetFlow.name}" bypassing chatbot pause for conversation ${conversationId}`);
            // Clear the pause so the flow can execute
            await WhatsAppConversation.findByIdAndUpdate(conversationId, {
                $set: { chatbotPausedUntil: null }
            });
            // Also end any stale active sessions
            await ChatbotSession.updateMany(
                { conversationId: conversationId, status: 'active' },
                { $set: { status: 'abandoned', completedAt: new Date() } }
            );
        }

        // 2. Template Reply Match — fires when user taps a QUICK_REPLY button on a template
        // This bypasses pause (same as keyword — it's an explicit user intent).
        if (!targetFlow && message.contextMessageId) {
            try {
                const originalMsg = await WhatsAppMessage.findOne({ waMessageId: message.contextMessageId }).lean();
                if (originalMsg && originalMsg.content?.templateName) {
                    const tplName = originalMsg.content.templateName;
                    const replyFlow = allActiveFlows.find(f =>
                        f.triggerType === 'template_reply' && f.triggerTemplateName === tplName
                    );
                    if (replyFlow) {
                        console.log(`📩 [Chatbot] Template reply trigger matched: "${replyFlow.name}" (template: ${tplName}, button: "${messageText}")`);
                        targetFlow = replyFlow;
                        // Bypass pause if needed
                        if (isPaused) {
                            console.log(`🔓 [Chatbot] Template reply trigger "${replyFlow.name}" bypassing chatbot pause`);
                            await WhatsAppConversation.findByIdAndUpdate(conversationId, {
                                $set: { chatbotPausedUntil: null }
                            });
                            await ChatbotSession.updateMany(
                                { conversationId: conversationId, status: 'active' },
                                { $set: { status: 'abandoned', completedAt: new Date() } }
                            );
                        }
                    }
                }
            } catch (tplErr) {
                console.error('[Chatbot] Template reply lookup error:', tplErr.message);
            }
        }

        // 2.5. Meta Ad (Click-to-WhatsApp) Match
        // Fires when user clicks an ad and sends a message (referral data is attached)
        // Bypasses pause as it's an explicit intent.
        if (!targetFlow && message.content?.referral) {
            const adHeadline = message.content.referral.headline || '';
            const adFlow = allActiveFlows.find(f => 
                f.triggerType === 'meta_ad' && 
                f.triggerAdHeadline &&
                f.triggerAdHeadline.toLowerCase().trim() === adHeadline.toLowerCase().trim()
            );

            if (adFlow) {
                console.log(`🎯 [Chatbot] Meta Ad trigger matched: "${adFlow.name}" (Ad Headline: "${adHeadline}")`);
                targetFlow = adFlow;
                if (isPaused) {
                    console.log(`🔓 [Chatbot] Meta Ad trigger "${adFlow.name}" bypassing chatbot pause`);
                    await WhatsAppConversation.findByIdAndUpdate(conversationId, {
                        $set: { chatbotPausedUntil: null }
                    });
                    await ChatbotSession.updateMany(
                        { conversationId: conversationId, status: 'active' },
                        { $set: { status: 'abandoned', completedAt: new Date() } }
                    );
                }
            }
        }

        // 3. First Message Match (Completely new contact) — only if NOT paused
        if (!targetFlow && !isPaused && conversation.metadata.totalInbound === 1) {
            targetFlow = allActiveFlows.find(f => f.triggerType === 'first_message' || f.triggerType === 'any_message');
            if (targetFlow) console.log(`🤖 [Chatbot] First-message trigger matched: "${targetFlow.name}"`);
        }

        // 4. Existing Contact Match (They have messaged before) — only if NOT paused
        if (!targetFlow && !isPaused && conversation.metadata.totalInbound > 1) {
            targetFlow = allActiveFlows.find(f => f.triggerType === 'existing_contact_message' || f.triggerType === 'any_message');
            if (targetFlow) console.log(`🤖 [Chatbot] Existing-contact trigger matched: "${targetFlow.name}"`);
        }

        if (targetFlow) {
            console.log(`🚀 [Chatbot] Starting flow "${targetFlow.name}" (ID: ${targetFlow._id}) for conversation ${conversationId}`);
            // Start new session with first matching flow
            return await startSession(
                targetFlow,
                conversationId,
                normalizeId(targetFlow.userId) || tenantId,
                messageText,
                targetFlow.triggerType === 'template_reply',
                message
            );
        }

        if (isPaused) {
            console.log(`⏸️ [Chatbot] No keyword match found. Chatbot remains paused for conversation ${conversationId}`);
        } else {
            console.log(`🤖 [Chatbot] No matching flow found for message "${messageText}" in conversation ${conversationId}`);
        }

        return null;
    } catch (error) {
        console.error('Error processing auto-replies / chatbot:', error);
        return null;
    }
};

// Start a new chatbot session
const startSession = async (flow, conversationId, userId, triggerMessageText = null, isTemplateReply = false, incomingMessage = null) => {
    try {
        // Race-safe: re-check for an existing active session and bail if one already exists.
        // Two webhooks arriving within ~50ms can both reach this function — without this
        // guard we'd create two parallel sessions for the same conversation.
        const existing = await ChatbotSession.findOne({
            conversationId: conversationId,
            status: 'active'
        }).populate('flowId');
        if (existing) {
            console.log(`🤖 [Chatbot] startSession: active session ${existing._id} already exists for conversation ${conversationId}. Skipping duplicate start.`);
            return null;
        }

        // Fetch parent conversation & potential Lead to populate variables immediately
        const conversation = await WhatsAppConversation.findById(conversationId).populate('leadId');
        const initialVariables = new Map();

        if (conversation && conversation.leadId) {
            const lead = conversation.leadId;
            initialVariables.set('lead_name', lead.name || '');
            initialVariables.set('lead_email', lead.email || '');
            initialVariables.set('lead_phone', lead.phone || conversation.phone || '');
            initialVariables.set('lead_status', lead.status || '');
            initialVariables.set('lead_tags', (lead.tags || []).join(', '));

            if (lead.customData) {
                // Populate custom fields as variables
                getSafeLeadCustomDataEntries(lead.customData).forEach(([key, value]) => {
                    initialVariables.set(key, value == null ? '' : value.toString());
                });
            }
        }

        // Create session
        const session = new ChatbotSession({
            conversationId: conversationId,
            userId: userId,
            flowId: flow._id,
            currentNodeId: flow.startNodeId,
            variables: initialVariables,
            visitedNodes: []
        });

        try {
            await session.save();
        } catch (saveErr) {
            // If a unique-index conflict races us, another worker won — return their session.
            if (saveErr.code === 11000) {
                const winner = await ChatbotSession.findOne({
                    conversationId: conversationId,
                    status: 'active'
                });
                console.log(`🤖 [Chatbot] startSession: race detected, returning winning session ${winner?._id}`);
                return null;
            }
            throw saveErr;
        }
        console.log(`🤖 [Chatbot] Session ${session._id} created. startNodeId=${flow.startNodeId}, flow has ${flow.nodes?.length || 0} node(s) and ${flow.edges?.length || 0} edge(s)`);

        // Update analytics
        await ChatbotFlow.findByIdAndUpdate(flow._id, {
            $inc: { 'analytics.triggered': 1 }
        });

        if (isTemplateReply) {
            console.log(`🤖 [Chatbot] Handling template reply button click immediately`);
            return await continueSession(session, triggerMessageText, conversationId, userId, incomingMessage);
        } else {
            // Execute start node
            return await executeNode(session, flow, flow.startNodeId);
        }
    } catch (error) {
        console.error('Error starting session:', error);
        return null;
    }
};
// Function to evaluate smart lead settings and create/update lead
const evaluateSmartLead = async (session, flow, conversation) => {
    if (!flow.smartLeadSettings || !flow.smartLeadSettings.enabled) return;
    
    let currentLevel = session.qualificationLevel || 'None';
    // Count all user interactions (button taps, replies, media uploads) — not just stored variables
    const numAnswers = session.visitedNodes ? session.visitedNodes.length : 0;
    
    const customData = buildLeadCustomDataFromVariables(session.variables);

    const levelWeight = { 'None': 0, 'Partial': 1, 'Engaged': 2, 'Qualified': 3 };
    let bestRule = null;

    if (flow.smartLeadSettings.rules && flow.smartLeadSettings.rules.length > 0) {
        for (const rule of flow.smartLeadSettings.rules) {
            let rulePassed = true;
            
            // Check minimum questions answered
            if (rule.minQuestionsAnswered && numAnswers < rule.minQuestionsAnswered) {
                rulePassed = false;
            }
            
            // Check specific required variables
            if (rulePassed && rule.requiredVariables && rule.requiredVariables.length > 0) {
                for (const reqVar of rule.requiredVariables) {
                    if (!session.variables.get(reqVar)) {
                        rulePassed = false;
                        break;
                    }
                }
            }
            
            // Apply if passed and is a higher level
            if (rulePassed && levelWeight[rule.qualificationLevel] > levelWeight[currentLevel]) {
                currentLevel = rule.qualificationLevel;
                bestRule = rule;
            }
        }
    }
    
    // Evaluate if level actually increased
    const didLevelUp = levelWeight[currentLevel] > levelWeight[session.qualificationLevel || 'None'];
    
    // Track update in Lead DB
    // Update existing lead with new variables even if level didn't change
    let leadIdToUpdate = conversation.leadId;

    if (leadIdToUpdate) {
        if (didLevelUp) {
            session.qualificationLevel = currentLevel;
            await session.save();
        }

        // FIX 3a: Use dot-notation for customData so we MERGE chatbot answers into
        // existing Lead custom fields instead of OVERWRITING the entire customData map.
        // e.g. { 'customData.budget': '10k' } instead of { customData: { budget: '10k' } }
        const dotNotationCustomData = {};
        Object.entries(customData).forEach(([key, val]) => {
            dotNotationCustomData[`customData.${key}`] = val;
        });

        const setPayload = { ...dotNotationCustomData, 'qualificationLevel': currentLevel };
        if (didLevelUp && bestRule?.changeStageTo) {
            setPayload['status'] = bestRule.changeStageTo;
        }

        const updateOp = { $set: setPayload };

        // Only push a history entry when the level actually increased
        if (didLevelUp) {
            let qualificationReason = `Level upgraded to ${currentLevel} by Smart Engine. `;
            if (bestRule?.minQuestionsAnswered) qualificationReason += `Met criteria: ${bestRule.minQuestionsAnswered} node interactions. `;
            if (bestRule?.requiredVariables?.length > 0) qualificationReason += `Provided required criteria: ${bestRule.requiredVariables.join(', ')}.`;
            updateOp.$push = {
                history: { type: 'System', subType: 'Stage Change', content: qualificationReason, date: new Date() }
            };
        }

        // FIX 3b: Apply tags to BOTH the Lead CRM record AND the WhatsApp Conversation.
        // Previously tags only went to the Conversation, so they never appeared in the CRM UI.
        if (didLevelUp && bestRule?.assignTags?.length > 0) {
            updateOp.$addToSet = { tags: { $each: bestRule.assignTags } };
        }

        const updatedLead = await Lead.findByIdAndUpdate(leadIdToUpdate, updateOp, { new: true });

        if (didLevelUp && bestRule?.assignTags?.length > 0) {
            await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                $addToSet: { tags: { $each: bestRule.assignTags } }
            });
        }
        
        // Fire Automation & Meta CAPI hooks for Lead Upgrade Status Change
        if (didLevelUp && bestRule?.changeStageTo && updatedLead) {
            setImmediate(async () => {
                try {
                    const { evaluateLead } = require('./AutomationService');
                    evaluateLead(updatedLead, 'STAGE_CHANGED').catch(e => console.error('[Chatbot] Automation engine error:', e));

                    const IntegrationConfig = require('../models/IntegrationConfig');
                    const config = await IntegrationConfig.findOne({ userId: session.userId }).select('+meta.metaCapiEnabled +meta.metaPixelId +meta.metaCapiAccessToken +meta.metaStageMapping +meta.metaTestEventCode');
                    if (config?.meta?.metaCapiEnabled) {
                        const { sendMetaEvent } = require('./metaConversionService');
                        sendMetaEvent(config, updatedLead, bestRule.changeStageTo, null).catch(e => console.error('[Chatbot] Meta CAPI error:', e));
                    }
                } catch(err) {
                    console.error('[Chatbot] Background trigger error:', err);
                }
            });
        }
    } else if (didLevelUp) {
        // Create new lead when it crosses 'None'
        session.qualificationLevel = currentLevel;
        await session.save();

        const newLeadStatus = bestRule?.changeStageTo ? bestRule.changeStageTo : 'New';

        // Generate intelligent qualification reasoning
        let qualificationReason = `Lead automatically qualified as ${currentLevel} by Smart Engine. `;
        if (bestRule) {
            if (bestRule.minQuestionsAnswered) qualificationReason += `Met criteria: ${bestRule.minQuestionsAnswered} node interactions. `;
            if (bestRule.requiredVariables && bestRule.requiredVariables.length > 0) qualificationReason += `Provided required criteria: ${bestRule.requiredVariables.join(', ')}.`;
        } else {
            qualificationReason += `Crossed baseline threshold.`;
        }

        const lead = new Lead(buildLeadPayloadFromSession(session, conversation, {
            status: newLeadStatus,
            qualificationLevel: currentLevel,
            tags: bestRule?.assignTags?.length > 0 ? bestRule.assignTags : [],
            history: [{
                type: 'System',
                subType: 'Created',
                content: qualificationReason,
                date: new Date()
            }]
        }));
        await lead.save();
        leadIdToUpdate = lead._id;

        triggerChatbotLeadCreatedEffects(lead, session.userId, newLeadStatus);
        
        // Dynamically track new lead generation in flow analytics
        await ChatbotFlow.findByIdAndUpdate(flow._id, {
            $inc: { 'analytics.leadsGenerated': 1 }
        });
        
        // SAFETY: Build update payload correctly — always use operators, never mix bare fields
        // Also mirror the tags to the WhatsApp Conversation for the inbox sidebar
        const convUpdate = { $set: { leadId: lead._id } };
        if (bestRule?.assignTags && bestRule.assignTags.length > 0) {
            convUpdate.$addToSet = { tags: { $each: bestRule.assignTags } };
        }
        await WhatsAppConversation.findByIdAndUpdate(conversation._id, convUpdate);
    }
};

// Continue existing session.
// `incomingMessage` is the raw webhook message (used for request_media nodes that
// need access to message.content.mediaId / mimeType / caption / fileName).
const continueSession = async (session, userResponse, conversationId, userId, incomingMessage = null) => {
    try {
        const flow = session.flowId;
        if (!flow || !Array.isArray(flow.nodes)) {
            console.warn(`Chatbot session ${session._id} has a missing flow reference. Ending session safely.`);
            await endSession(session, 'abandoned');
            return null;
        }

        // FIX #25: Fetch conversation ONCE and reuse throughout the session lifecycle
        const conversation = await WhatsAppConversation.findById(conversationId);
        if (!conversation) {
            console.warn(`Conversation ${conversationId} not found for session ${session._id}`);
            await endSession(session, 'abandoned');
            return null;
        }

        const currentNode = flow.nodes.find(n => n.id === session.currentNodeId);

        if (!currentNode) {
            await endSession(session, 'abandoned');
            return null;
        }

        // Record user response
        session.visitedNodes.push({
            nodeId: currentNode.id,
            timestamp: new Date(),
            userResponse: userResponse || (incomingMessage ? `[${incomingMessage.type}]` : null)
        });

        // Track the latest customer reply timestamp.
        // The delay-node scheduler uses this to decide whether to cancel a
        // pending scheduled message when cancelIfReplied=true is set.
        session.lastCustomerReplyAt = new Date();


        // request_media node: capture uploaded media into session variables and (optionally) the lead.
        if (currentNode.type === 'request_media') {
            const messageType = incomingMessage?.type;
            const acceptedTypes = (currentNode.data.acceptedMediaTypes && currentNode.data.acceptedMediaTypes.length > 0)
                ? currentNode.data.acceptedMediaTypes
                : ['image', 'video', 'document', 'audio'];

            if (!messageType || !acceptedTypes.includes(messageType)) {
                const typesList = acceptedTypes.join(', ');
                const errMsg = `Please upload a ${typesList}.`;
                const errResult = await sendWhatsAppTextMessage(conversation.phone, errMsg, session.userId);
                await saveBotMessage(conversationId, session.userId, errMsg, 'text', errResult);
                return { success: true }; // stay on node
            }

            const mediaContent = incomingMessage.content || {};
            const variableName = currentNode.data.variableName || 'media';
            const captured = {
                mediaId: mediaContent.mediaId || null,
                type: messageType,
                mimeType: mediaContent.mimeType || null,
                fileName: mediaContent.fileName || null,
                caption: mediaContent.caption || ''
            };

            session.variables.set(variableName, captured);
            session.markModified('variables');

            // Optionally attach to the linked Lead's customData.mediaAttachments[]
            if (currentNode.data.attachToLead && conversation.leadId) {
                try {
                    const lead = await Lead.findById(conversation.leadId);
                    if (lead) {
                        if (!lead.customData) lead.customData = new Map();
                        const existing = lead.customData.get('mediaAttachments') || [];
                        existing.push({ ...captured, uploadedAt: new Date() });
                        lead.customData.set('mediaAttachments', existing);
                        lead.markModified('customData');
                        await lead.save();
                    }
                } catch (attachErr) {
                    console.error('[Chatbot] Failed to attach media to lead:', attachErr.message);
                }
            }

            const nextNodeId = currentNode.data.nextNodeId;
            await evaluateSmartLead(session, flow, conversation);
            if (nextNodeId) {
                session.currentNodeId = nextNodeId;
                session.lastInteractionAt = new Date();
                session.followUpIndex = 0;
                await session.save();
                return await executeNode(session, flow, nextNodeId, conversation);
            }
            await endSession(session, 'completed');
            return null;
        }

        // ── PRE-CHECK: Button re-selection takes priority over question/other nodes ──
        // If the user sends text that matches a button from ANY previously visited
        // button-node, pivot immediately — don't treat it as a question answer.
        if (userResponse) {
            const _normResp = userResponse.toLowerCase().trim();
            const _btnNodeTypes = new Set(['message', 'template']);
            const _buttonId = incomingMessage?.content?.buttonId || null;
            const _seenIds = new Set();
            const _reversedVisited = [...session.visitedNodes].reverse().filter(e => {
                if (_seenIds.has(e.nodeId)) return false;
                _seenIds.add(e.nodeId);
                return true;
            });
            for (const _entry of _reversedVisited) {
                const _pNode = flow.nodes.find(n => n.id === _entry.nodeId);
                if (!_pNode || !_btnNodeTypes.has(_pNode.type)) continue;
                if (!_pNode.data?.buttons || _pNode.data.buttons.length === 0) continue;
                const _mBtn = _pNode.data.buttons.find(b => {
                    if (_buttonId && b.id === _buttonId) return true;
                    const ft = (b.text || '').toLowerCase().trim();
                    if (ft && ft === _normResp) return true;
                    if (b.id === _normResp) return true;
                    const tr = (b.text || '').substring(0, 20).toLowerCase().trim();
                    if (tr && tr === _normResp) return true;
                    return false;
                });
                if (!_mBtn) continue;
                let _tId = _mBtn.nextNodeId;
                let _tNode = _tId ? flow.nodes.find(n => n.id === _tId) : null;
                if (!_tNode && flow.edges?.length > 0) {
                    const _edge = flow.edges.find(e =>
                        e.source === _pNode.id && e.sourceHandle === _mBtn.id &&
                        flow.nodes.some(n => n.id === e.target)
                    );
                    if (_edge) { _tId = _edge.target; _tNode = flow.nodes.find(n => n.id === _tId); }
                }
                if (_tNode) {
                    console.log(`🔄 [Chatbot] Button re-selection (pre-check) at node type "${currentNode.type}": user picked "${_mBtn.text}" from past node "${_pNode.id}". Pivoting → "${_tId}".`);
                    session.currentNodeId = _tId;
                    session.lastInteractionAt = new Date();
                    session.followUpIndex = 0;
                    await session.save();
                    await evaluateSmartLead(session, flow, conversation);
                    return await executeNode(session, flow, _tId, conversation);
                }
            }
        }

        // Handle different node types
        if (currentNode.type === 'question') {
            // FIX: Validate response against expectedType before accepting
            const expectedType = currentNode.data.expectedType || 'any';
            if (expectedType !== 'any' && expectedType !== 'text') {
                let isValid = true;
                let validationMsg = '';
                
                if (expectedType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userResponse)) {
                    isValid = false;
                    validationMsg = 'Please enter a valid email address (e.g. name@example.com)';
                } else if (expectedType === 'number' && isNaN(userResponse.replace(/[,\s]/g, ''))) {
                    isValid = false;
                    validationMsg = 'Please enter a valid number.';
                } else if (expectedType === 'phone' && !/^[+]?[\d\s()-]{7,15}$/.test(userResponse)) {
                    isValid = false;
                    validationMsg = 'Please enter a valid phone number.';
                }
                
                if (!isValid) {
                    if (conversation) {
                        const valResult = await sendWhatsAppTextMessage(conversation.phone, validationMsg, session.userId);
                        await saveBotMessage(conversationId, session.userId, validationMsg, 'text', valResult);
                    }
                    return { success: true }; // Stay on the same node, wait for valid input
                }
            }
            
            // Store answer in variables
            const variableName = currentNode.data.variableName || 'answer';
            session.variables.set(variableName, userResponse);
            session.markModified('variables');

            // Evaluate smart lead config — reuse already-fetched conversation
            await evaluateSmartLead(session, flow, conversation);

            // Move to next node
            const nextNodeId = currentNode.data.nextNodeId;
            if (nextNodeId) {
                session.currentNodeId = nextNodeId;
                session.lastInteractionAt = new Date();
                session.followUpIndex = 0;
                await session.save();
                return await executeNode(session, flow, nextNodeId, conversation);
            } else {
                await endSession(session, 'completed');
                return null;
            }
        } else if ((currentNode.type === 'message' || currentNode.type === 'template') && currentNode.data.buttons) {
            // Handle button response. Match priority:
            //   1. Exact buttonId from interactive.button_reply.id (most reliable — survives
            //      WhatsApp's 20-char title truncation and case/whitespace differences).
            //   2. Full button text (case-insensitive) — covers typed replies that match exactly.
            //   3. Truncated button text (first 20 chars) — covers tapped buttons whose original
            //      title was longer than WhatsApp's 20-char display limit.
            const normalizedResponse = (userResponse || '').toLowerCase().trim();
            const buttonId = incomingMessage?.content?.buttonId || null;

            const button = currentNode.data.buttons.find(b => {
                if (buttonId && b.id === buttonId) return true;
                const fullText = (b.text || '').toLowerCase().trim();
                if (fullText && fullText === normalizedResponse) return true;
                if (b.id === normalizedResponse) return true;
                const truncated = (b.text || '').substring(0, 20).toLowerCase().trim();
                if (truncated && truncated === normalizedResponse) return true;
                return false;
            });

            if (button) {
                // Resolve the target node. Try, in order:
                //   1. button.nextNodeId, if it points to an existing node.
                //   2. The target of any edge from (currentNode.id, sourceHandle = button.id)
                //      whose target also exists in flow.nodes.
                // The edge fallback covers two real cases: (a) older saves never wrote
                // nextNodeId onto the button, (b) the node nextNodeId points to was deleted
                // but a fresh edge was drawn afterwards.
                let targetNodeId = button.nextNodeId;
                let targetNode = targetNodeId ? flow.nodes.find(n => n.id === targetNodeId) : null;

                if (!targetNode && flow.edges && flow.edges.length > 0) {
                    const matchingEdge = flow.edges.find(e =>
                        e.source === currentNode.id &&
                        e.sourceHandle === button.id &&
                        flow.nodes.some(n => n.id === e.target)
                    );
                    if (matchingEdge) {
                        targetNodeId = matchingEdge.target;
                        targetNode = flow.nodes.find(n => n.id === targetNodeId);
                        console.log(`🤖 [Chatbot] Recovered button "${button.text}" → ${targetNodeId} from flow.edges (button.nextNodeId was "${button.nextNodeId || 'empty'}")`);
                    }
                }

                if (targetNode) {
                    session.currentNodeId = targetNodeId;
                    session.lastInteractionAt = new Date();
                    session.followUpIndex = 0;
                    await session.save();
                    await evaluateSmartLead(session, flow, conversation);
                    return await executeNode(session, flow, targetNodeId, conversation);
                } else {
                    const stalePointer = button.nextNodeId
                        ? `points to deleted node "${button.nextNodeId}"`
                        : 'has no nextNodeId set';
                    const edgeOut = (flow.edges || []).find(e => e.source === currentNode.id && e.sourceHandle === button.id);
                    const edgeNote = edgeOut
                        ? `(edge with sourceHandle="${button.id}" exists but its target "${edgeOut.target}" is also missing)`
                        : `(no edge with sourceHandle="${button.id}" found either)`;
                    console.log(`🤖 [Chatbot] Button "${button.text}" ${stalePointer} ${edgeNote}. Ending session.`);
                    await endSession(session, 'completed');
                    return null;
                }
            }
            
            // No button matched at all → send retry prompt
            if (conversation) {
                const buttonOptions = currentNode.data.buttons.map(b => `• ${b.text}`).join('\n');
                const retryText = `I didn't understand that. Please choose one of the following options:\n${buttonOptions}`;
                const retryResult = await sendInteractiveMessage(
                    conversation.phone,
                    retryText,
                    currentNode.data.buttons.map(b => ({ id: b.id, text: b.text })),
                    session.userId
                );
                await saveBotMessage(conversationId, session.userId, retryText, 'interactive', retryResult);
            }
            return { success: true }; // Stay on current node
        }

        // ─── BUTTON RE-SELECTION: scan ALL visited button-nodes in history ──────
        // User may be at Node 4 but tap/type a button from Node 1 (or any earlier
        // node). We scan ALL visited button-nodes in reverse so ANY past menu can
        // be re-selected, not just the most recent one.
        if (userResponse) {
            const normalizedResp = userResponse.toLowerCase().trim();
            const buttonNodeTypes = new Set(['message', 'template']);

            // Walk visitedNodes in reverse to find the last node that had buttons
            const reversedVisited = [...session.visitedNodes].reverse();
            for (const entry of reversedVisited) {
                const pastNode = flow.nodes.find(n => n.id === entry.nodeId);
                if (!pastNode || !buttonNodeTypes.has(pastNode.type)) continue;
                if (!pastNode.data?.buttons || pastNode.data.buttons.length === 0) continue;

                const buttonId = incomingMessage?.content?.buttonId || null;
                const matchedButton = pastNode.data.buttons.find(b => {
                    if (buttonId && b.id === buttonId) return true;
                    const fullText = (b.text || '').toLowerCase().trim();
                    if (fullText && fullText === normalizedResp) return true;
                    if (b.id === normalizedResp) return true;
                    const truncated = (b.text || '').substring(0, 20).toLowerCase().trim();
                    if (truncated && truncated === normalizedResp) return true;
                    return false;
                });

                if (matchedButton) {
                    let targetNodeId = matchedButton.nextNodeId;
                    let targetNode = targetNodeId ? flow.nodes.find(n => n.id === targetNodeId) : null;

                    if (!targetNode && flow.edges && flow.edges.length > 0) {
                        const matchingEdge = flow.edges.find(e =>
                            e.source === pastNode.id &&
                            e.sourceHandle === matchedButton.id &&
                            flow.nodes.some(n => n.id === e.target)
                        );
                        if (matchingEdge) {
                            targetNodeId = matchingEdge.target;
                            targetNode = flow.nodes.find(n => n.id === targetNodeId);
                        }
                    }

                    if (targetNode) {
                        console.log(`🔄 [Chatbot] Button re-selection detected! User changed from previous choice to "${matchedButton.text}" on node "${pastNode.id}". Pivoting to node "${targetNodeId}".`);
                        session.currentNodeId = targetNodeId;
                        session.lastInteractionAt = new Date();
                        session.followUpIndex = 0;
                        await session.save();
                        await evaluateSmartLead(session, flow, conversation);
                        return await executeNode(session, flow, targetNodeId, conversation);
                    }
                }
                // Button matched but target node missing — keep scanning older nodes
                continue;
            }
        }

        return null;
    } catch (error) {
        console.error('Error continuing session:', error);
        // Recover from a handler crash by abandoning the session — otherwise it stays
        // 'active' forever and every subsequent message hits the same broken node.
        try {
            await endSession(session, 'abandoned');
        } catch (endErr) {
            console.error('Error ending session after handler crash:', endErr);
        }
        return null;
    }
};

// Maximum recursion depth for executeNode — prevents stack overflow on
// self-referencing or cyclic flows (corrupted data from old chatbot builders).
const MAX_NODE_EXECUTION_DEPTH = 50;

// Execute a specific node
const executeNode = async (session, flow, nodeId, conversation = null, depth = 0) => {
    try {
        if (depth >= MAX_NODE_EXECUTION_DEPTH) {
            console.error(`🛑 [Chatbot] executeNode depth limit (${MAX_NODE_EXECUTION_DEPTH}) reached for session ${session._id}. Likely cycle in flow ${flow?._id}. Ending session.`);
            await endSession(session, 'abandoned');
            return null;
        }

        if (!flow || !Array.isArray(flow.nodes)) {
            console.warn(`Cannot execute chatbot node for session ${session._id}: flow is missing.`);
            await endSession(session, 'abandoned');
            return null;
        }

        const node = flow.nodes.find(n => n.id === nodeId);
        if (!node) {
            console.warn(`🤖 [Chatbot] executeNode: node "${nodeId}" not found in flow ${flow._id} (depth=${depth}). Available node ids: ${flow.nodes.map(n => n.id).join(', ')}. Ending session as abandoned.`);
            await endSession(session, 'abandoned');
            return null;
        }
        console.log(`🤖 [Chatbot] executeNode session=${session._id} node=${node.id} type=${node.type} depth=${depth}${node.data?.buttons?.length ? ` buttons=${node.data.buttons.length}` : ''}${node.data?.nextNodeId ? ` next=${node.data.nextNodeId}` : ''}`);

        // FIX #25: Reuse passed conversation, only fetch if not provided
        if (!conversation) {
            conversation = await WhatsAppConversation.findById(session.conversationId);
        }
        if (!conversation) return null;

        switch (node.type) {
            case 'start':
                // Move to next node immediately
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;

            case 'message':
                // Send message
                const messageText = replaceVariables(node.data.text, session.variables);

                if (node.data.buttons && node.data.buttons.length > 0) {
                    // Send interactive message with buttons
                    const interactiveResult = await sendInteractiveMessage(
                        conversation.phone,
                        messageText,
                        node.data.buttons.map(b => ({ id: b.id, text: b.text })),
                        session.userId
                    );
                    await saveBotMessage(session.conversationId, session.userId, messageText, 'interactive', interactiveResult);
                } else {
                    // Send regular text message
                    const textResult = await sendWhatsAppTextMessage(conversation.phone, messageText, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, messageText, 'text', textResult);

                    // Auto-advance to next node if no buttons
                    if (node.data.nextNodeId) {
                        session.currentNodeId = node.data.nextNodeId;
                        await session.save();
                        return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                    }
                }
                break;

            case 'question':
                // Send question and wait for response
                const questionText = replaceVariables(node.data.text, session.variables);
                const questionResult = await sendWhatsAppTextMessage(conversation.phone, questionText, session.userId);
                await saveBotMessage(session.conversationId, session.userId, questionText, 'text', questionResult);
                // Session will wait for user response
                break;

            case 'request_media':
                // Prompt the user to upload a file. Session waits for the next inbound
                // media message (handled in processIncomingMessage → continueSession).
                const requestMediaText = replaceVariables(
                    node.data.text || 'Please upload a file to continue.',
                    session.variables
                );
                const requestMediaResult = await sendWhatsAppTextMessage(
                    conversation.phone,
                    requestMediaText,
                    session.userId
                );
                await saveBotMessage(
                    session.conversationId,
                    session.userId,
                    requestMediaText,
                    'text',
                    requestMediaResult
                );
                break;

            case 'condition': {
                // Guard: conditions must be an array
                const conditions = Array.isArray(node.data.conditions) ? node.data.conditions : [];
                if (conditions.length === 0) {
                    console.warn(`⚠️ [Chatbot] Condition node "${nodeId}" has no conditions. Taking else path.`);
                }

                // Find the first matching IF branch
                const matchedCondition = conditions.find(cond => evaluateCondition(cond, session.variables));

                let branchNodeId = null;

                if (matchedCondition) {
                    // Resolve nextNodeId from condition data OR from the edge sourceHandle
                    branchNodeId = matchedCondition.nextNodeId;
                    if (!branchNodeId && flow.edges?.length > 0) {
                        const edge = flow.edges.find(e =>
                            e.source === nodeId && e.sourceHandle === matchedCondition.id &&
                            flow.nodes.some(n => n.id === e.target)
                        );
                        if (edge) branchNodeId = edge.target;
                    }
                    console.log(`🔀 [Chatbot] Condition node "${nodeId}": IF matched (var="${matchedCondition.variable}" ${matchedCondition.operator} "${matchedCondition.value}") → "${branchNodeId}"`);
                } else {
                    // ELSE path: use node.data.nextNodeId OR edge with sourceHandle='else'
                    branchNodeId = node.data.nextNodeId;
                    if (!branchNodeId && flow.edges?.length > 0) {
                        const elseEdge = flow.edges.find(e =>
                            e.source === nodeId && e.sourceHandle === 'else' &&
                            flow.nodes.some(n => n.id === e.target)
                        );
                        if (elseEdge) branchNodeId = elseEdge.target;
                    }
                    console.log(`🔀 [Chatbot] Condition node "${nodeId}": no IF matched → ELSE → "${branchNodeId}"`);
                }

                if (branchNodeId && flow.nodes.some(n => n.id === branchNodeId)) {
                    session.currentNodeId = branchNodeId;
                    await session.save();
                    return await executeNode(session, flow, branchNodeId, conversation, depth + 1);
                }
                // No branch resolved — end session gracefully
                console.warn(`⚠️ [Chatbot] Condition node "${nodeId}": no valid branch target found. Ending session.`);
                await endSession(session, 'completed');
                break;
            }

            case 'action':
                // Execute action
                await executeAction(node.data, session, conversation);

                // Move to next node
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;

            case 'delay':
                if (node.data.nextNodeId && node.data.delaySeconds > 0) {
                    // cancelIfReplied defaults to true — skip the scheduled message
                    // if the customer sends any reply during the wait window.
                    const cancelIfReplied = node.data.cancelIfReplied !== false;
                    await whatsappQueueService.scheduleDelayNode(
                        session._id,
                        flow._id,
                        node.data.nextNodeId,
                        node.data.delaySeconds,
                        cancelIfReplied
                    );
                } else if (node.data.nextNodeId) {
                    // No delay config, jump immediately
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;


            case 'template':
                // Send an approved WhatsApp template message
                if (node.data.templateName) {
                    const { sendWhatsAppTemplateMessage } = require('./whatsappService');
                    const templateResult = await sendWhatsAppTemplateMessage(
                        conversation.phone,
                        node.data.templateName,
                        node.data.templateLanguage || 'en',
                        [], // components — no dynamic variables from chatbot for now
                        session.userId,
                        { isAutomated: true, triggerType: 'chatbot' }
                    );
                    await saveBotMessage(
                        session.conversationId,
                        session.userId,
                        `📄 Template: ${node.data.templateName}`,
                        'template',
                        templateResult
                    );
                } else {
                    console.warn(`⚠️ Template node ${nodeId} has no templateName configured. Skipping.`);
                }

                // Auto-advance to next node
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;

            case 'media':
                // Send media message (image/video/document) with actual file or URL
                const mediaCaption = replaceVariables(node.data.text || '', session.variables);
                const VALID_MEDIA_TYPES = ['image', 'video', 'document', 'audio'];
                const rawMediaType = node.data.mediaType || 'image';
                const mediaType = VALID_MEDIA_TYPES.includes(rawMediaType) ? rawMediaType : 'image';
                if (rawMediaType !== mediaType) {
                    console.warn(`⚠️ [Chatbot] Media node ${nodeId} has invalid mediaType "${rawMediaType}". Falling back to "image".`);
                }
                const mediaIdentifier = node.data.mediaId || node.data.mediaUrl;

                if (mediaIdentifier) {
                    try {
                        const mediaResult = await sendMediaMessage(
                            conversation.phone,
                            mediaType,
                            mediaIdentifier,
                            mediaCaption,
                            session.userId
                        );
                        
                        const mediaData = mediaIdentifier.startsWith('http') 
                            ? { mediaUrl: mediaIdentifier } 
                            : { mediaId: mediaIdentifier };
                            
                        await saveBotMessage(
                            session.conversationId, 
                            session.userId, 
                            mediaCaption || `[${mediaType}]`, 
                            mediaType, 
                            mediaResult,
                            mediaData
                        );
                    } catch (mediaErr) {
                        console.error(`[Chatbot] Failed to send actual media, falling back to text link:`, mediaErr.message);
                        const fallbackText = mediaCaption ? `${mediaCaption}\n\n${mediaIdentifier}` : mediaIdentifier;
                        const fallbackResult = await sendWhatsAppTextMessage(conversation.phone, fallbackText, session.userId);
                        await saveBotMessage(session.conversationId, session.userId, fallbackText, 'text', fallbackResult);
                    }
                } else if (mediaCaption) {
                    const mediaCaptionResult = await sendWhatsAppTextMessage(conversation.phone, mediaCaption, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, mediaCaption, 'text', mediaCaptionResult);
                }

                // Auto-advance to next node
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;

            case 'list': {
                const listText = replaceVariables(node.data.text || 'Choose an option:', session.variables);
                const listItems = node.data.items || [];
                // Normalise items — support both legacy string[] and new {id,title,description}[]
                const normalisedItems = listItems.map((item, idx) =>
                    typeof item === 'string'
                        ? { id: `list_${idx}`, title: item, description: '' }
                        : { id: item.id || `list_${idx}`, title: item.title || item.text || `Option ${idx + 1}`, description: item.description || '' }
                );

                if (normalisedItems.length > 0 && normalisedItems.length <= 3) {
                    // ≤3 items — send as WhatsApp interactive reply buttons
                    const listButtons = normalisedItems.map(it => ({ id: it.id, text: it.title.slice(0, 20) }));
                    const listResult = await sendInteractiveMessage(
                        conversation.phone, listText, listButtons, session.userId
                    );
                    await saveBotMessage(session.conversationId, session.userId, listText, 'interactive', listResult);
                } else if (normalisedItems.length > 3) {
                    // >3 items — send as numbered text list (WhatsApp interactive list API requires approved BSP access)
                    const numberedList = normalisedItems.map((it, idx) => {
                        const desc = it.description ? ` — ${it.description}` : '';
                        return `${idx + 1}. ${it.title}${desc}`;
                    }).join('\n');
                    const fullListText = `${listText}\n\n${numberedList}`;
                    const listTextResult = await sendWhatsAppTextMessage(conversation.phone, fullListText, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, fullListText, 'text', listTextResult);
                }
                break;
            }

            case 'product': {
                const productText = replaceVariables(node.data.text || '', session.variables);
                const priceInfo = node.data.price ? `\n💰 Price: ${node.data.price}` : '';
                const productMessage = productText + priceInfo;
                if (productMessage) {
                    const productResult = await sendWhatsAppTextMessage(conversation.phone, productMessage, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, productMessage, 'text', productResult);
                }
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;
            }

            case 'products': {
                const catalogIntro = replaceVariables(node.data.text || 'Browse our catalog:', session.variables);
                const productList = node.data.productList || [];
                if (productList.length > 0) {
                    const catalogLines = productList.map((p, idx) => {
                        const name = p.name || `Product ${idx + 1}`;
                        const price = p.price ? ` — 💰 ${p.price}` : '';
                        return `${idx + 1}. ${name}${price}`;
                    }).join('\n');
                    const catalogMessage = `${catalogIntro}\n\n${catalogLines}`;
                    const catalogResult = await sendWhatsAppTextMessage(conversation.phone, catalogMessage, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, catalogMessage, 'text', catalogResult);
                } else {
                    // Fallback to legacy single-product format
                    const legacyText = replaceVariables(node.data.text || '', session.variables);
                    const legacyPrice = node.data.price ? `\n💰 Price: ${node.data.price}` : '';
                    const legacyMsg = legacyText + legacyPrice;
                    if (legacyMsg) {
                        const legacyResult = await sendWhatsAppTextMessage(conversation.phone, legacyMsg, session.userId);
                        await saveBotMessage(session.conversationId, session.userId, legacyMsg, 'text', legacyResult);
                    }
                }
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;
            }

            case 'handoff':
                // Transfer to human agent — end chatbot session and notify agent
                const handoffText = replaceVariables(node.data.text || 'An agent will assist you shortly.', session.variables);
                const handoffResult = await sendWhatsAppTextMessage(conversation.phone, handoffText, session.userId);
                await saveBotMessage(session.conversationId, session.userId, handoffText, 'text', handoffResult);

                // Pause chatbot for 24 hours so agent can work
                await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                    $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                });

                // Notify agent via Socket.IO
                const handoffUserId = conversation.assignedTo || session.userId;
                emitToUser(handoffUserId, 'notification:agent', {
                    type: 'chatbot_handoff',
                    conversationId: conversation._id,
                    phone: conversation.phone,
                    displayName: conversation.displayName,
                    message: `🤝 Chatbot handoff requested by ${conversation.displayName || conversation.phone}`,
                    timestamp: new Date()
                });

                // End the chatbot session
                await endSession(session, 'handoff');
                return { success: true };

            case 'end':
                await endSession(session, 'completed');
                break;
        }

        return { success: true };
    } catch (error) {
        console.error('Error executing node:', error);
        return null;
    }
};

// Replace variables in text. Both the variable key (used in regex source) and the
// value (used as replacement string) need escaping — `$` has special meaning in
// String.replace replacement strings and would corrupt user input like "$100".
const replaceVariables = (text, variables) => {
    if (!text) return '';
    if (!variables || typeof variables.forEach !== 'function') return text;

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapeReplacement = (s) => String(s ?? '').replace(/\$/g, '$$$$');

    let result = text;
    variables.forEach((value, key) => {
        if (!key) return;
        const regex = new RegExp(`{{${escapeRegex(key)}}}`, 'g');
        result = result.replace(regex, escapeReplacement(value));
    });

    return result;
};

// NOTE: evaluateCondition() is defined near the top of this file (after RESERVED_LEAD_VARIABLES).
// It supports 10 operators: equals, not_equals, contains, not_contains, starts_with,
// ends_with, greater_than, less_than, is_set, is_empty.

// Execute action
const executeAction = async (actionData, session, conversation) => {
    try {
        switch (actionData.actionType) {
            case 'assign_tag':
                if (actionData.actionData?.tag) {
                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                        $addToSet: { tags: actionData.actionData.tag }
                    });
                    // Also tag the Lead if linked
                    if (conversation.leadId) {
                        await Lead.findByIdAndUpdate(conversation.leadId, {
                            $addToSet: { tags: actionData.actionData.tag }
                        });
                    }
                }
                break;

            case 'change_stage':
                if (conversation.leadId && actionData.actionData?.stage) {
                    await Lead.findByIdAndUpdate(conversation.leadId, {
                        $set: { status: actionData.actionData.stage },
                        $push: {
                            history: {
                                $each: [{
                                    type: 'System', subType: 'Stage Change',
                                    content: `Stage changed to "${actionData.actionData.stage}" by chatbot action.`,
                                    date: new Date()
                                }],
                                $slice: -100
                            }
                        }
                    });
                }
                break;

            case 'create_lead': {
                const targetStage = actionData.actionData?.status || 'New';
                const { findDuplicates } = require('./duplicateService');
                const actionTags = Array.isArray(actionData.actionData?.tags)
                    ? actionData.actionData.tags
                    : (actionData.actionData?.tag ? [actionData.actionData.tag] : []);
                const leadEmail = getFirstPopulatedVariable(session.variables, [
                    'email', 'email_address', 'emailAddress', 'lead_email'
                ]) || null;

                let lead = null;

                // ── Step 1: Check if conversation already has a linked lead ──
                if (conversation.leadId) {
                    lead = await Lead.findById(conversation.leadId);
                }

                // ── Step 2: If not linked, try to find by phone/email duplicate ──
                if (!lead) {
                    const duplicates = await findDuplicates(session.userId, conversation.phone, leadEmail);
                    if (duplicates.length > 0) {
                        lead = await Lead.findById(duplicates[0]._id);
                    }
                }

                if (lead) {
                    // ── UPSERT PATH: Lead exists → just update stage ──────────
                    const stageChanged = lead.status !== targetStage;
                    if (stageChanged) {
                        await Lead.findByIdAndUpdate(lead._id, {
                            $set: { status: targetStage },
                            $push: {
                                history: {
                                    $each: [{
                                        type: 'System',
                                        subType: 'Stage Change',
                                        content: `Stage updated to "${targetStage}" by chatbot action node.`,
                                        date: new Date()
                                    }],
                                    $slice: -100
                                }
                            }
                        });
                        console.log(`🤖 [Chatbot] create_lead (upsert): lead ${lead._id} stage updated → "${targetStage}"`);
                    } else {
                        console.log(`🤖 [Chatbot] create_lead (upsert): lead ${lead._id} already in stage "${targetStage}", no change needed.`);
                    }
                } else {
                    // ── CREATE PATH: No lead found → create new ───────────────
                    lead = new Lead(buildLeadPayloadFromSession(session, conversation, {
                        source: actionData.actionData?.source || 'WhatsApp Chatbot',
                        status: targetStage,
                        tags: actionTags,
                        history: [{
                            type: 'System',
                            subType: 'Created',
                            content: `Lead created in stage "${targetStage}" by chatbot action node.`,
                            date: new Date()
                        }]
                    }));
                    await lead.save();
                    console.log(`🤖 [Chatbot] create_lead: new lead ${lead._id} created in stage "${targetStage}"`);

                    const flowId = getSessionFlowId(session);
                    if (flowId) {
                        await ChatbotFlow.findByIdAndUpdate(flowId, {
                            $inc: { 'analytics.leadsGenerated': 1 }
                        });
                    }

                    triggerChatbotLeadCreatedEffects(lead, session.userId, lead.status);
                }

                // ── Always link lead to the conversation ──────────────────────
                if (!conversation.leadId || conversation.leadId.toString() !== lead._id.toString()) {
                    conversation.leadId = lead._id;
                    const conversationUpdate = { $set: { leadId: lead._id } };
                    if (lead.tags?.length > 0) {
                        conversationUpdate.$addToSet = { tags: { $each: lead.tags } };
                    }
                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, conversationUpdate);
                }
                break;
            }


            case 'notify_agent':
                // FIX: Implement real agent notification via Socket.IO
                try {
                    const agentMsg = actionData.actionData?.message || `Chatbot needs attention for conversation with ${conversation.displayName || conversation.phone}`;
                    // Notify the conversation owner (or assigned agent)
                    const notifyUserId = conversation.assignedTo || session.userId;
                    emitToUser(notifyUserId, 'notification:agent', {
                        type: 'chatbot_handoff',
                        conversationId: conversation._id,
                        phone: conversation.phone,
                        displayName: conversation.displayName,
                        message: agentMsg,
                        timestamp: new Date()
                    });
                    console.log(`🔔 Agent notification sent to ${notifyUserId} for conversation ${conversation._id}`);
                } catch (notifErr) {
                    console.error('Error sending agent notification:', notifErr.message);
                }
                break;

            case 'send_email':
                // FIX: Implement send_email action
                try {
                    if (actionData.actionData?.to || session.variables.get('email')) {
                        const { sendEmail } = require('./emailService');
                        const emailTo = actionData.actionData?.to || session.variables.get('email');
                        const emailSubject = actionData.actionData?.subject || 'Follow-up from our chat';
                        let emailBody = actionData.actionData?.body || '';
                        // Replace variables in email body
                        if (session.variables) {
                            session.variables.forEach((val, key) => {
                                emailBody = emailBody.replace(new RegExp(`{{${key}}}`, 'g'), val);
                            });
                        }
                        await sendEmail({ to: emailTo, subject: emailSubject, text: emailBody, userId: session.userId });
                        console.log(`📧 Chatbot sent email to ${emailTo}`);
                    }
                } catch (emailErr) {
                    console.error('Error in chatbot send_email action:', emailErr.message);
                }
                break;

            case 'update_field':
                // FIX: Implement update_field action — updates custom fields on the linked Lead
                try {
                    if (conversation.leadId && actionData.actionData?.fieldName) {
                        const fieldName = actionData.actionData.fieldName;
                        let fieldValue = actionData.actionData.fieldValue || '';
                        // Allow using session variable values
                        if (actionData.actionData.fromVariable && session.variables.get(actionData.actionData.fromVariable)) {
                            fieldValue = session.variables.get(actionData.actionData.fromVariable);
                        }
                        await Lead.findByIdAndUpdate(conversation.leadId, {
                            $set: { [`customData.${fieldName}`]: fieldValue }
                        });
                        console.log(`✏️ Chatbot updated lead field '${fieldName}' = '${fieldValue}'`);
                    }
                } catch (fieldErr) {
                    console.error('Error in chatbot update_field action:', fieldErr.message);
                }
                break;
        }
    } catch (error) {
        console.error('Error executing action:', error);
    }
};

// End session
const endSession = async (session, status) => {
    try {
        session.status = status;
        session.completedAt = new Date();
        await session.save();

        // Update analytics
        const flowId = getSessionFlowId(session);
        if (flowId) {
            const updateField = status === 'completed' ? 'analytics.completed' : 'analytics.abandoned';
            await ChatbotFlow.findByIdAndUpdate(flowId, {
                $inc: { [updateField]: 1 }
            });
        } else {
            console.warn(`Skipping chatbot analytics update for session ${session._id}: flow reference is missing.`);
        }

        console.log(`✅ Chatbot session ${status}:`, session._id);
    } catch (error) {
        console.error('Error ending session:', error);
    }
};

// Handoff to agent
exports.handoffToAgent = async (sessionId, reason) => {
    try {
        const session = await ChatbotSession.findById(sessionId);
        if (!session) return;

        session.status = 'handoff';
        session.handoffReason = reason;
        await session.save();

        console.log('🤝 Session handed off to agent:', sessionId);
    } catch (error) {
        console.error('Error handing off session:', error);
    }
};

// Cancel all active chatbot sessions for a conversation (called when agent takes over)
// CRITICAL: Without this, chatbot runs in parallel with human agents — spam risk!
exports.cancelActiveChatbots = async (conversationId) => {
    try {
        await WhatsAppConversation.findByIdAndUpdate(conversationId, { $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) } });
        const result = await ChatbotSession.updateMany(
            { conversationId: conversationId, status: 'active' },
            { $set: { status: 'handoff', handoffReason: 'Agent manually replied', completedAt: new Date() } }
        );

        if (result.modifiedCount > 0) {
            console.log(`🛑 Cancelled ${result.modifiedCount} active chatbot session(s) for conversation ${conversationId} — agent took over`);
        }
    } catch (error) {
        console.error('Error cancelling active chatbots:', error);
    }
};



// Exported for Agenda queue processor
exports.resumeExecution = async (session, flow, nodeId) => { return await executeNode(session, flow, nodeId); };
