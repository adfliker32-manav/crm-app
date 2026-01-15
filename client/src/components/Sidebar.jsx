import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';

const Sidebar = () => {
    const location = useLocation();
    const { logout, user } = useAuth();
    const { showDanger } = useConfirm();
    const currentPath = location.pathname;

    // Helper to get classes for active/inactive links
    const getLinkClass = (path) => {
        const baseClass = "flex items-center px-4 py-3 rounded-lg transition font-medium duration-200";
        const activeClass = "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-900/50 transform scale-[1.02]";
        const inactiveClass = "text-slate-400 hover:text-white hover:bg-slate-800 hover:pl-5";

        // Check if current path matches or if it's the root path handling
        const isActive = currentPath === path || (path === '/' && currentPath === '/dashboard');
        return isActive ? `${baseClass} ${activeClass}` : `${baseClass} ${inactiveClass}`;
    };

    const handleLogout = async () => {
        const confirmed = await showDanger("Are you sure you want to logout?", "Confirm Logout");
        if (confirmed) {
            logout();
        }
    };

    return (
        <aside className="w-64 bg-slate-900 text-white flex flex-col shadow-2xl z-50 h-full relative">
            {/* Logo Header */}
            <div className="h-16 flex items-center justify-center border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-blue-400 text-transparent bg-clip-text bg-300% animate-gradient">
                    <i className="fa-solid fa-rocket mr-2 text-blue-400"></i>CRM Pro
                </h1>
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 px-3 py-6 space-y-2 overflow-y-auto custom-scrollbar">
                <Link to="/" className={getLinkClass('/')}>
                    <i className="fa-solid fa-chart-line w-8 text-center"></i>
                    <span>Dashboard</span>
                </Link>

                <Link to="/leads" className={getLinkClass('/leads')}>
                    <i className="fa-solid fa-users w-8 text-center"></i>
                    <span>Leads</span>
                </Link>

                <div className="pt-4 pb-2">
                    <p className="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Communication</p>
                </div>

                <Link to="/email" className={getLinkClass('/email')}>
                    <i className="fa-solid fa-envelope w-8 text-center"></i>
                    <span>Email Management</span>
                </Link>

                <Link to="/whatsapp" className={getLinkClass('/whatsapp')}>
                    <i className="fa-brands fa-whatsapp w-8 text-center"></i>
                    <span>WhatsApp</span>
                </Link>

                <div className="pt-4 pb-2">
                    <p className="px-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Admin</p>
                </div>

                <Link to="/team" className={getLinkClass('/team')}>
                    <i className="fa-solid fa-users w-8 text-center"></i>
                    <span>Team</span>
                </Link>
            </nav>

            {/* User Profile Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                <div className="flex items-center gap-3 mb-4 p-2 rounded-lg bg-slate-800/50 border border-slate-700/50">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-lg font-bold shadow-md">
                        👤
                    </div>
                    <div className="overflow-hidden">
                        <p className="text-sm font-bold text-white truncate">{user?.name || 'User'}</p>
                        <p className="text-xs text-blue-300">{user?.role || 'Admin Account'}</p>
                    </div>
                </div>
                <button onClick={handleLogout} className="w-full group bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 text-white py-2.5 rounded-lg transition shadow-lg flex items-center justify-center gap-2 font-medium">
                    <i className="fa-solid fa-right-from-bracket group-hover:translate-x-1 transition-transform"></i> Logout
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
