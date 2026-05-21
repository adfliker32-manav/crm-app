import React, { createContext, useState, useContext, useEffect } from 'react';
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

    // Refresh user permissions from server on mount so that changes made by
    // superadmin (e.g. enabling aiChatbot) are picked up without requiring re-login.
    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) return;
        api.get('/auth/me')
            .then(res => {
                const fresh = res.data?.user;
                if (fresh) {
                    const merged = { ...JSON.parse(localStorage.getItem('user') || '{}'), ...fresh };
                    localStorage.setItem('user', JSON.stringify(merged));
                    setUser(merged);
                }
            })
            .catch(() => { /* silent — stale cache is better than broken UI */ });
    }, []);

    const login = async (email, password, rememberMe = false) => {
        try {
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

    const googleLogin = async (credential, allowNewUser = true) => {
        try {
            const res = await api.post('/auth/google', { credential, allowNewUser });
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
                message: error.response?.data?.message || 'Google login failed'
            };
        }
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loginWithToken, updateUser, googleLogin, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
