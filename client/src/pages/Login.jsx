import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleLogin } from '@react-oauth/google';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [needsRegistration, setNeedsRegistration] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login, googleLogin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Set by the Register page after a successful sign-up (no auto-login).
  const justRegistered = location.state?.registered;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await login(email, password, rememberMe);

    if (result.success) {
      if (result.role === 'superadmin') navigate('/super-admin');
      else if (result.role === 'agency') navigate('/agency/dashboard');
      else navigate('/dashboard');
    } else {
      setError(result.message);
      setIsLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setIsLoading(true);
    const result = await googleLogin(credentialResponse.credential, false, rememberMe);

    if (result.success) {
      if (result.role === 'superadmin') navigate('/super-admin');
      else if (result.role === 'agency') navigate('/agency/dashboard');
      else navigate('/dashboard');
    } else {
      if (result.needsRegistration) {
        setNeedsRegistration(true);
        setError('');
      } else {
        setNeedsRegistration(false);
        setError(result.message);
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans flex overflow-hidden">

      {/* LEFT SIDE */}
      <div className="hidden lg:flex lg:w-[45%] relative bg-[#0f172a] flex-col justify-between p-16 overflow-hidden">

        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-green-500 rounded-full blur-[120px] opacity-20" />

        <div className="relative z-10">
          <div className="flex items-center">
            <img src="/logo.png" alt="Adfliker Logo" className="h-12 object-contain" />
          </div>
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="text-5xl font-bold text-white leading-tight mb-6">
            Turn Meta Leads Into <span className="text-green-400">Predictable Revenue</span>
          </h1>
          <p className="text-gray-300 text-lg">
            Instantly capture leads, trigger WhatsApp follow-ups, and close deals on autopilot — without manual effort.
          </p>
        </div>

        <div className="relative z-10 text-gray-500 text-xs uppercase tracking-widest">
          © 2026 Adfliker
        </div>
      </div>

      {/* RIGHT SIDE */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-[400px]">

          {/* Mobile Logo */}
          <div className="lg:hidden flex items-center mb-10 bg-[#0f172a] p-3 rounded-xl w-fit">
            <img src="/logo.png" alt="Adfliker Logo" className="h-8 object-contain" />
          </div>

          {/* Heading */}
          <div className="mb-10 text-center lg:text-left">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome back
            </h2>
            <p className="text-gray-500">
              Log in to manage your leads and automation
            </p>
          </div>

          {/* Registration success (redirected from /register) */}
          {justRegistered && !error && (
            <div className="bg-green-50 text-green-700 px-4 py-3 rounded-xl text-sm mb-6 border border-green-100">
              Registration successful — your 14-day free trial has started. Please log in to continue.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-6 border border-red-100">
              {error}
            </div>
          )}

          {/* Needs registration prompt */}
          {needsRegistration && (
            <div className="bg-amber-50 text-amber-800 px-4 py-3 rounded-xl text-sm mb-6 border border-amber-200">
              No account found with this email. Please{' '}
              <Link to="/register" className="font-semibold underline hover:text-amber-900">register here</Link>
              {' '}to get started.
            </div>
          )}

          <div className="space-y-6">

            {/* Google Login */}
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

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="px-4 bg-white text-gray-400">or</span>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">

              <div>
                <label className="text-xs font-semibold text-gray-400 uppercase ml-1">
                  Work Email
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="name@company.com"
                />
              </div>

              <div>
                <div className="flex justify-between">
                  <label className="text-xs font-semibold text-gray-400 uppercase ml-1">
                    Password
                  </label>
                  <Link to="/forgot-password" className="text-xs font-bold text-green-600 hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    tabIndex={-1}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      /* Eye-off icon */
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9-4-9-7a9.77 9.77 0 012.168-5.168M6.343 6.343A8.014 8.014 0 0112 5c5 0 9 4 9 7a9.77 9.77 0 01-1.343 3.657M15 12a3 3 0 11-6 0 3 3 0 016 0zM3 3l18 18" />
                      </svg>
                    ) : (
                      /* Eye icon */
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500 cursor-pointer"
                />
                <label htmlFor="rememberMe" className="text-sm text-gray-600 cursor-pointer select-none">
                  Keep me signed in
                </label>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#0f172a] hover:bg-[#020617] text-white font-bold py-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg"
              >
                {isLoading ? 'Authenticating...' : 'Access Dashboard'}
              </button>

              {/* New here? → navigate to Register page */}
              <Link
                to="/register"
                className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3 mt-1 cursor-pointer hover:bg-green-100 active:scale-[0.98] transition-all select-none no-underline"
              >
                <span className="text-green-500 mt-0.5 flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
                  </svg>
                </span>
                <p className="text-sm text-green-800 leading-snug">
                  <span className="font-bold">New here?</span>{' '}
                  <span className="font-semibold text-green-700 underline underline-offset-2">Create your free account</span>{' '}
                  and get started instantly.
                </p>
              </Link>

              <div className="text-center text-xs text-gray-400 mt-2">
                By signing in you agree to our{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-green-600 underline">
                  Terms & Conditions
                </a>{" "}
                and{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-green-600 underline">
                  Privacy Policy
                </a>
              </div>

            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
