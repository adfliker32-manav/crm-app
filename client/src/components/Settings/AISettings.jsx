import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';

const AISettings = () => {
    const { user } = useAuth();
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [status, setStatus] = useState({ online: false, checking: true });
    
    // Config states
    const [provider, setProvider] = useState('gemini');
    const [model, setModel] = useState('gemini-2.5-flash');
    const [agentName, setAgentName] = useState('AI Assistant');
    const [systemPrompt, setSystemPrompt] = useState('');
    const [aiEnabled, setAiEnabled] = useState(false);
    const [aiFallbackEnabled, setAiFallbackEnabled] = useState(false);
    const [aiSupportEnabled, setAiSupportEnabled] = useState(false);
    const [maxTurns, setMaxTurns] = useState(5);
    const [tokensUsed, setTokensUsed] = useState(0);

    // Voice Automation Config
    const [voiceProvider, setVoiceProvider] = useState('vapi');
    const [voiceApiKey, setVoiceApiKey] = useState('');
    const [voiceAgentId, setVoiceAgentId] = useState('');
    const [voiceFromNumber, setVoiceFromNumber] = useState('');

    // Tenants use the global superadmin API key now
    const hasApiKey = true;

    // Test Chat Simulator state
    const [testMessage, setTestMessage] = useState('');
    const [chatMessages, setChatMessages] = useState([
        { sender: 'bot', text: 'Hello! I am your AI assistant. Send me a message to test my qualification logic.' }
    ]);

    // Available models based on provider
    const modelsByProvider = {
        gemini: [
            { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash ✅ (Free — Works Now)' },
            { id: 'gemini-2.5-flash-lite-preview-06-17', name: 'Gemini 2.5 Flash Lite (Preview)' },
            { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite (Legacy)' },
            { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash (Legacy)' },
        ],
        openai: [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Cost-Efficient)' },
            { id: 'gpt-4o', name: 'GPT-4o (Premium Capability)' }
        ]
    };

    // Load current config
    useEffect(() => {
        const fetchSettings = async () => {
            try {
                setLoading(true);
                const response = await api.get('/ai/settings');
                const data = response.data;
                
                setProvider(data.provider || 'gemini');
                setModel(data.model || 'gemini-2.5-flash');
                setAgentName(data.agentName || 'AI Assistant');
                setSystemPrompt(data.systemPrompt || '');
                setAiEnabled(data.aiEnabled || false);
                setAiFallbackEnabled(data.aiFallbackEnabled || false);
                setAiSupportEnabled(data.aiSupportEnabled || false);
                setMaxTurns(data.maxTurns || 5);
                setTokensUsed(data.tokensUsedThisMonth || 0);

                // Voice Automation
                if (data.voiceAutomation) {
                    setVoiceProvider(data.voiceAutomation.provider || 'vapi');
                    setVoiceApiKey(data.voiceAutomation.apiKey || '');
                    setVoiceAgentId(data.voiceAutomation.defaultAgentId || '');
                    setVoiceFromNumber(data.voiceAutomation.fromNumber || '');
                }
            } catch (error) {
                console.error('Failed to load AI settings:', error);
                showError('Failed to load AI Chatbot settings.');
            } finally {
                setLoading(false);
            }
        };

        const checkServiceHealth = async () => {
            try {
                const response = await api.get('/ai/health');
                if (response.data.status === 'OK') {
                    setStatus({ online: true, checking: false });
                } else {
                    setStatus({ online: false, checking: false });
                }
            } catch (error) {
                setStatus({ online: false, checking: false });
            }
        };

        fetchSettings();
        checkServiceHealth();
    }, [showError]);

    // Handle provider toggle and auto-select default model
    const handleProviderChange = (newProvider) => {
        setProvider(newProvider);
        if (newProvider === 'gemini') {
            setModel('gemini-2.5-flash');
        } else {
            setModel('gpt-4o-mini');
        }
    };

    // Save configuration
    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            const payload = {
                provider,
                model,
                agentName,
                systemPrompt,
                aiEnabled,
                aiFallbackEnabled,
                aiSupportEnabled,
                maxTurns,
                voiceAutomation: {
                    provider: voiceProvider,
                    apiKey: voiceApiKey,
                    defaultAgentId: voiceAgentId,
                    fromNumber: voiceFromNumber
                }
            };
            
            await api.put('/ai/settings', payload);
            showSuccess('AI Qualification settings updated successfully!');
        } catch (error) {
            console.error('Failed to save settings:', error);
            showError(error.response?.data?.error || 'Failed to update AI settings.');
        } finally {
            setSaving(false);
        }
    };

    // Send a message inside the Simulator
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!testMessage.trim() || testing) return;

        const userMsg = testMessage.trim();
        setTestMessage('');
        
        // Add message to chat screen
        const updatedChat = [...chatMessages, { sender: 'user', text: userMsg }];
        setChatMessages(updatedChat);
        setTesting(true);

        try {
            // Get conversation history (excluding the first mock welcome message)
            const history = updatedChat
                .slice(1, updatedChat.length - 1)
                .map(m => ({
                    sender: m.sender === 'user' ? 'user' : 'model',
                    text: m.text
                }));

            const response = await api.post('/ai/test', {
                message: userMsg,
                history
            });

            const { reply, action } = response.data;
            
            setChatMessages(prev => [
                ...prev,
                { sender: 'bot', text: reply, action }
            ]);
        } catch (error) {
            console.error('AI test call failed:', error);
            const detail = error.response?.data?.details || error.message;
            setChatMessages(prev => [
                ...prev,
                { sender: 'bot', text: `❌ Test call failed: ${detail}` }
            ]);
        } finally {
            setTesting(false);
        }
    };

    const loadTemplatePrompt = (type) => {
        if (type === 'real_estate') {
            setSystemPrompt(
                "You are a real estate qualification assistant. Your goal is to qualify the customer for a property booking by asking 3 questions, one-by-one:\n" +
                "1. Ask what BHK configuration they are looking for (2BHK, 3BHK, etc).\n" +
                "2. Ask their preferred location or area.\n" +
                "3. Ask their budget range (e.g., ₹50L - ₹1Cr).\n\n" +
                "Be polite and warm. Once they answer all 3 questions, reply that a sales advisor will call them, and trigger the action to change stage to 'Qualified'."
            );
        } else if (type === 'consulting') {
            setSystemPrompt(
                "You are an agency qualification assistant. Your goal is to qualify lead prospects for software services by asking 3 questions:\n" +
                "1. Ask what kind of project they are building (Web app, CRM, Mobile app, SEO).\n" +
                "2. Ask their timeline for launch (e.g. 1 month, 3 months).\n" +
                "3. Ask their approximate budget for the project.\n\n" +
                "Once you gather these three points, set the action to change stage to 'Interested' and notify the agent."
            );
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-slate-50/20">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-blue-500 mb-4"></i>
                <p className="text-slate-500 font-bold">Loading AI configuration...</p>
            </div>
        );
    }

    if (!user?.planFeatures?.aiChatbot) {
        return (
            <div className="flex flex-col items-center justify-center py-32">
                <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center max-w-md">
                    <i className="fa-solid fa-lock text-5xl text-slate-300 mb-6"></i>
                    <h2 className="text-2xl font-bold text-slate-800 mb-2">AI Chatbot is locked</h2>
                    <p className="text-slate-500 mb-6">
                        The Global AI Chatbot feature is only available on the Enterprise plan. Upgrade your subscription to automatically qualify leads and handle support using AI.
                    </p>
                    <button className="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition w-full">
                        Upgrade to Enterprise
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 p-6 lg:p-8">
            
            {/* Form Section - Left */}
            <div className="lg:col-span-7 space-y-6">
                
                {/* Health & Status Dashboard */}
                <div className="bg-slate-50/80 rounded-2xl p-5 border border-slate-100 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-200/50">
                            <i className="fa-solid fa-robot text-2xl text-blue-500"></i>
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800">Qualification Engine Status</h3>
                            <div className="flex items-center gap-2 mt-1">
                                {status.checking ? (
                                    <>
                                        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse"></span>
                                        <span className="text-xs font-semibold text-slate-500">Checking microservice...</span>
                                    </>
                                ) : status.online ? (
                                    <>
                                        <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                                        <span className="text-xs font-bold text-emerald-600">Online & Ready</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping"></span>
                                        <span className="text-xs font-bold text-rose-600">Service Unreachable (Offline)</span>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                    
                    <div className="text-right">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Usage this month</p>
                        <p className="text-xl font-black text-slate-800 mt-0.5">
                            {tokensUsed.toLocaleString()} <span className="text-sm font-bold text-slate-400">/ {user?.planFeatures?.aiMessageLimit?.toLocaleString() || '1,000'} messages</span>
                        </p>
                    </div>
                </div>

                <form onSubmit={handleSave} className="space-y-6">
                    
                    {/* General toggles */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
                        <h3 className="text-base font-bold text-slate-800 border-b border-slate-50 pb-3 flex items-center gap-2">
                            <i className="fa-solid fa-toggle-on text-blue-500"></i> Automation Toggles
                        </h3>
                        
                        {/* Enabled inside flows */}
                        <div className="flex items-start justify-between py-2">
                            <div className="pr-4">
                                <label className="font-bold text-sm text-slate-800 block">Enable AI Nodes in Flows</label>
                                <span className="text-xs text-slate-500 block mt-0.5">Allows using AI qualification blocks inside visual chatbot builder diagrams.</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAiEnabled(!aiEnabled)}
                                className={`w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none flex items-center p-0.5 ${
                                    aiEnabled ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'
                                }`}
                            >
                                <span className="w-5 h-5 rounded-full bg-white shadow-md"></span>
                            </button>
                        </div>

                        {/* Enabled as fallback auto-reply */}
                        <div className="flex items-start justify-between py-2 border-t border-slate-50 pt-4">
                            <div className="pr-4">
                                <label className="font-bold text-sm text-slate-800 block">Enable AI Fallback (Auto-Reply)</label>
                                <span className="text-xs text-slate-500 block mt-0.5">If a WhatsApp message does not match any keyword flow, the AI bot takes over automatically to qualify the lead.</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAiFallbackEnabled(!aiFallbackEnabled)}
                                className={`w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none flex items-center p-0.5 ${
                                    aiFallbackEnabled ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'
                                }`}
                            >
                                <span className="w-5 h-5 rounded-full bg-white shadow-md"></span>
                            </button>
                        </div>

                        {/* Enabled for Support system */}
                        <div className="flex items-start justify-between py-2 border-t border-slate-50 pt-4">
                            <div className="pr-4">
                                <label className="font-bold text-sm text-slate-800 block">Enable AI Support Assistant</label>
                                <span className="text-xs text-slate-500 block mt-0.5">If enabled, the AI handles support tickets initially, answering queries before a human admin takes over.</span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setAiSupportEnabled(!aiSupportEnabled)}
                                className={`w-12 h-6 rounded-full transition-colors duration-200 focus:outline-none flex items-center p-0.5 ${
                                    aiSupportEnabled ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'
                                }`}
                            >
                                <span className="w-5 h-5 rounded-full bg-white shadow-md"></span>
                            </button>
                        </div>
                    </div>

                    {/* LLM Credentials Settings */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-6">
                        <h3 className="text-base font-bold text-slate-800 border-b border-slate-50 pb-3 flex items-center gap-2">
                            <i className="fa-solid fa-key text-blue-500"></i> Provider Credentials
                        </h3>

                        {/* Provider radio selectors */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">AI Engine Provider</label>
                            <div className="grid grid-cols-2 gap-4">
                                <label className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200 ${provider === 'gemini' ? 'border-blue-500 bg-blue-50/20 ring-1 ring-blue-500/50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                                    <input 
                                        type="radio" 
                                        name="provider" 
                                        checked={provider === 'gemini'} 
                                        onChange={() => handleProviderChange('gemini')}
                                        className="text-blue-600 focus:ring-blue-500 h-4 w-4"
                                    />
                                    <div>
                                        <p className="text-sm font-bold text-slate-800">Google Gemini</p>
                                        <p className="text-xs text-slate-500 font-semibold mt-0.5">Free tier, high regional speed</p>
                                    </div>
                                </label>
                                
                                <label className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200 ${provider === 'openai' ? 'border-blue-500 bg-blue-50/20 ring-1 ring-blue-500/50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                                    <input 
                                        type="radio" 
                                        name="provider" 
                                        checked={provider === 'openai'} 
                                        onChange={() => handleProviderChange('openai')}
                                        className="text-blue-600 focus:ring-blue-500 h-4 w-4"
                                    />
                                    <div>
                                        <p className="text-sm font-bold text-slate-800">OpenAI GPT</p>
                                        <p className="text-xs text-slate-500 font-semibold mt-0.5">High logical reasoning</p>
                                    </div>
                                </label>
                            </div>
                        </div>

                        {/* Model & Parameters */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">AI Model</label>
                                <select
                                    value={model}
                                    onChange={(e) => setModel(e.target.value)}
                                    className="w-full p-3.5 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm font-bold text-slate-800"
                                >
                                    {modelsByProvider[provider].map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                            </div>
                            
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Max Conversation Turns</label>
                                <input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={maxTurns}
                                    onChange={(e) => setMaxTurns(parseInt(e.target.value) || 5)}
                                    className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm font-bold text-slate-800"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Agent Prompt Configuration */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-6">
                        <div className="flex items-center justify-between border-b border-slate-50 pb-3">
                            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
                                <i className="fa-solid fa-user-gear text-blue-500"></i> Agent Persona & Prompt
                            </h3>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => loadTemplatePrompt('real_estate')}
                                    className="px-3 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 transition"
                                >
                                    Real Estate Template
                                </button>
                                <button
                                    type="button"
                                    onClick={() => loadTemplatePrompt('consulting')}
                                    className="px-3 py-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 transition"
                                >
                                    Consulting Template
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Agent Display Name</label>
                            <input
                                type="text"
                                value={agentName}
                                onChange={(e) => setAgentName(e.target.value)}
                                placeholder="e.g. Sales Assistant"
                                className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm font-bold text-slate-800"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">System Instructions / Prompt</label>
                            <textarea
                                value={systemPrompt}
                                onChange={(e) => setSystemPrompt(e.target.value)}
                                rows="6"
                                maxLength={1000}
                                placeholder="Describe the steps the AI should follow to qualify the lead. E.g. 'Ask the user for budget and requirements. Once provided, update stage to Qualified.'"
                                className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none shadow-sm text-sm text-slate-700 font-medium leading-relaxed"
                            ></textarea>
                            <div className="flex justify-between items-center mt-2">
                                <p className="text-xs text-slate-400 font-medium">The system automatically appends strict schema controls instructing the AI to output stages and triggers back to the CRM database.</p>
                                <span className={`text-xs font-bold ${systemPrompt.length > 900 ? 'text-red-500' : 'text-slate-400'}`}>{systemPrompt.length}/1000</span>
                            </div>
                        </div>
                    </div>

                    {/* Voice Automation Settings */}
                    <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm space-y-4">
                        <h3 className="text-base font-bold text-slate-800 border-b border-slate-50 pb-3 flex items-center gap-2">
                            <i className="fa-solid fa-phone-volume text-indigo-500"></i> Voice Automation (Option B)
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Provider</label>
                                <select 
                                    value={voiceProvider} 
                                    onChange={(e) => setVoiceProvider(e.target.value)}
                                    className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm font-bold text-slate-700 bg-white"
                                >
                                    <option value="vapi">Vapi.ai (Recommended)</option>
                                    <option value="retell">Retell AI</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">API Key</label>
                                <input
                                    type="password"
                                    value={voiceApiKey}
                                    onChange={(e) => setVoiceApiKey(e.target.value)}
                                    placeholder="Enter secret API Key"
                                    className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm font-bold text-slate-800"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Default Voice Agent ID</label>
                            <input
                                type="text"
                                value={voiceAgentId}
                                onChange={(e) => setVoiceAgentId(e.target.value)}
                                placeholder="e.g. 9b9c9f8a-..."
                                className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm font-bold text-slate-800"
                            />
                            <p className="text-xs text-slate-400 mt-2 font-medium">This Agent ID is used if no specific ID is provided in the automation workflow.</p>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">From Number (Outbound Caller ID)</label>
                            <input
                                type="text"
                                value={voiceFromNumber}
                                onChange={(e) => setVoiceFromNumber(e.target.value)}
                                placeholder="e.g. +14155551234"
                                className="w-full p-3.5 border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm font-bold text-slate-800"
                            />
                            <p className="text-xs text-slate-400 mt-2 font-medium">
                                {voiceProvider === 'retell'
                                    ? 'Your Retell AI phone number — get it from Retell Dashboard → Phone Numbers.'
                                    : 'Your Twilio outbound number linked to Vapi — e.g. +14155551234.'}
                            </p>
                        </div>
                    </div>

                    {/* Actions and Save */}
                    <div className="flex justify-end pt-4">
                        <button
                            type="submit"
                            disabled={saving}
                            className={`bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 ${saving ? 'opacity-70 cursor-wait' : 'hover:-translate-y-0.5'}`}
                        >
                            {saving ? (
                                <>
                                    <i className="fa-solid fa-spinner fa-spin"></i> Saving Settings...
                                </>
                            ) : (
                                <>
                                    <i className="fa-solid fa-circle-check"></i> Save AI Config
                                </>
                            )}
                        </button>
                    </div>

                </form>

            </div>

            {/* Chat simulator panel - Right */}
            <div className="lg:col-span-5">
                <div className="bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border border-slate-800 flex flex-col h-[650px] sticky top-6">
                    
                    {/* Header */}
                    <div className="bg-slate-800/80 p-5 border-b border-slate-800 flex items-center gap-3">
                        <div className="relative">
                            <div className="w-10 h-10 bg-blue-600 rounded-2xl flex items-center justify-center font-bold text-white shadow-inner">
                                <i className="fa-solid fa-robot"></i>
                            </div>
                            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 border-2 border-slate-950 shadow-sm"></span>
                        </div>
                        <div>
                            <h4 className="font-bold text-sm text-white">{agentName}</h4>
                            <p className="text-[10px] font-semibold text-slate-400">Simulator Sandbox</p>
                        </div>
                    </div>

                    {/* Chat Messages Area */}
                    <div className="flex-1 p-5 overflow-y-auto space-y-4 select-none">
                        {chatMessages.map((msg, index) => (
                            <div key={index} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                                <div className={`p-4 rounded-2xl max-w-[85%] text-xs font-semibold leading-relaxed shadow-sm ${
                                    msg.sender === 'user' 
                                    ? 'bg-blue-600 text-white rounded-br-none' 
                                    : msg.text.startsWith('❌') 
                                      ? 'bg-rose-950/40 text-rose-300 border border-rose-900 rounded-bl-none'
                                      : 'bg-slate-800 text-slate-200 rounded-bl-none'
                                }`}>
                                    {msg.text}
                                </div>
                                
                                {/* Qualification Action Alert pill */}
                                {msg.action && (msg.action.type || msg.action.stage || msg.action.tag) && (
                                    <div className="mt-2 flex items-center gap-2 bg-slate-800/80 p-2 rounded-xl border border-slate-700/50 shadow-md">
                                        <span className="p-1 bg-emerald-500/20 text-emerald-400 rounded-lg text-[10px] font-bold">
                                            <i className="fa-solid fa-bolt mr-1"></i> Triggered Action
                                        </span>
                                        <span className="text-[10px] font-black text-slate-300">
                                            {msg.action.type === 'change_stage' && `Stage ➔ ${msg.action.stage}`}
                                            {msg.action.type === 'assign_tag' && `Tag ➔ ${msg.action.tag}`}
                                            {msg.action.type === 'notify_agent' && `Handoff requested`}
                                        </span>
                                    </div>
                                )}
                            </div>
                        ))}
                        
                        {/* Typing / Thinking effect */}
                        {testing && (
                            <div className="flex items-center gap-1.5 p-4 bg-slate-800 text-slate-400 rounded-2xl rounded-bl-none w-fit shadow-sm">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                            </div>
                        )}
                    </div>

                    {/* Chat Input */}
                    <form onSubmit={handleSendMessage} className="p-4 border-t border-slate-800 bg-slate-900 flex items-center gap-3">
                        <input
                            type="text"
                            value={testMessage}
                            onChange={(e) => setTestMessage(e.target.value)}
                            disabled={testing || !hasApiKey}
                            placeholder={hasApiKey ? "Type a response to qualify..." : "Configure key first to test..."}
                            className="flex-1 p-3.5 bg-slate-800 border border-slate-800 rounded-xl outline-none text-white text-xs font-semibold placeholder-slate-500 focus:border-slate-700 transition"
                        />
                        <button
                            type="submit"
                            disabled={testing || !testMessage.trim() || !hasApiKey}
                            className={`p-3.5 rounded-xl text-white font-bold transition flex items-center justify-center ${
                                testing || !testMessage.trim() || !hasApiKey
                                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/35 hover:-translate-y-0.5'
                            }`}
                        >
                            <i className="fa-solid fa-paper-plane"></i>
                        </button>
                    </form>

                </div>
            </div>

        </div>
    );
};

export default AISettings;
