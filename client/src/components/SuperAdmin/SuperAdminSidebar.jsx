import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const SuperAdminSidebar = ({ activeView, setActiveView }) => {
    const navigate = useNavigate();
    const { logout } = useAuth();

    const menuItems = [
        { id: 'dashboard', icon: 'fa-chart-line', label: 'Dashboard', color: 'text-blue-600' },
        { id: 'companies', icon: 'fa-building', label: 'Companies', color: 'text-purple-600' },
        { id: 'billing', icon: 'fa-dollar-sign', label: 'Billing & Revenue', color: 'text-green-600' },
    ];

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    return (
        <div className="w-64 bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col shadow-2xl">
            {/* Header */}
            <div className="p-6 border-b border-slate-700">
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

            {/* Navigation Menu */}
            <nav className="flex-1 p-4 space-y-2">
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
                        {activeView === item.id && (
                            <i className="fa-solid fa-chevron-right ml-auto text-sm"></i>
                        )}
                    </button>
                ))}
            </nav>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-700 space-y-2">
                <button
                    onClick={() => navigate('/')}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-300 hover:bg-slate-700 hover:text-white transition"
                >
                    <i className="fa-solid fa-arrow-left"></i>
                    <span className="font-medium">Back to CRM</span>
                </button>
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
