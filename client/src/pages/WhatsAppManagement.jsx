import React, { useState } from 'react';
import StatCard from '../components/Dashboard/StatCard';
import WhatsAppTemplates from '../components/WhatsApp/WhatsAppTemplates';
import WhatsAppInbox from '../components/WhatsApp/WhatsAppInbox';
import WhatsAppSettings from '../components/WhatsApp/WhatsAppSettings';

const WhatsAppManagement = () => {
    const [activeTab, setActiveTab] = useState('templates');
    // Initialize stats directly instead of using useEffect
    const [stats] = useState({
        sentToday: 0,
        failedToday: 0,
        sentMonth: 0,
        autoToday: 0
    });

    const renderTabContent = () => {
        switch (activeTab) {
            case 'templates': return <WhatsAppTemplates />;
            case 'inbox': return <WhatsAppInbox />;
            case 'settings': return <WhatsAppSettings />;
            default: return <WhatsAppTemplates />;
        }
    };

    return (
        <div className="space-y-6 animate-fade-in-up">
            {/* Header / Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <StatCard title="Sent Today" value={stats.sentToday} icon="fa-brands fa-whatsapp" gradient="bg-gradient-to-br from-green-500 to-green-600" subtext="Messages Sent" />
                <StatCard title="Failed Today" value={stats.failedToday} icon="fa-exclamation-circle" gradient="bg-gradient-to-br from-red-500 to-red-600" subtext="Messages Failed" />
                <StatCard title="This Month" value={stats.sentMonth} icon="fa-calendar" gradient="bg-gradient-to-br from-blue-500 to-blue-600" subtext="Total Sent" />
                <StatCard title="Auto Today" value={stats.autoToday} icon="fa-robot" gradient="bg-gradient-to-br from-purple-500 to-purple-600" subtext="Automated Sent" />
            </div>

            {/* Navigation & Actions */}
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 flex flex-col md:flex-row justify-between items-center gap-4">
                <div className="flex gap-2">
                    <button
                        onClick={() => setActiveTab('templates')}
                        className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'templates' ? 'bg-green-50 text-green-600 border border-green-200' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        <i className="fa-solid fa-file-lines mr-2"></i>Templates
                    </button>
                    <button
                        onClick={() => setActiveTab('inbox')}
                        className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'inbox' ? 'bg-green-50 text-green-600 border border-green-200' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        <i className="fa-solid fa-inbox mr-2"></i>Inbox
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`px-4 py-2 rounded-lg font-medium transition ${activeTab === 'settings' ? 'bg-green-50 text-green-600 border border-green-200' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        <i className="fa-solid fa-cog mr-2"></i>Settings
                    </button>
                </div>
                <button className="bg-green-600 hover:bg-green-700 text-white px-5 py-2.5 rounded-lg text-sm font-semibold transition shadow-md flex items-center gap-2">
                    <i className="fa-solid fa-plus"></i> New Template
                </button>
            </div>

            {/* Tab Content */}
            <div className="bg-slate-50 rounded-xl min-h-[500px] border border-slate-200">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default WhatsAppManagement;
