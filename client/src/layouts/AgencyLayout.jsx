import { Outlet } from 'react-router-dom';
import AgencySidebar from '../components/AgencySidebar';

const AgencyLayout = () => {
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
