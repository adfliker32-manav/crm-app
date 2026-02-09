/* eslint-disable react-hooks/set-state-in-effect */
import React, { useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import EmailTemplates from '../components/Email/EmailTemplates';
import EmailInbox from '../components/Email/EmailInbox';
import EmailSettings from '../components/Email/EmailSettings';

const EmailManagement = () => {
    const [activeTab, setActiveTab] = useState('inbox');
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

    const StatCard = ({ title, value, label, icon, color, bgColor }) => (
        <div className="bg-white rounded-2xl p-6 shadow-[0_2px_15px_-3px_rgba(0,0,0,0.07),0_10px_20px_-2px_rgba(0,0,0,0.04)] hover:shadow-lg transition-all duration-300 border border-slate-100 group">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-slate-500 text-sm font-medium mb-1">{title}</p>
                    <h3 className="text-3xl font-bold text-slate-800 tracking-tight">{value}</h3>
                </div>
                <div className={`${bgColor} ${color} p-3 rounded-xl transform group-hover:scale-110 transition-transform duration-300`}>
                    <i className={`fa-solid ${icon} text-lg`}></i>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-50 flex items-center gap-2">
                <span className={`text-xs font-semibold ${color} bg-opacity-10 px-2 py-1 rounded-full ${bgColor}`}>
                    {label}
                </span>
                <span className="text-slate-400 text-xs">updated just now</span>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-slate-50/50 p-8 font-sans space-y-8 animate-fade-in-up">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-800 tracking-tight">Email Center</h1>
                    <p className="text-slate-500 mt-1">Manage templates, track performance, and configure settings</p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-medium border border-emerald-100 flex items-center gap-2">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></span>
                        System Operational
                    </span>
                </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    title="Sent Today"
                    value={stats.today.sent}
                    label="+2.5% vs yesterday"
                    icon="fa-paper-plane"
                    color="text-emerald-600"
                    bgColor="bg-emerald-50"
                />
                <StatCard
                    title="Failed Delivery"
                    value={stats.today.failed}
                    label="Needs attention"
                    icon="fa-circle-exclamation"
                    color="text-rose-500"
                    bgColor="bg-rose-50"
                />
                <StatCard
                    title="Monthly Volume"
                    value={stats.thisMonth.sent}
                    label="Current billing period"
                    icon="fa-chart-line"
                    color="text-blue-600"
                    bgColor="bg-blue-50"
                />
                <StatCard
                    title="Auto-Responses"
                    value={stats.today.automated.sent}
                    label="Triggered automatically"
                    icon="fa-robot"
                    color="text-violet-600"
                    bgColor="bg-violet-50"
                />
            </div>

            {/* Main Content Area */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden h-[calc(100vh-200px)] flex flex-col">
                {/* Modern Tab Navigation */}
                <div className="border-b border-slate-100 px-6 py-4">
                    <div className="flex items-center gap-1 bg-slate-100/50 p-1 rounded-xl w-fit">
                        {[
                            { id: 'templates', label: 'Templates', icon: 'fa-layer-group' },
                            { id: 'inbox', label: 'Inbox & Logs', icon: 'fa-inbox' },
                            { id: 'settings', label: 'Configuration', icon: 'fa-sliders' }
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                                    flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all duration-300
                                    ${activeTab === tab.id
                                        ? 'bg-white text-slate-800 shadow-sm shadow-slate-200'
                                        : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                                    }
                                `}
                            >
                                <i className={`fa-solid ${tab.icon} ${activeTab === tab.id ? 'text-indigo-500' : 'opacity-70'}`}></i>
                                {tab.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Content Container */}
                <div className="flex-1 overflow-hidden">
                    <div className="h-full">
                        {activeTab === 'templates' && <EmailTemplates />}
                        {activeTab === 'inbox' && <EmailInbox />}
                        {activeTab === 'settings' && <EmailSettings />}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmailManagement;
