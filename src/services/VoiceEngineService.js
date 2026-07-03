const mongoose = require('mongoose');
const axios = require('axios');
const Lead = require('../models/Lead');
const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const VoiceCallLog = require('../models/VoiceCallLog');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require('openai');

class VoiceEngineService {
    /**
     * Executes the Voice Call Action triggered by an automation rule
     */
    async executeCallAction(leadId, tenantId, actionConfig, ruleId = null) {
        try {
            const config = await IntegrationConfig.findOne({ userId: tenantId }).select('+voiceAutomation.apiKey');
            if (!config || !config.voiceAutomation || !config.voiceAutomation.apiKey) {
                console.warn(`[VoiceEngine] No Vapi API key configured for tenant ${tenantId}`);
                return false;
            }

            const lead = await Lead.findById(leadId);
            if (!lead || !lead.phone) {
                console.warn(`[VoiceEngine] Lead ${leadId} not found or missing phone number`);
                return false;
            }

            const { executionMode, basePrompt, agentId } = actionConfig;
            let finalPrompt = basePrompt;
            let aiCreditsConsumed = 0;
            let finalExecutionMode = executionMode || 'static';

            if (executionMode === 'injected') {
                finalPrompt = this._injectVariables(basePrompt, lead);
            } else if (executionMode === 'smart') {
                const user = await User.findById(tenantId);
                if (!user || user.aiCreditsBalance <= 0) {
                    console.warn(`[VoiceEngine] Tenant ${tenantId} has insufficient AI credits. Falling back to injected mode.`);
                    finalExecutionMode = 'injected';
                    finalPrompt = this._injectVariables(basePrompt, lead);
                } else {
                    const { prompt, credits } = await this._generateSmartPrompt(basePrompt, lead, config);
                    finalPrompt = prompt;
                    aiCreditsConsumed = credits;

                    // Deduct credits
                    if (aiCreditsConsumed > 0) {
                        await User.findByIdAndUpdate(tenantId, {
                            $inc: { aiCreditsBalance: -aiCreditsConsumed, aiCreditsUsedThisMonth: aiCreditsConsumed }
                        });
                    }
                }
            }

            // Dispatch to Vapi
            const callResponse = await this._dispatchToVapi(lead.phone, finalPrompt, config.voiceAutomation.apiKey, agentId || config.voiceAutomation.defaultAgentId);
            
            // Log the call in our DB
            await VoiceCallLog.create({
                userId: tenantId,
                leadId: lead._id,
                automationRuleId: ruleId,
                externalCallId: callResponse.id,
                status: 'queued',
                executionMode: finalExecutionMode,
                generatedPrompt: finalPrompt,
                aiCreditsConsumed
            });

            return true;
        } catch (error) {
            console.error(`[VoiceEngine] Failed to execute call action:`, error);
            return false;
        }
    }

    /**
     * Replaces {{variables}} with actual lead data
     * Supported: {{lead.name}}, {{lead.phone}}, {{lead.email}}, {{lead.stage}},
     *            {{lead.company}}, {{lead.source}}, {{lead.assignedManager}},
     *            {{lead.appointmentDate}}
     */
    _injectVariables(prompt, lead) {
        if (!prompt) return '';
        let result = prompt;

        // Core lead fields
        result = result.replace(/{{lead\.name}}/g, lead.name || 'Customer');
        result = result.replace(/{{lead\.phone}}/g, lead.phone || '');
        result = result.replace(/{{lead\.email}}/g, lead.email || '');
        result = result.replace(/{{lead\.stage}}/g, lead.status || lead.stage || '');
        result = result.replace(/{{lead\.source}}/g, lead.source || '');

        // Custom data fields
        result = result.replace(/{{lead\.company}}/g, lead.customData?.company || lead.customData?.Company || '');
        result = result.replace(/{{lead\.assignedManager}}/g, lead.customData?.assignedManager || '');
        result = result.replace(/{{lead\.appointmentDate}}/g, lead.customData?.appointmentDate || lead.appointmentDate || '');
        result = result.replace(/{{lead\.productName}}/g, lead.customData?.productName || lead.customData?.ProductName || '');

        return result;
    }


