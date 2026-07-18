import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import PromptBuilderModal from './PromptBuilderModal';

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
    const [aiButtonMappingEnabled, setAiButtonMappingEnabled] = useState(true);
    const [maxTurns, setMaxTurns] = useState(12);
    const [tokensUsed, setTokensUsed] = useState(0);
    // AI credit wallet (shared with voice). Priced via the admin model-rate table.
    const [creditsBalance, setCreditsBalance] = useState(0);
    const [creditsUsed, setCreditsUsed] = useState(0);
    const [usage, setUsage] = useState(null);
    const [ledger, setLedger] = useState([]);
    // Sub-tab within the AI Chatbot page: 'behavior' | 'agent' | 'usage'
    const [activeTab, setActiveTab] = useState('behavior');
    const [showPromptBuilder, setShowPromptBuilder] = useState(false);
    // Soft warning threshold — prompts are allowed well past this (hard cap is
    // enforced server-side), but every character here is resent on every AI
    // reply, so past this point we start telling the customer what it costs.
    const PROMPT_WARN_LENGTH = 1000;
    const PROMPT_MAX_LENGTH = 6000;

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
                // Defaults ON, so treat only an explicit false as off.
                setAiButtonMappingEnabled(data.aiButtonMappingEnabled !== false);
                setMaxTurns(data.maxTurns || 12);
                setTokensUsed(data.tokensUsedThisMonth || 0);
                setCreditsBalance(data.aiCreditsBalance || 0);
                setCreditsUsed(data.aiCreditsUsedThisMonth || 0);
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

        const fetchUsageAndLedger = async () => {
            try {
                const [usageRes, ledgerRes] = await Promise.all([
                    api.get('/ai/usage'),
                    api.get('/ai/ledger?limit=25')
                ]);
                setUsage(usageRes.data);
                setLedger(ledgerRes.data.entries || []);
            } catch (error) {
                // Non-fatal — the settings page still works without the statement.
                console.error('Failed to load AI usage/ledger:', error);
            }
        };

        fetchSettings();
        checkServiceHealth();
        fetchUsageAndLedger();
    }, [showError]);

    // Human labels for ledger feature codes.
    const FEATURE_LABELS = {
        ai_fallback: 'Chatbot (AI reply)',
        ai_rescue: 'Chatbot (AI rescue)',
        ai_node: 'Chatbot (AI node)',
        button_mapping: 'Smart button match',
        ai_classifier: 'AI classifier',
        ai_support: 'AI support',
        test_simulator: 'Test simulator',
        voice: 'Voice call',
        topup: 'Top-up',
        bonus: 'Bonus',
        refund: 'Refund',
        migration: 'Starting balance'
    };
    const featureLabel = (f) => FEATURE_LABELS[f] || f;

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
                aiButtonMappingEnabled,
                maxTurns
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

    // Compact toggle card used in the Configuration tab.
    const renderToggle = (title, desc, value, onClick) => (
        <div className="border border-slate-100 rounded-xl p-4 flex items-start justify-between gap-3 bg-white hover:border-slate-200 transition">
            <div className="pr-1">
                <label className="font-bold text-sm text-slate-800 block">{title}</label>
                <span className="text-xs text-slate-500 block mt-1 leading-snug">{desc}</span>
            </div>
            <button
                type="button"
                onClick={onClick}
                className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none flex items-center p-0.5 ${value ? 'bg-blue-600 justify-end' : 'bg-slate-300 justify-start'}`}
            >
                <span className="w-5 h-5 rounded-full bg-white shadow-md"></span>
            </button>
        </div>
    );

    // Simulator panel — reused beside both config tabs so testing is always visible.
    const simulatorPanel = (
        <div className="bg-slate-900 rounded-3xl overflow-hidden shadow-xl border border-slate-800 flex flex-col h-[540px]">
            <div className="bg-slate-800/80 p-4 border-b border-slate-800 flex items-center gap-3">
                <div className="relative">
                    <div className="w-9 h-9 bg-blue-600 rounded-2xl flex items-center justify-center font-bold text-white shadow-inner">
                        <i className="fa-solid fa-robot text-sm"></i>
                    </div>
                    <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-slate-950"></span>
                </div>
                <div>
                    <h4 className="font-bold text-sm text-white">{agentName}</h4>
                    <p className="text-[10px] font-semibold text-slate-400">Test Simulator</p>
                </div>
            </div>

            <div className="flex-1 p-4 overflow-y-auto space-y-3 select-none">
                {chatMessages.map((msg, index) => (
                    <div key={index} className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`p-3.5 rounded-2xl max-w-[85%] text-xs font-semibold leading-relaxed shadow-sm ${
                            msg.sender === 'user'
                            ? 'bg-blue-600 text-white rounded-br-none'
                            : msg.text.startsWith('❌')
                              ? 'bg-rose-950/40 text-rose-300 border border-rose-900 rounded-bl-none'
                              : 'bg-slate-800 text-slate-200 rounded-bl-none'
                        }`}>
                            {msg.text}
                        </div>
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
                {testing && (
                    <div className="flex items-center gap-1.5 p-4 bg-slate-800 text-slate-400 rounded-2xl rounded-bl-none w-fit shadow-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                )}
            </div>

            <form onSubmit={handleSendMessage} className="p-3 border-t border-slate-800 bg-slate-900 flex items-center gap-2">
                <input type="text" value={testMessage} onChange={(e) => setTestMessage(e.target.value)} disabled={testing || !hasApiKey} placeholder={hasApiKey ? "Type a message to test…" : "Configure key first…"} className="flex-1 p-3 bg-slate-800 border border-slate-800 rounded-xl outline-none text-white text-xs font-semibold placeholder-slate-500 focus:border-slate-700 transition" />
                <button type="submit" disabled={testing || !testMessage.trim() || !hasApiKey} className={`p-3 rounded-xl text-white font-bold transition flex items-center justify-center ${testing || !testMessage.trim() || !hasApiKey ? 'bg-slate-800 text-slate-600 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-md shadow-blue-600/35'}`}>
                    <i className="fa-solid fa-paper-plane"></i>
                </button>
            </form>
        </div>
    );

    // Save button (shared by both config tabs — they share the same form state).
    const saveButton = (
        <div className="flex justify-end">
            <button type="submit" disabled={saving} className={`bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 ${saving ? 'opacity-70 cursor-wait' : 'hover:-translate-y-0.5'}`}>
                {saving ? (<><i className="fa-solid fa-spinner fa-spin"></i> Saving…</>) : (<><i className="fa-solid fa-circle-check"></i> Save Config</>)}
            </button>
        </div>
    );

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
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">

            {/* Compact status bar — always visible above the tabs */}
            <div className="bg-white rounded-2xl px-5 py-4 border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-50 rounded-xl">
                        <i className="fa-solid fa-robot text-blue-500 text-lg"></i>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Qualification Engine</p>
                        <div className="flex items-center gap-2 mt-0.5">
                            {status.checking ? (
                                <><span className="h-2 w-2 rounded-full bg-yellow-400 animate-pulse"></span><span className="text-xs font-bold text-slate-500">Checking…</span></>
                            ) : status.online ? (
                                <><span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span><span className="text-xs font-bold text-emerald-600">Online &amp; Ready</span></>
                            ) : (
                                <><span className="h-2 w-2 rounded-full bg-rose-500 animate-ping"></span><span className="text-xs font-bold text-rose-600">Offline</span></>
                            )}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="text-right">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AI Credit Balance</p>
                        <p className={`text-xl font-black mt-0.5 ${creditsBalance <= 0 ? 'text-rose-600' : creditsBalance < 500 ? 'text-amber-600' : 'text-slate-800'}`}>
                            {creditsBalance.toLocaleString()} <span className="text-xs font-bold text-slate-400">cr</span>
                        </p>
                    </div>
                    <div className="text-right hidden sm:block border-l border-slate-100 pl-6">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Used This Month</p>
                        <p className="text-xl font-black text-slate-700 mt-0.5">{creditsUsed.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            {/* Low / empty balance inline warning (shown on any tab) */}
            {creditsBalance <= 0 ? (
                <div className="mb-4 flex items-center gap-2 text-xs font-bold text-rose-600 bg-rose-50 border border-rose-100 px-4 py-2.5 rounded-xl">
                    <i className="fa-solid fa-triangle-exclamation"></i>
                    Out of credits — AI replies are paused. Contact your administrator to add more.
                </div>
            ) : creditsBalance < 500 ? (
                <div className="mb-4 flex items-center gap-2 text-xs font-bold text-amber-600 bg-amber-50 border border-amber-100 px-4 py-2.5 rounded-xl">
                    <i className="fa-solid fa-circle-exclamation"></i>
                    Low balance — contact your administrator to top up before it runs out.
                </div>
            ) : null}

            {/* Sub-tabs */}
            <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl w-fit mb-5">
                {[
                    { id: 'behavior', icon: 'fa-sliders', label: 'Behavior' },
                    { id: 'agent', icon: 'fa-user-gear', label: 'Agent & Prompt' },
                    { id: 'usage', icon: 'fa-chart-line', label: 'Usage & Credits' }
                ].map(t => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveTab(t.id)}
                        className={`px-4 py-2 rounded-lg text-sm font-bold transition ${activeTab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        <i className={`fa-solid ${t.icon} mr-2`}></i>{t.label}
                    </button>
                ))}
            </div>

            {/* ============ BEHAVIOR TAB ============ */}
            {activeTab === 'behavior' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div className="lg:col-span-7">
                        <form onSubmit={handleSave} className="space-y-4">
                            {/* Automation toggles */}
                            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                                <h3 className="text-sm font-bold text-slate-800 pb-3 flex items-center gap-2">
                                    <i className="fa-solid fa-toggle-on text-blue-500"></i> Automation
                                </h3>
                                <div className="space-y-2.5">
                                    {renderToggle('AI Nodes in Flows', 'Use AI qualification blocks inside the visual chatbot flow builder.', aiEnabled, () => setAiEnabled(!aiEnabled))}
                                    {renderToggle('AI Fallback (Auto-Reply)', 'When a message matches no keyword flow, the AI takes over to qualify the lead.', aiFallbackEnabled, () => setAiFallbackEnabled(!aiFallbackEnabled))}
                                    {renderToggle('Smart Button Matching', 'If a customer types instead of tapping a button, the AI infers which option they meant and continues.', aiButtonMappingEnabled, () => setAiButtonMappingEnabled(!aiButtonMappingEnabled))}
                                </div>
                            </div>

                            {/* AI engine */}
                            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-4">
                                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                    <i className="fa-solid fa-microchip text-blue-500"></i> AI Engine
                                </h3>
                                <div className="grid grid-cols-2 gap-3">
                                    <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition ${provider === 'gemini' ? 'border-blue-500 bg-blue-50/20 ring-1 ring-blue-500/50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                        <input type="radio" name="provider" checked={provider === 'gemini'} onChange={() => handleProviderChange('gemini')} className="text-blue-600 focus:ring-blue-500 h-4 w-4" />
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">Google Gemini</p>
                                            <p className="text-[11px] text-slate-500 font-semibold">Fast, low cost</p>
                                        </div>
                                    </label>
                                    <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer transition ${provider === 'openai' ? 'border-blue-500 bg-blue-50/20 ring-1 ring-blue-500/50' : 'border-slate-200 hover:bg-slate-50'}`}>
                                        <input type="radio" name="provider" checked={provider === 'openai'} onChange={() => handleProviderChange('openai')} className="text-blue-600 focus:ring-blue-500 h-4 w-4" />
                                        <div>
                                            <p className="text-sm font-bold text-slate-800">OpenAI GPT</p>
                                            <p className="text-[11px] text-slate-500 font-semibold">Strong reasoning</p>
                                        </div>
                                    </label>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Model</label>
                                        <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full p-3 border border-slate-300 rounded-xl bg-white focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800 text-sm">
                                            {modelsByProvider[provider].map(m => (
                                                <option key={m.id} value={m.id}>{m.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Max Turns</label>
                                        <input type="number" min="1" max="30" value={maxTurns} onChange={(e) => setMaxTurns(parseInt(e.target.value) || 12)} className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800 text-sm" />
                                        <p className="text-[10px] text-slate-400 font-medium mt-1">Replies before handoff to a human. Recommended: 10–15.</p>
                                    </div>
                                </div>
                            </div>

                            {saveButton}
                        </form>
                    </div>
                    <div className="lg:col-span-5">{simulatorPanel}</div>
                </div>
            )}

            {/* ============ AGENT & PROMPT TAB ============ */}
            {activeTab === 'agent' && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    <div className="lg:col-span-7">
                        <form onSubmit={handleSave} className="space-y-4">
                            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-4">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                        <i className="fa-solid fa-user-gear text-blue-500"></i> Agent &amp; Prompt
                                    </h3>
                                    <button
                                        type="button"
                                        onClick={() => setShowPromptBuilder(true)}
                                        className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-[11px] font-bold text-blue-700 transition flex items-center gap-1.5"
                                    >
                                        <i className="fa-solid fa-wand-magic-sparkles"></i> Build My Prompt with AI
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Agent Display Name</label>
                                    <input type="text" value={agentName} onChange={(e) => setAgentName(e.target.value)} placeholder="e.g. Sales Assistant" className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800 text-sm" />
                                </div>

                                <div>
                                    <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">System Instructions / Prompt</label>
                                    <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} rows="9" maxLength={PROMPT_MAX_LENGTH} placeholder="Describe how the AI should qualify the lead. E.g. 'Ask for budget and requirements. Once provided, update the stage to Qualified.' Or use 'Build My Prompt with AI' above." className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-sm text-slate-700 font-medium leading-relaxed"></textarea>
                                    <div className="flex justify-between items-center mt-1.5">
                                        <p className="text-[11px] text-slate-400 font-medium">Schema controls are appended automatically to write stages &amp; triggers back to the CRM.</p>
                                        <span className={`text-[11px] font-bold ${systemPrompt.length > PROMPT_WARN_LENGTH ? 'text-red-500' : 'text-slate-400'}`}>{systemPrompt.length}/{PROMPT_MAX_LENGTH}</span>
                                    </div>
                                    {systemPrompt.length > PROMPT_WARN_LENGTH && (
                                        <p className="text-[11px] font-bold text-red-500 mt-1.5 flex items-start gap-1.5">
                                            <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
                                            <span>Longer prompts use more AI credits on every single reply — this whole prompt is resent each time the AI responds. Keep it as focused as possible.</span>
                                        </p>
                                    )}
                                </div>
                            </div>

                            {saveButton}
                        </form>
                    </div>
                    <div className="lg:col-span-5">{simulatorPanel}</div>
                </div>
            )}

            <PromptBuilderModal
                isOpen={showPromptBuilder}
                onClose={() => setShowPromptBuilder(false)}
                onApply={(text) => setSystemPrompt(text.substring(0, PROMPT_MAX_LENGTH))}
            />

            {/* ============ USAGE & CREDITS TAB ============ */}
            {activeTab === 'usage' && (
                <div className="space-y-4">
                    {/* Usage summary + forecast */}
                    {usage && (
                        <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                    <i className="fa-solid fa-chart-line text-emerald-500"></i> Usage — This Month
                                </h3>
                                <p className="text-[11px] text-slate-400 font-medium hidden sm:block">1 credit ≈ 100 tokens · heavier models cost more</p>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="bg-slate-50/70 rounded-xl p-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Credits Used</p>
                                    <p className="text-lg font-black text-slate-800 mt-0.5">{(usage.creditsUsed || 0).toLocaleString()}</p>
                                </div>
                                <div className="bg-slate-50/70 rounded-xl p-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">≈ Money</p>
                                    <p className="text-lg font-black text-slate-800 mt-0.5">₹{(usage.moneyUsedInr || 0).toLocaleString()}</p>
                                </div>
                                <div className="bg-slate-50/70 rounded-xl p-3">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tokens</p>
                                    <p className="text-lg font-black text-slate-800 mt-0.5">{((usage.inputTokens || 0) + (usage.outputTokens || 0)).toLocaleString()}</p>
                                </div>
                                <div className="bg-indigo-50/70 rounded-xl p-3">
                                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Forecast (month)</p>
                                    <p className="text-lg font-black text-indigo-700 mt-0.5">
                                        {(usage.forecast?.projectedCredits || 0).toLocaleString()}
                                        <span className="text-xs font-bold text-indigo-400"> · ₹{(usage.forecast?.projectedInr || 0).toLocaleString()}</span>
                                    </p>
                                </div>
                            </div>

                            {(usage.topFeatures?.length > 0 || usage.topModels?.length > 0) && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                                    {usage.topFeatures?.length > 0 && (
                                        <div>
                                            <p className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Top features</p>
                                            <div className="space-y-1.5">
                                                {usage.topFeatures.slice(0, 3).map(f => (
                                                    <div key={f.feature} className="flex items-center justify-between text-xs">
                                                        <span className="font-semibold text-slate-600">{featureLabel(f.feature)}</span>
                                                        <span className="font-bold text-slate-800">{f.credits.toLocaleString()} cr</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {usage.topModels?.length > 0 && (
                                        <div>
                                            <p className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wider">Top models</p>
                                            <div className="space-y-1.5">
                                                {usage.topModels.slice(0, 3).map(m => (
                                                    <div key={m.model} className="flex items-center justify-between text-xs">
                                                        <span className="font-semibold text-slate-600">{m.model}</span>
                                                        <span className="font-bold text-slate-800">{m.credits.toLocaleString()} cr</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Ledger — scrolls inside its own box so the page never scrolls */}
                    <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm">
                        <h3 className="text-sm font-bold text-slate-800 pb-2 flex items-center gap-2">
                            <i className="fa-solid fa-receipt text-slate-500"></i> Credit Ledger
                        </h3>
                        {ledger.length > 0 ? (
                            <div className="overflow-auto max-h-[260px] rounded-lg border border-slate-100">
                                <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-slate-50 z-10">
                                        <tr className="text-left text-slate-400">
                                            <th className="px-3 py-2 font-bold">Date</th>
                                            <th className="px-3 py-2 font-bold">Feature</th>
                                            <th className="px-3 py-2 font-bold">Model</th>
                                            <th className="px-3 py-2 font-bold text-right">Tokens</th>
                                            <th className="px-3 py-2 font-bold text-right">Credits</th>
                                            <th className="px-3 py-2 font-bold text-right">Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {ledger.map((e) => (
                                            <tr key={e._id} className="border-t border-slate-50">
                                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{new Date(e.createdAt).toLocaleDateString()}</td>
                                                <td className="px-3 py-2 font-semibold text-slate-700">{featureLabel(e.feature)}</td>
                                                <td className="px-3 py-2 text-slate-500">{e.model || '—'}</td>
                                                <td className="px-3 py-2 text-right text-slate-500">
                                                    {(e.inputTokens || e.outputTokens) ? `${(e.inputTokens || 0)}/${(e.outputTokens || 0)}` : '—'}
                                                </td>
                                                <td className={`px-3 py-2 text-right font-bold ${e.credits >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                    {e.credits >= 0 ? '+' : ''}{e.credits.toLocaleString()}
                                                </td>
                                                <td className="px-3 py-2 text-right font-semibold text-slate-700">{(e.balanceAfter || 0).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <p className="text-sm text-slate-400 italic py-8 text-center">No credit activity yet. Usage will appear here once the AI starts replying.</p>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default AISettings;
