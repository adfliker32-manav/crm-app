const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

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
5. If they want to book an appointment, ask for their preferred date, time, and service. Once you have all three, set the action type to "book_appointment" and provide serviceType, appointmentDate, and appointmentTime. IMPORTANT: In your `reply`, do NOT confirm the booking details yourself. Just say a brief acknowledgment like "Booking your appointment now...", as the system will automatically send an official confirmation template.
`;
}

/**
 * Invokes Gemini API for chat completion.
 */
async function callGemini(apiKey, modelName, systemPrompt, history, lastUserMessage) {
    const genAI = new GoogleGenerativeAI(apiKey);
    
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
            responseMimeType: 'application/json'
        }
    });
    
    const chat = model.startChat({
        history: geminiHistory
    });
    
    const result = await chat.sendMessage(lastUserMessage);
    const responseText = result.response.text();
    
    return JSON.parse(responseText);
}

/**
 * Invokes OpenAI API for chat completion.
 */
async function callOpenAI(apiKey, modelName, systemPrompt, history, lastUserMessage) {
    const openai = new OpenAI({ apiKey });
    
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
        response_format: { type: 'json_object' }
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
