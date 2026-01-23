import React, { useState } from 'react';
import WhatsAppInbox from '../components/WhatsApp/WhatsAppInbox';
import WhatsAppTemplates from '../components/WhatsApp/WhatsAppTemplates';
import WhatsAppSettings from '../components/WhatsApp/WhatsAppSettings';

const WhatsAppManagement = () => {
    const [activeTab, setActiveTab] = useState('inbox'); // Default to inbox

    const renderContent = () => {
        switch (activeTab) {
            case 'inbox': return <WhatsAppInbox />;
            case 'templates': return <WhatsAppTemplates />;
            case 'settings': return <WhatsAppSettings />;
            default: return <WhatsAppInbox />;
        }
    };

    return (
        <div className="h-[calc(100vh-100px)] flex flex-col bg-[#f0f2f5]">
            {/* WhatsApp Web Style Header */}
            <div className="bg-[#008069] text-white shadow-md">
                <div className="px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3">
                            <i className="fa-brands fa-whatsapp text-3xl"></i>
                            <h1 className="text-xl font-semibold">WhatsApp Business</h1>
                        </div>
                    </div>

                    {/* Navigation Tabs */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setActiveTab('inbox')}
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${activeTab === 'inbox'
                                    ? 'bg-white/20 text-white'
                                    : 'text-white/80 hover:bg-white/10'
                                }`}
                        >
                            <i className="fa-solid fa-inbox mr-2"></i>
                            Inbox
                        </button>
                        <button
                            onClick={() => setActiveTab('templates')}
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${activeTab === 'templates'
                                    ? 'bg-white/20 text-white'
                                    : 'text-white/80 hover:bg-white/10'
                                }`}
                        >
                            <i className="fa-solid fa-file-lines mr-2"></i>
                            Templates
                        </button>
                        <button
                            onClick={() => setActiveTab('settings')}
                            className={`px-4 py-2 rounded-lg font-medium transition-all ${activeTab === 'settings'
                                    ? 'bg-white/20 text-white'
                                    : 'text-white/80 hover:bg-white/10'
                                }`}
                        >
                            <i className="fa-solid fa-cog mr-2"></i>
                            Settings
                        </button>
                    </div>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden">
                {renderContent()}
            </div>
        </div>
    );
};

export default WhatsAppManagement;
