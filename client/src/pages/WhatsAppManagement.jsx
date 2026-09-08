import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import WhatsAppInbox from '../components/WhatsApp/WhatsAppInbox';
import WhatsAppTemplates from '../components/WhatsApp/WhatsAppTemplates';
import WhatsAppBroadcasts from '../components/WhatsApp/WhatsAppBroadcasts';
import WhatsAppSettings from '../components/WhatsApp/WhatsAppSettings';
import WhatsAppAnalytics from '../components/WhatsApp/WhatsAppAnalytics';
import ChatbotFlows from '../components/WhatsApp/ChatbotFlows';
import ChatbotFlowBuilder from '../components/WhatsApp/ChatbotFlowBuilder';
import MediaLibrary from '../components/WhatsApp/MediaLibrary';
import KnowledgeBase from '../components/WhatsApp/KnowledgeBase';
import AISettings from '../components/Settings/AISettings';
import FeatureGate from '../components/FeatureGate';
import { hasEntitlement } from '../utils/entitlements';

// Which partner module each tab requires (PA-H2). The SuperAdmin "Module
// Access" grid writes these keys onto PartnerApp.allowedModules; without this
// mapping they were never read by anything and every embed user reached the
// full surface regardless of what the partner had been sold.
//
// Server-side the same grant is enforced by the embed clamp in authMiddleware —
// this only decides what to draw.
const EMBED_TAB_MODULE = {
    inbox:      'whatsapp',
    chatbot:    'whatsapp_chatbot',
    templates:  'whatsapp_templates',
    media:      'whatsapp',
    broadcasts: 'whatsapp_broadcasts',
    analytics:  'whatsapp_analytics',
    settings:   'whatsapp'
};

