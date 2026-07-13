const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

// Global timeout applied to every LLM request (both providers). The OpenAI SDK
// enforces this natively; the Gemini SDK does not, so we wrap its calls (see withTimeout).
const AI_TIMEOUT_MS = 30000;

// Cache OpenAI clients per API key so we get connection pooling + native
// timeout/retry instead of constructing `new OpenAI()` on every request.
const _openaiClientCache = new Map();
function getOpenAIClient(apiKey) {
    let client = _openaiClientCache.get(apiKey);
    if (!client) {
        client = new OpenAI({ apiKey, timeout: AI_TIMEOUT_MS, maxRetries: 2 });
        _openaiClientCache.set(apiKey, client);
    }
    return client;
}

// Reject a promise if it doesn't settle within `ms`. Used to bound the Gemini
// SDK, which otherwise has no request timeout and can hang the webhook path.
function withTimeout(promise, ms, label = 'AI') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} request timed out after ${ms}ms`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Normalizes conversation history into roles suitable for the LLM.
 * @param {Array} history - Array of { role: 'user'|'model'|'assistant', text: string }
 * @returns {Array} - Normalized history
 */
function normalizeHistory(history = []) {
    return history.map(msg => {
        const role = (msg.role === 'user' || msg.direction === 'inbound') ? 'user' : 'model';
        const text = msg.text || msg.content?.text || '';
        return { role, text };
    }).filter(msg => msg.text.trim() !== '');
}

/**
 * Formats lead context into a readable string for the system prompt.
 * @param {Object} leadContext - Lead metadata
 * @returns {String} - Formatted context string
 */
function formatLeadContext(leadContext = {}) {
    if (!leadContext || Object.keys(leadContext).length === 0) return '';
    
    let contextStr = '\n=== CUSTOMER PROFILE ===\n';
    if (leadContext.name) contextStr += `- Name: ${leadContext.name}\n`;
    if (leadContext.phone) contextStr += `- Phone: ${leadContext.phone}\n`;
    if (leadContext.email) contextStr += `- Email: ${leadContext.email}\n`;
    if (leadContext.currentStage) contextStr += `- Current Lead Stage: ${leadContext.currentStage}\n`;
    if (leadContext.tags && leadContext.tags.length > 0) {
        contextStr += `- Current Tags: ${leadContext.tags.join(', ')}\n`;
    }
    if (leadContext.customData && Object.keys(leadContext.customData).length > 0) {
        contextStr += '- Custom Data:\n';
        for (const [key, value] of Object.entries(leadContext.customData)) {
            if (value !== undefined && value !== null) {
                contextStr += `  * ${key}: ${value}\n`;
            }
        }
    }
    contextStr += '=== END CUSTOMER PROFILE ===\n';
    return contextStr;
}

/**
 * Appends JSON schema enforcement rules to the system prompt.
 */
function buildEnforcedSystemPrompt(basePrompt, leadContext) {
    const contextText = formatLeadContext(leadContext);
    
    return `${basePrompt}
${contextText}
CRITICAL OUTPUT INSTRUCTIONS:
You are a lead qualification assistant. You must respond ONLY in a valid JSON object matching the schema below. 
Do not wrap your response in markdown formatting (like \`\`\`json ... \`\`\`), just output raw JSON.

Output JSON Schema:
{
  "reply": "Your WhatsApp response message here. Keep it to 1-3 sentences maximum. Be polite and ask qualifying questions one by one.",
  "action": {
    "type": "change_stage" | "assign_tag" | "notify_agent" | "book_appointment" | null,
    "stage": "The stage name to change the lead to (e.g. 'Qualified', 'Interested', 'Lost') if qualification conditions are met, otherwise null",
    "tag": "A tag to assign to the lead (e.g. 'hot-lead', 'invalid-number') if applicable, otherwise null",
    "serviceType": "If type is book_appointment, the service requested (e.g. 'Consultation'). Otherwise null",
    "appointmentDate": "If type is book_appointment, the date in YYYY-MM-DD format. Otherwise null",
    "appointmentTime": "If type is book_appointment, the time (e.g. '10:00 AM' or '14:30'). Otherwise null",
    "reason": "Brief justification of why this action was chosen"
  }
}

Additional Rules:
1. If the customer answers a qualifying question, save the info and ask the next question.
2. If they have answered all qualifying questions successfully, set the action type to "change_stage" and stage to "Qualified".
3. If they specifically ask for a human agent or present a query you cannot resolve, set action type to "notify_agent".
4. If they are rude, spamming, or not interested, set action type to "change_stage" and stage to "Lost" or "Dead Lead".
5. If they want to book an appointment, ask for their preferred date, time, and service. Once you have all three, set the action type to "book_appointment" and provide serviceType, appointmentDate, and appointmentTime. IMPORTANT: In your 'reply', do NOT confirm the booking details yourself. Just say a brief acknowledgment like "Booking your appointment now...", as the system will automatically send an official confirmation template.
`;
}

