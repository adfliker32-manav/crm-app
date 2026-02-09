import React, { createContext, useState, useContext } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    // Lazy initialization to avoid useEffect setState warning
    const [user, setUser] = useState(() => {
        const storedUser = localStorage.getItem('user');
        const token = localStorage.getItem('token');
        if (storedUser && token) {
            return JSON.parse(storedUser);
        }
        return null;
    });
    const [loading, _setLoading] = useState(false);

    const login = async (email, password) => {
        try {
            // Adjust endpoint if needed (current: /api/auth/login)
            const res = await api.post('/auth/login', { email, password });
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
        setUser(null);
        window.location.href = '/login';
    };

    const register = async (userData) => {
        try {
            // userData object should contain: { name, email, password, companyName, industry, teamSize, phone }
            const res = await api.post('/auth/register', userData);
            const { token, user } = res.data;

            localStorage.setItem('token', token);
            localStorage.setItem('user', JSON.stringify(user));
            setUser(user);
            return { success: true };
        } catch (error) {
            console.error("Registration failed", error);
            return {
                success: false,
                message: error.response?.data?.message || 'Registration failed'
            };
        }
    };

    // Update user data in state and localStorage
    const updateUser = (updatedUserData) => {
        const updatedUser = { ...user, ...updatedUserData };
        localStorage.setItem('user', JSON.stringify(updatedUser));
        setUser(updatedUser);
    };

    return (
        <AuthContext.Provider value={{ user, login, register, logout, updateUser, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);
