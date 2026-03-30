const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { sendWhatsAppTextMessage, sendInteractiveMessage } = require('./whatsappService');
const { emitToUser } = require('./socketService');
const NodeCache = require('node-cache');
const flowCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });
const normalizeId = (value) => value ? value.toString() : null;
const buildFlowCacheKey = (ownerIds) => `flows_${[...new Set(ownerIds.map(normalizeId).filter(Boolean))].sort().join('|')}`;
const getSessionFlowId = (session) => session?.flowId?._id || session?.flowId || null;

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
            isAutomated: true
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

const resolveChatbotContext = async (userId) => {
    const normalizedUserId = normalizeId(userId);
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

    return {
        tenantId: tenantId || normalizedUserId,
        flowOwnerIds: [...new Set(flowOwnerIds.filter(Boolean))]
    };
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
        if (!conversation) return null;
        const { tenantId, flowOwnerIds } = await resolveChatbotContext(userId);

        // 1. Check Global Automations (Welcome & Out-of-Office)
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

        // 2. Chatbot Flow Evaluation
        const messageText = message.content?.text?.toLowerCase().trim();
        if (!messageText) return null;

        // Check for active session first
        let session = await ChatbotSession.findOne({
            conversationId: conversationId,
            status: 'active'
        }).populate('flowId');

        if (session) {
            // Continue existing session
            return await continueSession(session, messageText, conversationId, userId);
        }

        // Check for keyword triggers using memory cache
        const allActiveFlows = await getActiveFlows(flowOwnerIds, tenantId);
        let targetFlow = null;

        // 1. Keyword Flow Match (Case-Insensitive & Boundary matched)
        targetFlow = allActiveFlows.find(f => {
            if (f.triggerType !== 'keyword' || !f.triggerKeywords || f.triggerKeywords.length === 0) return false;
            
            return f.triggerKeywords.some(k => {
                const kl = k.toLowerCase().trim();
                // Check exact match or word boundary regex (handles if keyword is part of a larger sentence)
                if (messageText === kl) return true;
                try {
                    const regex = new RegExp(`\\b${kl}\\b`, 'i');
                    return regex.test(messageText);
                } catch (e) {
                    return messageText.includes(kl); // Fallback for special characters
                }
            });
        });

        // 2. First Message Match (Completely new contact)
        if (!targetFlow && conversation.metadata.totalInbound === 1) {
            targetFlow = allActiveFlows.find(f => f.triggerType === 'first_message' || f.triggerType === 'any_message');
        }

        // 3. Existing Contact Match (They have messaged before)
        if (!targetFlow && conversation.metadata.totalInbound > 1) {
            targetFlow = allActiveFlows.find(f => f.triggerType === 'existing_contact_message' || f.triggerType === 'any_message');
        }

        if (targetFlow) {
            // Start new session with first matching flow
            return await startSession(
                targetFlow,
                conversationId,
                normalizeId(targetFlow.userId) || tenantId
            );
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
        // Create session
        const session = new ChatbotSession({
            conversationId: conversationId,
            userId: userId,
            flowId: flow._id,
            currentNodeId: flow.startNodeId,
            variables: new Map(),
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
    
    // Convert map to plain object for customData
    const customData = {};
    if (session.variables) {
        session.variables.forEach((val, key) => {
            customData[key] = val;
        });
    }

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

        await Lead.findByIdAndUpdate(leadIdToUpdate, updateOp);

        if (didLevelUp && bestRule?.assignTags?.length > 0) {
            await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                $addToSet: { tags: { $each: bestRule.assignTags } }
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

        const lead = new Lead({
            userId: session.userId,
            name: session.variables.get('name') || conversation.displayName || 'WhatsApp Lead',
            phone: conversation.phone,
            email: session.variables.get('email') || null,
            source: 'WhatsApp Chatbot',
            status: newLeadStatus,
            qualificationLevel: currentLevel,
            // FIX 3a: customData is already a plain object, safe to set directly on new lead creation
            customData: customData,
            // FIX 3b: Seed tags onto the new Lead from the qualifying rule
            tags: bestRule?.assignTags?.length > 0 ? bestRule.assignTags : [],
            history: [{
                type: 'System',
                subType: 'Created',
                content: qualificationReason,
                date: new Date()
            }]
        });
        await lead.save();
        leadIdToUpdate = lead._id;
        
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
            // Store answer in variables
            const variableName = currentNode.data.variableName || 'answer';
            session.variables.set(variableName, userResponse);
            session.markModified('variables');

            // Evaluate smart lead config
            const conversation = await WhatsAppConversation.findById(conversationId);
            await evaluateSmartLead(session, flow, conversation);

            // Move to next node
            const nextNodeId = currentNode.data.nextNodeId;
            if (nextNodeId) {
                session.currentNodeId = nextNodeId;
                session.lastInteractionAt = new Date();
                await session.save();
                return await executeNode(session, flow, nextNodeId);
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

            if (button && button.nextNodeId) {
                session.currentNodeId = button.nextNodeId;
                session.lastInteractionAt = new Date();
                await session.save();
                return await executeNode(session, flow, button.nextNodeId);
            }
        }

        return null;
    } catch (error) {
        console.error('Error continuing session:', error);
        return null;
    }
};

// Execute a specific node
const executeNode = async (session, flow, nodeId) => {
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

        const conversation = await WhatsAppConversation.findById(session.conversationId);
        if (!conversation) return null;

        switch (node.type) {
            case 'start':
                // Move to next node immediately
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId);
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
                        return await executeNode(session, flow, node.data.nextNodeId);
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
                    return await executeNode(session, flow, matchedCondition.nextNodeId);
                } else if (node.data.nextNodeId) {
                    // Default path
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId);
                }
                break;

            case 'action':
                // Execute action
                await executeAction(node.data, session, conversation);

                // Move to next node
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId);
                }
                break;

            case 'delay':
                // NOTE: We do NOT use setTimeout here as it is lost on server restart.
                // Instead we log the delay intent and advance immediately to the next node.
                // True scheduled delays should be handled via the Agenda job queue (future improvement).
                console.log(`⏱️ Delay node: ${node.data.delaySeconds}s - advancing immediately (safe mode)`);
                if (node.data.nextNodeId) {
                    session.currentNodeId = node.data.nextNodeId;
                    await session.save();
                    return await executeNode(session, flow, node.data.nextNodeId);
                }
                break;

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
    const value = variables.get(condition.variable);
    if (value === undefined) return false;

    switch (condition.operator) {
        case 'equals':
            return value.toString().toLowerCase() === condition.value.toLowerCase();
        case 'contains':
            return value.toString().toLowerCase().includes(condition.value.toLowerCase());
        case 'greater_than':
            return parseFloat(value) > parseFloat(condition.value);
        case 'less_than':
            return parseFloat(value) < parseFloat(condition.value);
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
                }
                break;

            case 'change_stage':
                if (conversation.leadId && actionData.actionData?.stage) {
                    // FIX: Use $set operator — bare field update causes MongoServerError
                    // when mixed with other operators elsewhere in the pipeline.
                    await Lead.findByIdAndUpdate(conversation.leadId, {
                        $set: { status: actionData.actionData.stage }
                    });
                }
                break;

            case 'create_lead':
                if (!conversation.leadId) {
                    const lead = new Lead({
                        userId: session.userId,
                        name: session.variables.get('name') || conversation.displayName || 'WhatsApp Lead',
                        phone: conversation.phone,
                        email: session.variables.get('email') || null,
                        source: 'WhatsApp Chatbot',
                        status: 'New'
                    });
                    await lead.save();

                    // FIX: Use $set operator — bare field causes MongoServerError
                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                        $set: { leadId: lead._id }
                    });
                }
                break;

            case 'notify_agent':
                // TODO: Implement agent notification
                console.log('Agent notification:', actionData.actionData);
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