/**
 * Invokes Gemini API for chat completion.
 */
// Cache Gemini client per API key (all tenants share the global key, so this is effectively a singleton)
const _geminiClientCache = new Map();
function getGeminiClient(apiKey) {
    let client = _geminiClientCache.get(apiKey);
    if (!client) {
        client = new GoogleGenerativeAI(apiKey);
        _geminiClientCache.set(apiKey, client);
    }
    return client;
}

async function callGemini(apiKey, modelName, systemPrompt, history, lastUserMessage) {
    const genAI = getGeminiClient(apiKey);
    
    // Format history for Gemini and enforce alternating roles starting with 'user'
    let geminiHistory = [];
    let expectedRole = 'user';

    for (const h of history) {
        const mappedRole = h.role === 'user' ? 'user' : 'model';
        
        if (geminiHistory.length === 0 && mappedRole === 'model') {
            // Gemini strictly requires the first message to be from 'user'
            geminiHistory.push({ role: 'user', parts: [{ text: '(Customer triggered conversation)' }] });
            expectedRole = 'model';
        }
        
        if (mappedRole === expectedRole) {
            geminiHistory.push({ role: mappedRole, parts: [{ text: h.text }] });
            expectedRole = expectedRole === 'user' ? 'model' : 'user';
        } else if (geminiHistory.length > 0) {
            // Same role consecutively: merge them to maintain alternating pattern
            geminiHistory[geminiHistory.length - 1].parts[0].text += `\n${h.text}`;
        }
    }
    
    const model = genAI.getGenerativeModel({
        model: modelName || 'gemini-2.5-flash',
        systemInstruction: systemPrompt,
        generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 500 // Guard: prevents runaway token costs + WhatsApp 4096-char limit
        }
    });
    
    const chat = model.startChat({
        history: geminiHistory
    });
    
    const result = await withTimeout(chat.sendMessage(lastUserMessage), AI_TIMEOUT_MS, 'Gemini');
    const responseText = result.response.text();

    return JSON.parse(responseText);
}

/**
 * Invokes OpenAI API for chat completion.
 */
async function callOpenAI(apiKey, modelName, systemPrompt, history, lastUserMessage) {
    const openai = getOpenAIClient(apiKey);

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({
            role: h.role === 'user' ? 'user' : 'assistant',
            content: h.text
        })),
        { role: 'user', content: lastUserMessage }
    ];
    
    const response = await openai.chat.completions.create({
        model: modelName || 'gpt-4o',
        messages,
        response_format: { type: 'json_object' },
        max_tokens: 500 // Guard: prevents runaway token costs + WhatsApp 4096-char limit
    });
    
    let responseText = response.choices[0].message.content;
    
    if (typeof responseText === 'string') {
        // Strip out markdown code blocks if the model ignored instructions
        responseText = responseText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    }
    
    let parsed = JSON.parse(responseText);
    
    // Sometimes the model double-stringifies the JSON
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch (e) {
            // keep the string if it's not valid JSON inside
        }
    }
    
    return parsed;
}

