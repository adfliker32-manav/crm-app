import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        const result = await login(email, password);

        if (result.success) {
            if (result.role === 'superadmin') {
                navigate('/super-admin');
            } else {
                navigate('/dashboard');
            }
        } else {
            setError(result.message);
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-white font-sans flex">
            {/* Left - Branding */}
            <div className="hidden lg:flex lg:w-1/2 bg-neutral-950 flex-col justify-between p-12">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center">
                            <span className="text-neutral-950 font-black text-sm">C</span>
                        </div>
                        <span className="text-white font-semibold text-lg tracking-tight">CRM Pro</span>
                    </div>
                </div>

                <div className="max-w-md">
                    <h1 className="text-5xl font-semibold text-white leading-tight mb-6">
                        The modern way to manage your sales.
                    </h1>
                    <p className="text-neutral-400 text-lg leading-relaxed">
                        Simple, powerful, and designed for teams who want to close more deals with less friction.
                    </p>
                </div>

                <div className="flex items-center gap-8 text-neutral-500 text-sm">
                    <span>© 2026 CRM Pro</span>
                    <a href="#" className="hover:text-white transition-colors">Privacy</a>
                    <a href="#" className="hover:text-white transition-colors">Terms</a>
                </div>
            </div>

            {/* Right - Form */}
            <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
                <div className="w-full max-w-sm">
                    {/* Mobile Logo */}
                    <div className="lg:hidden flex items-center gap-2 mb-12">
                        <div className="w-8 h-8 bg-neutral-950 rounded-lg flex items-center justify-center">
                            <span className="text-white font-black text-sm">C</span>
                        </div>
                        <span className="text-neutral-950 font-semibold text-lg">CRM Pro</span>
                    </div>

                    <div className="mb-8">
                        <h2 className="text-2xl font-semibold text-neutral-900 mb-2">Welcome back</h2>
                        <p className="text-neutral-500">Enter your credentials to continue</p>
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-6 border border-red-100">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-2">Email</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                                placeholder="you@company.com"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-neutral-700 mb-2">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                                placeholder="••••••••"
                            />
                        </div>

                        <div className="flex items-center justify-between text-sm">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" className="w-4 h-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-900" />
                                <span className="text-neutral-600">Remember me</span>
                            </label>
                            <a href="#" className="text-neutral-900 font-medium hover:underline">Forgot password?</a>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-neutral-900 hover:bg-neutral-800 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? 'Signing in...' : 'Sign in'}
                        </button>
                    </form>

                    <div className="mt-8 pt-8 border-t border-neutral-100 text-center">
                        <p className="text-neutral-500 text-sm">
                            Don't have an account?{' '}
                            <Link to="/register" className="text-neutral-900 font-medium hover:underline">
                                Get started
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;
