import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useState, useEffect } from 'react';
import api from '../services/api';
import useSocket from '../hooks/useSocket';
import { hasEntitlement } from '../utils/entitlements';

const NavItem = ({ to, icon, label, collapsed, badgeCount = 0, alsoMatch = [], locked = false }) => {
    const location = useLocation();
    // `alsoMatch` lets one nav item stay highlighted across sibling paths that
    // render the same page (e.g. Automation hub served at /automations & /workflows).
    const isActive = location.pathname.startsWith(to)
        || alsoMatch.some(p => location.pathname.startsWith(p));

    return (
        <Link
            to={to}
            title={locked ? `${label} — not in your plan` : label}
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

            <i className={`${icon} text-base w-5 text-center ${locked ? 'opacity-60' : ''}`} />

            {!collapsed && <span className={locked ? 'opacity-60' : ''}>{label}</span>}

            {/* Locked (not in plan) → subtle lock; still clickable → upgrade wall. */}
            {locked && !collapsed && (
                <i className="fa-solid fa-lock ml-auto text-[10px] text-slate-500" />
            )}
            {locked && collapsed && (
                <span className="absolute top-1.5 right-1.5 text-[8px] text-slate-500"><i className="fa-solid fa-lock" /></span>
            )}

            {!locked && badgeCount > 0 && !collapsed && (
                <span className="ml-auto bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse shadow-lg shadow-orange-500/30">
                    {badgeCount}
                </span>
            )}
            {!locked && badgeCount > 0 && collapsed && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-orange-500 rounded-full animate-pulse"></span>
            )}
        </Link>
    );
};

