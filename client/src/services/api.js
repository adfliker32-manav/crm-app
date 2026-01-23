import axios from 'axios';

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000/api' : '/api'),
    headers: {
        'Content-Type': 'application/json',
    },
});

// Request interceptor to add token
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token');
        if (token) {
            config.headers['Authorization'] = token;
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor to handle auth errors
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Only handle 401 for authenticated requests where token exists but is invalid
        if (error.response && error.response.status === 401) {
            const token = localStorage.getItem('token');
            const requestUrl = error.config?.url || '';

            // Skip logout for login/register endpoints (expected 401 for wrong credentials)
            const isAuthEndpoint = requestUrl.includes('/auth/login') || requestUrl.includes('/auth/register');

            // Only logout if we have a token but server says it's invalid
            // This means the token expired or is corrupted
            if (token && !isAuthEndpoint) {
                const errorMessage = error.response?.data?.message || '';
                // Only clear on specific token-related errors
                if (errorMessage.includes('Token') || errorMessage.includes('token') ||
                    errorMessage.includes('Authorization') || errorMessage.includes('expired')) {
                    console.warn('Token invalid, logging out:', errorMessage);
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.href = '/login';
                }
            }
        }
        return Promise.reject(error);
    }
);

export default api;
