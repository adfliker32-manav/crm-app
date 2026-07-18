const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const BookingPage = require('../models/BookingPage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const AgencySettings = require('../models/AgencySettings');
const axios = require('axios');
const { sendWhatsAppTextMessage, sendInteractiveMessage, sendListMessage, sendCtaUrlMessage, sendMediaMessage } = require('./whatsappService');
const { emitToUser, emitToUsers, emitToConversation } = require('./socketService');
const { getCompanyUserIds } = require('../utils/whatsappUtils');
const whatsappQueueService = require('./whatsappQueueService');
const NodeCache = require('node-cache');
const flowCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const bookingPageCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const { generateReply, mapReplyToOption } = require('./aiService');
const aiCreditService = require('./aiCreditService');
const { decryptToken } = require('../utils/encryptionUtils');

const normalizeBaseUrl = (value) => {
    const v = String(value || '').trim();
    if (!v) return '';
    const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    return withProto.replace(/\/+$/, '');
};
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

            // FIX: Enroll chatbot-captured leads in drip sequences (was missing)
            const { enrollLeadInSequences } = require('./sequenceService');
            enrollLeadInSequences(lead, 'LEAD_CREATED').catch(e => console.error('[Chatbot] Sequence enrollment error:', e));

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
const saveBotMessage = async (conversationId, userId, text, type = 'text', waResult = null, mediaData = null, automationSource = 'chatbot') => {
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
            automationSource
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

        // Push to the whole team via Socket.IO (shared inbox — all company users)
        const savedMsg = messageDoc.toObject();
        const companyUserIds = await getCompanyUserIds(userId);
        emitToUsers(companyUserIds, 'whatsapp:newMessage', {
            conversationId,
            message: savedMsg
        });
        emitToConversation(String(conversationId), 'whatsapp:newMessage', {
            conversationId,
            message: savedMsg
        });
        emitToUsers(companyUserIds, 'whatsapp:conversationUpdate', {
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

// How long after an outbound template a typed reply (one carrying no
// contextMessageId) is still assumed to be about that template. Matches
// WhatsApp's 24h customer-service window.
const TEMPLATE_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

// List-node items support both legacy string[] and {id,title,description}[].
// Shared by the outgoing send (executeNode) and the incoming reply matcher
// (continueSession) so both agree on the same ids/titles for a given node.
const normaliseListItems = (rawItems) => (rawItems || []).map((item, idx) =>
    typeof item === 'string'
        ? { id: `list_${idx}`, title: item, description: '' }
        : { id: item.id || `list_${idx}`, title: item.title || item.text || `Option ${idx + 1}`, description: item.description || '' }
);

// ============================================================
// 🤖 BUTTON MATCHING — shared by every node type that has buttons
// ============================================================
// Match priority:
//   1. content.buttonId — the id of the button the customer actually tapped.
//      Most reliable: it survives WhatsApp's 20-char title truncation and any
//      case/whitespace differences.
//   2. Full button text (case-insensitive) — covers typed replies.
//   3. Truncated button text (first 20 chars) — covers a tapped button whose
//      configured title was longer than WhatsApp's 20-char display limit.
const matchButton = (buttons, userResponse, incomingMessage) => {
    if (!Array.isArray(buttons) || buttons.length === 0) return null;
    const normalized = (userResponse || '').toLowerCase().trim();
    const buttonId = incomingMessage?.content?.buttonId || null;

    return buttons.find(b => {
        if (buttonId && b.id === buttonId) return true;
        const fullText = (b.text || '').toLowerCase().trim();
        if (fullText && fullText === normalized) return true;
        if (b.id === normalized) return true;
        const truncated = (b.text || '').substring(0, 20).toLowerCase().trim();
        if (truncated && truncated === normalized) return true;
        return false;
    }) || null;
};

// Ask the AI which option a free-text reply means, so an answer like "around
// 50,000" to a budget question continues the flow instead of bouncing the
// customer a "please tap a button" message. Only a validated match is accepted:
// anything the AI isn't sure about returns null and the caller re-prompts.
//
// Gated on aiButtonMappingEnabled + plan + key. Deliberately NOT on aiEnabled or
// aiFallbackEnabled — those switches govern the AI *talking to customers*, and
// this never sends a message; it only interprets an answer for the scripted flow.
// Mapping calls are counted against the monthly AI allowance like any other call.
const tryAiButtonMap = async ({ buttons, currentNode, userResponse, tenantId }) => {
    try {
        const IntegrationConfig = require('../models/IntegrationConfig');
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const GlobalSetting = require('../models/GlobalSetting');

        const [aiConfig, workspace, globalGemini, globalOpenai] = await Promise.all([
            IntegrationConfig.findOne({ userId: tenantId }),
            WorkspaceSettings.findOne({ userId: tenantId }),
            GlobalSetting.findOne({ key: 'global_gemini_api_key' }),
            GlobalSetting.findOne({ key: 'global_openai_api_key' })
        ]);

        if (aiConfig?.ai?.aiButtonMappingEnabled === false) return null;
        if (workspace?.planFeatures?.aiChatbot !== true) return null;

        const apiKey = aiConfig.ai.provider === 'openai'
            ? decryptToken(globalOpenai?.value)
            : decryptToken(globalGemini?.value);
        if (!apiKey) return null;

        if (!(await aiCreditService.hasCredits(tenantId))) {
            console.log(`🎯 [Chatbot] Skipping AI button mapping — tenant ${tenantId} is out of AI credits.`);
            return null;
        }

        const { index: idx, usage } = await mapReplyToOption({
            provider: aiConfig.ai.provider,
            apiKey,
            model: aiConfig.ai.model,
            question: currentNode.data?.text || '',
            options: buttons.map(b => b.text),
            userReply: userResponse,
            // Same zone the business-hours check uses — "Saturday" has to resolve
            // against the tenant's local today, not the server's.
            timezone: aiConfig.whatsapp?.businessHours?.timezone
        });

        await aiCreditService.charge(tenantId, {
            model: aiConfig.ai.model,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            feature: 'button_mapping'
        });

        if (idx === null) {
            console.log(`🎯 [Chatbot] AI could not map "${userResponse}" to any option on node "${currentNode.id}" — re-prompting.`);
            return null;
        }

        const mapped = buttons[idx];
        console.log(`🎯 [Chatbot] AI mapped "${userResponse}" → option "${mapped.text}" on node "${currentNode.id}".`);
        return mapped;
    } catch (err) {
        // Mapping is an enhancement, never a dependency — fall back to re-prompting.
        console.error('[Chatbot] AI button mapping failed:', err.message);
        return null;
    }
};

// Exact match first, then AI mapping for free text. This is the matcher every
// button node uses to interpret a reply.
const matchButtonWithAi = async (buttons, userResponse, incomingMessage, currentNode, tenantId) => {
    const exact = matchButton(buttons, userResponse, incomingMessage);
    if (exact) return exact;

    // A reply carrying a buttonId came from an actual tap. If that didn't match,
    // the flow was edited under the customer — a phrasing problem is not the
    // issue, so there's nothing for the AI to interpret.
    if (incomingMessage?.content?.buttonId) return null;
    if (!userResponse || !userResponse.trim()) return null;

    // Prefer the original text: userResponse has been lowercased upstream for
    // keyword matching, and casing carries meaning the model can use.
    const rawText = incomingMessage?.content?.text || userResponse;
    return await tryAiButtonMap({ buttons, currentNode, userResponse: rawText, tenantId });
};

// Same matching pipeline as matchButtonWithAi, extended with numeric-position
// matching: the numbered-text fallback (list nodes with no BSP-approved list
// API, or where sendListMessage failed) asks the customer to reply "3", which
// has no button/row id to match against a tap.
const matchListItemWithAi = async (items, userResponse, incomingMessage, currentNode, tenantId) => {
    if (!Array.isArray(items) || items.length === 0) return null;
    const asButtons = items.map(it => ({ id: it.id, text: it.title }));

    const exact = matchButton(asButtons, userResponse, incomingMessage);
    if (exact) return items.find(it => it.id === exact.id) || null;

    const asNumber = Number((userResponse || '').trim());
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= items.length) {
        return items[asNumber - 1];
    }

    if (incomingMessage?.content?.buttonId) return null;
    if (!userResponse || !userResponse.trim()) return null;

    const rawText = incomingMessage?.content?.text || userResponse;
    const mapped = await tryAiButtonMap({ buttons: asButtons, currentNode, userResponse: rawText, tenantId });
    return mapped ? (items.find(it => it.id === mapped.id) || null) : null;
};

// Resolve where a matched button should lead. Tries, in order:
//   1. button.nextNodeId, if it points to a node that still exists.
//   2. The target of an edge from (node.id, sourceHandle = button.id) whose
//      target also exists.
// The edge fallback covers two real cases: (a) older saves never wrote
// nextNodeId onto the button, (b) the node nextNodeId points to was deleted but
// a fresh edge was drawn afterwards.
// Returns the target node id, or null when the link is genuinely broken.
const resolveButtonTarget = (flow, node, button) => {
    let targetNodeId = button.nextNodeId;
    if (targetNodeId && flow.nodes.some(n => n.id === targetNodeId)) return targetNodeId;

    if (flow.edges && flow.edges.length > 0) {
        const matchingEdge = flow.edges.find(e =>
            e.source === node.id &&
            e.sourceHandle === button.id &&
            flow.nodes.some(n => n.id === e.target)
        );
        if (matchingEdge) {
            console.log(`🤖 [Chatbot] Recovered button "${button.text}" → ${matchingEdge.target} from flow.edges (button.nextNodeId was "${button.nextNodeId || 'empty'}")`);
            return matchingEdge.target;
        }
    }
    return null;
};

// Describes a stuck flow node to the AI so a rescue reply lands in context
// instead of restarting qualification from scratch.
const buildRescueContext = (session, currentNode) => {
    let ctx = '\n=== CHATBOT FLOW CONTEXT ===\n';
    ctx += "A scripted chatbot flow is running and could not interpret the customer's last message.\n";
    if (currentNode?.data?.text) {
        ctx += `The question the flow last asked was: "${currentNode.data.text}"\n`;
    }
    const options = (currentNode?.data?.buttons || []).map(b => b.text).filter(Boolean);
    if (options.length > 0) {
        ctx += `The flow expected one of these options: ${options.join(', ')}.\n`;
        ctx += "Answer the customer's question or objection, then guide them back to choosing one of those options.\n";
    }
    const collected = [];
    if (session?.variables?.size > 0) {
        for (const [k, v] of session.variables.entries()) {
            if (k.startsWith('ai_') || k.startsWith('btn_miss_')) continue;
            if (v === null || v === undefined || typeof v === 'object') continue;
            collected.push(`  * ${k}: ${v}`);
        }
    }
    if (collected.length > 0) {
        ctx += 'Information the flow already collected from this customer:\n';
        ctx += collected.join('\n') + '\n';
        ctx += 'Do not ask again for anything listed above.\n';
    }
    ctx += '=== END CHATBOT FLOW CONTEXT ===\n';
    return ctx;
};

// Shown to the customer on every AI→human handoff path (rescue cap, fallback
// max-turns, AI-node max-turns, AI unavailable). Kept as one constant so the
// experience is identical no matter which limit tripped.
const HANDOFF_MESSAGE = "We've received your message — one of our team members will follow up with you shortly.";

// Last resort when a session is stuck and the AI cannot rescue it (AI disabled,
// or the rescue cap is exhausted): tell the customer a human is coming, notify
// the team, and stop the bot competing with the agent.
const handoffStuckSession = async (session, conversation, conversationId, tenantId) => {
    try {
        const msg = HANDOFF_MESSAGE;
        const result = await sendWhatsAppTextMessage(conversation.phone, msg, tenantId);
        await saveBotMessage(conversationId, tenantId, msg, 'text', result);

        await executeAction(
            {
                actionType: 'notify_agent',
                actionData: { message: `Chatbot could not handle the conversation with ${conversation.displayName || conversation.phone} and handed off.` }
            },
            session || { userId: tenantId, conversationId, variables: new Map(), save: async () => {} },
            conversation
        );

        await WhatsAppConversation.findByIdAndUpdate(conversationId, {
            $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
        });
        if (session) await endSession(session, 'handoff');
    } catch (err) {
        console.error('[Chatbot] handoffStuckSession failed:', err.message);
    }
};

// ============================================================
// 🤖 AI REPLY — the single place the AI is allowed to speak
// ============================================================
// Two entry points share this:
//
//   mode 'fallback' — nothing matched an inbound message: no active session and
//                     no flow trigger. The AI owns the conversation.
//
//   mode 'rescue'   — a live session hit a dead end: a button the customer's
//                     reply doesn't match, or a matched button whose target node
//                     no longer exists. The AI answers once and the session
//                     STAYS ACTIVE on its current node, so the flow resumes as
//                     soon as the customer says something the node understands.
//                     Previously these cases ended the session silently: the
//                     customer got no reply at all, and the fallback AI picked up
//                     the whole conversation from their next message onward.
//
// Rescue turns are counted per-session so a permanently broken node cannot burn
// the tenant's whole monthly AI quota; once the cap is hit the conversation goes
// to a human instead.
//
// Returns 'ai_fallback' | 'ai_rescue' when a reply was sent, null otherwise.
const runAiReply = async ({ conversation, conversationId, tenantId, session = null, flow = null, currentNode = null, mode = 'fallback' }) => {
    const IntegrationConfig = require('../models/IntegrationConfig');
    const WorkspaceSettings = require('../models/WorkspaceSettings');
    const GlobalSetting = require('../models/GlobalSetting');

    const [aiConfig, workspace, globalGemini, globalOpenai] = await Promise.all([
        IntegrationConfig.findOne({ userId: tenantId }),
        WorkspaceSettings.findOne({ userId: tenantId }),
        GlobalSetting.findOne({ key: 'global_gemini_api_key' }),
        GlobalSetting.findOne({ key: 'global_openai_api_key' })
    ]);

    const apiKey = aiConfig?.ai?.provider === 'openai'
        ? decryptToken(globalOpenai?.value)
        : decryptToken(globalGemini?.value);
    const hasAiPlan = workspace?.planFeatures?.aiChatbot === true;

    if (!aiConfig?.ai?.aiFallbackEnabled || !apiKey || !hasAiPlan) {
        if (mode === 'rescue') {
            console.log(`🤖 [Chatbot] Rescue needed on conversation ${conversationId} but AI is unavailable (fallback=${!!aiConfig?.ai?.aiFallbackEnabled}, key=${!!apiKey}, plan=${hasAiPlan}). Handing to a human.`);
            await handoffStuckSession(session, conversation, conversationId, tenantId);
        }
        return null;
    }

    console.log(`🤖 [Chatbot] AI ${mode} invoked for tenant ${tenantId} on conversation ${conversationId}.`);
    const maxTurns = aiConfig.ai.maxTurns || 12;

    // ── AI credit guard (both modes) ──
    if (!(await aiCreditService.hasCredits(tenantId))) {
        console.log(`🤖 [Chatbot] Tenant ${tenantId} is out of AI credits. Stopping AI ${mode}.`);
        await WhatsAppConversation.findByIdAndUpdate(conversationId, {
            $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
        });
        const limitMsg = 'Our AI assistant is currently unavailable. An agent will connect with you shortly.';
        const limitResult = await sendWhatsAppTextMessage(conversation.phone, limitMsg, tenantId);
        await saveBotMessage(conversationId, tenantId, limitMsg, 'text', limitResult);
        if (session) await endSession(session, 'handoff');
        return null;
    }

    // ── Turn guard ──
    if (mode === 'rescue') {
        const rescueCount = Number(session.variables.get('ai_rescue_count') || 0);
        if (rescueCount >= maxTurns) {
            console.log(`🤖 [Chatbot] AI rescue cap (${maxTurns}) reached on node "${currentNode?.id}" of flow "${flow?.name}" for conversation ${conversationId}. Handing to a human.`);
            await handoffStuckSession(session, conversation, conversationId, tenantId);
            return null;
        }
    } else {
        // NOTE: this previously queried `source: 'bot'`, a field that is never
        // written, so the count was always 0 and the cap never fired. AI replies
        // are saved with automationSource — count those.
        const aiBotMessageCount = await WhatsAppMessage.countDocuments({
            conversationId,
            direction: 'outbound',
            automationSource: 'ai_fallback'
        });
        if (aiBotMessageCount >= maxTurns) {
            // Previously this paused the bot with NO reply to the customer — they'd
            // send a message and get total silence. Hand off properly instead: same
            // message + agent notification as every other handoff path.
            console.log(`🤖 [Chatbot] AI Fallback max turns (${maxTurns}) reached for conversation ${conversationId}. Handing to a human.`);
            await handoffStuckSession(session, conversation, conversationId, tenantId);
            return null;
        }
    }

    // Get recent messages (last 15)
    const recentMessages = await WhatsAppMessage.find({ conversationId })
        .sort({ timestamp: -1 })
        .limit(15)
        .lean();
    const history = recentMessages.reverse();

    // Get lead context
    let leadDetails = {};
    if (conversation.leadId) {
        const lead = await Lead.findById(conversation.leadId).lean();
        if (lead) {
            leadDetails = {
                name: lead.name,
                phone: lead.phone,
                email: lead.email,
                currentStage: lead.status,
                tags: lead.tags,
                customData: lead.customData
            };
        }
    }

    const systemPrompt = mode === 'rescue'
        ? `${aiConfig.ai.systemPrompt}\n${buildRescueContext(session, currentNode)}`
        : aiConfig.ai.systemPrompt;

    try {
        const { reply, action, usage } = await generateReply({
            provider: aiConfig.ai.provider,
            apiKey: apiKey,
            modelName: aiConfig.ai.model,
            systemPrompt,
            conversationHistory: history,
            leadContext: leadDetails
        });

        // Tag the reply with its mode so the turn guards above can count it
        const automationSource = mode === 'rescue' ? 'ai_rescue' : 'ai_fallback';
        const result = await sendWhatsAppTextMessage(conversation.phone, reply, tenantId);
        await saveBotMessage(conversationId, tenantId, reply, 'text', result, null, automationSource);

        // Deduct AI credits by actual token cost
        await aiCreditService.charge(tenantId, {
            model: aiConfig.ai.model,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            feature: `ai_${mode}`
        });

        if (mode === 'rescue') {
            session.variables.set('ai_rescue_count', Number(session.variables.get('ai_rescue_count') || 0) + 1);
            session.markModified('variables');
            session.lastInteractionAt = new Date();
            await session.save();
        }

        // Execute actions returned by the AI
        if (action && action.type) {
            // In rescue mode the real session is used, so AI actions land on the
            // same variables the flow collected. In fallback mode there is no
            // session — build a session-like object with leadDetails pre-populated
            // so executeAction's change_stage path can find/create the lead.
            let actionSession = session;
            if (!actionSession) {
                const fallbackVariables = new Map();
                if (leadDetails.name)  fallbackVariables.set('name', leadDetails.name);
                if (leadDetails.phone) fallbackVariables.set('phone', leadDetails.phone);
                if (leadDetails.email) fallbackVariables.set('email', leadDetails.email);
                actionSession = {
                    userId: tenantId,
                    conversationId,
                    variables: fallbackVariables,
                    save: async () => {}
                };
            }

            const logTag = mode === 'rescue' ? 'AI Rescue' : 'AI Fallback';

            if (action.type === 'change_stage' && action.stage) {
                console.log(`🤖 [${logTag}] Executing change_stage → "${action.stage}" for conversation ${conversationId}`);
                await executeAction({
                    actionType: 'change_stage',
                    actionData: { stage: action.stage }
                }, actionSession, conversation);
            } else if (action.type === 'assign_tag' && action.tag) {
                console.log(`🤖 [${logTag}] Executing assign_tag → "${action.tag}" for conversation ${conversationId}`);
                await executeAction({
                    actionType: 'assign_tag',
                    actionData: { tag: action.tag }
                }, actionSession, conversation);
            } else if (action.type === 'notify_agent') {
                const agentMsg = action.reason || `${logTag}: Handoff requested for ${conversation.displayName || conversation.phone}`;
                console.log(`🤖 [${logTag}] Executing notify_agent — pausing chatbot for 24h on conversation ${conversationId}`);
                await executeAction({
                    actionType: 'notify_agent',
                    actionData: { message: agentMsg }
                }, actionSession, conversation);

                // Pause chatbot for 24h so the human agent can take over, and stop
                // any live session competing with them.
                await WhatsAppConversation.findByIdAndUpdate(conversationId, {
                    $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                });
                if (session) await endSession(session, 'handoff');
            } else if (action.type === 'book_appointment') {
                console.log(`🤖 [${logTag}] Executing book_appointment for conversation ${conversationId}`);
                await executeAction({
                    actionType: 'book_appointment',
                    actionData: action
                }, actionSession, conversation);
            }
        }

        return automationSource;
    } catch (err) {
        console.error(`Error in AI ${mode} auto-reply:`, err.message);
        return null;
    }
};

// A button node could not interpret the customer's reply. Re-prompt once — a
// near-miss usually just needs the options shown again — then hand the turn to
// the AI rather than looping the same prompt forever.
const handleButtonMiss = async (session, flow, currentNode, conversation, conversationId) => {
    const missKey = `btn_miss_${currentNode.id}`;
    const misses = Number(session.variables.get(missKey) || 0) + 1;
    session.variables.set(missKey, misses);
    session.markModified('variables');
    session.lastInteractionAt = new Date();
    await session.save();

    if (misses === 1) {
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

    console.log(`🤖 [Chatbot] Node "${currentNode.id}" could not match the reply ${misses}× — handing this turn to the AI; session stays active.`);
    return await runAiReply({
        conversation,
        conversationId,
        tenantId: session.userId,
        session,
        flow,
        currentNode,
        mode: 'rescue'
    });
};

// Same as handleButtonMiss, for list nodes. Kept separate because a list can
// carry up to 10 items — WhatsApp's interactive button message rejects more
// than 3, so the retry has to pick the same send strategy executeNode uses
// (buttons for ≤3, native list message for 4-10, numbered text as a last resort).
const handleListMiss = async (session, flow, currentNode, conversation, conversationId, items) => {
    const missKey = `btn_miss_${currentNode.id}`;
    const misses = Number(session.variables.get(missKey) || 0) + 1;
    session.variables.set(missKey, misses);
    session.markModified('variables');
    session.lastInteractionAt = new Date();
    await session.save();

    if (misses === 1 && items.length > 0) {
        if (conversation) {
            const retryIntro = `I didn't understand that. Please choose one of the following options:`;
            if (items.length <= 3) {
                const retryResult = await sendInteractiveMessage(
                    conversation.phone,
                    retryIntro,
                    items.map(it => ({ id: it.id, text: it.title })),
                    session.userId
                );
                await saveBotMessage(conversationId, session.userId, retryIntro, 'interactive', retryResult);
            } else {
                try {
                    const retryResult = await sendListMessage(
                        conversation.phone, retryIntro, currentNode.data.buttonText || 'View Options', items, session.userId
                    );
                    await saveBotMessage(conversationId, session.userId, retryIntro, 'interactive', retryResult);
                } catch (err) {
                    const numberedList = items.map((it, idx) => `${idx + 1}. ${it.title}`).join('\n');
                    const fallbackText = `${retryIntro}\n\n${numberedList}`;
                    const fallbackResult = await sendWhatsAppTextMessage(conversation.phone, fallbackText, session.userId);
                    await saveBotMessage(conversationId, session.userId, fallbackText, 'text', fallbackResult);
                }
            }
        }
        return { success: true }; // Stay on current node
    }

    console.log(`🤖 [Chatbot] List node "${currentNode.id}" could not match the reply ${misses}× — handing this turn to the AI; session stays active.`);
    return await runAiReply({
        conversation,
        conversationId,
        tenantId: session.userId,
        session,
        flow,
        currentNode,
        mode: 'rescue'
    });
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
            console.log(`🤖 [Chatbot] No active chatbot flows found. Will check for AI Fallback.`);
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

        // 2. Template Reply Match — fires when the customer replies to a template.
        // This bypasses pause (same as keyword — it's an explicit user intent).
        //
        // The preferred signal is contextMessageId, which WhatsApp only attaches when
        // the customer taps a quick-reply button or swipe-replies. Someone who simply
        // types "yes" gives us no context id at all, which used to drop the whole
        // conversation to the AI. So when there's no context id, fall back to the last
        // outbound template on this conversation — but only if it's still inside the
        // 24h customer-service window AND this is the first inbound since it was sent,
        // which together mean the message can only be a reply to that template.
        if (!targetFlow) {
            try {
                let originalMsg = message.contextMessageId
                    ? await WhatsAppMessage.findOne({ waMessageId: message.contextMessageId }).lean()
                    : null;

                if (!originalMsg?.content?.templateName) {
                    const lastTemplate = await WhatsAppMessage.findOne({
                        conversationId,
                        direction: 'outbound',
                        'content.templateName': { $exists: true, $ne: null },
                        timestamp: { $gte: new Date(Date.now() - TEMPLATE_REPLY_WINDOW_MS) }
                    }).sort({ timestamp: -1 }).lean();

                    if (lastTemplate) {
                        const inboundSinceTemplate = await WhatsAppMessage.countDocuments({
                            conversationId,
                            direction: 'inbound',
                            timestamp: { $gt: lastTemplate.timestamp },
                            _id: { $ne: message._id }
                        });
                        if (inboundSinceTemplate === 0) {
                            console.log(`📩 [Chatbot] Reply has no contextMessageId — treating it as a reply to the last outbound template "${lastTemplate.content.templateName}".`);
                            originalMsg = lastTemplate;
                        } else {
                            console.log(`📩 [Chatbot] Last outbound template "${lastTemplate.content.templateName}" already has ${inboundSinceTemplate} repl(y/ies) — not re-triggering its flow.`);
                        }
                    }
                }

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
        // Match priority: source_id (Ad ID) → headline → catch-all (no identifier set)
        if (!targetFlow && message.content?.referral) {
            const adSourceId = message.content.referral.source_id || '';
            const adHeadline = (message.content.referral.headline || '').toLowerCase().trim();
            const metaAdFlows = allActiveFlows.filter(f => f.triggerType === 'meta_ad');

            let adFlow =
                // 1. Match by Ad ID (most reliable — Meta always sends source_id)
                metaAdFlows.find(f => f.triggerAdId && f.triggerAdId.trim() === adSourceId) ||
                // 2. Match by headline (fallback — Meta sometimes omits this)
                metaAdFlows.find(f =>
                    !f.triggerAdId &&
                    f.triggerAdHeadline &&
                    f.triggerAdHeadline.toLowerCase().trim() === adHeadline
                ) ||
                // 3. Catch-all: flow with neither Ad ID nor headline set triggers on any referral
                metaAdFlows.find(f => !f.triggerAdId && !f.triggerAdHeadline);

            if (!adFlow) {
                console.log(`⚠️ [Chatbot] CTWA referral received but no meta_ad flow matched — source_id="${adSourceId}", headline="${adHeadline}", active meta_ad flows: ${metaAdFlows.map(f => `"${f.name}" (adId="${f.triggerAdId}", headline="${f.triggerAdHeadline}")`).join(', ') || 'none'}`);
            }

            if (adFlow) {
                console.log(`🎯 [Chatbot] Meta Ad trigger matched: "${adFlow.name}" (source_id: "${adSourceId}", headline: "${adHeadline}")`);
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
            return null;
        }

        console.log(`🤖 [Chatbot] No matching flow found for message "${messageText}" in conversation ${conversationId}`);
        return await runAiReply({ conversation, conversationId, tenantId, mode: 'fallback' });
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

                    // FIX: Enroll in drip sequences on chatbot-triggered stage change (was missing)
                    const { enrollLeadInSequences } = require('./sequenceService');
                    enrollLeadInSequences(updatedLead, 'STAGE_CHANGED', bestRule.changeStageTo).catch(e => console.error('[Chatbot] Sequence enrollment (STAGE_CHANGED) error:', e));

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
        // If the user sends text that matches a button from a previously visited
        // button-node, pivot immediately — don't treat it as a question answer.
        // The current node is skipped here: its own buttons are handled below, where
        // the choice is also captured into the node's variable.
        if (userResponse) {
            const _btnNodeTypes = new Set(['message', 'template', 'question']);
            const _seenIds = new Set([currentNode.id]);
            const _reversedVisited = [...session.visitedNodes].reverse().filter(e => {
                if (_seenIds.has(e.nodeId)) return false;
                _seenIds.add(e.nodeId);
                return true;
            });
            for (const _entry of _reversedVisited) {
                const _pNode = flow.nodes.find(n => n.id === _entry.nodeId);
                if (!_pNode || !_btnNodeTypes.has(_pNode.type)) continue;
                const _mBtn = matchButton(_pNode.data?.buttons, userResponse, incomingMessage);
                if (!_mBtn) continue;
                const _tId = resolveButtonTarget(flow, _pNode, _mBtn);
                if (_tId) {
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
        if (currentNode.type === 'ai') {
            // Re-evaluate the AI node with the new incoming message
            session.lastInteractionAt = new Date();
            await session.save();
            return await executeNode(session, flow, currentNode.id, conversation);
        } else if (currentNode.type === 'question') {
            const hasButtons = Array.isArray(currentNode.data.buttons) && currentNode.data.buttons.length > 0;

            // A question node can offer buttons instead of free text. When it does,
            // the reply must match one of them: the matched button's text is what
            // gets stored in the node's variable, and the button's own link decides
            // where the flow goes next (falling back to the node's nextNodeId).
            if (hasButtons) {
                const chosen = await matchButtonWithAi(
                    currentNode.data.buttons, userResponse, incomingMessage, currentNode, session.userId
                );
                if (!chosen) {
                    return await handleButtonMiss(session, flow, currentNode, conversation, conversationId);
                }

                if (currentNode.data.noReplyTimeoutSeconds > 0) {
                    whatsappQueueService.cancelNoReplyTimeout(session._id.toString(), currentNode.id).catch(() => {});
                }

                session.variables.set(currentNode.data.variableName || 'answer', chosen.text);
                session.variables.set(`btn_miss_${currentNode.id}`, 0);
                session.markModified('variables');
                await evaluateSmartLead(session, flow, conversation);

                const chosenTarget = resolveButtonTarget(flow, currentNode, chosen)
                    || (flow.nodes.some(n => n.id === currentNode.data.nextNodeId) ? currentNode.data.nextNodeId : null);

                if (chosenTarget) {
                    session.currentNodeId = chosenTarget;
                    session.lastInteractionAt = new Date();
                    session.followUpIndex = 0;
                    await session.save();
                    return await executeNode(session, flow, chosenTarget, conversation);
                }

                console.log(`🤖 [Chatbot] Question node "${currentNode.id}" button "${chosen.text}" has no reachable target. Handing this turn to the AI; session stays active.`);
                return await runAiReply({
                    conversation,
                    conversationId,
                    tenantId: session.userId,
                    session,
                    flow,
                    currentNode,
                    mode: 'rescue'
                });
            }

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

            // Cancel any pending no-reply timeout for this question node (customer replied in time)
            if (currentNode.data.noReplyTimeoutSeconds > 0) {
                whatsappQueueService.cancelNoReplyTimeout(session._id.toString(), currentNode.id).catch(() => {});
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
        } else if (currentNode.type === 'list') {
            const items = normaliseListItems(currentNode.data.items);

            const chosen = await matchListItemWithAi(items, userResponse, incomingMessage, currentNode, session.userId);
            if (!chosen) {
                return await handleListMiss(session, flow, currentNode, conversation, conversationId, items);
            }

            session.variables.set(currentNode.data.variableName || 'answer', chosen.title);
            session.variables.set(`btn_miss_${currentNode.id}`, 0);
            session.markModified('variables');
            await evaluateSmartLead(session, flow, conversation);

            const nextNodeId = currentNode.data.nextNodeId;
            if (nextNodeId && flow.nodes.some(n => n.id === nextNodeId)) {
                session.currentNodeId = nextNodeId;
                session.lastInteractionAt = new Date();
                session.followUpIndex = 0;
                await session.save();
                return await executeNode(session, flow, nextNodeId, conversation);
            }

            await endSession(session, 'completed');
            return null;
        } else if ((currentNode.type === 'message' || currentNode.type === 'template') && currentNode.data.buttons) {
            const button = await matchButtonWithAi(
                currentNode.data.buttons, userResponse, incomingMessage, currentNode, session.userId
            );

            if (button) {
                const targetNodeId = resolveButtonTarget(flow, currentNode, button);

                if (targetNodeId) {
                    session.currentNodeId = targetNodeId;
                    session.variables.set(`btn_miss_${currentNode.id}`, 0);
                    session.markModified('variables');
                    session.lastInteractionAt = new Date();
                    session.followUpIndex = 0;
                    await session.save();
                    await evaluateSmartLead(session, flow, conversation);
                    return await executeNode(session, flow, targetNodeId, conversation);
                }

                // The customer picked a valid option but the flow has nowhere to send
                // them — the target node was deleted, or was never linked. Ending the
                // session here would drop them mid-flow without a reply, so the AI
                // answers this turn and the session stays put.
                const stalePointer = button.nextNodeId
                    ? `points to deleted node "${button.nextNodeId}"`
                    : 'has no nextNodeId set';
                const edgeOut = (flow.edges || []).find(e => e.source === currentNode.id && e.sourceHandle === button.id);
                const edgeNote = edgeOut
                    ? `(edge with sourceHandle="${button.id}" exists but its target "${edgeOut.target}" is also missing)`
                    : `(no edge with sourceHandle="${button.id}" found either)`;
                console.log(`🤖 [Chatbot] Button "${button.text}" ${stalePointer} ${edgeNote}. Handing this turn to the AI; session stays active.`);
                return await runAiReply({
                    conversation,
                    conversationId,
                    tenantId: session.userId,
                    session,
                    flow,
                    currentNode,
                    mode: 'rescue'
                });
            }

            // No button matched at all → re-prompt once, then let the AI step in.
            return await handleButtonMiss(session, flow, currentNode, conversation, conversationId);
        }

        // NOTE: re-selecting a button from an earlier menu is handled by the
        // pre-check at the top of this function, which scans the same visited
        // button-nodes before any node-type handler runs.
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

            case 'question': {
                // Send question and wait for response. A question node may define
                // buttons — send it interactively so the customer taps an option
                // rather than guessing the wording (continueSession then matches the
                // reply against those buttons).
                const questionText = replaceVariables(node.data.text, session.variables);
                if (node.data.buttons && node.data.buttons.length > 0) {
                    const questionInteractive = await sendInteractiveMessage(
                        conversation.phone,
                        questionText,
                        node.data.buttons.map(b => ({ id: b.id, text: b.text })),
                        session.userId
                    );
                    await saveBotMessage(session.conversationId, session.userId, questionText, 'interactive', questionInteractive);
                } else {
                    const questionResult = await sendWhatsAppTextMessage(conversation.phone, questionText, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, questionText, 'text', questionResult);
                }

                // If a no-reply timeout is configured, schedule auto-advance
                if (node.data.noReplyTimeoutSeconds > 0 && node.data.nextNodeId) {
                    await whatsappQueueService.scheduleNoReplyTimeout(
                        session._id.toString(),
                        flow._id.toString(),
                        node.id,
                        node.data.nextNodeId,
                        node.data.noReplyTimeoutSeconds
                    );
                }
                // Session will wait for user response
                break;
            }

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
                const normalisedItems = normaliseListItems(node.data.items);

                if (normalisedItems.length > 0 && normalisedItems.length <= 3) {
                    // ≤3 items — send as WhatsApp interactive reply buttons
                    const listButtons = normalisedItems.map(it => ({ id: it.id, text: it.title.slice(0, 20) }));
                    const listResult = await sendInteractiveMessage(
                        conversation.phone, listText, listButtons, session.userId
                    );
                    await saveBotMessage(session.conversationId, session.userId, listText, 'interactive', listResult);
                } else if (normalisedItems.length > 3 && normalisedItems.length <= 10) {
                    // 4-10 items — native WhatsApp interactive List Message (scrollable picker)
                    try {
                        const listMsgResult = await sendListMessage(
                            conversation.phone, listText, node.data.buttonText || 'View Options', normalisedItems, session.userId
                        );
                        await saveBotMessage(session.conversationId, session.userId, listText, 'interactive', listMsgResult);
                    } catch (listErr) {
                        console.error(`[Chatbot] List message failed, falling back to numbered text:`, listErr.message);
                        const numberedList = normalisedItems.map((it, idx) => {
                            const desc = it.description ? ` — ${it.description}` : '';
                            return `${idx + 1}. ${it.title}${desc}`;
                        }).join('\n');
                        const fullListText = `${listText}\n\n${numberedList}`;
                        const listTextResult = await sendWhatsAppTextMessage(conversation.phone, fullListText, session.userId);
                        await saveBotMessage(session.conversationId, session.userId, fullListText, 'text', listTextResult);
                    }
                } else if (normalisedItems.length > 10) {
                    // >10 items (UI caps at 10; defensive fallback for stale/imported flows)
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
                const productImageUrl = node.data.image || '';

                if (productImageUrl) {
                    // Send product image with name+price as caption
                    try {
                        const imgResult = await sendMediaMessage(conversation.phone, 'image', productImageUrl, productMessage, session.userId);
                        await saveBotMessage(session.conversationId, session.userId, productMessage, 'image', imgResult, { mediaUrl: productImageUrl });
                    } catch (imgErr) {
                        console.warn(`[Chatbot] Product image failed, falling back to text:`, imgErr.message);
                        if (productMessage) {
                            const fallbackResult = await sendWhatsAppTextMessage(conversation.phone, productMessage, session.userId);
                            await saveBotMessage(session.conversationId, session.userId, productMessage, 'text', fallbackResult);
                        }
                    }
                } else if (productMessage) {
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

            case 'notify_agent': {
                // Tell customer
                const notifyCustomerText = replaceVariables(node.data.text || 'Agent will be notified and chatbot paused for 24 hours.', session.variables);
                const notifyResult = await sendWhatsAppTextMessage(conversation.phone, notifyCustomerText, session.userId);
                await saveBotMessage(session.conversationId, session.userId, notifyCustomerText, 'text', notifyResult);

                // Pause chatbot for 24 hours
                await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                    $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                });

                // Notify the selected agent via WhatsApp
                const targetAgentId = node.data.notifyAgentId;
                if (targetAgentId) {
                    try {
                        const agent = await User.findById(targetAgentId).select('phone name').lean();
                        if (agent && agent.phone) {
                            const note = node.data.internalNote ? `\nNote: ${node.data.internalNote}` : '';
                            const alertMsg = `🔔 *Chatbot Agent Request*\nA customer (${conversation.displayName || conversation.phone}) needs your attention.${note}\nChatbot is paused for 24 hours for this conversation.`;
                            
                            // Send text message directly to agent
                            await sendWhatsAppTextMessage(agent.phone, alertMsg, session.userId);
                            console.log(`[Chatbot] Successfully sent notify_agent WhatsApp to agent ${targetAgentId}`);
                        } else {
                            console.warn(`[Chatbot] notify_agent: Agent ${targetAgentId} has no phone number configured.`);
                        }
                    } catch (err) {
                        console.error('[Chatbot] Failed to send WhatsApp alert to agent in notify_agent node:', err.message);
                    }
                }

                // Notify via Socket.IO as well
                const notifyUserId = targetAgentId || conversation.assignedTo || session.userId;
                emitToUser(notifyUserId, 'notification:agent', {
                    type: 'chatbot_notify_agent',
                    conversationId: conversation._id,
                    phone: conversation.phone,
                    displayName: conversation.displayName,
                    message: `🔔 Chatbot requested your attention for ${conversation.displayName || conversation.phone}`,
                    timestamp: new Date()
                });

                // End the chatbot session
                await endSession(session, 'notify_agent');
                return { success: true };
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

            case 'booking_link': {
                let frontendUrl = normalizeBaseUrl(process.env.FRONTEND_URL) || 'https://app.adfliker.com';
                const tenantId = session.userId.toString();

                // Multi-tenancy: if this tenant belongs to an agency with a custom domain,
                // use that domain for the public booking link (white-label support).
                try {
                    const tenantUser = await User.findById(session.userId).select('role parentId').lean();
                    const agencyId = tenantUser?.role === 'agency'
                        ? session.userId
                        : (tenantUser?.parentId || null);

                    if (agencyId) {
                        const agency = await AgencySettings.findOne({ agencyId }).select('customDomain').lean();
                        const customBase = normalizeBaseUrl(agency?.customDomain);
                        if (customBase) frontendUrl = customBase;
                    }
                } catch (_) { /* non-critical */ }

                let bookingUrl = '';
                try {
                    let slug = bookingPageCache.get(tenantId);
                    if (!slug) {
                        const bp = await BookingPage.findOne({ userId: session.userId, isActive: true }).select('slug').lean();
                        slug = bp?.slug || null;
                        if (slug) bookingPageCache.set(tenantId, slug);
                    }
                    if (slug) bookingUrl = `${frontendUrl}/book/${slug}`;
                } catch (_) { /* non-critical */ }

                const bookingIntroText = replaceVariables(
                    node.data.text || '📅 Click below to book your appointment:',
                    session.variables
                );

                let bookingResult;
                if (bookingUrl) {
                    bookingResult = await sendCtaUrlMessage(
                        conversation.phone,
                        bookingIntroText,
                        'Book Appointment',
                        bookingUrl,
                        session.userId
                    );
                    await saveBotMessage(session.conversationId, session.userId, `[Link Sent: ${bookingUrl}]\n${bookingIntroText}`, 'interactive', bookingResult);
                } else {
                    bookingResult = await sendWhatsAppTextMessage(conversation.phone, bookingIntroText, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, bookingIntroText, 'text', bookingResult);
                }

                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId, conversation, depth + 1);
                }
                break;
            }

            case 'ai': {
                const IntegrationConfig = require('../models/IntegrationConfig');
                const WorkspaceSettings = require('../models/WorkspaceSettings');
                const GlobalSetting = require('../models/GlobalSetting');
                
                const [aiConfig, workspace, globalGemini, globalOpenai] = await Promise.all([
                    IntegrationConfig.findOne({ userId: session.userId }),
                    WorkspaceSettings.findOne({ userId: session.userId }),
                    GlobalSetting.findOne({ key: 'global_gemini_api_key' }),
                    GlobalSetting.findOne({ key: 'global_openai_api_key' })
                ]);
                
                const apiKey = aiConfig?.ai?.provider === 'openai' 
                    ? decryptToken(globalOpenai?.value) 
                    : decryptToken(globalGemini?.value);
                const hasAiPlan = workspace?.planFeatures?.aiChatbot === true;
                const hasCredit = await aiCreditService.hasCredits(session.userId);

                if (!aiConfig?.ai?.aiEnabled || !apiKey || !hasAiPlan || !hasCredit) {
                    console.warn(`[Chatbot] AI node blocked (Enabled: ${!!aiConfig?.ai?.aiEnabled}, API Key: ${!!apiKey}, Plan: ${hasAiPlan}, Credits: ${hasCredit}) for user ${session.userId}. Advancing to handoff.`);
                    const errMsg = 'Connecting you to an agent...';
                    const errResult = await sendWhatsAppTextMessage(conversation.phone, errMsg, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, errMsg, 'text', errResult);
                    await endSession(session, 'handoff');
                    break;
                }

                const systemPrompt = node.data.aiSystemPromptOverride || aiConfig.ai.systemPrompt;
                const maxTurns = node.data.aiMaxTurns || aiConfig.ai.maxTurns || 12;

                // Turn guard — checked BEFORE calling the AI. Previously this ran
                // after the AI's reply was already sent, so on the limit-reaching
                // turn the customer got both a fresh AI question AND the handoff
                // message back to back. Now once the cap is hit we skip the AI
                // call entirely and hand off cleanly (mirrors runAiReply's guard).
                const turnCount = parseInt(session.variables.get('ai_turn_count') || '0');
                if (turnCount >= maxTurns) {
                    console.log(`🤖 [Chatbot] AI Node max turns (${maxTurns}) reached. Handing off to human agent.`);
                    const handoffMsg = HANDOFF_MESSAGE;
                    const handoffResult = await sendWhatsAppTextMessage(conversation.phone, handoffMsg, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, handoffMsg, 'text', handoffResult);

                    await executeAction({
                        actionType: 'notify_agent',
                        actionData: { message: 'AI qualification limit reached. Please take over.' }
                    }, session, conversation);

                    // Pause the chatbot for 24h and end the session so it actually
                    // stays handed off instead of re-triggering on the next message.
                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                        $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                    });
                    await endSession(session, 'handoff');
                    break;
                }

                // 1. Get recent conversation messages (last 15 messages)
                const recentMessages = await WhatsAppMessage.find({ conversationId: session.conversationId })
                    .sort({ timestamp: -1 })
                    .limit(15)
                    .lean();

                const history = recentMessages.reverse();

                // 2. Fetch Lead details
                let leadDetails = {};
                if (conversation.leadId) {
                    const lead = await Lead.findById(conversation.leadId).lean();
                    if (lead) {
                        leadDetails = {
                            name: lead.name,
                            phone: lead.phone,
                            email: lead.email,
                            currentStage: lead.status,
                            tags: lead.tags,
                            customData: lead.customData
                        };
                    }
                }

                // 3. Make HTTP request to AI Service
                try {
                    const { reply, action, usage } = await generateReply({
                        provider: aiConfig.ai.provider,
                        apiKey: apiKey,
                        modelName: aiConfig.ai.model,
                        systemPrompt,
                        conversationHistory: history,
                        leadContext: leadDetails
                    });

                    // 4. Send WhatsApp reply
                    const result = await sendWhatsAppTextMessage(conversation.phone, reply, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, reply, 'text', result);

                    // Deduct AI credits by actual token cost
                    await aiCreditService.charge(session.userId, {
                        model: aiConfig.ai.model,
                        inputTokens: usage?.inputTokens,
                        outputTokens: usage?.outputTokens,
                        feature: 'ai_node'
                    });

                    // 5. Execute actions if returned
                    if (action) {
                        if (action.type === 'change_stage' && action.stage) {
                            await executeAction({
                                actionType: 'change_stage',
                                actionData: { stage: action.stage }
                            }, session, conversation);
                        } else if (action.type === 'assign_tag' && action.tag) {
                            await executeAction({
                                actionType: 'assign_tag',
                                actionData: { tag: action.tag }
                            }, session, conversation);
                        } else if (action.type === 'notify_agent') {
                            const agentMsg = action.reason || `AI Qualify: Handoff requested for ${conversation.displayName || conversation.phone}`;
                            await executeAction({
                                actionType: 'notify_agent',
                                actionData: { message: agentMsg }
                            }, session, conversation);

                            // Same as the max-turns handoff: pause the bot and end
                            // the session so a live agent isn't fighting the AI for
                            // the next reply.
                            await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                                $set: { chatbotPausedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000) }
                            });
                            await endSession(session, 'handoff');
                            break;
                        } else if (action.type === 'book_appointment') {
                            await executeAction({
                                actionType: 'book_appointment',
                                actionData: action
                            }, session, conversation);
                        }
                    }

                    // Increment turn count and stay on AI node (re-evaluate on next message)
                    session.variables.set('ai_turn_count', (turnCount + 1).toString());
                    session.markModified('variables');
                    await session.save();

                } catch (error) {
                    console.error('Error calling standalone AI Chatbot Service:', error.message);
                    const errMsg = 'Let me connect you with a team member.';
                    const errResult = await sendWhatsAppTextMessage(conversation.phone, errMsg, session.userId);
                    await saveBotMessage(session.conversationId, session.userId, errMsg, 'text', errResult);
                    await endSession(session, 'handoff');
                }
                break;
            }

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

            case 'change_stage': {
                const newStage = actionData.actionData?.stage;
                if (!newStage) break;

                let leadForStage = null;

                // ── Step 1: Use linked lead if available ──────────────────────
                if (conversation.leadId) {
                    leadForStage = await Lead.findById(conversation.leadId);
                }

                // ── Step 2: No linked lead → search by phone/email ─────────────
                if (!leadForStage) {
                    const { findDuplicates } = require('./duplicateService');
                    const emailForSearch = getFirstPopulatedVariable(session.variables, [
                        'email', 'email_address', 'emailAddress', 'lead_email'
                    ]) || null;
                    const duplicates = await findDuplicates(session.userId, conversation.phone, emailForSearch);
                    if (duplicates.length > 0) {
                        leadForStage = await Lead.findById(duplicates[0]._id);
                        // Link it to the conversation so future nodes can use it
                        conversation.leadId = leadForStage._id;
                        await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                            $set: { leadId: leadForStage._id }
                        });
                    }
                }

                // ── Step 3: Still no lead → create one on the spot ────────────
                if (!leadForStage) {
                    leadForStage = new Lead(buildLeadPayloadFromSession(session, conversation, {
                        source: 'WhatsApp Chatbot',
                        status: newStage,
                        history: [{
                            type: 'System', subType: 'Created',
                            content: `Lead auto-created in stage "${newStage}" by chatbot change_stage node.`,
                            date: new Date()
                        }]
                    }));
                    await leadForStage.save();
                    conversation.leadId = leadForStage._id;
                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                        $set: { leadId: leadForStage._id }
                    });
                    console.log(`🤖 [Chatbot] change_stage: auto-created lead ${leadForStage._id} in stage "${newStage}"`);

                    // CAPI: lead created directly in a mapped stage (was missing —
                    // AI/chatbot qualification never reached Meta on this path)
                    {
                        const { sendMetaEventForLead } = require('./metaConversionService');
                        sendMetaEventForLead(leadForStage, newStage, null)
                            .catch(e => console.error('[Chatbot] Meta CAPI error (change_stage create):', e.message));
                    }
                    break; // Already created with correct stage, no need to update again
                }

                // ── Update the stage ──────────────────────────────────────────
                const stageBeforeChange = leadForStage.status;
                await Lead.findByIdAndUpdate(leadForStage._id, {
                    $set: { status: newStage },
                    $push: {
                        history: {
                            $each: [{
                                type: 'System', subType: 'Stage Change',
                                content: `Stage changed to "${newStage}" by chatbot action.`,
                                date: new Date()
                            }],
                            $slice: -100
                        }
                    }
                });
                console.log(`🤖 [Chatbot] change_stage: lead ${leadForStage._id} → "${newStage}"`);

                // CAPI: chatbot/AI stage change is a qualification signal (was missing)
                if (stageBeforeChange !== newStage) {
                    const { sendMetaEventForLead } = require('./metaConversionService');
                    sendMetaEventForLead(leadForStage, newStage, stageBeforeChange)
                        .catch(e => console.error('[Chatbot] Meta CAPI error (change_stage):', e.message));
                }
                break;
            }


            case 'book_appointment': {
                const Appointment = require('../models/Appointment');
                const BookingPage = require('../models/BookingPage');
                const WhatsAppTemplate = require('../models/WhatsAppTemplate');
                const { sendWhatsAppTextMessage, sendWhatsAppTemplateMessage } = require('./whatsappService');
                const { serviceType, appointmentDate, appointmentTime } = actionData.actionData || {};
                
                if (appointmentDate && appointmentTime && serviceType) {
                    const customerName = getFirstPopulatedVariable(session.variables, [
                        'name', 'full_name', 'customer_name', 'firstName'
                    ]) || conversation.displayName || conversation.phone;
                    
                    const appt = new Appointment({
                        userId: session.userId,
                        leadId: conversation.leadId || null,
                        customerName: customerName,
                        customerPhone: conversation.phone,
                        serviceType: serviceType,
                        appointmentDate: new Date(appointmentDate),
                        appointmentTime: appointmentTime,
                        source: 'chatbot',
                        status: 'Pending'
                    });
                    await appt.save();
                    console.log(`🤖 [Chatbot] book_appointment: created appointment ${appt._id} for ${customerName}`);
                    
                    // Send system confirmation message using BookingPage template
                    try {
                        const page = await BookingPage.findOne({ userId: session.userId, isActive: true }).lean();
                        let sentTemplate = false;

                        if (page && page.sendConfirmation && page.confirmationTemplateId) {
                            const tpl = await WhatsAppTemplate.findOne({ _id: page.confirmationTemplateId }).lean();
                            if (tpl && tpl.status === 'APPROVED') {
                                const formattedDate = new Date(appointmentDate).toLocaleDateString('en-IN', {
                                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                                });
                                
                                const bookingData = {
                                    name: customerName,
                                    date: formattedDate,
                                    time: appointmentTime,
                                    service: serviceType,
                                    businessName: page.businessName || ''
                                };

                                const metaComponents = [];
                                const resolveBookingVar = (varNum) => {
                                    switch (varNum) {
                                        case 1: return bookingData.name;
                                        case 2: return bookingData.date;
                                        case 3: return bookingData.time;
                                        case 4: return bookingData.service;
                                        case 5: return bookingData.businessName;
                                        default: return '';
                                    }
                                };

                                for (const comp of (tpl.components || [])) {
                                    if (comp.type === 'BODY' && comp.text) {
                                        const matches = comp.text.match(/\{\{(\d+)\}\}/g);
                                        if (matches && matches.length > 0) {
                                            const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                                            metaComponents.push({
                                                type: 'body',
                                                parameters: nums.map(n => ({ type: 'text', text: resolveBookingVar(n) }))
                                            });
                                        }
                                    }
                                    if (comp.type === 'HEADER' && comp.format === 'TEXT' && comp.text) {
                                        const matches = comp.text.match(/\{\{(\d+)\}\}/g);
                                        if (matches && matches.length > 0) {
                                            const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                                            metaComponents.push({
                                                type: 'header',
                                                parameters: nums.map(n => ({ type: 'text', text: resolveBookingVar(n) }))
                                            });
                                        }
                                    }
                                }

                                const confResult = await sendWhatsAppTemplateMessage(
                                    conversation.phone,
                                    tpl.name,
                                    tpl.language || 'en',
                                    metaComponents,
                                    session.userId,
                                    { isAutomated: true, triggerType: 'booking_confirmation' }
                                );
                                
                                await saveBotMessage(session.conversationId, session.userId, `📄 Template: ${tpl.name}`, 'template', confResult);
                                sentTemplate = true;
                                await Appointment.findByIdAndUpdate(appt._id, { confirmationSent: true });
                            }
                        }

                        // Fallback if no template is configured or not sent
                        if (!sentTemplate) {
                            let confMsg = `✅ Your appointment for *${serviceType}* on *${appointmentDate}* at *${appointmentTime}* has been successfully booked. We look forward to seeing you!`;
                            
                            if (page && page.confirmationMessage) {
                                const { replaceVariables } = require('../utils/emailTemplateUtils');
                                const formattedDate = new Date(appointmentDate).toLocaleDateString('en-IN', {
                                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                                });
                                confMsg = replaceVariables(page.confirmationMessage, {
                                    name:    customerName,
                                    date:    formattedDate,
                                    time:    appointmentTime,
                                    service: serviceType
                                });
                            }
                            
                            const confResult = await sendWhatsAppTextMessage(conversation.phone, confMsg, session.userId);
                            await saveBotMessage(session.conversationId, session.userId, confMsg, 'text', confResult);
                        }
                    } catch (err) {
                        console.error('Failed to send appointment confirmation message:', err.message);
                    }
                }
                break;
            }

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

                    // Also reach the agent on WhatsApp — the socket emit above is
                    // lost if they aren't actively watching the inbox. Mirrors the
                    // dedicated "Notify Agent" flow-builder node (see the
                    // 'notify_agent' case in executeNode), which always sends a
                    // real WhatsApp message instead of relying on the socket alone.
                    try {
                        const agent = await User.findById(notifyUserId).select('phone name').lean();
                        if (agent?.phone) {
                            const alertMsg = `🔔 *Chatbot Handoff*\nConversation with ${conversation.displayName || conversation.phone} needs your attention.\n${agentMsg}`;
                            await sendWhatsAppTextMessage(agent.phone, alertMsg, session.userId);
                            console.log(`🔔 WhatsApp agent alert sent to ${agent.phone} for conversation ${conversation._id}`);
                        } else {
                            console.warn(`[Chatbot] notify_agent: agent ${notifyUserId} has no phone number configured — WhatsApp alert skipped.`);
                        }
                    } catch (waErr) {
                        console.error('Error sending WhatsApp agent alert:', waErr.message);
                    }
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

