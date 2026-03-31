import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

const Layout = () => {
    useEffect(() => {
        // Background Pre-fetching Strategy: 
        // Load heavy segments after the dashboard is already interactive
        const preloadCoreModules = () => {
            // These dynamic imports tell the browser to download these chunks in the background
            import('../pages/Leads');
            import('../pages/WhatsAppManagement');
            import('../pages/EmailManagement');
            import('../pages/Team');
            import('../pages/Automations');
            import('../pages/Settings');
            import('../pages/Reports');
        };

        // Delay pre-fetching by 2 seconds to ensure primary dashboard assets have priority
        const timer = setTimeout(preloadCoreModules, 2000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="flex h-screen bg-slate-900 overflow-hidden font-sans">
            {/* Sidebar */}
            <Sidebar />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-100">
                <main className="flex-1 overflow-y-auto p-4 md:p-6 relative scroll-smooth flex flex-col font-sans">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default Layout;
