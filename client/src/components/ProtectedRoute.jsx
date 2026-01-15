import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = () => {
    const { user } = useAuth();

    // Check if user is authenticated (either in state or local storage token check via AuthContext initial load)
    // Note: AuthContext handles initial loading, so 'user' should be reliable if !loading
    // We might need to handle the 'loading' state in AuthContext to prevent premature redirect, but for now we assume loading is handled there.
    // Actually, AuthContext renders children only when !loading.

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
};

export default ProtectedRoute;
