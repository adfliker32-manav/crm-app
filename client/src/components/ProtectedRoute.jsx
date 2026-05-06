import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import TermsModal from './TermsModal';

const ProtectedRoute = () => {
    const { user } = useAuth();

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    return (
        <>
            <Outlet />
            {!user.termsAccepted && <TermsModal />}
        </>
    );
};

export default ProtectedRoute;
