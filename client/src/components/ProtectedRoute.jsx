import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TermsModal from './TermsModal';

const ProtectedRoute = () => {
    const { user } = useAuth();
    const location = useLocation();

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    // Hard role-home lock: superadmin lives under /super-admin, agency under /agency.
    // Without this, a stale URL / bookmark / back-button can drop them on the
    // manager dashboard with their superadmin/agency session still attached.
    if (user.role === 'superadmin' && !location.pathname.startsWith('/super-admin')) {
        return <Navigate to="/super-admin" replace />;
    }
    if (user.role === 'agency' && !location.pathname.startsWith('/agency')) {
        return <Navigate to="/agency/dashboard" replace />;
    }
    // Conversely, manager/agent should not be inside the superadmin or agency consoles.
    if (location.pathname.startsWith('/super-admin') && user.role !== 'superadmin') {
        return <Navigate to="/dashboard" replace />;
    }
    if (location.pathname.startsWith('/agency') && user.role !== 'agency') {
        return <Navigate to="/dashboard" replace />;
    }

    return (
        <>
            <Outlet />
            {!user.termsAccepted && <TermsModal />}
        </>
    );
};

export default ProtectedRoute;
