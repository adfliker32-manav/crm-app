import React, { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.477 0 8.268 2.943 9.542 7-1.274 4.057-5.065 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-5 0-9-4-9-7a9.77 9.77 0 012.168-5.168M6.343 6.343A8.014 8.014 0 0112 5c5 0 9 4 9 7a9.77 9.77 0 01-1.343 3.657M15 12a3 3 0 11-6 0 3 3 0 016 0zM3 3l18 18" />
  </svg>
);

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { resetPassword } = useAuth();

  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const passwordRules = [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'One uppercase letter',  ok: /[A-Z]/.test(password) },
    { label: 'One number',            ok: /[0-9]/.test(password) },
    { label: 'One special character', ok: /[^A-Za-z0-9]/.test(password) },
  ];
  const passwordValid = passwordRules.every((r) => r.ok);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Reset link is missing or invalid. Please request a new one.');
      return;
    }

    if (!passwordValid) {
      setError('Password must be at least 8 characters, and include uppercase, lowercase, number, and special character.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    const result = await resetPassword(token, password);
    setIsLoading(false);

    if (result.success) {
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2500);
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
            Set a new <span className="text-green-400">password</span>
          </h1>
          <p className="text-gray-300 text-lg">
            Choose something strong and memorable. You will use this to access your Adfliker account.
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

          {success ? (
            <div className="text-center">
              <div className="mx-auto mb-6 w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Password updated!</h2>
              <p className="text-gray-500 mb-8">
                Your password has been changed successfully. Redirecting you to login...
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 text-sm font-semibold text-green-600 hover:text-green-700 transition-colors"
              >
                Go to Login now
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-10">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">New password</h2>
                <p className="text-gray-500">
                  {token ? 'Choose a strong new password for your account.' : 'This reset link is invalid or has expired.'}
                </p>
              </div>

              {!token ? (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
                  <p className="text-red-600 text-sm mb-4">Reset link is missing or invalid.</p>
                  <Link to="/forgot-password" className="text-sm font-semibold text-green-600 hover:underline">
                    Request a new reset link
                  </Link>
                </div>
              ) : (
                <>
                  {error && (
                    <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-6 border border-red-100">
                      {error}
                      {error.toLowerCase().includes('invalid or has expired') && (
                        <span className="block mt-1">
                          <Link to="/forgot-password" className="font-semibold underline">Request a new link</Link>
                        </span>
                      )}
                    </div>
                  )}

                  <form onSubmit={handleSubmit} className="space-y-4">
                    {/* New Password */}
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase ml-1 block mb-1">
                        New Password
                      </label>
                      <div className="relative">
                        <input
                          id="new-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          autoFocus
                          className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          placeholder="Min. 8 characters"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(v => !v)}
                          className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                          tabIndex={-1}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>
                      {/* Password rules checklist */}
                      {password.length > 0 && (
                        <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {passwordRules.map((r) => (
                            <li key={r.label} className={`flex items-center gap-1.5 text-xs transition-colors ${r.ok ? 'text-green-600' : 'text-gray-400'}`}>
                              <span className="w-3 text-center">{r.ok ? '✓' : '○'}</span>
                              {r.label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* Confirm Password */}
                    <div>
                      <label className="text-xs font-semibold text-gray-400 uppercase ml-1 block mb-1">
                        Confirm Password
                      </label>
                      <div className="relative">
                        <input
                          id="confirm-password"
                          type={showConfirm ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          placeholder="Re-enter password"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirm(v => !v)}
                          className="absolute inset-y-0 right-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                          tabIndex={-1}
                          aria-label={showConfirm ? 'Hide password' : 'Show password'}
                        >
                          {showConfirm ? <EyeOffIcon /> : <EyeIcon />}
                        </button>
                      </div>
                      {/* Match indicator */}
                      {confirmPassword.length > 0 && (
                        <p className={`text-xs mt-1 ml-1 ${password === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
                          {password === confirmPassword ? 'Passwords match' : 'Passwords do not match'}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      id="update-password-btn"
                      disabled={isLoading}
                      className="w-full bg-[#0f172a] hover:bg-[#020617] text-white font-bold py-4 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg mt-2"
                    >
                      {isLoading ? 'Updating...' : 'Update Password'}
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