const WhatsAppManagement = ({ embedded = false, embedUser = null }) => {
    const { user: contextUser } = useAuth();
    // In embed mode AuthContext is empty by design — the embed session lives
    // under its own storage keys (see api.js) and is handed down as a prop.
    const user = embedded ? embedUser : contextUser;

    // The partner's grant. Absent (older embed token) → fall back to the
    // WhatsApp core only, rather than silently granting everything.
    const embedModules = embedded
        ? (Array.isArray(user?.allowedModules) ? user.allowedModules : ['whatsapp'])
        : null;

    const canManageTeam = embedded || ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    // Plan entitlement for the AI layer (sub-feature). The flow builder is free
    // with WhatsApp; only the AI Chatbot draws a plan feature → gate it separately.
    const aiChatbotEntitled = hasEntitlement(user, 'whatsapp.chatbot.ai');
    // The RAG knowledge base is its own paid sub-feature (it spends AI credits on
    // every upload and every retrieval), so it carries a separate entitlement.
    const knowledgeBaseEntitled = hasEntitlement(user, 'whatsapp.chatbot.knowledgeBase');
    // An embed user must still hold the base WhatsApp module — `embedded` alone
    // is no longer a blanket "yes".
    const canViewWhatsApp = embedded
        ? embedModules.includes('whatsapp')
        : (canManageTeam || user?.permissions?.viewWhatsApp === true);

    const [activeTab, setActiveTab] = useState('inbox');
    const [editingFlowId, setEditingFlowId] = useState(null);
    // Sub-view inside the Chatbot tab: the visual flow builder ('flows') or the
    // AI qualification settings ('ai') — moved here out of Organization Settings
    // so everything chatbot-related lives in one place.
    const [chatbotView, setChatbotView] = useState('flows');

    const hasModule = (moduleName) => {
        if (embedded) {
            // Was `return true` — the line that made the partner's entire module
            // configuration decorative.
            if (moduleName === 'chatbot') return embedModules.includes('whatsapp_chatbot');
            return embedModules.includes(moduleName);
        }
        if (['superadmin', 'agency'].includes(user?.role)) return true;
        if (moduleName === 'chatbot') {
            // The WhatsApp chatbot / visual flow builder is FREE and available to anyone
            // with the WhatsApp module. The premium AI (LLM) layer is gated separately by
            // planFeatures.aiChatbot (see AISettings + the runtime AI node/fallback), so
            // disabling AI no longer hides the builder. Mirrors requireModule('chatbot').
            const mods = user?.activeModules || [];
            return mods.includes('chatbot') || mods.includes('whatsapp');
        }
        return user?.activeModules ? user.activeModules.includes(moduleName) : true;
    };

    const tabs = [
        { id: 'inbox', label: 'Inbox', icon: 'fa-solid fa-inbox' },
        hasModule('chatbot') && { id: 'chatbot', label: 'Chatbot', icon: 'fa-solid fa-robot' },
        { id: 'templates', label: 'Templates', icon: 'fa-solid fa-file-lines' },
        { id: 'media', label: 'Media', icon: 'fa-solid fa-photo-film' },
        { id: 'broadcasts', label: 'Broadcasts', icon: 'fa-solid fa-tower-broadcast' },
        { id: 'analytics', label: 'Analytics', icon: 'fa-solid fa-chart-line' },
        { id: 'settings', label: 'Settings', icon: 'fa-solid fa-cog' }
    ]
        // In embed mode, drop every tab the partner wasn't granted. Outside
        // embed mode this is a no-op — normal sessions keep their existing tabs.
        .filter(t => t && (!embedded || embedModules.includes(EMBED_TAB_MODULE[t.id])));

    if (!canViewWhatsApp) {
        // An embed session has nowhere to navigate to — it is a standalone page
        // inside someone else's product, and /dashboard would 404 the iframe.
        if (embedded) {
            return (
                <div className="h-full w-full flex items-center justify-center bg-slate-50">
                    <div className="text-center max-w-sm px-6">
                        <i className="fa-solid fa-lock text-3xl text-slate-300 mb-3" />
                        <p className="text-slate-500 text-sm">
                            WhatsApp is not enabled for this account. Contact your CRM provider.
                        </p>
                    </div>
                </div>
            );
        }
        return <Navigate to="/dashboard" replace />;
    }

    // State can hold a tab that the grant no longer includes (e.g. the partner's
    // modules changed between sessions) — fall back to the first allowed tab
    // rather than rendering a panel the API will refuse to serve.
    const effectiveTab = tabs.some(t => t.id === activeTab) ? activeTab : tabs[0]?.id;

    const renderContent = () => {
        switch (effectiveTab) {
            case 'inbox': return <WhatsAppInbox />;
            case 'media': return <div className="h-full overflow-y-auto"><MediaLibrary /></div>;
            case 'chatbot': {
                // Fullscreen flow builder takes over the whole area (no sub-tabs).
                if (editingFlowId) {
                    return <ChatbotFlowBuilder flowId={editingFlowId} onBack={() => setEditingFlowId(null)} />;
                }
                // AI Settings is workspace-level config — keep it manager-only, matching
                // its old home in Organization Settings (accessSettings). Line agents with
                // viewWhatsApp still get the flow builder, just not the AI config.
                const chatbotSubTabs = [
                    { id: 'flows', label: 'Flows',       icon: 'fa-diagram-project' },
                    canManageTeam && { id: 'ai', label: 'AI Settings', icon: 'fa-wand-magic-sparkles' },
                    // Knowledge base is workspace-level AI config like AI Settings —
                    // it decides what the bot tells every customer, so it stays
                    // manager-only rather than being editable by a line agent.
                    canManageTeam && { id: 'knowledge', label: 'Knowledge Base', icon: 'fa-book' },
                ].filter(Boolean);
                // Defensive: never render AI settings for a non-manager, even if state drifts.
                const showAi = canManageTeam && chatbotView === 'ai';
                const showKnowledge = canManageTeam && chatbotView === 'knowledge';
                return (
                    <div className="h-full flex flex-col">
                        {/* Chatbot sub-navigation: Flows | AI Settings */}
                        <div className="flex items-center gap-2 px-6 py-3 bg-white border-b border-slate-200">
                            {chatbotSubTabs.map(st => {
                                // Show the AI Settings / Knowledge Base tabs even when the plan
                                // doesn't include them (soft paywall) — a lock hints the upsell;
                                // the wall sells it.
                                const locked = (st.id === 'ai' && !aiChatbotEntitled)
                                    || (st.id === 'knowledge' && !knowledgeBaseEntitled);
                                return (
                                    <button
                                        key={st.id}
                                        onClick={() => setChatbotView(st.id)}
                                        className={`px-6 py-3 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-all duration-200 ${
                                            chatbotView === st.id
                                                ? 'bg-[#008069] text-white shadow-lg shadow-black/25 ring-2 ring-[#05cd99] scale-105'
                                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                                        }`}
                                    >
                                        <i className={`fa-solid ${st.icon}`}></i>
                                        {st.label}
                                        {locked && <i className="fa-solid fa-lock text-[9px] opacity-70" />}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex-1 overflow-hidden">
                            {showKnowledge ? (
                                // Sub-feature gate: unlocked → knowledge base; locked → upgrade wall.
                                <FeatureGate feature="whatsapp.chatbot.knowledgeBase" featureLabel="Knowledge Base" source="sub-feature">
                                    <KnowledgeBase />
                                </FeatureGate>
                            ) : !showAi
                                ? <ChatbotFlows onEditFlow={(id) => setEditingFlowId(id)} />
                                : (
                                    // Sub-feature gate: unlocked → AI settings; locked → upgrade wall.
                                    <FeatureGate feature="whatsapp.chatbot.ai" featureLabel="AI Chatbot" source="sub-feature">
                                        <div className="h-full overflow-y-auto bg-slate-50">
                                            <div className="p-6 border-b border-slate-100 bg-white">
                                                <h2 className="text-xl font-bold text-slate-800">AI Chatbot Qualification Settings</h2>
                                                <p className="text-sm text-slate-500 mt-1">Configure your automated lead qualification AI bot powered by Adfliker AI.</p>
                                            </div>
                                            <div className="p-6">
                                                <AISettings />
                                            </div>
                                        </div>
                                    </FeatureGate>
                                )}
                        </div>
                    </div>
                );
            }
            case 'templates': return <WhatsAppTemplates />;
            case 'broadcasts':
                // Broadcast = bulk campaigns → plan sub-feature (soft paywall).
                return (
                    <FeatureGate feature="whatsapp.broadcast" featureLabel="Broadcast" source="sub-feature">
                        <WhatsAppBroadcasts />
                    </FeatureGate>
                );
            case 'analytics': return <WhatsAppAnalytics />;
            case 'settings': return <WhatsAppSettings />;
            default: return <WhatsAppInbox />;
        }
    };

    // The negative margins cancel the main app layout's page padding so the
    // inbox can run edge-to-edge. An embed has NO such padding — there the same
    // margins dragged the UI outside the iframe (up under the "Powered by" bar
    // and off both sides). `h-screen` is wrong there too: the embed reserves
    // space for that bar, so a hard 100vh overflows the frame by its height.
    // Fill the parent instead and let the embed decide how tall that is.
    const shellClass = embedded
        ? 'h-full w-full flex flex-col bg-[#f0f2f5] overflow-hidden'
        : '-mx-4 md:-mx-6 -my-4 md:-my-6 h-screen flex flex-col bg-[#f0f2f5] overflow-hidden';

    return (
        <div className={shellClass}>
            {/* Premium Vibrant Header */}
            {!(effectiveTab === 'chatbot' && editingFlowId) && (
                <div className="bg-gradient-to-r from-[#008069] via-[#00a884] to-[#05cd99] text-white shadow-xl z-20 relative overflow-hidden">
                    {/* Subtle pattern overlay */}
                    <div className="absolute inset-0 opacity-10 pointer-events-none" 
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }}>
                    </div>
                    
                    <div className={`px-6 ${effectiveTab === 'inbox' ? 'py-2' : 'py-4'} flex items-center justify-between relative z-10`}>
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-md shadow-inner border border-white/20">
                                <i className="fa-brands fa-whatsapp text-3xl drop-shadow-md"></i>
                            </div>
                            <div>
                                <h1 className="text-xl font-extrabold tracking-tight">WhatsApp Business</h1>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse shadow-[0_0_8px_rgba(74,222,128,0.8)]"></span>
                                    <p className="text-[11px] font-semibold text-white/80 uppercase tracking-widest">Cloud API Active</p>
                                </div>
                            </div>
                        </div>

                        {/* Navigation Tabs - Modern Floating Style */}
                        <div className="flex items-center gap-1.5 bg-black/10 backdrop-blur-xl rounded-2xl p-1.5 border border-white/10 shadow-lg">
                            {tabs.map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all duration-300 flex items-center gap-2.5 relative group ${effectiveTab === tab.id
                                        ? 'bg-white text-[#008069] shadow-lg shadow-black/25 ring-2 ring-white scale-110'
                                        : 'text-white/80 hover:bg-white/15 hover:text-white hover:scale-102'
                                    }`}
                                >
                                    <i className={`${tab.icon} ${effectiveTab === tab.id ? 'text-[#008069]' : 'text-white/70 group-hover:text-white'} text-sm`}></i>
                                    <span className="hidden lg:inline">{tab.label}</span>
                                    {effectiveTab === tab.id && (
                                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-[#008069] rounded-full"></span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {renderContent()}
            </div>
        </div>
    );
};

export default WhatsAppManagement;