/**
 * Main service function to generate replies and qualification actions.
 */
exports.generateReply = async ({ provider, apiKey, modelName, systemPrompt, conversationHistory = [], leadContext = {} }) => {
    console.log(`[AI_SERVICE DEBUG] Received key: length=${apiKey?.length}, prefix=${apiKey?.substring(0, 5)}`);
    if (!apiKey) {
        throw new Error('API key is required.');
    }
    
    const normalized = normalizeHistory(conversationHistory);
    
    // Extract the last user message and the rest of the history
    let lastUserMessage = 'Hello';
    let historySubset = [...normalized];
    
    if (normalized.length > 0 && normalized[normalized.length - 1].role === 'user') {
        lastUserMessage = normalized[normalized.length - 1].text;
        historySubset = normalized.slice(0, normalized.length - 1);
    }
    
    const finalSystemPrompt = buildEnforcedSystemPrompt(systemPrompt, leadContext);
    
    console.log(`🤖 Sending request to ${provider} (${modelName || 'default'}). History length: ${historySubset.length}. Msg: "${lastUserMessage}"`);
    
    let resultJson;
    if (provider === 'openai') {
        resultJson = await callOpenAI(apiKey, modelName, finalSystemPrompt, historySubset, lastUserMessage);
    } else {
        // Default to Gemini
        resultJson = await callGemini(apiKey, modelName, finalSystemPrompt, historySubset, lastUserMessage);
    }
    
    // Validation check on the response object format
    if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) {
        console.error('[AI_SERVICE ERROR] Invalid response format. resultJson:', JSON.stringify(resultJson));
        throw new Error('Invalid response received from LLM.');
    }
    
    return {
        reply: resultJson.reply || 'I understand. Let me check that for you.',
        action: resultJson.action || null
    };
};

/**
 * Single-label classification for the workflow "AI Classifier" node.
 * Provider-agnostic: works with both OpenAI and Gemini so the node is not
 * silently broken on a Gemini-only deployment.
 *
 * Returns the raw model text — the caller is responsible for matching it
 * against the configured category list.
 *
 * @param {Object}   params
 * @param {'openai'|'gemini'} params.provider
 * @param {string}   params.apiKey
 * @param {string}   [params.model]      — provider-appropriate model; falls back to a sane default
 * @param {string[]} params.categories   — allowed output labels
 * @param {string}   params.prompt       — the interpolated classification prompt
 * @returns {Promise<string>}
 */
exports.classifyText = async ({ provider, apiKey, model, categories = [], prompt }) => {
    if (!apiKey) throw new Error('API key is required for classification.');

    const systemInstruction = `You are a strict data classifier. Your task is to output exactly one of these allowed categories: ${categories.join(', ')}.\nDo not add any punctuation, explanation, quotes, prefix, or extra words. Output ONLY the exact category name.`;

    if (provider === 'openai') {
        const openai = getOpenAIClient(apiKey);
        const completion = await openai.chat.completions.create({
            model: (model && model.startsWith('gpt')) ? model : 'gpt-4o-mini',
            max_tokens: 50,
            temperature: 0, // Deterministic — we want exact category matching
            messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: prompt }
            ]
        });
        return completion.choices?.[0]?.message?.content?.trim() || '';
    }

    // Gemini
    const genAI = getGeminiClient(apiKey);
    const gModel = genAI.getGenerativeModel({
        // The node's model dropdown holds OpenAI names; ignore them for Gemini.
        model: (model && model.startsWith('gemini')) ? model : 'gemini-2.5-flash',
        systemInstruction,
        // Gemini 2.5 models spend "thinking" tokens against maxOutputTokens; a tiny cap
        // can exhaust the budget on thinking and return empty text. 256 leaves headroom
        // while still bounding cost (the output itself is a single short label).
        generationConfig: { temperature: 0, maxOutputTokens: 256 }
    });
    const result = await withTimeout(gModel.generateContent(prompt), AI_TIMEOUT_MS, 'Gemini');
    return (result.response.text() || '').trim();
};
