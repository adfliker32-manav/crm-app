import React, { useState } from 'react';
import SuperAdminSidebar from '../components/SuperAdmin/SuperAdminSidebar';
import DashboardView from '../components/SuperAdmin/DashboardView';
import AgenciesView from '../components/SuperAdmin/AgenciesView';
import DirectClientsView from '../components/SuperAdmin/DirectClientsView';
import AccountApprovalsView from '../components/SuperAdmin/AccountApprovalsView';
import GlobalSettingsView from '../components/SuperAdmin/GlobalSettingsView';
import AuditLogsView from '../components/SuperAdmin/AuditLogsView';
import EmergencyControlsView from '../components/SuperAdmin/EmergencyControlsView';
import SystemHealthView from '../components/SuperAdmin/SystemHealthView';

const SuperAdmin = () => {
    const [activeView, setActiveView] = useState('dashboard');

    const renderView = () => {
        switch (activeView) {
            case 'dashboard':
                return <DashboardView />;
            case 'approvals':
                return <AccountApprovalsView />;
            case 'agencies':
                return <AgenciesView />;
            case 'direct-clients':
                return <DirectClientsView />;
            case 'system-health':
                return <SystemHealthView />;
            case 'audit-logs':
                return <AuditLogsView />;
            case 'emergency-controls':
                return <EmergencyControlsView />;
            case 'settings':
                return <GlobalSettingsView />;
            default:
                return <DashboardView />;
        }
    };

    return (
        <div className="flex h-screen bg-slate-50">
            {/* Sidebar */}
            <SuperAdminSidebar activeView={activeView} setActiveView={setActiveView} />

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="p-8">
                    {renderView()}
                </div>
            </div>
        </div>
    );
};

export default SuperAdmin;
