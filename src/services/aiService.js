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
    const usage = geminiUsage(result);

    return { parsed: JSON.parse(responseText), usage };
}

// Normalize a Gemini response's usageMetadata into { inputTokens, outputTokens }.
function geminiUsage(result) {
    const u = result?.response?.usageMetadata || {};
    return {
        inputTokens: u.promptTokenCount || 0,
        outputTokens: u.candidatesTokenCount || 0,
    };
}

// Normalize an OpenAI response's usage into { inputTokens, outputTokens }.
function openaiUsage(response) {
    const u = response?.usage || {};
    return {
        inputTokens: u.prompt_tokens || 0,
        outputTokens: u.completion_tokens || 0,
    };
}

// Rough token estimate (~4 chars/token) used ONLY as a billing fallback when a
// provider omits usage metadata. Gemini's SDK does not always return
// usageMetadata; without this, such a call would be metered at 0 credits — a
// silent leak. Estimating keeps a real call from ever being free.
function estTokens(str) {
    return Math.ceil((String(str || '').length) / 4);
}

// If a provider reported no usage, estimate it from the text actually sent and
// received so the call is still billed proportionally.
function ensureUsage(usage, inputText, outputText) {
    const total = (usage?.inputTokens || 0) + (usage?.outputTokens || 0);
    if (total > 0) return usage;
    return { inputTokens: estTokens(inputText), outputTokens: estTokens(outputText) };
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

    return { parsed, usage: openaiUsage(response) };
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
    
    let resultJson, usage;
    if (provider === 'openai') {
        ({ parsed: resultJson, usage } = await callOpenAI(apiKey, modelName, finalSystemPrompt, historySubset, lastUserMessage));
    } else {
        // Default to Gemini
        ({ parsed: resultJson, usage } = await callGemini(apiKey, modelName, finalSystemPrompt, historySubset, lastUserMessage));
    }

    // Validation check on the response object format
    if (!resultJson || typeof resultJson !== 'object' || Array.isArray(resultJson)) {
        console.error('[AI_SERVICE ERROR] Invalid response format. resultJson:', JSON.stringify(resultJson));
        throw new Error('Invalid response received from LLM.');
    }

    const reply = resultJson.reply || 'I understand. Let me check that for you.';

    // Token usage for credit accounting; callers deduct via aiCreditService.
    // Fall back to an estimate if the provider reported none, so the call is
    // never billed at 0. Input ≈ system prompt + prior turns + last user message.
    const inputText = finalSystemPrompt + ' ' +
        historySubset.map(h => h.text).join(' ') + ' ' + lastUserMessage;
    const finalUsage = ensureUsage(usage, inputText, reply);

    return {
        reply,
        action: resultJson.action || null,
        usage: finalUsage
    };
};

