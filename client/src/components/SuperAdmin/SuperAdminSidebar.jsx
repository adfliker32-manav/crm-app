import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import useSocket from '../../hooks/useSocket';

const SuperAdminSidebar = ({ activeView, setActiveView }) => {
    const navigate = useNavigate();
    const { logout } = useAuth();
    const { socket } = useSocket();
    const [supportUnread, setSupportUnread] = useState(0);

    useEffect(() => {
        const fetchUnread = () => {
            api.get('/support/admin/unread')
                .then(r => setSupportUnread(r.data.unreadCount || 0))
                .catch(() => {});
        };
        fetchUnread();
        const interval = setInterval(fetchUnread, 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!socket) return;
        const bump = () => setSupportUnread(c => c + 1);
        const recount = () => {
            api.get('/support/admin/unread').then(r => setSupportUnread(r.data.unreadCount || 0)).catch(() => {});
        };
        socket.on('support:newTicket', bump);
        socket.on('support:newMessage', recount);
        socket.on('support:ticketClosed', recount);
        return () => {
            socket.off('support:newTicket', bump);
            socket.off('support:newMessage', recount);
            socket.off('support:ticketClosed', recount);
        };
    }, [socket]);

    useEffect(() => {
        if (activeView === 'support') setSupportUnread(0);
    }, [activeView]);

    const menuItems = [
        { id: 'dashboard',          icon: 'fa-chart-line',             label: 'Dashboard',           color: 'text-blue-600'  },
        { id: 'approvals',          icon: 'fa-shield-check',           label: 'Account Approvals',   color: 'text-amber-600 font-semibold' },
        { id: 'agencies',           icon: 'fa-network-wired',          label: 'Agencies',            color: 'text-purple-600' },
        { id: 'direct-clients',     icon: 'fa-user-tie',               label: 'Direct Clients',      color: 'text-emerald-600' },
        { id: 'finance',            icon: 'fa-sack-dollar',            label: 'Finance',             color: 'text-emerald-500 font-bold' },
        { id: 'plans',              icon: 'fa-layer-group',            label: 'Plan Catalog',        color: 'text-indigo-500 font-semibold' },
        { id: 'coupons',            icon: 'fa-tag',                    label: 'Coupon Codes',        color: 'text-pink-500 font-semibold' },
        { id: 'support',            icon: 'fa-life-ring',              label: 'Support Inbox',       color: 'text-orange-500', badge: supportUnread },
        { id: 'system-health',      icon: 'fa-heartbeat',              label: 'System Health',       color: 'text-cyan-500'  },
        { id: 'audit-logs',         icon: 'fa-terminal',               label: 'Command Center',      color: 'text-rose-500'  },
        { id: 'emergency-controls', icon: 'fa-triangle-exclamation',   label: 'Emergency Controls',  color: 'text-red-500 font-bold bg-red-900/20' },
        { id: 'settings',           icon: 'fa-cog',                    label: 'Global Settings',     color: 'text-slate-600' },
    ];


    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="w-64 h-screen sticky top-0 bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col shadow-2xl">
            {/* Header */}
            <div className="p-6 border-b border-slate-700 flex-shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center shadow-lg">
                        <i className="fa-solid fa-crown text-white text-lg"></i>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold">Super Admin</h2>
                        <p className="text-xs text-slate-400">Control Panel</p>
                    </div>
                </div>
            </div>

            {/* Navigation Menu — overflow-y so items scroll inside the sidebar
                rather than spilling and clipping the Logout footer on short viewports */}
            <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
                {menuItems.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => setActiveView(item.id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${activeView === item.id
                            ? 'bg-white text-slate-900 shadow-lg transform scale-105'
                            : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                            }`}
                    >
                        <i className={`fa-solid ${item.icon} ${activeView === item.id ? item.color : ''}`}></i>
                        <span className="font-medium">{item.label}</span>
                        {item.badge > 0 && (
                            <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                                {item.badge}
                            </span>
                        )}
                        {activeView === item.id && !item.badge && (
                            <i className="fa-solid fa-chevron-right ml-auto text-sm"></i>
                        )}
                    </button>
                ))}
            </nav>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-700 flex-shrink-0">
                <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-red-400 hover:bg-red-900 hover:text-white transition"
                >
                    <i className="fa-solid fa-sign-out-alt"></i>
                    <span className="font-medium">Logout</span>
                </button>
            </div>
        </div>
    );
};

export default SuperAdminSidebar;
