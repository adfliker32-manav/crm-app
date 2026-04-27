/* eslint-disable no-unused-vars, no-empty, no-undef, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const EmergencyControlsView = () => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    
    const [settings, setSettings] = useState({
        DISABLE_WHATSAPP: false,
        DISABLE_EMAILS: false,
        DISABLE_AUTOMATIONS: false
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const res = await api.get('/superadmin/system-settings');
            if (res.data.success && res.data.settings) {
                // Ensure defaults are boolean False if not set
                setSettings({
                    DISABLE_WHATSAPP: !!res.data.settings.DISABLE_WHATSAPP,
                    DISABLE_EMAILS: !!res.data.settings.DISABLE_EMAILS,
                    DISABLE_AUTOMATIONS: !!res.data.settings.DISABLE_AUTOMATIONS
                });
            }
        } catch (error) {
            console.error('Failed to load system settings:', error);
            showError('Failed to sync emergency controls from server');
        } finally {
            setLoading(false);
        }
    };

    const handleToggle = async (key) => {
        const newValue = !settings[key];
        const actionLabel = newValue ? 'ACTIVATE' : 'DEACTIVATE';
        
        let warningMessage = '';
        if (key === 'DISABLE_WHATSAPP') {
            warningMessage = newValue ? "This will instantly STOP all outgoing WhatsApp messages across the entire platform. Users will see errors when trying to send." : "This will REMOVE the block on WhatsApp messages.";
        } else if (key === 'DISABLE_EMAILS') {
            warningMessage = newValue ? "This will instantly STOP all outgoing Emails across the entire platform." : "This will allow Emails to flow normally again.";
        } else if (key === 'DISABLE_AUTOMATIONS') {
            warningMessage = newValue ? "This will instantly HALT all background rules and background jobs for all tenants." : "This will resume Automation processing.";
        }

        const confirmed = await showDanger(
            warningMessage,
            `${actionLabel} Kill Switch?`
        );

        if (!confirmed) return;

        try {
            await api.put('/superadmin/system-settings', {
                settings: {
                    [key]: newValue
                }
            });
            
            setSettings(prev => ({
                ...prev,
                [key]: newValue
            }));
            
            showSuccess(`System config synced! Setting ${key} -> ${newValue}`);
        } catch (error) {
            console.error('Update failed:', error);
            showError('Failed to toggle emergency switch');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-96">
                <i className="fa-solid fa-spinner fa-spin text-4xl text-slate-400"></i>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in-up">
            {/* Header */}
            <div className="flex items-start gap-4 bg-red-50 p-6 rounded-2xl shadow-sm border border-red-200">
                <div className="w-14 h-14 bg-red-600 rounded-2xl flex items-center justify-center text-white shadow-lg shrink-0">
                    <i className="fa-solid fa-triangle-exclamation text-2xl animate-pulse"></i>
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-red-900">Global Emergency Controls</h1>
                    <p className="text-red-700 font-medium mt-1">
                        WARNING: These are true platform-level kill switches. Activating these will instantly disable features for ALL agencies, managers, and agents connected to the system. Bypasses all tenant limits.
                    </p>
                </div>
            </div>

            {/* Switches Container */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                
                {/* 1. WhatsApp Kill Switch */}
                <div className={`p-6 rounded-2xl shadow-lg border transition-all ${settings.DISABLE_WHATSAPP ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div className="flex justify-between items-start mb-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md ${settings.DISABLE_WHATSAPP ? 'bg-amber-500' : 'bg-green-500'}`}>
                            <i className="fa-brands fa-whatsapp text-2xl"></i>
                        </div>
                        <div 
                            onClick={() => handleToggle('DISABLE_WHATSAPP')}
                            className={`w-14 h-8 flex items-center rounded-full p-1 cursor-pointer transition-colors ${settings.DISABLE_WHATSAPP ? 'bg-amber-500' : 'bg-slate-300'}`}
                        >
                            <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform ${settings.DISABLE_WHATSAPP ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">WhatsApp Kill Switch</h3>
                    <p className="text-sm text-slate-500 mb-4">
                         {settings.DISABLE_WHATSAPP ? 
                            <span className="text-amber-700 font-bold">Currently Blocked.</span> : 
                            "Normal operations."} 
                         Use this if Meta bans a webhook or there is a platform-wide WhatsApp malfunction causing spam.
                    </p>
                </div>

                {/* 2. Email Kill Switch */}
                <div className={`p-6 rounded-2xl shadow-lg border transition-all ${settings.DISABLE_EMAILS ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div className="flex justify-between items-start mb-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md ${settings.DISABLE_EMAILS ? 'bg-amber-500' : 'bg-blue-500'}`}>
                            <i className="fa-solid fa-envelope text-2xl"></i>
                        </div>
                        <div 
                            onClick={() => handleToggle('DISABLE_EMAILS')}
                            className={`w-14 h-8 flex items-center rounded-full p-1 cursor-pointer transition-colors ${settings.DISABLE_EMAILS ? 'bg-amber-500' : 'bg-slate-300'}`}
                        >
                            <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform ${settings.DISABLE_EMAILS ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Email Kill Switch</h3>
                    <p className="text-sm text-slate-500 mb-4">
                        {settings.DISABLE_EMAILS ? 
                            <span className="text-amber-700 font-bold">Currently Blocked.</span> : 
                            "Normal operations."} 
                        Instantly freezes all SMTP/Gmail dispatches across the application if the server IP gets blacklisted.
                    </p>
                </div>

                {/* 3. Automation Kill Switch */}
                <div className={`p-6 rounded-2xl shadow-lg border transition-all ${settings.DISABLE_AUTOMATIONS ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200'}`}>
                    <div className="flex justify-between items-start mb-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-md ${settings.DISABLE_AUTOMATIONS ? 'bg-amber-500' : 'bg-purple-600'}`}>
                            <i className="fa-solid fa-robot text-2xl"></i>
                        </div>
                        <div 
                            onClick={() => handleToggle('DISABLE_AUTOMATIONS')}
                            className={`w-14 h-8 flex items-center rounded-full p-1 cursor-pointer transition-colors ${settings.DISABLE_AUTOMATIONS ? 'bg-amber-500' : 'bg-slate-300'}`}
                        >
                            <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform ${settings.DISABLE_AUTOMATIONS ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Automation Kill Switch</h3>
                    <p className="text-sm text-slate-500 mb-4">
                        {settings.DISABLE_AUTOMATIONS ? 
                            <span className="text-amber-700 font-bold">Currently Blocked.</span> : 
                            "Normal operations."} 
                        Pauses the evaluation of all tenant rules and halts the Agenda background queue permanently until released.
                    </p>
                </div>

            </div>
        </div>
    );
};

export default EmergencyControlsView;
