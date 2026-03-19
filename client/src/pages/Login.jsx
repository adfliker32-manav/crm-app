import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleLogin } from '@react-oauth/google';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const { login, googleLogin } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        const result = await login(email, password);

        if (result.success) {
            navigate(result.role === 'superadmin' ? '/super-admin' : '/dashboard');
        } else {
            setError(result.message);
            setIsLoading(false);
        }
    };

    const handleGoogleSuccess = async (credentialResponse) => {
        setError('');
        setIsLoading(true);
        const result = await googleLogin(credentialResponse.credential);
        if (result.success) {
            navigate(result.role === 'superadmin' ? '/super-admin' : '/dashboard');
        } else {
            setError(result.message);
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#FDFDFD] font-sans flex overflow-hidden">
            {/* Left - Branding with Mesh Gradient */}
            <div className="hidden lg:flex lg:w-[45%] relative bg-[#0A0A0A] flex-col justify-between p-16 overflow-hidden">
                {/* Decorative background element */}
                <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-neutral-800 rounded-full blur-[120px] opacity-50" />
                
                <div className="relative z-10">
                    <div className="flex items-center gap-3 group cursor-pointer">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center transition-transform duration-500 group-hover:rotate-12">
                            <span className="text-black font-black text-xl">C</span>
                        </div>
                        <span className="text-white font-bold text-xl tracking-tighter">CRM<span className="text-neutral-500">PRO</span></span>
                    </div>
                </div>

                <div className="relative z-10 max-w-lg">
                    <h1 className="text-6xl font-bold text-white tracking-tight leading-[1.1] mb-8">
                        Precision tools for <br />
                        <span className="text-neutral-500 underline decoration-neutral-800 underline-offset-8">modern sales.</span>
                    </h1>
                    <p className="text-neutral-400 text-xl font-light leading-relaxed">
                        Eliminate friction. Close faster. <br />
                        The operating system for high-growth teams.
                    </p>
                </div>

                <div className="relative z-10 flex items-center gap-6 text-neutral-600 text-xs font-medium uppercase tracking-widest">
                    <span>© 2026 CRM Pro</span>
                    <div className="w-1 h-1 bg-neutral-800 rounded-full" />
                    <a href="#" className="hover:text-white transition-colors">Privacy</a>
                    <a href="#" className="hover:text-white transition-colors">Terms</a>
                </div>
            </div>

            {/* Right - Form Section */}
            <div className="flex-1 flex items-center justify-center p-6 bg-white">
                <div className="w-full max-w-[400px] animate-in fade-in slide-in-from-bottom-4 duration-1000">
                    
                    {/* Mobile Branding */}
                    <div className="lg:hidden flex items-center gap-2 mb-10">
                        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                            <span className="text-white font-black text-sm">C</span>
                        </div>
                        <span className="text-black font-bold text-lg tracking-tighter">CRM PRO</span>
                    </div>

                    <div className="mb-10 text-center lg:text-left">
                        <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-2">Sign in</h2>
                        <p className="text-neutral-500 font-medium">Please enter your details to continue.</p>
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-6 border border-red-100 animate-pulse">
                            {error}
                        </div>
                    )}

                    <div className="space-y-6">
                        <div className="flex justify-center w-full">
                            <GoogleLogin
                                onSuccess={handleGoogleSuccess}
                                onError={() => setError('Google sign-in failed.')}
                                theme="filled_black"
                                shape="pill"
                                size="large"
                                width="400"
                            />
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-neutral-100"></div></div>
                            <div className="relative flex justify-center text-xs uppercase tracking-widest"><span className="px-4 bg-white text-neutral-400">or</span></div>
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-1">
                                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Email Address</label>
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                                    placeholder="name@company.com"
                                />
                            </div>

                            <div className="space-y-1">
                                <div className="flex justify-between items-end">
                                    <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Password</label>
                                    <a href="#" className="text-xs font-bold text-neutral-900 hover:opacity-70 transition-opacity mb-1">Forgot?</a>
                                </div>
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    required
                                    className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:ring-2 focus:ring-black/5 focus:border-black transition-all"
                                    placeholder="••••••••"
                                />
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <input type="checkbox" id="remember" className="w-4 h-4 rounded border-neutral-300 text-black focus:ring-black" />
                                <label htmlFor="remember" className="text-sm text-neutral-600 font-medium cursor-pointer">Keep me signed in</label>
                            </div>

                            <button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-black hover:bg-neutral-800 text-white font-bold py-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 mt-4 shadow-xl shadow-black/10"
                            >
                                {isLoading ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                        Authenticating...
                                    </span>
                                ) : 'Continue'}
                            </button>
                        </form>

                        <p className="text-center text-neutral-500 text-sm font-medium mt-8">
                            New here?{' '}
                            <Link to="/register" className="text-black font-bold hover:underline underline-offset-4">
                                Create an account
                            </Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Login;