const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { sendWhatsAppTextMessage, sendInteractiveMessage } = require('./whatsappService');
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
const saveBotMessage = async (conversationId, userId, text, type = 'text', waResult = null) => {
    try {
        const waMessageId = waResult?.messages?.[0]?.id || undefined;
        const messageDoc = new WhatsAppMessage({
            conversationId,
            userId,
            waMessageId,
            direction: 'outbound',
            type,
            content: { text },
            status: waMessageId ? 'sent' : 'pending',
            timestamp: new Date(),
            isAutomated: true,
            automationSource: 'chatbot'
        });
        await messageDoc.save();

        // Update conversation metadata
        await WhatsAppConversation.findByIdAndUpdate(conversationId, {
            $set: {
                lastMessage: text.substring(0, 100),
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
                lastMessage: text.substring(0, 100),
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
        console.log(`🤖 [Chatbot] Message text: "${messageText || '(empty/media)'}" | Conversation: ${conversationId} | Paused: ${isPaused}`);
        
        // FIX: Handle media messages — acknowledge receipt instead of silently ignoring
        if (!messageText) {
            // Check if there's an active session waiting for a response
            const activeSession = await ChatbotSession.findOne({
                conversationId: conversationId,
                status: 'active'
            });
            if (activeSession && !isPaused) {
                // Let the user know we need a text response
                const replyText = 'Please send a text message to continue. Media files are not supported in this conversation flow.';
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
                console.log(`🤖 [Chatbot] Continuing active session ${session._id} for flow "${session.flowId?.name || 'unknown'}"`);
                return await continueSession(session, messageText, conversationId, userId);
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

        // 2. First Message Match (Completely new contact) — only if NOT paused
        if (!targetFlow && !isPaused && conversation.metadata.totalInbound === 1) {
            targetFlow = allActiveFlows.find(f => f.triggerType === 'first_message' || f.triggerType === 'any_message');
            if (targetFlow) console.log(`🤖 [Chatbot] First-message trigger matched: "${targetFlow.name}"`);
        }

        // 3. Existing Contact Match (They have messaged before) — only if NOT paused
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
                normalizeId(targetFlow.userId) || tenantId
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
const startSession = async (flow, conversationId, userId) => {
    try {
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

        await session.save();

        // Update analytics
        await ChatbotFlow.findByIdAndUpdate(flow._id, {
            $inc: { 'analytics.triggered': 1 }
        });

        // Execute start node
        return await executeNode(session, flow, flow.startNodeId);
    } catch (error) {
        console.error('Error starting session:', error);
        return null;
    }
};
// Function to evaluate smart lead settings and create/update lead
const evaluateSmartLead = async (session, flow, conversation) => {
    if (!flow.smartLeadSettings || !flow.smartLeadSettings.enabled) return;
    
    let currentLevel = session.qualificationLevel || 'None';
    const numAnswers = session.variables ? session.variables.size : 0;
    
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
            if (bestRule?.minQuestionsAnswered) qualificationReason += `Met criteria: ${bestRule.minQuestionsAnswered} questions answered. `;
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
            if (bestRule.minQuestionsAnswered) qualificationReason += `Met criteria: ${bestRule.minQuestionsAnswered} questions answered. `;
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

// Continue existing session
const continueSession = async (session, userResponse, conversationId, userId) => {
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
            userResponse: userResponse
        });

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
                await session.save();
                return await executeNode(session, flow, nextNodeId, conversation);
            } else {
                await endSession(session, 'completed');
                return null;
            }
        } else if (currentNode.type === 'message' && currentNode.data.buttons) {
            // Handle button response — trim & normalize for reliable matching
            const normalizedResponse = userResponse.toLowerCase().trim();
            const button = currentNode.data.buttons.find(b =>
                b.text.toLowerCase().trim() === normalizedResponse || b.id === normalizedResponse
            );

            if (button) {
                // Verify the edge actually exists in the flow to prevent phantom connections from legacy bugs
                let isValidConnection = !!button.nextNodeId;
                if (isValidConnection && flow.edges && flow.edges.length > 0) {
                    isValidConnection = flow.edges.some(e => e.source === currentNode.id && e.target === button.nextNodeId);
                }

                if (isValidConnection) {
                    // Button matched AND has a connected next node → navigate
                    session.currentNodeId = button.nextNodeId;
                    session.lastInteractionAt = new Date();
                    await session.save();
                    return await executeNode(session, flow, button.nextNodeId, conversation);
                } else {
                    // Button matched but NO next node connected → dead-end path, end session gracefully
                    console.log(`🤖 [Chatbot] Button "${button.text}" selected but has no connected node. Ending session.`);
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

        return null;
    } catch (error) {
        console.error('Error continuing session:', error);
        return null;
    }
};

// Execute a specific node
const executeNode = async (session, flow, nodeId, conversation = null) => {
    try {
        if (!flow || !Array.isArray(flow.nodes)) {
            console.warn(`Cannot execute chatbot node for session ${session._id}: flow is missing.`);
            await endSession(session, 'abandoned');
            return null;
        }

        const node = flow.nodes.find(n => n.id === nodeId);
        if (!node) {
            await endSession(session, 'abandoned');
            return null;
        }

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
                    return await executeNode(session, flow, node.data.nextNodeId, conversation);
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
                        return await executeNode(session, flow, node.data.nextNodeId, conversation);
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

            case 'condition':
                // Evaluate conditions
                const matchedCondition = node.data.conditions.find(cond =>
                    evaluateCondition(cond, session.variables)
                );

                if (matchedCondition && matchedCondition.nextNodeId) {
                    session.currentNodeId = matchedCondition.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, matchedCondition.nextNodeId, conversation);
                } else if (node.data.nextNodeId) {
                    // Default path
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation);
                }
                break;

            case 'action':
                // Execute action
                await executeAction(node.data, session, conversation);

                // Move to next node
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation);
                }
                break;

            case 'delay':
                if (node.data.nextNodeId && node.data.delaySeconds > 0) {
                    await whatsappQueueService.scheduleDelayNode(
                        session._id,
                        flow._id,
                        node.data.nextNodeId,
                        node.data.delaySeconds
                    );
                } else if (node.data.nextNodeId) {
                    // No delay config, jump immediately
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation);
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
                    return await executeNode(session, flow, node.data.nextNodeId, conversation);
                }
                break;

            case 'media':
                // Send media message (image/video/document) with optional caption
                const mediaCaption = replaceVariables(node.data.text || '', session.variables);
                if (node.data.mediaUrl) {
                    // Use text message with media URL as link for now
                    // (WhatsApp Cloud API requires uploaded media IDs, so we send URL in text)
                    const mediaText = mediaCaption ? `${mediaCaption}\n\n${node.data.mediaUrl}` : node.data.mediaUrl;
                    const mediaResult = await sendWhatsAppTextMessage(conversation.phone, mediaText, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, mediaText, 'text', mediaResult);
                } else if (mediaCaption) {
                    const mediaCaptionResult = await sendWhatsAppTextMessage(conversation.phone, mediaCaption, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, mediaCaption, 'text', mediaCaptionResult);
                }

                // Auto-advance to next node
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation);
                }
                break;

            case 'list':
                // Send list as interactive button menu (WhatsApp limits to 3 buttons) or text list
                const listText = replaceVariables(node.data.text || 'Choose an option:', session.variables);
                const listItems = node.data.items || [];
                
                if (listItems.length > 0 && listItems.length <= 3) {
                    // Send as interactive buttons
                    const listButtons = listItems.map((item, idx) => ({
                        id: `list_${idx}`,
                        text: typeof item === 'string' ? item : item.text || `Option ${idx + 1}`
                    }));
                    const listResult = await sendInteractiveMessage(
                        conversation.phone, listText, listButtons, session.userId
                    );
                    await saveBotMessage(session.conversationId, session.userId, listText, 'interactive', listResult);
                } else {
                    // More than 3 items — send as numbered text list
                    const numberedList = listItems.map((item, idx) => {
                        const itemText = typeof item === 'string' ? item : item.text || `Option ${idx + 1}`;
                        return `${idx + 1}. ${itemText}`;
                    }).join('\n');
                    const fullListText = `${listText}\n\n${numberedList}`;
                    const listTextResult = await sendWhatsAppTextMessage(conversation.phone, fullListText, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, fullListText, 'text', listTextResult);
                }
                // Wait for user selection (same as message with buttons)
                break;

            case 'product':
            case 'products':
                // Send product info as rich text message
                const productText = replaceVariables(node.data.text || '', session.variables);
                const priceInfo = node.data.price ? `\n💰 Price: ${node.data.price}` : '';
                const productMessage = productText + priceInfo;
                
                if (productMessage) {
                    const productResult = await sendWhatsAppTextMessage(conversation.phone, productMessage, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, productMessage, 'text', productResult);
                }

                // Auto-advance to next node
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation);
                }
                break;

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

