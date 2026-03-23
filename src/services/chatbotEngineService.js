const ChatbotFlow = require('../models/ChatbotFlow');
const ChatbotSession = require('../models/ChatbotSession');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const Lead = require('../models/Lead');
const User = require('../models/User');
const { sendWhatsAppTextMessage, sendInteractiveMessage } = require('./whatsappService');
const NodeCache = require('node-cache');
const flowCache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

exports.invalidateFlowCache = (userId) => {
    flowCache.del(`flows_${userId}`);
    console.log(`🧹 Cleared chatbot flow cache for user ${userId}`);
};

const getActiveFlows = async (userId) => {
    const cacheKey = `flows_${userId}`;
    let flows = flowCache.get(cacheKey);
    if (!flows) {
        flows = await ChatbotFlow.find({ userId: userId, isActive: true }).lean();
        flowCache.set(cacheKey, flows);
    }
    return flows;
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

        // 1. Check Global Automations (Welcome & Out-of-Office)
        const user = await User.findById(userId).select('whatsappSettings');
        if (user && user.whatsappSettings && user.whatsappSettings.autoReply) {
            const autoReply = user.whatsappSettings.autoReply;
            const settings = user.whatsappSettings;

            // Welcome Message logic
            if (autoReply.welcomeEnabled && autoReply.welcomeMessage) {
                // If this is the absolute first message inbound
                if (conversation.metadata.totalInbound === 1) {
                    await sendWhatsAppTextMessage(conversation.phone, autoReply.welcomeMessage, userId);
                }
            }

            // Out-Of-Office logic
            if (autoReply.outOfOfficeEnabled && autoReply.outOfOfficeMessage) {
                const isOpen = isWithinBusinessHours(settings);
                if (!isOpen) {
                    // Prevent spamming: only send OOO if we haven't sent one recently (e.g. in the last 12 hours)
                    // We'll approximate this by only sending it if this is the first message in the current "burst"
                    // (Checking if previous message was more than 4 hours ago, or if it's the very first message)
                    const isNewConversationBurst = !conversation.lastMessageAt || 
                        (new Date() - new Date(conversation.lastMessageAt)) > (4 * 60 * 60 * 1000);
                    
                    if (conversation.metadata.totalInbound === 1 || isNewConversationBurst) {
                        await sendWhatsAppTextMessage(conversation.phone, autoReply.outOfOfficeMessage, userId);
                    }
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
        const allActiveFlows = await getActiveFlows(userId);
        const keywordFlows = allActiveFlows.filter(f => 
            f.triggerType === 'keyword' && 
            f.triggerKeywords && 
            f.triggerKeywords.some(k => k.toLowerCase() === messageText)
        );

        if (keywordFlows.length > 0) {
            // Start new session with first matching flow
            return await startSession(keywordFlows[0], conversationId, userId);
        }

        // Check for first_message trigger (Chatbots)
        if (conversation.metadata.totalInbound === 1) {
            const firstMessageFlows = allActiveFlows.filter(f => f.triggerType === 'first_message');

            if (firstMessageFlows.length > 0) {
                return await startSession(firstMessageFlows[0], conversationId, userId);
            }
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

// Continue existing session
const continueSession = async (session, userResponse, conversationId, userId) => {
    try {
        const flow = session.flowId;
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
            // Handle button response
            const button = currentNode.data.buttons.find(b =>
                b.text.toLowerCase() === userResponse || b.id === userResponse
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
                    await sendInteractiveMessage(
                        conversation.phone,
                        messageText,
                        node.data.buttons.map(b => ({ id: b.id, text: b.text })),
                        session.userId
                    );
                } else {
                    // Send regular text message
                    await sendWhatsAppTextMessage(conversation.phone, messageText, session.userId);

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
                await sendWhatsAppTextMessage(conversation.phone, questionText, session.userId);
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
                // Schedule next node execution
                const delayMs = (node.data.delaySeconds || 0) * 1000;
                setTimeout(async () => {
                    if (node.data.nextNodeId) {
                        session.currentNodeId = node.data.nextNodeId;
                        await session.save();
                        await executeNode(session, flow, node.data.nextNodeId);
                    }
                }, delayMs);
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
                    await Lead.findByIdAndUpdate(conversation.leadId, {
                        status: actionData.actionData.stage
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

                    await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                        leadId: lead._id
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
        const updateField = status === 'completed' ? 'analytics.completed' : 'analytics.abandoned';
        await ChatbotFlow.findByIdAndUpdate(session.flowId, {
            $inc: { [updateField]: 1 }
        });

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

