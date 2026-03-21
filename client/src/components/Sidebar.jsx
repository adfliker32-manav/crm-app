import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useState, useEffect } from 'react';
import api from '../services/api';

const NavItem = ({ to, icon, label, collapsed, badgeCount = 0 }) => {
    const location = useLocation();
    const isActive = location.pathname.startsWith(to);

    return (
        <Link
            to={to}
            className={`relative flex items-center ${collapsed ? "justify-center" : "gap-3"} 
            px-4 py-2.5 text-sm font-medium transition rounded-md
            ${isActive
                    ? "text-white"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
        >
            {isActive && (
                <span className="absolute left-0 top-1 bottom-1 w-1 bg-blue-500 rounded-r"></span>
            )}

            <i className={`${icon} text-base w-5 text-center`} />

            {!collapsed && label}

            {badgeCount > 0 && !collapsed && (
                <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shadow-lg shadow-orange-500/30">
                    {badgeCount}
                </span>
            )}
            {badgeCount > 0 && collapsed && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>
            )}
        </Link>
    );
};

const Sidebar = () => {
    const { logout, user } = useAuth();
    const { showDanger } = useConfirm();
    const [collapsed, setCollapsed] = useState(true);
    const [appName, setAppName] = useState('CRM Pro');
    const [dueTaskCount, setDueTaskCount] = useState(0);

    const canManageTeam = ['superadmin', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;

    useEffect(() => {
        const fetchAppName = async () => {
            try {
                const res = await api.get('/auth/app-name');
                if (res.data?.success) setAppName(res.data.appName);
            } catch { }
        };

        const fetchDueTasks = async () => {
            try {
                const res = await api.get('/tasks?status=Pending&dateFilter=today');
                setDueTaskCount(res.data?.length || 0);
            } catch { }
        };

        fetchAppName();
        if (user) fetchDueTasks();

        // Optional: refresh notification every 5 minutes
        const interval = setInterval(() => {
            if (user) fetchDueTasks();
        }, 5 * 60 * 1000);

        return () => clearInterval(interval);
    }, [user]);

    const handleLogout = async () => {
        const confirmed = await showDanger("Are you sure you want to logout?", "Confirm Logout");
        if (confirmed) logout();
    };

    return (
        <aside
            className={`${collapsed ? "w-16" : "w-64"} 
            bg-slate-950 border-r border-slate-800 flex flex-col h-screen 
            transition-all duration-300`}
            onMouseEnter={() => setCollapsed(false)}
            onMouseLeave={() => setCollapsed(true)}
        >

            {/* Logo */}
            <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
                {!collapsed && (
                    <h1 className="text-lg font-bold text-white tracking-wide">
                        🚀 {appName}
                    </h1>
                )}
            </div>

            {/* NAV */}
            <nav className="flex-1 overflow-y-auto py-4 space-y-1">

                {(canManageTeam || user?.permissions?.viewDashboard !== false) && (
                    <NavItem collapsed={collapsed} to="/dashboard" icon="fa-solid fa-chart-line" label="Dashboard" badgeCount={dueTaskCount} />
                )}

                {!collapsed && (
                    <p className="text-xs text-slate-500 px-4 mt-6 mb-2 uppercase tracking-wider">Sales</p>
                )}

                {(canManageTeam || user?.permissions?.viewLeads !== false) && (
                    <NavItem collapsed={collapsed} to="/leads" icon="fa-solid fa-users" label="Leads" />
                )}

                {(canManageTeam || user?.permissions?.viewEmails === true || user?.permissions?.viewWhatsApp === true) && !collapsed && (
                    <p className="text-xs text-slate-500 px-4 mt-6 mb-2 uppercase tracking-wider">Inbox</p>
                )}

                {(canManageTeam || user?.permissions?.viewWhatsApp === true) && (
                    <NavItem collapsed={collapsed} to="/whatsapp" icon="fa-brands fa-whatsapp" label="WhatsApp" />
                )}

                {(canManageTeam || user?.permissions?.viewEmails === true) && (
                    <NavItem collapsed={collapsed} to="/email" icon="fa-solid fa-envelope" label="Email" />
                )}

                {(canManageTeam || user?.permissions?.viewReports) && !collapsed && (
                    <p className="text-xs text-slate-500 px-4 mt-6 mb-2 uppercase tracking-wider">Analytics</p>
                )}

                {(canManageTeam || user?.permissions?.viewReports) && (
                    <NavItem collapsed={collapsed} to="/reports" icon="fa-solid fa-chart-pie" label="Reports" />
                )}

                {canManageTeam && !collapsed && (
                    <p className="text-xs text-slate-500 px-4 mt-6 mb-2 uppercase tracking-wider">Admin</p>
                )}

                {canManageTeam && (
                    <NavItem collapsed={collapsed} to="/team" icon="fa-solid fa-user-group" label="Team" />
                )}

                {canManageTeam && (
                    <NavItem collapsed={collapsed} to="/automations" icon="fa-solid fa-robot" label="Automations" />
                )}

            </nav>

            {/* PROFILE */}
            <div className="border-t border-slate-800 p-4">

                <Link to="/settings" className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
                    <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center font-bold text-white">
                        {user?.name?.charAt(0) || 'U'}
                    </div>

                    {!collapsed && (
                        <div>
                            <p className="text-sm font-semibold text-white">{user?.name}</p>
                            <p className="text-xs text-slate-400">{user?.role}</p>
                        </div>
                    )}
                </Link>

                <button
                    onClick={handleLogout}
                    className={`w-full mt-3 text-sm text-slate-400 hover:text-red-400 transition 
                    ${collapsed ? "text-center" : "text-left"}`}
                >
                    <i className="fa-solid fa-right-from-bracket mr-2"></i>
                    {!collapsed && "Logout"}
                </button>

            </div>
        </aside>
    );
};

export default Sidebar;