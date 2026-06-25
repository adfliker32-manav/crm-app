const axios = require('axios');
const IntegrationConfig = require('../models/IntegrationConfig');
const Lead = require('../models/Lead');
const { generateReply } = require('../services/aiService');

// Helper to get or create integration config
async function getOrCreateConfig(userId) {
    let config = await IntegrationConfig.findOne({ userId }).select('+ai.apiKey');
    if (!config) {
        config = new IntegrationConfig({ userId });
        await config.save();
    }
    return config;
}

// Get AI Settings
exports.getSettings = async (req, res) => {
    try {
        const config = await getOrCreateConfig(req.tenantId);
        
        // Prepare settings for frontend (masking API key)
        const settings = {
            provider: config.ai?.provider || 'gemini',
            model: config.ai?.model || 'gemini-1.5-flash',
            agentName: config.ai?.agentName || 'AI Assistant',
            systemPrompt: config.ai?.systemPrompt || '',
            aiEnabled: config.ai?.aiEnabled || false,
            aiFallbackEnabled: config.ai?.aiFallbackEnabled || false,
            aiSupportEnabled: config.ai?.aiSupportEnabled || false,
            maxTurns: config.ai?.maxTurns || 5,
            tokensUsedThisMonth: config.ai?.tokensUsedThisMonth || 0,
            hasApiKey: !!(config.ai?.apiKey)
        };
        
        return res.status(200).json(settings);
    } catch (error) {
        console.error('Error fetching AI settings:', error);
        return res.status(500).json({ error: 'Failed to fetch AI settings', details: error.message });
    }
};

// Update AI Settings
exports.updateSettings = async (req, res) => {
    try {
        const {
            provider,
            apiKey,
            model,
            agentName,
            systemPrompt,
            aiEnabled,
            aiFallbackEnabled,
            aiSupportEnabled,
            maxTurns
        } = req.body;

        const config = await getOrCreateConfig(req.tenantId);
        
        // Update fields
        if (provider) config.ai.provider = provider;
        if (model) config.ai.model = model;
        if (agentName !== undefined) config.ai.agentName = agentName;
        if (systemPrompt !== undefined) config.ai.systemPrompt = systemPrompt;
        if (aiEnabled !== undefined) config.ai.aiEnabled = aiEnabled;
        if (aiFallbackEnabled !== undefined) config.ai.aiFallbackEnabled = aiFallbackEnabled;
        if (aiSupportEnabled !== undefined) config.ai.aiSupportEnabled = aiSupportEnabled;
        if (maxTurns !== undefined) config.ai.maxTurns = maxTurns;

        // Handle API key updates
        if (apiKey === '') {
            config.ai.apiKey = null;
        } else if (apiKey && apiKey !== '••••••••••••••••') {
            config.ai.apiKey = apiKey;
        }

        await config.save();

        return res.status(200).json({
            message: 'AI settings updated successfully',
            settings: {
                provider: config.ai.provider,
                model: config.ai.model,
                agentName: config.ai.agentName,
                systemPrompt: config.ai.systemPrompt,
                aiEnabled: config.ai.aiEnabled,
                aiFallbackEnabled: config.ai.aiFallbackEnabled,
                aiSupportEnabled: config.ai.aiSupportEnabled,
                maxTurns: config.ai.maxTurns,
                tokensUsedThisMonth: config.ai.tokensUsedThisMonth,
                hasApiKey: !!(config.ai.apiKey)
            }
        });
    } catch (error) {
        console.error('Error updating AI settings:', error);
        return res.status(500).json({ error: 'Failed to update AI settings', details: error.message });
    }
};

// Test AI Bot
exports.testAI = async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        if (!message) {
            return res.status(400).json({ error: 'Message is required for testing' });
        }

        const config = await IntegrationConfig.findOne({ userId: req.tenantId }).select('+ai.apiKey');
        if (!config?.ai?.apiKey) {
            return res.status(400).json({ error: 'AI Settings are incomplete. Please save a valid API key first.' });
        }

        // Fetch dummy/first lead context if available, or mock one
        let leadContext = {};
        const firstLead = await Lead.findOne({ userId: req.tenantId }).lean();
        if (firstLead) {
            leadContext = {
                name: firstLead.name,
                phone: firstLead.phone,
                email: firstLead.email,
                currentStage: firstLead.status,
                tags: firstLead.tags,
                customData: firstLead.customData
            };
        } else {
            leadContext = {
                name: 'John Doe',
                phone: '+919999999999',
                email: 'johndoe@example.com',
                currentStage: 'New',
                tags: ['test-lead'],
                customData: { budget: '50L', location: 'Pune' }
            };
        }

        // Construct full conversation history list
        const conversationHistory = [
            ...history.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'model',
                text: msg.text
            })),
            { role: 'user', text: message }
        ];

        console.log(`🤖 Proxying test call to local AI Service`);
        const result = await generateReply({
            provider: config.ai.provider,
            apiKey: config.ai.apiKey,
            modelName: config.ai.model,
            systemPrompt: config.ai.systemPrompt,
            conversationHistory,
            leadContext
        });

        return res.status(200).json(result);
    } catch (error) {
        console.error('Error during AI settings test:', error.message);
        const errDetails = error.response?.data?.details || error.message;
        return res.status(500).json({ error: 'AI Test Call Failed', details: errDetails });
    }
};

// Check Health of standalone service
exports.checkHealth = async (req, res) => {
    return res.status(200).json({ status: 'OK', message: 'Standalone AI service merged.' });
};
