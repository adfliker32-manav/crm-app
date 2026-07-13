const NodeRegistry = require('../../NodeRegistry');
// RATE #2 FIX: Per-tenant AI request rate limiting
const { checkAIRate } = require('../../../utils/workflowRateLimiter');
// Provider-agnostic classification + unified platform key resolution
const { classifyText } = require('../../../services/aiService');
const { getGlobalAIKey } = require('../../../utils/aiKeyResolver');
const IntegrationConfig = require('../../../models/IntegrationConfig');

// ─────────────────────────────────────────────────────────────────────────────
// AiClassifierNode
// Uses the AI service to classify the lead into one of the configured categories.
// The classification result is stored in 'ai.classification' variable and
// used to route to the appropriate output port.
//
// FIXES:
//   RATE #2 — Per-tenant rate limit check before calling the AI API
//   KEYS    — Resolves the platform key from the DB global setting (Super-Admin UI)
//             with an env-var fallback, so the node isn't silently keyless.
//   PROVIDER— Honours the tenant's provider (OpenAI or Gemini) and auto-falls back
//             to whichever provider actually has a key configured.
// ─────────────────────────────────────────────────────────────────────────────
const AiClassifierNode = {
    type: 'ai_classifier',

    meta: () => ({
        type:     'ai_classifier',
        name:     'AI Classifier',
        icon:     'fa-solid fa-wand-magic-sparkles',
        category: 'ai',
        color:    '#A855F7',
        description: 'Classify the lead into categories using AI'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',   label: 'In' }],
        outputs: [{ id: 'default', label: 'Default' }]
        // Dynamic ports created from 'categories' config field
    }),

    schema: () => ({
        fields: [
            {
                key:      'prompt',
                label:    'Classification Prompt',
                type:     'textarea',
                required: true,
                rows:     4,
                placeholder: 'Based on this lead (name: {{lead.name}}, source: {{lead.source}}), classify as one of the categories below.'
            },
            {
                key:         'categories',
                label:       'Categories',
                type:        'tag_input',
                required:    true,
                placeholder: 'e.g. Hot Lead, Cold Lead, Not Interested',
                description: 'Each category becomes an output port on the canvas'
            },
            {
                key:         'model',
                label:       'AI Model',
                type:        'select',
                defaultValue: 'gpt-4o-mini',
                options: [
                    { value: 'gpt-4o-mini',   label: 'GPT-4o Mini (Better, Fast, Low Cost)' },
                    { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (Legacy)' }
                ]
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.prompt?.trim())     errors.push('Prompt is required');
        if (!data.categories?.length) errors.push('At least one category is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const categories = (data.categories || []).map(c => c.trim());

        // RATE #2 FIX: Check per-tenant AI rate limit before calling OpenAI.
        // Prevents one high-volume tenant from consuming the entire TPM quota
        // and causing AI classification failures for all other tenants.
        const tenantId = context.tenantId.toString();
        const rateCheck = await checkAIRate(tenantId);
        if (!rateCheck.allowed) {
            console.warn(`[AiClassifierNode] Tenant ${tenantId} exceeded AI rate limit (${rateCheck.count}/${rateCheck.limit}/min). Routing to default.`);
            context.set('ai.classification', 'default');
            context.set('ai.rateLimited', true);
            return {
                nextPort: 'default',
                output: { 'ai.classification': 'default', 'ai.rateLimited': true }
            };
        }

        // Build context-aware prompt with variable interpolation
        const vars = context.getAll();
        const prompt = (data.prompt || '').replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');

        let classification = 'default';
        try {
            // Resolve the tenant's provider, then the platform key for it.
            // If the configured provider has no key but the other one does, use that —
            // so the node works on both OpenAI-only and Gemini-only deployments.
            const cfg = await IntegrationConfig.findOne({ userId: tenantId }).select('ai.provider ai.model').lean();
            let provider = cfg?.ai?.provider || 'openai';
            let apiKey   = await getGlobalAIKey(provider);
            if (!apiKey) {
                const alt = provider === 'openai' ? 'gemini' : 'openai';
                const altKey = await getGlobalAIKey(alt);
                if (altKey) { provider = alt; apiKey = altKey; }
            }

            if (!apiKey) {
                console.warn(`[AiClassifierNode] No AI API key configured (checked DB global keys + env) for tenant ${tenantId}. Routing to default.`);
            } else {
                const rawText = await classifyText({
                    provider,
                    apiKey,
                    model: data.model,
                    categories,
                    prompt
                });

                // Clean the response (strip quotes, common punctuation, wrapper spaces)
                const cleanResponse = rawText.replace(/^["'`.?!,\s]+|["'`.?!,\s]+$/g, '').trim().toLowerCase();
                const lowercaseCategories = categories.map(c => c.toLowerCase());

                // 1. Try exact match first to prevent substring collision (e.g. matching "Sales" when the output is "Pre-Sales")
                const exactIdx = lowercaseCategories.indexOf(cleanResponse);
                if (exactIdx !== -1) {
                    classification = categories[exactIdx];
                } else {
                    // 2. Fallback to substring matching
                    const matched = categories.find(c => cleanResponse.includes(c.toLowerCase()));
                    if (matched) {
                        classification = matched;
                    }
                }
            }
        } catch (err) {
            console.error('[AiClassifierNode] AI call failed:', err.message);
            // On API failure, route to default — don't crash the execution
        }

        context.set('ai.classification', classification);

        return {
            nextPort: classification,
            output: { 'ai.classification': classification }
        };
    }
};

NodeRegistry.register(AiClassifierNode);
module.exports = AiClassifierNode;
