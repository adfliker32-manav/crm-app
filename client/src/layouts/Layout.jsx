import React, { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import useSocket from '../hooks/useSocket';

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

    // ⚠️ Listen for account deletion — auto-logout if admin removes this agent
    const { socket } = useSocket();
    useEffect(() => {
        if (!socket) return;
        const handleAccountDeleted = (data) => {
            alert(data?.message || 'Your account has been removed. You will be logged out.');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/login';
        };
        socket.on('account:deleted', handleAccountDeleted);
        return () => socket.off('account:deleted', handleAccountDeleted);
    }, [socket]);

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
