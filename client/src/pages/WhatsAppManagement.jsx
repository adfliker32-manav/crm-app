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

const WhatsAppManagement = () => {
    const { user } = useAuth();
    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;
    const canViewWhatsApp = canManageTeam || user?.permissions?.viewWhatsApp === true;

    const [activeTab, setActiveTab] = useState('inbox');
    const [editingFlowId, setEditingFlowId] = useState(null);

    const hasModule = (moduleName) => {
        if (['superadmin', 'agency'].includes(user?.role)) return true;
        return user?.activeModules ? user.activeModules.includes(moduleName) : true;
    };

    const tabs = [
        { id: 'inbox', label: 'Inbox', icon: 'fa-solid fa-inbox' },
        hasModule('chatbot') && { id: 'chatbot', label: 'Chatbot', icon: 'fa-solid fa-robot' },
        { id: 'templates', label: 'Templates', icon: 'fa-solid fa-file-lines' },
        { id: 'broadcasts', label: 'Broadcasts', icon: 'fa-solid fa-tower-broadcast' },
        { id: 'analytics', label: 'Analytics', icon: 'fa-solid fa-chart-line' },
        { id: 'settings', label: 'Settings', icon: 'fa-solid fa-cog' }
    ].filter(Boolean);

    if (!canViewWhatsApp) return <Navigate to="/dashboard" replace />;

    const renderContent = () => {
        switch (activeTab) {
            case 'inbox': return <WhatsAppInbox />;
            case 'chatbot': 
                if (editingFlowId) {
                    return <ChatbotFlowBuilder flowId={editingFlowId} onBack={() => setEditingFlowId(null)} />;
                }
                return <ChatbotFlows onEditFlow={(id) => setEditingFlowId(id)} />;
            case 'templates': return <WhatsAppTemplates />;
            case 'broadcasts': return <WhatsAppBroadcasts />;
            case 'analytics': return <WhatsAppAnalytics />;
            case 'settings': return <WhatsAppSettings />;
            default: return <WhatsAppInbox />;
        }
    };

    return (
        <div className={`${activeTab === 'chatbot' && editingFlowId ? 'h-screen' : 'h-[calc(100vh-100px)]'} flex flex-col bg-[#f0f2f5] overflow-hidden`}>
            {/* Premium Vibrant Header */}
            {!(activeTab === 'chatbot' && editingFlowId) && (
                <div className="bg-gradient-to-r from-[#008069] via-[#00a884] to-[#05cd99] text-white shadow-xl z-20 relative overflow-hidden">
                    {/* Subtle pattern overlay */}
                    <div className="absolute inset-0 opacity-10 pointer-events-none" 
                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")` }}>
                    </div>
                    
                    <div className="px-6 py-4 flex items-center justify-between relative z-10">
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
                                    className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all duration-300 flex items-center gap-2.5 relative group ${activeTab === tab.id
                                        ? 'bg-white text-[#008069] shadow-md scale-105'
                                        : 'text-white/80 hover:bg-white/15 hover:text-white hover:scale-102'
                                    }`}
                                >
                                    <i className={`${tab.icon} ${activeTab === tab.id ? 'text-[#008069]' : 'text-white/70 group-hover:text-white'} text-sm`}></i>
                                    <span className="hidden lg:inline">{tab.label}</span>
                                    {activeTab === tab.id && (
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
