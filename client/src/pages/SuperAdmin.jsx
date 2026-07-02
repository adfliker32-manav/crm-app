import React, { useState } from 'react';
import SuperAdminSidebar from '../components/SuperAdmin/SuperAdminSidebar';
import DashboardView from '../components/SuperAdmin/DashboardView';
import AgencyManagementModule from '../components/SuperAdmin/AgencyManagementModule';
import DirectClientsView from '../components/SuperAdmin/DirectClientsView';
import GlobalSettingsView from '../components/SuperAdmin/GlobalSettingsView';
import AuditLogsView from '../components/SuperAdmin/AuditLogsView';
import EmergencyControlsView from '../components/SuperAdmin/EmergencyControlsView';
import SystemHealthView from '../components/SuperAdmin/SystemHealthView';
import SupportInboxView from '../components/SuperAdmin/SupportInboxView';
import FinanceView from '../components/SuperAdmin/FinanceView';
import PlanCatalogView from '../components/SuperAdmin/PlanCatalogView';
import CouponView from '../components/SuperAdmin/CouponView';
import WhatsAppInbox from '../components/WhatsApp/WhatsAppInbox';
import EmailInbox from '../components/Email/EmailInbox';
import SuperAdminCommSettings from '../components/SuperAdmin/SuperAdminCommSettings';


const SuperAdmin = () => {
    const [activeView, setActiveView] = useState('dashboard');

    const renderView = () => {
        switch (activeView) {
            case 'dashboard':
                return <DashboardView setActiveView={setActiveView} />;
            case 'agency-management':
                return <AgencyManagementModule />;
            case 'direct-clients':
                return <DirectClientsView />;
            case 'finance':
                return <FinanceView />;
            case 'plans':
                return <PlanCatalogView />;
            case 'coupons':
                return <CouponView />;
            case 'support':
                return <SupportInboxView />;

            case 'wa-inbox':
                return <WhatsAppInbox />;
            case 'email-inbox':
                return <EmailInbox />;
            case 'comm-settings':
                return <SuperAdminCommSettings />;
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

    // Inbox views need full-height, no padding — all other views use the default wrapper
    const isFullScreen = ['wa-inbox', 'email-inbox'].includes(activeView);

    return (
        <div className="flex h-screen bg-slate-50">
            {/* Sidebar */}
            <SuperAdminSidebar activeView={activeView} setActiveView={setActiveView} />

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto">
                {isFullScreen ? (
                    // Full-screen for inbox views — no padding, fills the remaining space
                    <div className="h-full">
                        {renderView()}
                    </div>
                ) : (
                    <div className="p-8">
                        {renderView()}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SuperAdmin;
