/* eslint-disable no-unused-vars */
import React, { useState } from 'react';
import WhatsAppSettings from '../WhatsApp/WhatsAppSettings';
import EmailSettings from '../Email/EmailSettings';

/**
 * SuperAdminCommSettings
 *
 * A thin two-tab wrapper that gives the Super Admin access to the identical
 * WhatsApp and Email settings UI that regular admins use.
 *
 * The Super Admin connects their own WABA ID / Phone Number ID / Auth Token via
 * the WhatsApp tab and their SMTP / Gmail credentials via the Email tab.
 * Credentials are stored in IntegrationConfig keyed by their userId — the
 * same mechanism used for all tenant accounts. No new routes or controllers needed.
 */
const SuperAdminCommSettings = () => {
    const [activeTab, setActiveTab] = useState('whatsapp');

    const tabs = [
        {
            id: 'whatsapp',
            label: 'WhatsApp',
            icon: 'fa-brands fa-whatsapp',
            activeClass: 'border-emerald-500 text-emerald-600',
            badgeColor: 'bg-emerald-100 text-emerald-700'
        },
        {
            id: 'email',
            label: 'Email / SMTP',
            icon: 'fa-solid fa-envelope',
            activeClass: 'border-blue-500 text-blue-600',
            badgeColor: 'bg-blue-100 text-blue-700'
        }
    ];

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
                        <i className="fa-solid fa-satellite-dish text-white text-xl"></i>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Communication Setup</h1>
                        <p className="text-sm text-slate-500">
                            Connect your WhatsApp Business Account and Email for automated billing notifications &amp; direct inbox access.
                        </p>
                    </div>
                </div>

                {/* Info card */}
                <div className="mt-5 bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3">
                    <i className="fa-solid fa-circle-info text-indigo-500 mt-0.5 text-lg flex-shrink-0"></i>
                    <div className="text-sm text-indigo-700 space-y-1">
                        <p className="font-semibold">How this works</p>
                        <ul className="list-disc pl-4 space-y-1 text-indigo-600">
                            <li>
                                <strong>WhatsApp:</strong> Enter your WABA ID, Phone Number ID, and Auth Token — exactly the same as any other account in the system.
                            </li>
                            <li>
                                <strong>Email:</strong> Connect Gmail or configure a custom SMTP server for sending billing notifications.
                            </li>
                            <li>
                                Once configured, open the <strong>WhatsApp Inbox</strong> or <strong>Email Inbox</strong> from the sidebar to manage conversations directly.
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                {/* Tab bar */}
                <div className="flex border-b border-slate-200 bg-slate-50">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex-1 flex items-center justify-center gap-2.5 px-6 py-4 font-semibold text-sm border-b-2 transition-all duration-200 ${
                                activeTab === tab.id
                                    ? `${tab.activeClass} bg-white`
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-white/60'
                            }`}
                        >
                            <i className={`${tab.icon} text-base`}></i>
                            {tab.label}
                            {activeTab === tab.id && (
                                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${tab.badgeColor}`}>
                                    Active
                                </span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Tab content — renders the real settings components untouched */}
                <div className="min-h-[500px]">
                    {activeTab === 'whatsapp' && (
                        <WhatsAppSettings />
                    )}
                    {activeTab === 'email' && (
                        <EmailSettings />
                    )}
                </div>
            </div>
        </div>
    );
};

export default SuperAdminCommSettings;