    /**
     * Calls LLM to generate a hyper-personalized system prompt
     */
    async _generateSmartPrompt(basePrompt, lead, config) {
        try {
            const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // Using platform API key
            
            // In a real scenario, we'd also fetch the WhatsAppConversation history here
            const contextStr = `Lead Name: ${lead.name || 'Unknown'}\nStage: ${lead.stage}\nNotes: ${lead.notes?.join(' | ') || 'None'}`;
            
            const systemMsg = `You are a helpful assistant generating a system prompt for an AI Voice Agent.
Base Instructions for the Voice Agent: "${basePrompt}"
Context about the person being called:
${contextStr}
Task: Write the final, precise system prompt for the Voice Agent. Do not include pleasantries in your output, just the raw system prompt text. Instruct the voice agent to use the context provided.`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [{ role: 'system', content: systemMsg }],
                max_tokens: 500
            });
            
            // Calculate dynamic credits based on token usage. 
            // e.g., 1 credit = 100 tokens. Minimum 1 credit.
            const totalTokens = response.usage?.total_tokens || 100;
            const credits = Math.max(1, Math.ceil(totalTokens / 100));
            
            return { prompt: response.choices[0].message.content, credits };
        } catch (error) {
            console.error('[VoiceEngine] Failed to generate smart prompt, falling back to base prompt:', error);
            return { prompt: basePrompt, credits: 0 };
        }
    }

    /**
     * Makes the HTTP request to Vapi.ai
     */
    async _dispatchToVapi(phone, systemPrompt, vapiApiKey, vapiAgentId) {
        const url = 'https://api.vapi.ai/call/phone';
        const payload = {
            phoneNumber: {
                twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER, // Platform out-bound number
            },
            customer: {
                number: phone,
            },
            assistantId: vapiAgentId,
            assistantOverrides: {
                model: {
                    messages: [
                        { role: 'system', content: systemPrompt }
                    ]
                },
                // Request structured data outcome extraction
                structuredDataPlan: {
                    schema: {
                        type: "object",
                        properties: {
                            outcome: {
                                type: "string",
                                description: "The final business outcome of this call.",
                                enum: ["Appointment Booked", "Interested", "Not Interested", "Callback Requested", "Busy", "Voicemail", "Wrong Number", "Payment Promised", "Follow-up Required", "Other"]
                            }
                        }
                    }
                }
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${vapiApiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        return response.data;
    }

    /**
     * Handles the webhook sent from Vapi when a call ends
     */
    async handleVapiWebhook(webhookData) {
        // Vapi sends 'end-of-call-report' message
        if (webhookData.message?.type === 'end-of-call-report') {
            const call = webhookData.message.call;
            const externalCallId = call.id;
            
            const callLog = await VoiceCallLog.findOne({ externalCallId });
            if (!callLog) {
                console.warn(`[VoiceEngine] Webhook received for unknown call ${externalCallId}`);
                return;
            }

            callLog.status = call.status === 'completed' ? 'completed' : 'failed';
            callLog.durationSeconds = call.endedAt && call.startedAt ? 
                Math.round((new Date(call.endedAt) - new Date(call.startedAt)) / 1000) : 0;
            
            callLog.recordingUrl = webhookData.message.recordingUrl || null;
            callLog.transcript = webhookData.message.transcript || null;
            callLog.summary = webhookData.message.summary || null;
            
            // Extract structured outcome if present
            if (webhookData.message.analysis?.structuredData?.outcome) {
                callLog.outcome = webhookData.message.analysis.structuredData.outcome;
            } else if (call.status === 'no-answer' || call.status === 'busy' || call.status === 'failed') {
                callLog.outcome = 'No Answer / Failed';
            }

            await callLog.save();

            // Trigger Automation Continuation
            if (callLog.outcome && callLog.automationRuleId) {
                const AutomationService = require('./AutomationService');
                await AutomationService.continueWorkflowAfterVoice(callLog);
            }
        }
    }
}

module.exports = new VoiceEngineService();
