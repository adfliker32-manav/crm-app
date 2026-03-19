import React, { useState } from 'react';
import WhatsAppInbox from '../components/WhatsApp/WhatsAppInbox';
import WhatsAppTemplates from '../components/WhatsApp/WhatsAppTemplates';
import WhatsAppBroadcasts from '../components/WhatsApp/WhatsAppBroadcasts';
import WhatsAppSettings from '../components/WhatsApp/WhatsAppSettings';
import WhatsAppAnalytics from '../components/WhatsApp/WhatsAppAnalytics';

const WhatsAppManagement = () => {
    const [activeTab, setActiveTab] = useState('inbox');

    const tabs = [
        { id: 'inbox', label: 'Inbox', icon: 'fa-solid fa-inbox' },
        { id: 'templates', label: 'Templates', icon: 'fa-solid fa-file-lines' },
        { id: 'broadcasts', label: 'Broadcasts', icon: 'fa-solid fa-tower-broadcast' },
        { id: 'analytics', label: 'Analytics', icon: 'fa-solid fa-chart-line' },
        { id: 'settings', label: 'Settings', icon: 'fa-solid fa-cog' }
    ];

    const renderContent = () => {
        switch (activeTab) {
            case 'inbox': return <WhatsAppInbox />;
            case 'templates': return <WhatsAppTemplates />;
            case 'broadcasts': return <WhatsAppBroadcasts />;
            case 'analytics': return <WhatsAppAnalytics />;
            case 'settings': return <WhatsAppSettings />;
            default: return <WhatsAppInbox />;
        }
    };

    return (
        <div className="h-[calc(100vh-100px)] flex flex-col bg-[#f0f2f5]">
            {/* Premium Header */}
            <div className="bg-gradient-to-r from-[#008069] to-[#00a884] text-white shadow-lg">
                <div className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/15 rounded-xl flex items-center justify-center backdrop-blur-sm">
                            <i className="fa-brands fa-whatsapp text-2xl"></i>
                        </div>
                        <div>
                            <h1 className="text-lg font-bold">WhatsApp Business</h1>
                            <p className="text-[11px] text-white/70">Cloud API Integration</p>
                        </div>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1 backdrop-blur-sm">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 ${activeTab === tab.id
                                    ? 'bg-white text-[#008069] shadow-sm'
                                    : 'text-white/80 hover:bg-white/10 hover:text-white'
                                }`}
                            >
                                <i className={tab.icon}></i>
                                <span className="hidden sm:inline">{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
                {renderContent()}
            </div>
        </div>
    );
};

export default WhatsAppManagement;
