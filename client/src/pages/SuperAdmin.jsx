import React, { useState } from 'react';
import SuperAdminSidebar from '../components/SuperAdmin/SuperAdminSidebar';
import DashboardView from '../components/SuperAdmin/DashboardView';
import CompaniesView from '../components/SuperAdmin/CompaniesView';
import BillingView from '../components/SuperAdmin/BillingView';

const SuperAdmin = () => {
    const [activeView, setActiveView] = useState('dashboard');

    const renderView = () => {
        switch (activeView) {
            case 'dashboard':
                return <DashboardView />;
            case 'companies':
                return <CompaniesView />;
            case 'billing':
                return <BillingView />;
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