/**
 * Single-label classification for the workflow "AI Classifier" node.
 * Provider-agnostic: works with both OpenAI and Gemini so the node is not
 * silently broken on a Gemini-only deployment.
 *
 * Returns { text, usage } — the raw model text (caller matches it against the
 * configured category list) plus token usage for credit accounting.
 *
 * @param {Object}   params
 * @param {'openai'|'gemini'} params.provider
 * @param {string}   params.apiKey
 * @param {string}   [params.model]      — provider-appropriate model; falls back to a sane default
 * @param {string[]} params.categories   — allowed output labels
 * @param {string}   params.prompt       — the interpolated classification prompt
 * @returns {Promise<{ text: string, usage: { inputTokens: number, outputTokens: number } }>}
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
        const oText = completion.choices?.[0]?.message?.content?.trim() || '';
        return {
            text: oText,
            usage: ensureUsage(openaiUsage(completion), systemInstruction + ' ' + prompt, oText)
        };
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
    const gText = (result.response.text() || '').trim();
    return {
        text: gText,
        usage: ensureUsage(geminiUsage(result), systemInstruction + ' ' + prompt, gText)
    };
};

/**
 * Maps a free-text customer reply onto one of a button node's options.
 *
 * A customer answering "around 50,000" to a budget question with ₹40k–60k on
 * offer has answered it — asking them to tap a button to say the same thing
 * again costs conversions. This resolves the reply to an option so the flow can
 * continue as if they'd tapped.
 *
 * Deliberately conservative: it returns null unless exactly one option clearly
 * fits, so questions, objections and genuinely ambiguous replies fall through to
 * the caller's re-prompt rather than being force-fitted onto an option the
 * customer never chose.
 *
 * Options are referred to by NUMBER, never by their own text — labels routinely
 * contain commas, currency symbols and emoji, which would collide with the
 * comma-separated category list the classifier is constrained to.
 *
 * The rules below are deliberately general. An earlier version listed worked
 * examples ("around 50,000" → a 40k-60k option, and so on); that taught the model
 * to pattern-match those cases rather than reason, and made the prompt look
 * correct precisely on the examples it was written around.
 *
 * The current date is supplied because options like "Today / Tomorrow / Next
 * Week" cannot be resolved without it — the model has no clock, so a reply of
 * "Saturday" is unanswerable unless it knows today's date in the tenant's own
 * timezone.
 *
 * @param {Object}   params
 * @param {'openai'|'gemini'} params.provider
 * @param {string}   params.apiKey
 * @param {string}   [params.model]
 * @param {string}   params.question    — what the flow asked
 * @param {string[]} params.options     — the button labels, in order
 * @param {string}   params.userReply   — the customer's free text
 * @param {string}   [params.timezone]  — IANA zone for date grounding; defaults to UTC
 * @param {Date}     [params.now]       — injectable clock, for tests
 * @returns {Promise<{ index: number|null, usage: { inputTokens: number, outputTokens: number } }>}
 *          0-based index of the matched option (or null), plus token usage. A
 *          short-circuit with no LLM call reports zero usage.
 */
exports.mapReplyToOption = async ({ provider, apiKey, model, question, options = [], userReply, timezone, now = new Date() }) => {
    const NO_USAGE = { inputTokens: 0, outputTokens: 0 };
    if (!apiKey) throw new Error('API key is required for option mapping.');
    if (!Array.isArray(options) || options.length === 0) return { index: null, usage: NO_USAGE };
    if (!userReply || !String(userReply).trim()) return { index: null, usage: NO_USAGE };

    const optionLines = options.map((text, i) => `${i + 1}. ${text}`).join('\n');
    const categories = [...options.map((_, i) => String(i + 1)), 'NONE'];

    // A bad IANA zone makes Intl throw; fall back rather than lose the mapping.
    let zone = timezone || 'UTC';
    let today;
    try {
        today = new Intl.DateTimeFormat('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: zone
        }).format(now);
    } catch (err) {
        zone = 'UTC';
        today = new Intl.DateTimeFormat('en-GB', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
        }).format(now);
    }

    const prompt = `Today is ${today} (timezone ${zone}).

A chatbot asked the customer: "${question}"

The customer must pick exactly one of these options:
${optionLines}

The customer replied: "${userReply}"

Decide which single option the reply means.

Rules:
- Judge by meaning, not wording. The reply need not reuse an option's words: it may give a value that falls inside an option's range, describe or name an option indirectly, or give a day or date that one option covers.
- Choose an option only when exactly one option is a clear match that a reasonable person would agree with.
- Answer NONE if the reply is a question, an objection, a refusal, or gives no answer.
- Answer NONE if more than one option could fit, if the reply falls outside every option, or if you are in any doubt.
- NONE is always better than a guess. A wrong choice sends the customer down the wrong path; NONE simply re-asks.

Answer with the option number alone, or NONE.`;

    const { text: raw, usage } = await exports.classifyText({ provider, apiKey, model, categories, prompt });

    // Strict parse: a bare option number, optionally with a trailing dot. Anything
    // chattier than that means the model ignored the contract — treat as no match.
    const parsed = /^\s*(\d+)\s*\.?\s*$/.exec(String(raw || '').trim());
    if (!parsed) return { index: null, usage };

    const idx = parseInt(parsed[1], 10) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= options.length) return { index: null, usage };
    return { index: idx, usage };
};
