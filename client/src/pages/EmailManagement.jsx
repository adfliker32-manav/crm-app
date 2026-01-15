/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import EmailTemplates from '../components/Email/EmailTemplates';
import EmailInbox from '../components/Email/EmailInbox';
import EmailSettings from '../components/Email/EmailSettings';

const EmailManagement = () => {
    const [activeTab, setActiveTab] = useState('templates');
    const [stats, setStats] = useState({
        today: { sent: 0, failed: 0, automated: { sent: 0 } },
        thisMonth: { sent: 0 }
    });

    const fetchAnalytics = useCallback(async () => {
        try {
            const res = await api.get('/email-logs/analytics');
            setStats(res.data);
        } catch (error) {
            console.error("Error fetching email analytics:", error);
        }
    }, []);

    useEffect(() => {
        fetchAnalytics();
    }, [fetchAnalytics]);

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Header with Analytics */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                    <i className="fa-solid fa-envelope-open-text text-blue-600"></i> Email Management
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                    {/* Sent Today */}
                    <div className="bg-gradient-to-br from-green-500 to-green-600 text-white p-4 rounded-xl shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition">
                            <i className="fa-solid fa-paper-plane text-6xl"></i>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="bg-white/20 p-2 rounded-lg">
                                <i className="fa-solid fa-paper-plane text-xl"></i>
                            </div>
                            <span className="text-sm font-medium bg-white/20 px-2 py-0.5 rounded-full">Today</span>
                        </div>
                        <p className="text-3xl font-bold">{stats.today.sent}</p>
                        <p className="text-xs opacity-80 mt-1">Emails Sent Successfully</p>
                    </div>

                    {/* Failed Today */}
                    <div className="bg-gradient-to-br from-red-500 to-red-600 text-white p-4 rounded-xl shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition">
                            <i className="fa-solid fa-exclamation-circle text-6xl"></i>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="bg-white/20 p-2 rounded-lg">
                                <i className="fa-solid fa-exclamation-circle text-xl"></i>
                            </div>
                            <span className="text-sm font-medium bg-white/20 px-2 py-0.5 rounded-full">Today</span>
                        </div>
                        <p className="text-3xl font-bold">{stats.today.failed}</p>
                        <p className="text-xs opacity-80 mt-1">Emails Failed</p>
                    </div>

                    {/* Sent Month */}
                    <div className="bg-gradient-to-br from-blue-500 to-blue-600 text-white p-4 rounded-xl shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition">
                            <i className="fa-solid fa-calendar text-6xl"></i>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="bg-white/20 p-2 rounded-lg">
                                <i className="fa-solid fa-calendar text-xl"></i>
                            </div>
                            <span className="text-sm font-medium bg-white/20 px-2 py-0.5 rounded-full">This Month</span>
                        </div>
                        <p className="text-3xl font-bold">{stats.thisMonth.sent}</p>
                        <p className="text-xs opacity-80 mt-1">Total Sent</p>
                    </div>

                    {/* Automated Today */}
                    <div className="bg-gradient-to-br from-purple-500 to-purple-600 text-white p-4 rounded-xl shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition">
                            <i className="fa-solid fa-robot text-6xl"></i>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                            <div className="bg-white/20 p-2 rounded-lg">
                                <i className="fa-solid fa-robot text-xl"></i>
                            </div>
                            <span className="text-sm font-medium bg-white/20 px-2 py-0.5 rounded-full">Today</span>
                        </div>
                        <p className="text-3xl font-bold">{stats.today.automated.sent}</p>
                        <p className="text-xs opacity-80 mt-1">Auto-Replies Sent</p>
                    </div>
                </div>
            </div>

            {/* Tabs & Content */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[600px]">
                <div className="flex items-center gap-1 px-6 pt-4 border-b border-slate-200 bg-slate-50">
                    <button
                        onClick={() => setActiveTab('templates')}
                        className={`px-6 py-3 text-sm font-bold border-b-2 rounded-t-lg transition-all ${activeTab === 'templates'
                            ? 'border-red-500 text-red-600 bg-white'
                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                    >
                        <i className="fa-solid fa-envelope mr-2"></i>Templates
                    </button>
                    <button
                        onClick={() => setActiveTab('inbox')}
                        className={`px-6 py-3 text-sm font-bold border-b-2 rounded-t-lg transition-all ${activeTab === 'inbox'
                            ? 'border-red-500 text-red-600 bg-white'
                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                    >
                        <i className="fa-solid fa-inbox mr-2"></i>Inbox & Logs
                    </button>
                    <button
                        onClick={() => setActiveTab('settings')}
                        className={`px-6 py-3 text-sm font-bold border-b-2 rounded-t-lg transition-all ${activeTab === 'settings'
                            ? 'border-red-500 text-red-600 bg-white'
                            : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                            }`}
                    >
                        <i className="fa-solid fa-cog mr-2"></i>Configuration
                    </button>
                </div>

                <div className="p-0">
                    {activeTab === 'templates' && <EmailTemplates />}
                    {activeTab === 'inbox' && <EmailInbox />}
                    {activeTab === 'settings' && <EmailSettings />}
                </div>
            </div>
        </div>
    );
};

export default EmailManagement;
