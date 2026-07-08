const NodeRegistry = require('../../NodeRegistry');
const OpenAI = require('openai');

// ─────────────────────────────────────────────────────────────────────────────
// AiClassifierNode
// Uses the AI service to classify the lead into one of the configured categories.
// The classification result is stored in 'ai.classification' variable and
// used to route to the appropriate output port.
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
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.prompt?.trim())           errors.push('Prompt is required');
        if (!data.categories?.length)       errors.push('At least one category is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead       = context.getLead();
        const categories = (data.categories || []).map(c => c.trim());

        // Build context-aware prompt
        const vars = context.getAll();
        let prompt = (data.prompt || '').replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');

        prompt += `\n\nAvailable categories: ${categories.join(', ')}\nRespond with ONLY the category name, nothing else.`;

        let classification = 'default';
        try {
            if (!process.env.OPENAI_API_KEY) {
                console.warn('[AiClassifierNode] OPENAI_API_KEY not set. Skipping classification.');
            } else {
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const completion = await openai.chat.completions.create({
                    model:      'gpt-3.5-turbo',
                    max_tokens: 50,
                    messages:   [{ role: 'user', content: prompt }]
                });
                const rawText = completion.choices?.[0]?.message?.content?.trim() || '';
                const matched = categories.find(c => rawText.toLowerCase().includes(c.toLowerCase()));
                if (matched) classification = matched;
            }
        } catch (err) {
            console.error('[AiClassifierNode] AI call failed:', err.message);
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
