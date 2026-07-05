import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const { forgotPassword } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const result = await forgotPassword(email.trim().toLowerCase());

    setIsLoading(false);

    if (result.success) {
      setSubmitted(true);
    } else {
      setError(result.message || 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans flex overflow-hidden">

      {/* LEFT SIDE */}
      <div className="hidden lg:flex lg:w-[45%] relative bg-[#0f172a] flex-col justify-between p-16 overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-green-500 rounded-full blur-[120px] opacity-20" />

        <div className="relative z-10">
          <Link to="/login" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-500 rounded-xl flex items-center justify-center">
              <span className="text-white font-black text-xl">A</span>
            </div>
            <span className="text-white font-bold text-xl tracking-tight">Adfliker</span>
          </Link>
        </div>

        <div className="relative z-10 max-w-lg">
          <h1 className="text-5xl font-bold text-white leading-tight mb-6">
            Forgot your <span className="text-green-400">password?</span>
          </h1>
          <p className="text-gray-300 text-lg">
            No worries — we will send you a secure reset link. It will arrive in your inbox within a minute.
          </p>
        </div>

        <div className="relative z-10 text-gray-500 text-xs uppercase tracking-widest">
          Copyright 2026 Adfliker
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

          {submitted ? (
            <div className="text-center">
              <div className="mx-auto mb-6 w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Check your inbox</h2>
              <p className="text-gray-500 mb-2">
                If <strong className="text-gray-700">{email}</strong> is registered, a password reset link has been sent.
              </p>
              <p className="text-sm text-gray-400 mb-8">
                The link expires in <strong>1 hour</strong>. Check your spam folder if you do not see it.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-sm font-semibold text-green-600 hover:text-green-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-10">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">Reset password</h2>
                <p className="text-gray-500">Enter your account email and we will send you a reset link.</p>
              </div>

              {error && (
                <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-6 border border-red-100">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="text-xs font-semibold text-gray-400 uppercase ml-1 block mb-1">
                    Work Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoFocus
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    placeholder="name@company.com"
                  />
                </div>

                <button
                  type="submit"
                  id="send-reset-btn"
                  disabled={isLoading}
                  className="w-full bg-[#0f172a] hover:bg-[#020617] text-white font-bold py-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg"
                >
                  {isLoading ? 'Sending...' : 'Send Reset Link'}
                </button>

                <div className="text-center">
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-green-600 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                    Back to Login
                  </Link>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