// Replace variables in text
const replaceVariables = (text, variables) => {
    if (!text) return '';

    let result = text;
    variables.forEach((value, key) => {
        const regex = new RegExp(`{{${key}}}`, 'g');
        result = result.replace(regex, value);
    });

    return result;
};

// Evaluate condition
const evaluateCondition = (condition, variables) => {
    if (!condition || !condition.variable) return false;
    const value = variables.get(condition.variable);
    if (value === undefined || value === null) return false;

    // FIX: Guard against null/undefined condition.value to prevent TypeError
    const conditionValue = condition.value != null ? condition.value : '';

    switch (condition.operator) {
        case 'equals':
            return value.toString().toLowerCase() === conditionValue.toString().toLowerCase();
        case 'contains':
            return value.toString().toLowerCase().includes(conditionValue.toString().toLowerCase());
        case 'greater_than':
            return parseFloat(value) > parseFloat(conditionValue);
        case 'less_than':
            return parseFloat(value) < parseFloat(conditionValue);
        case 'not_empty':
            return value && value.toString().trim().length > 0;
        default:
            return false;
    }
};

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

            case 'create_lead':
                if (!conversation.leadId) {
                    const { findDuplicates } = require('./duplicateService');
                    const actionTags = Array.isArray(actionData.actionData?.tags)
                        ? actionData.actionData.tags
                        : (actionData.actionData?.tag ? [actionData.actionData.tag] : []);
                    const leadEmail = getFirstPopulatedVariable(session.variables, [
                        'email',
                        'email_address',
                        'emailAddress',
                        'lead_email'
                    ]) || null;

                    const duplicates = await findDuplicates(session.userId, conversation.phone, leadEmail);
                    let lead = null;

                    if (duplicates.length > 0) {
                        lead = await Lead.findById(duplicates[0]._id);
                    }

                    if (!lead) {
                        lead = new Lead(buildLeadPayloadFromSession(session, conversation, {
                            source: actionData.actionData?.source || 'WhatsApp Chatbot',
                            status: actionData.actionData?.status || 'New',
                            tags: actionTags,
                            history: [{
                                type: 'System',
                                subType: 'Created',
                                content: 'Lead created by chatbot action node.',
                                date: new Date()
                            }]
                        }));
                        await lead.save();

                        const flowId = getSessionFlowId(session);
                        if (flowId) {
                            await ChatbotFlow.findByIdAndUpdate(flowId, {
                                $inc: { 'analytics.leadsGenerated': 1 }
                            });
                        }

                        triggerChatbotLeadCreatedEffects(lead, session.userId, lead.status);
                    }

                    conversation.leadId = lead._id;
                    conversation.tags = [...new Set([...(conversation.tags || []), ...(lead.tags || [])])];

                    const conversationUpdate = { $set: { leadId: lead._id } };
                    if (lead.tags?.length > 0) {
                        conversationUpdate.$addToSet = { tags: { $each: lead.tags } };
                    }

                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, conversationUpdate);
                }
                break;

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