const Sidebar = () => {
    const { logout, user } = useAuth();
    const { showDanger } = useConfirm();
    const location = useLocation();
    const { socket } = useSocket();
    const [collapsed, setCollapsed] = useState(true);
    const [appName, setAppName] = useState('Adfliker');
    const [dueTaskCount, setDueTaskCount] = useState(0);
    const [waUnreadCount, setWaUnreadCount] = useState(0);

    const canManageTeam = ['superadmin', 'agency', 'manager'].includes(user?.role) || user?.permissions?.manageTeam === true;

    // Workspace-level Plan Feature Check. Superadmin/agency are not bound by
    // workspace plans — they have no WorkspaceSettings doc, so activeModules
    // arrives as [] and must not gate the sidebar.
    const hasModule = (moduleName) => {
        if (user?.role === 'superadmin' || user?.role === 'agency') return true;
        return user?.activeModules?.length ? user.activeModules.includes(moduleName) : true;
    };

    const hasWhatsApp = (canManageTeam || user?.permissions?.viewWhatsApp === true) && hasModule('whatsapp');
    const isWhatsAppPage = location.pathname.startsWith('/whatsapp');

    // Fetch WhatsApp unread count when not on the inbox page (inbox manages its own state)
    useEffect(() => {
        if (!hasWhatsApp || !user) return;
        if (isWhatsAppPage) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear unread when entering the inbox page
            setWaUnreadCount(0);
            return;
        }
        api.get('/whatsapp/conversations/unread')
            .then(res => setWaUnreadCount(res.data.unreadCount || 0))
            .catch(() => { });
    }, [user, isWhatsAppPage, hasWhatsApp]);

    // Real-time increment via socket when a new inbound message arrives and inbox is not open
    useEffect(() => {
        if (!socket || !hasWhatsApp || isWhatsAppPage) return;
        const handler = ({ message }) => {
            if (message?.direction === 'inbound') {
                setWaUnreadCount(prev => prev + 1);
            }
        };
        socket.on('whatsapp:newMessage', handler);
        return () => socket.off('whatsapp:newMessage', handler);
    }, [socket, hasWhatsApp, isWhatsAppPage]);

    useEffect(() => {
        const fetchAppName = async () => {
            try {
                const res = await api.get('/auth/app-name');
                if (res.data?.success) setAppName(res.data.appName);
            } catch (err) { console.error('Failed to load app name:', err.message); }
        };

        const fetchDueTasks = async () => {
            try {
                const res = await api.get('/tasks?status=Pending&dateFilter=today');
                setDueTaskCount(res.data?.length || 0);
            } catch (err) { console.error('Failed to load due tasks:', err.message); }
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

    // ─── Declarative nav model ────────────────────────────────────────────────
    // Single source of truth for the sidebar. Grouped by the user's job/channel
    // (industry-standard IA), NOT by permission level. Each item carries its own
    // `show` predicate so rendering stays a pure map — no inline JSX conditionals.
    // A group's heading is auto-hidden when none of its items are visible.
    // (When the feature registry lands, `show` becomes a lookup against it.)
    // `show`    = agent-permission visibility (an agent without viewX never sees it).
    // `feature` = registry key for PLAN entitlement. Plan no longer HIDES an item —
    //             a locked item stays visible with a lock and routes to the upgrade
    //             wall on click (industry-standard soft paywall). No `feature` = never
    //             plan-gated (Dashboard, Billing).
    const NAV_GROUPS = [
        {
            heading: null, // top-level, no section label
            items: [
                { to: '/dashboard', icon: 'fa-solid fa-chart-line', label: 'Dashboard', badge: dueTaskCount,
                  show: canManageTeam || user?.permissions?.viewDashboard !== false },
            ],
        },
        {
            heading: 'CRM',
            items: [
                { to: '/leads', icon: 'fa-solid fa-users', label: 'Leads', feature: 'leads',
                  show: canManageTeam || user?.permissions?.viewLeads !== false },
                { to: '/appointments', icon: 'fa-solid fa-calendar-check', label: 'Appointments', feature: 'appointments',
                  show: canManageTeam || user?.permissions?.viewLeads !== false },
            ],
        },
        {
            heading: 'Conversations',
            items: [
                { to: '/whatsapp', icon: 'fa-brands fa-whatsapp', label: 'WhatsApp', badge: waUnreadCount, feature: 'whatsapp',
                  show: canManageTeam || user?.permissions?.viewWhatsApp === true },
                { to: '/email', icon: 'fa-solid fa-envelope', label: 'Email', feature: 'email',
                  show: canManageTeam || user?.permissions?.viewEmails === true },
                { to: '/voice-hub', icon: 'fa-solid fa-headset', label: 'AI Voice', feature: 'voice',
                  show: canManageTeam },
            ],
        },
        {
            heading: 'Automation',
            items: [
                // Hub: Legacy Automation | Workflow | Sequences (see AutomationHub).
                { to: '/automations', alsoMatch: ['/workflows', '/sequences'], icon: 'fa-solid fa-robot', label: 'Automation', feature: 'automation',
                  show: canManageTeam },
            ],
        },
        {
            heading: 'Insights',
            items: [
                { to: '/reports', icon: 'fa-solid fa-chart-pie', label: 'Reports', feature: 'reports',
                  show: canManageTeam || user?.permissions?.viewReports },
            ],
        },
        {
            heading: 'Admin',
            items: [
                { to: '/team', icon: 'fa-solid fa-user-group', label: 'Team', feature: 'team',
                  show: canManageTeam },
                // Billing — managers only. Agencies are lifetime-free; agents don't manage billing.
                { to: '/billing', icon: 'fa-solid fa-credit-card', label: 'Billing',
                  show: user?.role === 'manager' },
            ],
        },
    ];

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

            {/* NAV — rendered from the declarative NAV_GROUPS model above. */}
            <nav className="flex-1 overflow-y-auto py-4 space-y-1">
                {NAV_GROUPS.map((group, gi) => {
                    const visibleItems = group.items.filter(item => item.show);
                    if (visibleItems.length === 0) return null;
                    return (
                        <div key={group.heading || `group-${gi}`} className="space-y-1">
                            {group.heading && !collapsed && (
                                <p className="text-xs text-slate-500 px-4 mt-6 mb-2 uppercase tracking-wider">
                                    {group.heading}
                                </p>
                            )}
                            {visibleItems.map(item => (
                                <NavItem
                                    key={item.to}
                                    collapsed={collapsed}
                                    to={item.to}
                                    alsoMatch={item.alsoMatch}
                                    icon={item.icon}
                                    label={item.label}
                                    badgeCount={item.badge || 0}
                                    locked={item.feature ? !hasEntitlement(user, item.feature) : false}
                                />
                            ))}
                        </div>
                    );
                })}
            </nav>

            {/* PROFILE */}
            <div className="border-t border-slate-800 p-4">

                <Link to="/settings" className={`flex items-center hover:opacity-80 transition cursor-pointer ${collapsed ? "justify-center" : "gap-3"}`}>
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

                <div className="flex flex-col gap-3 mt-4">
                    <button
                        onClick={handleLogout}
                        className={`w-full text-sm text-slate-400 hover:text-red-400 transition 
                        ${collapsed ? "text-center" : "text-left"}`}
                    >
                        <i className="fa-solid fa-right-from-bracket mr-2"></i>
                        {!collapsed && "Logout"}
                    </button>
                </div>

            </div>
        </aside>
    );
};

export default Sidebar;