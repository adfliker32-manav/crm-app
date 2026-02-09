import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useState, useEffect } from 'react';
import api from '../services/api';


const Sidebar = () => {
    const location = useLocation();
    const { logout, user } = useAuth();
    const { showDanger } = useConfirm();
    const currentPath = location.pathname;
    const [appName, setAppName] = useState('CRM Pro');

    useEffect(() => {
        // Fetch app name from Global Settings
        const fetchAppName = async () => {
            try {
                const response = await api.get('/auth/app-name');
                if (response.data.success && response.data.appName) {
                    setAppName(response.data.appName);
                }
            } catch (error) {
                console.error('Failed to fetch app name:', error);
                // Keep default 'CRM Pro'
            }
        };
        fetchAppName();
    }, []);

    // Helper to get classes for active/inactive links
    const getLinkClass = (path) => {
        const baseClass = "flex items-center px-4 py-3 rounded-lg transition font-medium duration-200";
        const activeClass = "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-900/50 transform scale-[1.02]";
        const inactiveClass = "text-slate-400 hover:text-white hover:bg-slate-800 hover:pl-5";

        // Check if current path matches
        const isActive = currentPath === path;
        return isActive ? `${baseClass} ${activeClass}` : `${baseClass} ${inactiveClass}`;
    };

    const handleLogout = async () => {
        const confirmed = await showDanger("Are you sure you want to logout?", "Confirm Logout");
        if (confirmed) {
            logout();
        }
    };

    return (
        <aside className="w-56 bg-slate-900 text-white flex flex-col shadow-2xl z-50 h-full relative">
            {/* Logo Header */}
            <div className="h-16 flex items-center justify-center border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 text-transparent bg-clip-text bg-300% animate-gradient">
                    <i className="fa-solid fa-rocket mr-2 text-blue-400"></i>
                    {appName}
                </h1>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto custom-scrollbar">

                {user?.permissions?.viewDashboard !== false && (
                    <Link to="/dashboard" className={getLinkClass('/dashboard')}>
                        <i className="fa-solid fa-chart-line w-8 text-center"></i>
                        <span>Dashboard</span>
                    </Link>
                )}

                {user?.permissions?.viewLeads !== false && (
                    <Link to="/leads" className={getLinkClass('/leads')}>
                        <i className="fa-solid fa-users w-8 text-center"></i>
                        <span>Leads</span>
                    </Link>
                )}

                {(user?.permissions?.viewEmails !== false || user?.permissions?.viewWhatsApp !== false) && (
                    <div className="pt-3 pb-1">
                        <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Communication</p>
                    </div>
                )}

                {user?.permissions?.viewEmails !== false && (
                    <Link to="/email" className={getLinkClass('/email')}>
                        <i className="fa-solid fa-envelope w-8 text-center"></i>
                        <span>Email Management</span>
                    </Link>
                )}

                {user?.permissions?.viewWhatsApp !== false && (
                    <Link to="/whatsapp" className={getLinkClass('/whatsapp')}>
                        <i className="fa-brands fa-whatsapp w-8 text-center"></i>
                        <span>WhatsApp</span>
                    </Link>
                )}

                {user?.permissions?.manageTeam !== false && (
                    <>
                        <div className="pt-3 pb-1">
                            <p className="px-3 text-[10px] font-bold text-slate-500 uppercase tracking-wider">Admin</p>
                        </div>

                        <Link to="/team" className={getLinkClass('/team')}>
                            <i className="fa-solid fa-users w-8 text-center"></i>
                            <span>Team</span>
                        </Link>

                        <Link to="/reports" className={getLinkClass('/reports')}>
                            <i className="fa-solid fa-chart-pie w-8 text-center"></i>
                            <span>Reports</span>
                        </Link>
                    </>
                )}
            </nav>
            <div className="p-3 border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <Link to="/settings" className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-slate-800/50 border border-slate-700/50 hover:bg-slate-800 transition cursor-pointer group">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-base font-bold shadow-md group-hover:shadow-blue-500/20 transition">
                        👤
                    </div>
                    <div className="overflow-hidden flex-1">
                        <p className="text-xs font-bold text-white truncate">{user?.name || 'User'}</p>
                        <p className="text-[10px] text-blue-300 flex items-center gap-1">
                            {user?.role || 'Admin'}
                            <i className="fa-solid fa-gear text-slate-500 text-[8px] group-hover:text-blue-400 group-hover:rotate-90 transition ml-auto"></i>
                        </p>
                    </div>
                </Link>
                <button onClick={handleLogout} className="w-full group bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white py-2 rounded-lg transition shadow-lg flex items-center justify-center gap-2 font-medium text-sm">
                    <i className="fa-solid fa-right-from-bracket group-hover:translate-x-1 transition-transform text-xs"></i> Logout
                </button>
            </div>
        </aside >
    );
};

export default Sidebar;
