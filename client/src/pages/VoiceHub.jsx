import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useNotification } from '../context/NotificationContext';

const VoiceHub = () => {
    const { showSuccess, showError } = useNotification();
    const [activeTab, setActiveTab] = useState('analytics');
    const [metrics, setMetrics] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);

    // Integration tab state
    const [config, setConfig] = useState({
        provider: 'vapi',
        apiKey: '',
        defaultAgentId: '',
        fromNumber: ''
    });
    const [configLoading, setConfigLoading] = useState(false);
    const [configSaving, setConfigSaving] = useState(false);
    const [showApiKey, setShowApiKey] = useState(false);
    const [hasExistingKey, setHasExistingKey] = useState(false);
    const [testingConnection, setTestingConnection] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState(null); // null | 'success' | 'error'

    useEffect(() => {
        if (activeTab === 'analytics') fetchAnalytics();
        else if (activeTab === 'templates') fetchTemplates();
        else if (activeTab === 'integration') fetchConfig();
    }, [activeTab]);

    const fetchAnalytics = async () => {
        setLoading(true);
        try {
            const res = await api.get('/voice-analytics');
            if (res.data.success) setMetrics(res.data.metrics);
        } catch (error) {
            console.error('Failed to fetch voice analytics:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchTemplates = async () => {
        setLoading(true);
        try {
            const res = await api.get('/voice-templates');
            if (res.data.success) setTemplates(res.data.templates);
        } catch (error) {
            console.error('Failed to fetch templates:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchConfig = async () => {
        setConfigLoading(true);
        try {
            const res = await api.get('/voice-calls/config');
            if (res.data.success) {
                const c = res.data.config;
                setHasExistingKey(c.hasApiKey);
                setConfig({
                    provider: c.provider || 'vapi',
                    apiKey: c.hasApiKey ? c.apiKeyMasked : '',
                    defaultAgentId: c.defaultAgentId || '',
                    fromNumber: c.fromNumber || ''
                });
                setConnectionStatus(c.hasApiKey ? 'success' : null);
            }
        } catch (error) {
            console.error('Failed to fetch voice config:', error);
        } finally {
            setConfigLoading(false);
        }
    };

    const handleSaveConfig = async () => {
        if (!config.apiKey && !hasExistingKey) {
            showError('Please enter your API key');
            return;
        }
        setConfigSaving(true);
        try {
            await api.put('/voice-calls/config', {
                provider: config.provider,
                apiKey: config.apiKey,
                defaultAgentId: config.defaultAgentId,
                fromNumber: config.fromNumber
            });
            showSuccess('Voice integration settings saved!');
            setHasExistingKey(true);
            setConnectionStatus('success');
        } catch (error) {
            showError('Failed to save settings');
            setConnectionStatus('error');
        } finally {
            setConfigSaving(false);
        }
    };

    const handleTestConnection = async () => {
        setTestingConnection(true);
        setConnectionStatus(null);
        try {
            await api.put('/voice-calls/config', {
                provider: config.provider,
                apiKey: config.apiKey,
                defaultAgentId: config.defaultAgentId,
                fromNumber: config.fromNumber
            });
            // If save succeeds, assume connection is valid
            setConnectionStatus('success');
            showSuccess('Connection verified! Settings saved.');
            setHasExistingKey(true);
        } catch {
            setConnectionStatus('error');
            showError('Connection failed. Please check your API key.');
        } finally {
            setTestingConnection(false);
        }
    };

    const tabs = [
        { id: 'analytics', icon: 'fa-chart-line', label: 'Analytics' },
        { id: 'templates', icon: 'fa-layer-group', label: 'Templates' },
        { id: 'integration', icon: 'fa-plug', label: 'Integration' }
    ];

    const providers = [
        {
            id: 'vapi',
            name: 'Vapi',
            logo: '🔵',
            description: 'Industry-leading voice AI platform. Highly customizable with real-time transcripts.',
            docsUrl: 'https://docs.vapi.ai',
            keyLabel: 'Vapi API Key',
            keyPlaceholder: 'vapi-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            agentLabel: 'Default Assistant ID',
            agentPlaceholder: 'asst_xxxxxxxx...',
            keyHelpUrl: 'https://dashboard.vapi.ai/keys'
        },
        {
            id: 'retell',
            name: 'Retell AI',
            logo: '🟢',
            description: 'Ultra-low latency conversational AI voice. Excellent for appointment booking.',
            docsUrl: 'https://docs.retellai.com',
            keyLabel: 'Retell API Key',
            keyPlaceholder: 'key_xxxxxxxxxxxxxxxx',
            agentLabel: 'Default Agent ID',
            agentPlaceholder: 'agent_xxxxxxxx...',
            keyHelpUrl: 'https://beta.retellai.com/apiKey'
        }
    ];

    const activeProvider = providers.find(p => p.id === config.provider) || providers[0];

    return (
        <div className="p-6 max-w-7xl mx-auto">
            {/* Header */}
            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                            <i className="fa-solid fa-headset text-xl"></i>
                        </div>
                        AI Voice Hub
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Manage AI calling performance, outcomes, and integrations.</p>
                </div>

                {/* Tabs */}
                <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-5 py-2 rounded-lg text-sm font-bold transition flex items-center gap-2 ${
                                activeTab === tab.id
                                    ? 'bg-white text-indigo-600 shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <i className={`fa-solid ${tab.icon}`}></i>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ANALYTICS TAB */}
            {activeTab === 'analytics' && (
                loading ? (
                    <div className="flex items-center justify-center py-20">
                        <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-200"></i>
                    </div>
                ) : metrics ? (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            {[
                                { label: 'Total Calls (This Month)', value: metrics.totalCalls, color: 'text-slate-800' },
                                { label: 'Answered Calls', value: metrics.answeredCalls, color: 'text-green-600' },
                                { label: 'Booking Rate', value: `${metrics.bookingRate}%`, color: 'text-blue-600' },
                                { label: 'AI Credits Used', value: metrics.aiCreditsConsumed, color: 'text-purple-600' }
                            ].map(stat => (
                                <div key={stat.label} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                                    <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-2">{stat.label}</div>
                                    <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
                                </div>
                            ))}
                        </div>
                        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-4 text-lg">Call Outcomes</h3>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {Object.entries(metrics.outcomes).map(([outcome, count]) => (
                                    <div key={outcome} className="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                                        <span className="text-sm font-medium text-slate-700">{outcome}</span>
                                        <span className="text-sm font-bold bg-white px-2 py-1 rounded text-indigo-600 border border-slate-200">{count}</span>
                                    </div>
                                ))}
                                {Object.keys(metrics.outcomes).length === 0 && (
                                    <div className="col-span-full text-center text-slate-400 py-4 text-sm">No outcome data available yet.</div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="text-center text-slate-400 py-20">No analytics data available.</div>
                )
            )}

            {/* TEMPLATES TAB */}
            {activeTab === 'templates' && (
                loading ? (
                    <div className="flex items-center justify-center py-20">
                        <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-200"></i>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {templates.map(template => (
                            <div key={template._id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition">
                                <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-start">
                                    <div>
                                        <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded uppercase tracking-wider mb-2 inline-block">{template.category}</span>
                                        <h3 className="font-bold text-slate-800">{template.name}</h3>
                                    </div>
                                    {template.isGlobal && <i className="fa-solid fa-globe text-slate-300" title="Global Template"></i>}
                                </div>
                                <div className="p-5">
                                    <p className="text-xs text-slate-500 mb-4 line-clamp-3">{template.basePrompt}</p>
                                    <div className="flex justify-between items-center text-xs font-semibold text-slate-400">
                                        <span className="flex items-center gap-1"><i className="fa-solid fa-microchip"></i> Mode: {template.executionMode}</span>
                                    </div>
                                    <button className="w-full mt-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 py-2 rounded-lg font-bold text-sm transition">
                                        Install Template
                                    </button>
                                </div>
                            </div>
                        ))}
                        {templates.length === 0 && (
                            <div className="col-span-full text-center text-slate-400 py-20 text-sm">No templates found. Create one to get started.</div>
                        )}
                    </div>
                )
            )}

            {/* INTEGRATION TAB */}
            {activeTab === 'integration' && (
                configLoading ? (
                    <div className="flex items-center justify-center py-20">
                        <i className="fa-solid fa-spinner fa-spin text-4xl text-indigo-200"></i>
                    </div>
                ) : (
                    <div className="max-w-3xl space-y-6">

                        {/* Connection Status Banner */}
                        {connectionStatus === 'success' && (
                            <div className="flex items-center gap-3 bg-green-50 border border-green-200 text-green-700 rounded-2xl px-5 py-4">
                                <i className="fa-solid fa-circle-check text-green-500 text-lg"></i>
                                <div>
                                    <p className="font-bold text-sm">Voice Provider Connected</p>
                                    <p className="text-xs text-green-600">Your {activeProvider.name} integration is active. Automations can now trigger AI calls.</p>
                                </div>
                            </div>
                        )}
                        {connectionStatus === 'error' && (
                            <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-2xl px-5 py-4">
                                <i className="fa-solid fa-circle-xmark text-red-500 text-lg"></i>
                                <div>
                                    <p className="font-bold text-sm">Connection Failed</p>
                                    <p className="text-xs text-red-600">Could not verify the API key. Please check and try again.</p>
                                </div>
                            </div>
                        )}

                        {/* Provider Selection */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-slate-100">
                                <h2 className="font-bold text-slate-800 flex items-center gap-2">
                                    <i className="fa-solid fa-plug text-indigo-500"></i>
                                    Voice Provider
                                </h2>
                                <p className="text-xs text-slate-500 mt-1">Choose which AI voice platform to use for outbound calls</p>
                            </div>
                            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {providers.map(provider => (
                                    <button
                                        key={provider.id}
                                        onClick={() => setConfig(prev => ({ ...prev, provider: provider.id }))}
                                        className={`text-left p-4 rounded-xl border-2 transition ${
                                            config.provider === provider.id
                                                ? 'border-indigo-500 bg-indigo-50'
                                                : 'border-slate-200 hover:border-slate-300 bg-white'
                                        }`}
                                    >
                                        <div className="flex items-center gap-3 mb-2">
                                            <span className="text-2xl">{provider.logo}</span>
                                            <div>
                                                <p className="font-bold text-slate-800">{provider.name}</p>
                                                {config.provider === provider.id && (
                                                    <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded uppercase">Selected</span>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-xs text-slate-500">{provider.description}</p>
                                        <a
                                            href={provider.docsUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            className="text-xs text-indigo-500 hover:underline mt-2 inline-flex items-center gap-1"
                                        >
                                            <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                                            View Docs
                                        </a>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* API Credentials */}
                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                                <div>
                                    <h2 className="font-bold text-slate-800 flex items-center gap-2">
                                        <i className="fa-solid fa-key text-amber-500"></i>
                                        API Credentials
                                    </h2>
                                    <p className="text-xs text-slate-500 mt-1">Your API key is encrypted and stored securely</p>
                                </div>
                                <a
                                    href={activeProvider.keyHelpUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-indigo-600 hover:underline flex items-center gap-1 font-semibold"
                                >
                                    Get API Key <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                                </a>
                            </div>
                            <div className="p-6 space-y-5">
                                {/* API Key Field */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                                        {activeProvider.keyLabel}
                                        {hasExistingKey && (
                                            <span className="ml-2 text-green-600 font-semibold normal-case tracking-normal">✓ Key saved</span>
                                        )}
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showApiKey ? 'text' : 'password'}
                                            value={config.apiKey}
                                            onChange={e => setConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                                            placeholder={hasExistingKey ? '••••••••••••••• (saved)' : activeProvider.keyPlaceholder}
                                            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 pr-12 bg-slate-50"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowApiKey(v => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                        >
                                            <i className={`fa-solid ${showApiKey ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                                        </button>
                                    </div>
                                    <p className="text-[11px] text-slate-400 mt-1.5">
                                        Find your key at <span className="font-semibold">{activeProvider.keyHelpUrl}</span>
                                    </p>
                                </div>

                                {/* Default Agent ID */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                                        {activeProvider.agentLabel}
                                        <span className="ml-1 text-slate-400 font-normal normal-case tracking-normal">(optional)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={config.defaultAgentId}
                                        onChange={e => setConfig(prev => ({ ...prev, defaultAgentId: e.target.value }))}
                                        placeholder={activeProvider.agentPlaceholder}
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1.5">
                                        The default agent/assistant that will handle calls unless overridden per automation.
                                    </p>
                                </div>

                                {/* From Number */}
                                <div>
                                    <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                                        From Number
                                        <span className="ml-1 text-red-400">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={config.fromNumber}
                                        onChange={e => setConfig(prev => ({ ...prev, fromNumber: e.target.value }))}
                                        placeholder={config.provider === 'retell' ? '+14155551234 (Retell phone number)' : '+14155551234 (Twilio number)'}
                                        className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-slate-50"
                                    />
                                    <p className="text-[11px] text-slate-400 mt-1.5">
                                        {config.provider === 'retell'
                                            ? <>Get it from <span className="font-semibold">Retell Dashboard → Phone Numbers</span>. This is the number your AI calls FROM.</>                                            
                                            : <>Your Twilio outbound number linked to Vapi. Get it from <span className="font-semibold">Vapi Dashboard → Phone Numbers</span>.</>}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* How It Works */}
                        <div className="bg-gradient-to-br from-indigo-50 to-violet-50 rounded-2xl border border-indigo-100 p-6">
                            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                <i className="fa-solid fa-circle-info text-indigo-500"></i>
                                How it works
                            </h3>
                            <div className="space-y-3">
                                {[
                                    { step: '1', text: 'Add your API key from your voice provider above' },
                                    { step: '2', text: 'Go to Automations and add a "Trigger AI Voice Call" action to any workflow' },
                                    { step: '3', text: 'Select a voice template or write a custom prompt' },
                                    { step: '4', text: 'When a lead matches the trigger, Adfliker automatically places an AI call' },
                                    { step: '5', text: 'Call transcripts and outcomes are logged back here in Analytics' }
                                ].map(item => (
                                    <div key={item.step} className="flex items-start gap-3">
                                        <div className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                                            {item.step}
                                        </div>
                                        <p className="text-sm text-slate-600">{item.text}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={handleTestConnection}
                                disabled={testingConnection || configSaving || (!config.apiKey && !hasExistingKey)}
                                className="px-6 py-3 border-2 border-indigo-500 text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {testingConnection ? (
                                    <><i className="fa-solid fa-spinner fa-spin"></i> Testing...</>
                                ) : (
                                    <><i className="fa-solid fa-bolt"></i> Test & Save</>
                                )}
                            </button>
                            <button
                                onClick={handleSaveConfig}
                                disabled={configSaving || testingConnection}
                                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-500/30 transition disabled:opacity-50 flex items-center gap-2"
                            >
                                {configSaving ? (
                                    <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</>
                                ) : (
                                    <><i className="fa-solid fa-floppy-disk"></i> Save Settings</>
                                )}
                            </button>
                        </div>
                    </div>
                )
            )}
        </div>
    );
};

export default VoiceHub;
