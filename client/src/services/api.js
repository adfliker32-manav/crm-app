import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:5000/api' : '/api'),
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 30000, // 30s timeout — prevents infinite hang on Render cold starts
});

// Request interceptor to add token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor — handles auth errors, network issues, and server failures
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // ── Network Error (offline / DNS failure / CORS) ──
        if (!error.response) {
            if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
                // Request timed out — likely Render cold start
                error.message = 'Request timed out. The server may be starting up — please try again in a moment.';
            } else if (!navigator.onLine) {
                // Browser is offline
                error.message = 'You are offline. Please check your internet connection.';
            } else {
                // Generic network error (CORS, DNS, server down)
                error.message = 'Unable to reach the server. Please try again later.';
            }
            return Promise.reject(error);
        }

        const status = error.response.status;

        // ── 401 Unauthorized — Session expired or invalid token ──
        if (status === 401) {
            const token = localStorage.getItem('token');
            const requestUrl = error.config?.url || '';

            // Skip logout for login/register endpoints (expected 401 for wrong credentials)
            const isAuthEndpoint = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/register');

            // Only logout if we have a token but server says it's invalid
            if (token && !isAuthEndpoint) {
                const errorMessage = error.response?.data?.message || '';
                if (errorMessage.includes('Token') || errorMessage.includes('token') ||
                    errorMessage.includes('Authorization') || errorMessage.includes('expired')) {
                    console.warn('Session expired, logging out:', errorMessage);
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.href = '/login';
                }
            }
        }

        // ── 502/503/504 — Server temporarily unavailable (Render deploy/restart) ──
        if (status === 502 || status === 503 || status === 504) {
            error.response.data = {
                message: 'Server is temporarily unavailable. It may be restarting — please try again in 30 seconds.'
            };
        }

        // ── 429 Too Many Requests — Rate limit hit ──
        if (status === 429) {
            error.response.data = error.response.data || {
                message: 'Too many requests. Please slow down and try again in a moment.'
            };
        }

        return Promise.reject(error);
    }
);

export default api;
