import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../services/api';

// Mirrors the backend Joi password rules (validateRequest.js `register`) so the
// user gets instant feedback instead of a round-trip rejection.
const passwordRules = (pw) => [
  { label: 'At least 8 characters', ok: pw.length >= 8 },
  { label: 'One uppercase letter', ok: /[A-Z]/.test(pw) },
  { label: 'One number', ok: /[0-9]/.test(pw) },
  { label: 'One special character', ok: /[^A-Za-z0-9]/.test(pw) }
];

const STEPS = [
  { n: 1, label: 'Contact information' },
  { n: 2, label: 'Company details' },
  { n: 3, label: 'Create password' }
];

const HEADINGS = {
  1: { title: 'Your contact details', sub: 'How should we reach you?' },
  2: { title: 'About your company', sub: 'Tell us where you work.' },
  3: { title: 'Create a strong password', sub: 'Last step — secure your account.' }
};

const Register = () => {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    companyName: '',
    email: '',
    password: '',
    phone: '',
    website: '',
    onboardingNotes: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  const rules = passwordRules(form.password);
  const passwordValid = rules.every((r) => r.ok);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
  };

  // Per-step validation — returns an error message (or '' when valid).
  const validateStep = (s) => {
    if (s === 1) {
      if (form.name.trim().length < 2) return 'Please enter your full name.';
      if (!emailValid) return 'Please enter a valid email address.';
      if (form.phone.trim().length < 5) return 'Please enter a valid mobile / contact number.';
    }
    if (s === 2) {
      if (form.companyName.trim().length < 2) return 'Please enter your company name.';
    }
    return '';
  };

  const goBack = () => {
    setError('');
    setStep((s) => Math.max(1, s - 1));
  };

  // Form submit drives BOTH "Continue" and the final "Start trial" — so pressing
  // Enter advances steps naturally instead of submitting half a form.
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (step < 3) {
      const msg = validateStep(step);
      if (msg) return setError(msg);
      return setStep(step + 1);
    }

    // Final step — password.
    if (!passwordValid) {
      return setError('Please choose a password that meets all the requirements below.');
    }

    setIsLoading(true);
    try {
      await api.post('/auth/register', {
        name: form.name.trim(),
        companyName: form.companyName.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim(),
        website: form.website.trim(),
        onboardingNotes: form.onboardingNotes.trim()
      });
      // No auto-login — send them to login with a success banner. Trial already started.
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      const data = err.response?.data;
      if (Array.isArray(data?.errors) && data.errors.length) {
        setError(data.errors.map((x) => x.message).join('. '));
      } else {
        setError(data?.message || err.message || 'Registration failed. Please try again.');
      }
      setIsLoading(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500';
  const labelClass = 'text-xs font-semibold text-gray-400 uppercase ml-1';

  return (
    <div className="h-screen bg-[#f8fafc] font-sans flex overflow-hidden">

      {/* LEFT SIDE — brand + step tracker */}
      <div className="hidden lg:flex lg:w-[45%] relative bg-[#0f172a] flex-col justify-between p-16 overflow-hidden">
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-green-500 rounded-full blur-[120px] opacity-20" />

        <div className="relative z-10 flex items-center">
          <img src="/logo.png" alt="Adfliker Logo" className="h-12 object-contain" />
        </div>

        <div className="relative z-10 max-w-md">
          <p className="text-green-400 text-sm font-semibold uppercase tracking-widest mb-4">14-Day Free Trial</p>
          <h1 className="text-4xl font-bold text-white leading-tight mb-10">
            Create your <span className="text-green-400">Adfliker</span> workspace
          </h1>

          {/* Vertical step tracker */}
          <div className="space-y-5">
            {STEPS.map((s) => {
              const done = step > s.n;
              const active = step === s.n;
              return (
                <div key={s.n} className="flex items-center gap-4">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors
                      ${done ? 'bg-green-500 border-green-500 text-white'
                        : active ? 'border-green-400 text-green-400'
                          : 'border-gray-600 text-gray-500'}`}
                  >
                    {done ? '✓' : s.n}
                  </div>
                  <span className={`font-semibold transition-colors ${active ? 'text-white' : done ? 'text-gray-300' : 'text-gray-500'}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative z-10 text-gray-500 text-xs uppercase tracking-widest">© 2026 Adfliker</div>
      </div>

      {/* RIGHT SIDE — current step */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white">
        <div className="w-full max-w-[420px]">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center mb-6 bg-[#0f172a] p-3 rounded-xl w-fit">
            <img src="/logo.png" alt="Adfliker Logo" className="h-8 object-contain" />
          </div>

          {/* Progress */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Step {step} of 3</span>
              <span className="text-xs font-semibold text-gray-500">{Math.round((step / 3) * 100)}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-green-500 rounded-full transition-all duration-500" style={{ width: `${(step / 3) * 100}%` }} />
            </div>
          </div>

          {/* Heading */}
          <div className="mb-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-1">{HEADINGS[step].title}</h2>
            <p className="text-gray-500 text-sm">{HEADINGS[step].sub}</p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-5 border border-red-100">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>

            {/* ── STEP 1: Contact information ── */}
            {step === 1 && (
              <>
                <div>
                  <label className={labelClass}>Manager Name</label>
                  <input type="text" name="name" value={form.name} onChange={handleChange}
                    autoFocus autoComplete="name" className={inputClass} placeholder="Your full name" />
                </div>
                <div>
                  <label className={labelClass}>Work Email</label>
                  <input type="email" name="email" value={form.email} onChange={handleChange}
                    autoComplete="email" className={inputClass} placeholder="name@company.com" />
                </div>
                <div>
                  <label className={labelClass}>Mobile / Contact Number</label>
                  <input type="tel" name="phone" value={form.phone} onChange={handleChange}
                    autoComplete="tel" inputMode="tel" className={inputClass} placeholder="+91 98765 43210" />
                </div>
              </>
            )}

            {/* ── STEP 2: Company details ── */}
            {step === 2 && (
              <>
                <div>
                  <label className={labelClass}>Company Name</label>
                  <input type="text" name="companyName" value={form.companyName} onChange={handleChange}
                    autoFocus autoComplete="organization" className={inputClass} placeholder="Acme Inc." />
                </div>
                <div>
                  <label className={labelClass}>
                    Company Website <span className="text-gray-300 normal-case">(optional)</span>
                  </label>
                  <input type="text" name="website" value={form.website} onChange={handleChange}
                    autoComplete="url" className={inputClass} placeholder="example.com" />
                </div>
                <div>
                  <label className={labelClass}>
                    Onboarding Details <span className="text-gray-300 normal-case">(optional)</span>
                  </label>
                  <textarea name="onboardingNotes" value={form.onboardingNotes} onChange={handleChange}
                    rows={3} maxLength={2000} className={`${inputClass} resize-none`}
                    placeholder="Tell us a bit about your business and what you'd like to achieve." />
                </div>
              </>
            )}

            {/* ── STEP 3: Create password ── */}
            {step === 3 && (
              <div>
                <label className={labelClass}>Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    autoFocus
                    autoComplete="new-password"
                    className={`${inputClass} pr-16`}
                    placeholder="Create a strong password"
                  />
                  <button type="button" onClick={() => setShowPassword((s) => !s)} tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gray-400 hover:text-gray-600 select-none">
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  {rules.map((r) => (
                    <li key={r.label} className={`flex items-center gap-1.5 text-xs transition-colors ${r.ok ? 'text-green-600' : 'text-gray-400'}`}>
                      <span className="w-3 text-center">{r.ok ? '✓' : '○'}</span>
                      {r.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              {step > 1 && (
                <button type="button" onClick={goBack}
                  className="px-5 py-3.5 rounded-xl font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition active:scale-[0.98]">
                  Back
                </button>
              )}
              <button type="submit" disabled={isLoading}
                className="flex-1 bg-[#0f172a] hover:bg-[#020617] text-white font-bold py-3.5 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50 shadow-lg flex items-center justify-center gap-2">
                {step < 3 ? 'Continue →'
                  : isLoading ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating account...</>)
                    : 'Start Free Trial →'}
              </button>
            </div>
          </form>

          {/* Footer */}
          <div className="text-center text-sm text-gray-500 mt-5">
            Already have an account?{' '}
            <Link to="/login" className="text-green-600 font-semibold hover:underline">Sign in</Link>
          </div>
          {step === 3 && (
            <div className="text-center text-xs text-gray-400 mt-2">
              By creating an account you agree to our{' '}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-green-600 underline">Terms</a>{' '}
              and{' '}
              <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-gray-500 hover:text-green-600 underline">Privacy Policy</a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Register;
