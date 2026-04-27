import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
    const result = await googleLogin(credentialResponse.credential, false);

    if (result.success) {
      if (result.role === 'superadmin') navigate('/super-admin');
      else if (result.role === 'agency') navigate('/agency/dashboard');
      else navigate('/dashboard');
    } else {
      if (result.message?.includes("don't have an account") || result.message?.includes("not have an account")) {
        setError("No account found with this Google email. Start a free trial to get started.");
      } else {
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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
              <span className="text-white font-black text-xl">A</span>
            </div>
            <span className="text-white font-bold text-xl tracking-tight">
              Adfliker
            </span>
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
          <div className="lg:hidden flex items-center gap-2 mb-10">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-sm">A</span>
            </div>
            <span className="text-gray-900 font-bold text-lg">Adfliker</span>
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

          {/* Error */}
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-6 border border-red-100">
              {error}
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
                  <a href="#" className="text-xs font-bold text-green-600 hover:underline">
                    Forgot password?
                  </a>
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input type="checkbox" className="w-4 h-4 text-green-600" />
                <label className="text-sm text-gray-600">
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

              {/* NEW SECTION */}
              <div className="text-center text-sm text-gray-500 mt-4">
                Don’t have an account?{" "}
                <a
                  href="https://adfliker.com/contact"
                  className="text-green-600 font-semibold hover:underline"
                >
                  Contact us
                </a>{" "}
                and we’ll help you get started.
              </div>

            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;