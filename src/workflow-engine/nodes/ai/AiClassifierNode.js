const NodeRegistry = require('../../NodeRegistry');
// WEAK #1 FIX: Use singleton OpenAI client instead of creating a new instance per execution
const { getGlobalOpenAIClient } = require('../../../utils/openaiClient');
// RATE #2 FIX: Per-tenant AI request rate limiting
const { checkAIRate } = require('../../../utils/workflowRateLimiter');

// ─────────────────────────────────────────────────────────────────────────────
// AiClassifierNode
// Uses the AI service to classify the lead into one of the configured categories.
// The classification result is stored in 'ai.classification' variable and
// used to route to the appropriate output port.
//
// FIXES:
//   WEAK #1 — Singleton OpenAI client via openaiClient.js (no more per-execution instantiation)
//   RATE #2 — Per-tenant rate limit check before calling OpenAI API
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
            // WEAK #1 FIX: Get the shared singleton client — no new instance per call
            const openai = getGlobalOpenAIClient();
            if (!openai) {
                console.warn('[AiClassifierNode] OPENAI_API_KEY not set. Routing to default.');
            } else {
                const model = data.model || 'gpt-4o-mini';
                const completion = await openai.chat.completions.create({
                    model,
                    max_tokens: 50,
                    temperature: 0,  // Deterministic — we want exact category matching
                    messages: [
                        {
                            role: 'system',
                            content: `You are a strict data classifier. Your task is to output exactly one of these allowed categories: ${categories.join(', ')}.\nDo not add any punctuation, explanation, quotes, prefix, or extra words. Output ONLY the exact category name.`
                        },
                        { role: 'user', content: prompt }
                    ]
                });

                const rawText = completion.choices?.[0]?.message?.content?.trim() || '';
                
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
