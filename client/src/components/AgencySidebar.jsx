import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import api from '../services/api';

const NavItem = ({ to, icon, label, collapsed }) => {
    const location = useLocation();
    const isActive = location.pathname.startsWith(to);

    return (
        <Link
            to={to}
            className={`relative flex items-center ${collapsed ? "justify-center" : "gap-3"} 
            px-4 py-3 text-sm font-medium transition rounded-xl mx-2
            ${isActive
                    ? "text-blue-400 bg-blue-950/30 font-semibold"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
        >
            {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-1 bg-blue-500 rounded-r"></span>
            )}
            <i className={`${icon} ${collapsed ? 'text-lg' : 'text-base w-5 text-center'}`} />
            {!collapsed && label}
        </Link>
    );
};

const AgencySidebar = () => {
    const { logout, user } = useAuth();
    const { showDanger } = useConfirm();
    const [collapsed, setCollapsed] = useState(false);
    const [appName, setAppName] = useState('CRM Pro');

    useEffect(() => {
        const fetchAppName = async () => {
            try {
                const res = await api.get('/auth/app-name');
                if (res.data?.success) setAppName(res.data.appName);
            } catch { }
        };
        fetchAppName();
    }, []);

    const handleLogout = async () => {
        const confirmed = await showDanger("Are you sure you want to logout?", "Confirm Logout");
        if (confirmed) logout();
    };

    return (
        <aside
            className={`${collapsed ? "w-20" : "w-64"} 
            bg-[#0B0F19] border-r border-slate-800/60 flex flex-col h-screen 
            transition-all duration-300 shadow-2xl z-50`}
        >
            {/* Header / Logo block */}
            <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800/60 transition-all">
                {!collapsed ? (
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <i className="fa-solid fa-briefcase text-white text-sm"></i>
                        </div>
                        <span className="font-bold text-white tracking-wide text-lg">Agency</span>
                    </div>
                ) : (
                    <div className="w-full flex justify-center">
                        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                            <i className="fa-solid fa-briefcase text-white text-sm"></i>
                        </div>
                    </div>
                )}
            </div>

            {/* Navigation Links */}
            <nav className="flex-1 overflow-y-auto py-6 space-y-1 custom-scrollbar">
                
                {!collapsed && (
                    <p className="text-[10px] text-slate-500 px-6 mt-2 mb-3 uppercase tracking-widest font-bold">Reseller Overview</p>
                )}
                <NavItem collapsed={collapsed} to="/agency/dashboard" icon="fa-solid fa-chart-network" label="Analytics" />
                
                {!collapsed && (
                    <p className="text-[10px] text-slate-500 px-6 mt-6 mb-3 uppercase tracking-widest font-bold">Client Management</p>
                )}
                <NavItem collapsed={collapsed} to="/agency/clients" icon="fa-solid fa-buildings" label="Clients & Sub-accounts" />
                
                {!collapsed && (
                    <p className="text-[10px] text-slate-500 px-6 mt-6 mb-3 uppercase tracking-widest font-bold">Platform Settings</p>
                )}
                <NavItem collapsed={collapsed} to="/agency/white-label" icon="fa-solid fa-palette" label="White-Label" />

            </nav>

            {/* Bottom Profile / Collapse Toggle */}
            <div className="border-t border-slate-800/60 p-4 space-y-2 bg-[#080B13]">
                <button 
                    onClick={() => setCollapsed(!collapsed)}
                    className="w-full flex items-center justify-center py-2 text-slate-500 hover:text-white transition rounded-xl hover:bg-slate-800"
                >
                    <i className={`fa-solid ${collapsed ? 'fa-angles-right' : 'fa-angles-left'}`}></i>
                </button>

                <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between"} p-2 rounded-xl bg-slate-900/50 border border-slate-800/50`}>
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-indigo-600 flex items-center justify-center font-bold text-white shadow-inner">
                            {user?.name?.charAt(0) || 'A'}
                        </div>
                        {!collapsed && (
                            <div className="overflow-hidden">
                                <p className="text-sm font-semibold text-white truncate w-28">{user?.name}</p>
                                <p className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider">Agency Admin</p>
                            </div>
                        )}
                    </div>
                    
                    {!collapsed && (
                        <button onClick={handleLogout} className="text-slate-400 hover:text-red-400 p-2 rounded-lg hover:bg-slate-800 transition" title="Logout">
                            <i className="fa-solid fa-power-off"></i>
                        </button>
                    )}
                </div>
            </div>
        </aside>
    );
};

export default AgencySidebar;
