const axios = require('axios');
const IntegrationConfig = require('../models/IntegrationConfig');
const Lead = require('../models/Lead');
const GlobalSetting = require('../models/GlobalSetting');
const { generateReply } = require('../services/aiService');
const aiCreditService = require('../services/aiCreditService');
const { decryptToken } = require('../utils/encryptionUtils');

// Helper to get or create integration config
async function getOrCreateConfig(userId) {
    let config = await IntegrationConfig.findOne({ userId });
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
        const wallet = await aiCreditService.getWallet(req.tenantId);

        // Prepare settings for frontend (masking API key)
        const settings = {
            provider: config.ai?.provider || 'gemini',
            model: config.ai?.model || 'gemini-2.5-flash',
            agentName: config.ai?.agentName || 'AI Assistant',
            systemPrompt: config.ai?.systemPrompt || '',
            aiEnabled: config.ai?.aiEnabled || false,
            aiFallbackEnabled: config.ai?.aiFallbackEnabled || false,
            // Defaults ON — only an explicit false turns it off.
            aiButtonMappingEnabled: config.ai?.aiButtonMappingEnabled !== false,
            aiSupportEnabled: config.ai?.aiSupportEnabled || false,
            maxTurns: config.ai?.maxTurns || 12,
            // Always sent as a whole object so the UI never has to merge partial
            // state against schema defaults — a legacy config that predates this
            // field simply reports the defaults.
            leadCreation: {
                enabled:             config.ai?.leadCreation?.enabled === true,
                minCustomerMessages: config.ai?.leadCreation?.minCustomerMessages ?? 3,
                requirePhone:        config.ai?.leadCreation?.requirePhone !== false,
                requireName:         config.ai?.leadCreation?.requireName === true,
                requireEmail:        config.ai?.leadCreation?.requireEmail === true,
                instruction:         config.ai?.leadCreation?.instruction || '',
                status:              config.ai?.leadCreation?.status || 'New',
                source:              config.ai?.leadCreation?.source || 'WhatsApp AI Chatbot',
                tags:                config.ai?.leadCreation?.tags || [],
                autoCreateWhenReady: config.ai?.leadCreation?.autoCreateWhenReady === true
            },
            tokensUsedThisMonth: config.ai?.tokensUsedThisMonth || 0,
            // AI credit wallet (shared with voice; priced via the AiModelRate table)
            aiCreditsBalance: wallet.balance,
            aiCreditsUsedThisMonth: wallet.usedThisMonth,
            creditValueInr: wallet.creditValueInr,
            aiCreditsBalanceInr: wallet.balanceInr,
            aiCreditsUsedThisMonthInr: wallet.usedThisMonthInr,
            voiceAutomation: {
                provider:       config.voiceAutomation?.provider || 'vapi',
                defaultAgentId: config.voiceAutomation?.defaultAgentId || '',
                fromNumber:     config.voiceAutomation?.fromNumber || '',
                apiKey:         '' // never expose the raw key; frontend only needs to know if it's set
            }
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
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        const workspace = await WorkspaceSettings.findOne({ userId: req.tenantId });
        if (!workspace?.planFeatures?.aiChatbot) {
            return res.status(403).json({ error: 'AI Chatbot feature requires the Enterprise plan.' });
        }
        const {
            provider,
            model,
            agentName,
            systemPrompt,
            aiEnabled,
            aiFallbackEnabled,
            aiButtonMappingEnabled,
            aiSupportEnabled,
            maxTurns
        } = req.body;

        const config = await getOrCreateConfig(req.tenantId);

        // Remembered BEFORE the write: switching provider changes which embedding
        // model the knowledge base runs on, and vectors are not comparable across
        // models. Without the hook below, a provider change would silently stop
        // every knowledge base document being retrieved with no visible cause.
        const previousProvider = config.ai.provider;

        // Update fields
        if (provider) config.ai.provider = provider;
        if (model) config.ai.model = model;
        if (agentName !== undefined) config.ai.agentName = agentName;
        // Backend enforcement: hard ceiling to prevent runaway abuse (a few thousand
        // words). The UI encourages detailed prompts but warns past 1000 chars that
        // every extra character is resent — and billed — on every single AI reply.
        if (systemPrompt !== undefined) config.ai.systemPrompt = String(systemPrompt).substring(0, 6000);
        if (aiEnabled !== undefined) config.ai.aiEnabled = aiEnabled;
        if (aiFallbackEnabled !== undefined) config.ai.aiFallbackEnabled = aiFallbackEnabled;
        if (aiButtonMappingEnabled !== undefined) config.ai.aiButtonMappingEnabled = aiButtonMappingEnabled;
        if (aiSupportEnabled !== undefined) config.ai.aiSupportEnabled = aiSupportEnabled;
        // Backend enforcement, same reasoning as the systemPrompt cap above: every
        // extra turn is another billed round trip against the tenant's AI credit
        // wallet. This was written straight through unvalidated, so a non-numeric
        // value could poison the config and a large one multiplied spend per
        // conversation with nothing to stop it.
        if (maxTurns !== undefined) {
            const n = Math.floor(Number(maxTurns));
            if (!Number.isFinite(n) || n < 1 || n > 50) {
                return res.status(400).json({ error: 'maxTurns must be a whole number between 1 and 50.' });
            }
            config.ai.maxTurns = n;
        }

        // ── AI lead-creation policy ──────────────────────────────────────────
        // Every field is clamped server-side. `instruction` rides along on every
        // single AI reply and is billed with it, so it gets the same hard ceiling
        // treatment as systemPrompt above rather than being trusted from the UI.
        const leadPayload = req.body.leadCreation;
        if (leadPayload && typeof leadPayload === 'object') {
            const lc = config.ai.leadCreation || {};

            if (leadPayload.enabled !== undefined) lc.enabled = !!leadPayload.enabled;
            if (leadPayload.requirePhone !== undefined) lc.requirePhone = !!leadPayload.requirePhone;
            if (leadPayload.requireName !== undefined) lc.requireName = !!leadPayload.requireName;
            if (leadPayload.requireEmail !== undefined) lc.requireEmail = !!leadPayload.requireEmail;
            if (leadPayload.autoCreateWhenReady !== undefined) lc.autoCreateWhenReady = !!leadPayload.autoCreateWhenReady;

            if (leadPayload.minCustomerMessages !== undefined) {
                const n = Math.floor(Number(leadPayload.minCustomerMessages));
                if (!Number.isFinite(n) || n < 1 || n > 20) {
                    return res.status(400).json({ error: 'minCustomerMessages must be a whole number between 1 and 20.' });
                }
                lc.minCustomerMessages = n;
            }

            if (leadPayload.instruction !== undefined) {
                lc.instruction = String(leadPayload.instruction).substring(0, 500);
            }
            if (leadPayload.status !== undefined) {
                lc.status = String(leadPayload.status).trim().substring(0, 50) || 'New';
            }
            if (leadPayload.source !== undefined) {
                lc.source = String(leadPayload.source).trim().substring(0, 100) || 'WhatsApp AI Chatbot';
            }
            if (leadPayload.tags !== undefined) {
                lc.tags = Array.isArray(leadPayload.tags)
                    ? leadPayload.tags.slice(0, 10).map(t => String(t).trim().substring(0, 50)).filter(Boolean)
                    : [];
            }

            config.ai.leadCreation = lc;
            config.markModified('ai.leadCreation');
        }

        // Voice Automation settings from the same page
        const voicePayload = req.body.voiceAutomation;
        if (voicePayload) {
            if (voicePayload.provider)       config.voiceAutomation.provider       = voicePayload.provider;
            if (voicePayload.defaultAgentId !== undefined) config.voiceAutomation.defaultAgentId = voicePayload.defaultAgentId || null;
            if (voicePayload.fromNumber !== undefined)     config.voiceAutomation.fromNumber     = voicePayload.fromNumber || null;
            // Only update API key if a real value was sent (not empty/masked)
            if (voicePayload.apiKey && !voicePayload.apiKey.startsWith('•')) {
                config.voiceAutomation.apiKey = voicePayload.apiKey;
            }
        }

        await config.save();

        // Provider changed → the knowledge base's stored vectors were produced by
        // the OTHER provider's embedding model and can no longer be compared
        // against new queries. Flag those documents as needing a re-index so the
        // tenant sees a "Needs re-index" badge and a retry button, instead of a bot
        // that quietly stops using data they uploaded. Best-effort: a failure here
        // must not fail the settings save the user actually asked for.
        if (provider && provider !== previousProvider) {
            try {
                const { markStaleForProviderChange } = require('../services/knowledgeBaseService');
                const affected = await markStaleForProviderChange(req.tenantId);
                if (affected > 0) {
                    console.log(`[AI Settings] Provider ${previousProvider} → ${provider}: marked ${affected} knowledge base document(s) for re-indexing (tenant ${req.tenantId}).`);
                }
            } catch (kbErr) {
                console.error('[AI Settings] Could not flag knowledge base documents after provider change:', kbErr.message);
            }
        }

        return res.status(200).json({
            message: 'AI settings updated successfully',
            settings: {
                provider: config.ai.provider,
                model: config.ai.model,
                agentName: config.ai.agentName,
                systemPrompt: config.ai.systemPrompt,
                aiEnabled: config.ai.aiEnabled,
                aiFallbackEnabled: config.ai.aiFallbackEnabled,
                aiButtonMappingEnabled: config.ai.aiButtonMappingEnabled,
                aiSupportEnabled: config.ai.aiSupportEnabled,
                maxTurns: config.ai.maxTurns,
                tokensUsedThisMonth: config.ai.tokensUsedThisMonth
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

        const config = await IntegrationConfig.findOne({ userId: req.tenantId });
        const WorkspaceSettings = require('../models/WorkspaceSettings');
        
        const [globalGemini, globalOpenai, workspace] = await Promise.all([
            GlobalSetting.findOne({ key: 'global_gemini_api_key' }),
            GlobalSetting.findOne({ key: 'global_openai_api_key' }),
            WorkspaceSettings.findOne({ userId: req.tenantId })
        ]);
        
        const apiKey = config.ai.provider === 'openai' 
            ? decryptToken(globalOpenai?.value) 
            : decryptToken(globalGemini?.value);
        const hasAiPlan = workspace?.planFeatures?.aiChatbot === true;

        if (!hasAiPlan) {
            return res.status(403).json({ error: 'AI Chatbot feature requires the Enterprise plan.' });
        }

        if (!apiKey) {
            return res.status(400).json({ error: 'Global AI API Key is not configured by the Super Admin.' });
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
            apiKey: apiKey,
            modelName: config.ai.model,
            systemPrompt: config.ai.systemPrompt,
            conversationHistory,
            leadContext
        });

        // The simulator makes a real LLM call on the shared key — charge it to the
        // tenant's wallet like any other AI usage so testing isn't a free leak.
        await aiCreditService.charge(req.tenantId, {
            model: config.ai.model,
            inputTokens: result.usage?.inputTokens,
            outputTokens: result.usage?.outputTokens,
            feature: 'test_simulator'
        });

        return res.status(200).json({ reply: result.reply, action: result.action });
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

// AI credit ledger for this tenant (paginated statement, newest first)
exports.getLedger = async (req, res) => {
    try {
        const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
        const skip = parseInt(req.query.skip, 10) || 0;
        const entries = await aiCreditService.getLedger(req.tenantId, { limit, skip });
        return res.status(200).json({ entries });
    } catch (error) {
        console.error('Error fetching AI ledger:', error);
        return res.status(500).json({ error: 'Failed to fetch AI credit ledger' });
    }
};

// Month-to-date usage summary + linear monthly forecast for this tenant
exports.getUsage = async (req, res) => {
    try {
        const [summary, wallet] = await Promise.all([
            aiCreditService.getUsageSummary(req.tenantId),
            aiCreditService.getWallet(req.tenantId)
        ]);
        return res.status(200).json({ ...summary, wallet });
    } catch (error) {
        console.error('Error fetching AI usage summary:', error);
        return res.status(500).json({ error: 'Failed to fetch AI usage summary' });
    }
};
