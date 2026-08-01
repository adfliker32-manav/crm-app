import React, { createContext, useState, useContext, useEffect, useRef } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    // Lazy initialization to avoid useEffect setState warning
    const [user, setUser] = useState(() => {
        try {
            const storedUser = localStorage.getItem('user');
            const token = localStorage.getItem('token');
            if (storedUser && token) {
                return JSON.parse(storedUser);
            }
        } catch (e) {
            // Corrupted localStorage — clear it and start fresh
            console.warn('Corrupted user data in localStorage, clearing:', e.message);
            localStorage.removeItem('user');
            localStorage.removeItem('token');
        }
        return null;
    });
    const [loading, _setLoading] = useState(false);

    // AbortController ref for the /auth/me refresh call. The login function
    // aborts any in-flight /auth/me request to prevent a stale 401 response
    // from an expired token wiping the freshly-stored new session.
    const meAbortRef = useRef(null);

    // Refresh user permissions from server on mount so that changes made by
    // superadmin (e.g. enabling aiChatbot) are picked up without requiring re-login.
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;

        const controller = new AbortController();
        meAbortRef.current = controller;

        api.get('/auth/me', { signal: controller.signal })
            .then(res => {
                const fresh = res.data?.user;
                const refreshedToken = res.data?.token;
                if (fresh) {
                    const merged = { ...JSON.parse(localStorage.getItem('user') || '{}'), ...fresh };
                    localStorage.setItem('user', JSON.stringify(merged));
                    // Backend returns a refreshed token for sliding rememberMe sessions.
                    // Save it so the session slides forward on every visit.
                    if (refreshedToken) localStorage.setItem('token', refreshedToken);
                    setUser(merged);
                }
            })
            .catch(() => { /* silent — stale cache is better than broken UI */ })
            .finally(() => { meAbortRef.current = null; });

        return () => controller.abort();
    }, []);

    const login = async (email, password, rememberMe = false) => {
        try {
            // Abort any in-flight /auth/me request that may still be carrying an
            // old expired token. Without this, its 401 response can race with the
            // new session and wipe it via the response interceptor.
            if (meAbortRef.current) {
                meAbortRef.current.abort();
                meAbortRef.current = null;
            }

            // Adjust endpoint if needed (current: /api/auth/login)
            const res = await api.post('/auth/login', { email, password, rememberMe });
            const { token, role, user } = res.data;

            // Ensure role is included in user object for localStorage
            const userWithRole = { ...user, role: user.role || role };

            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(userWithRole));
            setUser(userWithRole);
            return { success: true, role: userWithRole.role };
        } catch (error) {
            console.error("Login failed", error);
            return {
                success: false,
                message: error.response?.data?.message || 'Login failed'
            };
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Use replace (not href) so browser history doesn't allow "back" to protected pages.
        // No setUser(null) needed — the hard reload reinitializes state from empty localStorage.
        window.location.replace('/login');
    };

    const loginWithToken = (token, userObj) => {
        const userWithRole = { ...userObj, role: userObj.role };
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userWithRole));
        setUser(userWithRole);
        return { success: true };
    };

    // Update user data in state and localStorage
    const updateUser = (updatedUserData) => {
        const updatedUser = { ...user, ...updatedUserData };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        setUser(updatedUser);
    };

    const forgotPassword = async (email) => {
        try {
            const res = await api.post('/auth/forgot-password', { email });
            return { success: true, message: res.data.message };
        } catch (error) {
            return { success: false, message: error.response?.data?.message || 'Something went wrong.' };
        }
    };

    const resetPassword = async (token, password) => {
        try {
            const res = await api.post('/auth/reset-password', { token, password });
            return { success: true, message: res.data.message };
        } catch (error) {
            return { success: false, message: error.response?.data?.message || 'Something went wrong.' };
        }
    };

    const googleLogin = async (credential, allowNewUser = true, rememberMe = false) => {

        try {
            // Abort any in-flight /auth/me request (same race-condition guard as login)
            if (meAbortRef.current) {
                meAbortRef.current.abort();
                meAbortRef.current = null;
            }

            const res = await api.post('/auth/google', { credential, allowNewUser, rememberMe });
            const { token, role, user } = res.data;

            const userWithRole = { ...user, role: user.role || role };

            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(userWithRole));
            setUser(userWithRole);
            return { success: true, role: userWithRole.role };
        } catch (error) {
            console.error("Google Login failed", error);
            return {
                success: false,
                message: error.response?.data?.message || 'Google login failed',
                needsRegistration: error.response?.data?.needsRegistration || false
            };
        }
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loginWithToken, updateUser, googleLogin, forgotPassword, resetPassword, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
