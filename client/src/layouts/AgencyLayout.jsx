import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import AgencySidebar from '../components/AgencySidebar';

const AgencyLayout = () => {
    useEffect(() => {
        // Background Pre-fetching for Agency Portal
        const preloadAgencyModules = () => {
            // These dynamic imports tell the browser to download these chunks in the background
            import('../pages/Agency/AgencyDashboard');
            import('../pages/Agency/AgencyClients');
            import('../pages/Agency/AgencyWhiteLabel');
        };

        // Delay pre-fetching for optimized initial dashboard rendering
        const timer = setTimeout(preloadAgencyModules, 2000);
        return () => clearTimeout(timer);
    }, []);

    return (
        <div className="flex h-screen bg-[#06080F] overflow-hidden font-sans">
            {/* Dedicated Reseller Sidebar */}
            <AgencySidebar />

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
                
                <main className="flex-1 overflow-y-auto p-4 md:p-8 relative scroll-smooth font-sans">
                    <Outlet />
                </main>
            </div>
        </div>
    );
};

export default AgencyLayout;
