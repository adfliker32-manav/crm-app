import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import api from '../services/api';

// === ICONS ===
const icons = {
    agency: '🏢', freelancer: '💼', clinic: '🏥', real_estate: '🏠', other: '⚡',
    meta_ads: '📣', whatsapp: '💬', manual: '📋', other_source: '🔧'
};

const Onboarding = () => {
    const { user, register, googleLogin, updateUser, loginWithToken } = useAuth();
    const navigate = useNavigate();

    // Step 0 = Auth (email/password sign up)
    // Step 1 = Account Type
    // Step 2 = Company Details
    // Step 3 = Activation Source
    const [step, setStep] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [formData, setFormData] = useState({
        email: '', password: '',
        accountType: '',
        name: '', companyName: '', teamSize: '', phone: '',
        activationSource: ''
    });

    // Resume from last step if user is already authenticated
    useEffect(() => {
        if (user) {
            if (user.isOnboarded) {
                if (user.role === 'superadmin') navigate('/super-admin');
                else if (user.role === 'agency') navigate('/agency/dashboard');
                else navigate('/dashboard');
                return;
            }
            // Resume wizard from saved step
            const savedStep = user.onboardingStep || 0;
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setStep(savedStep < 3 ? savedStep + 1 : 3);
        }
    }, [user, navigate]);

    const handleChange = (e) => {
        setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
        setError('');
    };

    // --- STEP 0: Auth ---
    const handleGoogleSuccess = async (credentialResponse) => {
        setError(''); setIsLoading(true);
        const result = await googleLogin(credentialResponse.credential, true);
        if (result.success) {
            if (result.isOnboarded) {
                navigate('/dashboard');
            } else {
                setStep(1);
            }
        } else {
            setError(result.message);
        }
        setIsLoading(false);
    };

    const handleEmailAuth = async (e) => {
        e.preventDefault();
        setError(''); setIsLoading(true);
        const result = await register({ email: formData.email, password: formData.password });
        if (result.success) {
            setStep(1);
        } else {
            setError(result.message);
        }
        setIsLoading(false);
    };

    // --- STEP 1: Account Type ---
    const handleStep1 = async (accountType) => {
        setFormData(prev => ({ ...prev, accountType }));
        setError(''); setIsLoading(true);
        try {
            await api.post('/auth/onboard/step1', { accountType });
            updateUser({ accountType, onboardingStep: 1 });
            setStep(2);
        } catch (err) {
            setError(err.response?.data?.message || 'Something went wrong');
        }
        setIsLoading(false);
    };

    // --- STEP 2: Company Details ---
    const handleStep2 = async (e) => {
        e.preventDefault();
        if (!formData.name.trim() || !formData.companyName.trim()) {
            setError('Name and Company Name are required.');
            return;
        }
        setError(''); setIsLoading(true);
        try {
            await api.post('/auth/onboard/step2', {
                name: formData.name,
                companyName: formData.companyName,
                teamSize: formData.teamSize,
                phone: formData.phone
            });
            updateUser({ name: formData.name, companyName: formData.companyName, onboardingStep: 2 });
            setStep(3);
        } catch (err) {
            setError(err.response?.data?.message || 'Something went wrong');
        }
        setIsLoading(false);
    };

    // --- STEP 3: Activation Source + START TRIAL ---
    const handleStep3 = async (activationSource) => {
        setError(''); setIsLoading(true);
        try {
            const res = await api.post('/auth/onboard/step3', { activationSource });
            if (res.data.success) {
                // Auto-login with the new full token
                loginWithToken(res.data.token, res.data.user);
                // Small delay for smooth UX then redirect
                setTimeout(() => navigate('/dashboard'), 600);
            }
        } catch (err) {
            const msg = err.response?.data?.message || 'Something went wrong';
            if (err.response?.data?.redirectTo === 'pricing') {
                setError('Your trial has already been used. Please choose a plan to continue.');
            } else {
                setError(msg);
            }
        }
        setIsLoading(false);
    };

    const totalSteps = 3;
    const progressPct = step === 0 ? 0 : (step / totalSteps) * 100;

    return (
        <div className="min-h-screen bg-[#FDFDFD] font-sans flex overflow-hidden">
            {/* Left Panel */}
            <div className="hidden lg:flex lg:w-[42%] relative bg-[#0A0A0A] flex-col justify-between p-16 overflow-hidden">
                <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-neutral-800 rounded-full blur-[130px] opacity-40" />
                <div className="absolute bottom-[-10%] left-[-5%] w-72 h-72 bg-neutral-700 rounded-full blur-[100px] opacity-20" />

                <div className="relative z-10 flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
                        <span className="text-black font-black text-xl">C</span>
                    </div>
                    <span className="text-white font-bold text-xl tracking-tighter">CRM<span className="text-neutral-500">PRO</span></span>
                </div>

                <div className="relative z-10 max-w-lg">
                    {step === 0 && <>
                        <p className="text-neutral-500 text-sm font-semibold uppercase tracking-widest mb-6">14-Day Free Trial</p>
                        <h1 className="text-5xl font-bold text-white tracking-tight leading-[1.1] mb-8">
                            The CRM built for<br /><span className="text-neutral-400">growth teams.</span>
                        </h1>
                        <p className="text-neutral-400 text-lg font-light leading-relaxed">No credit card. No commitment. Cancel anytime.</p>
                    </>}
                    {step === 1 && <>
                        <p className="text-neutral-500 text-sm font-semibold uppercase tracking-widest mb-6">Step 1 of 3</p>
                        <h1 className="text-4xl font-bold text-white tracking-tight leading-[1.15] mb-6">Tell us about your business.</h1>
                        <p className="text-neutral-400 text-lg font-light">We'll personalize your CRM experience based on your industry.</p>
                    </>}
                    {step === 2 && <>
                        <p className="text-neutral-500 text-sm font-semibold uppercase tracking-widest mb-6">Step 2 of 3</p>
                        <h1 className="text-4xl font-bold text-white tracking-tight leading-[1.15] mb-6">Set up your workspace.</h1>
                        <p className="text-neutral-400 text-lg font-light">Your company details help us tailor your CRM environment.</p>
                    </>}
                    {step === 3 && <>
                        <p className="text-neutral-500 text-sm font-semibold uppercase tracking-widest mb-6">Step 3 of 3 — Final Step</p>
                        <h1 className="text-4xl font-bold text-white tracking-tight leading-[1.15] mb-6">Almost ready. 🚀</h1>
                        <p className="text-neutral-400 text-lg font-light">One last question, then your 14-day trial starts instantly.</p>
                    </>}
                </div>

                <div className="relative z-10 flex items-center gap-6 text-neutral-600 text-xs font-medium uppercase tracking-widest">
                    <span>© 2026 Adfliker</span>
                    <div className="w-1 h-1 bg-neutral-800 rounded-full" />
                    <a href="#" className="hover:text-white transition-colors">Privacy</a>
                    <a href="#" className="hover:text-white transition-colors">Terms</a>
                </div>
            </div>

            {/* Right Panel */}
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-white overflow-y-auto">
                <div className="w-full max-w-[480px] py-12">

                    {/* Mobile Logo */}
                    <div className="lg:hidden flex items-center gap-2 mb-10">
                        <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                            <span className="text-white font-black text-sm">C</span>
                        </div>
                        <span className="text-black font-bold text-lg">Adfliker</span>
                    </div>

                    {/* Progress Bar (visible after auth) */}
                    {step > 0 && (
                        <div className="mb-8">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">Step {step} of {totalSteps}</span>
                                <span className="text-xs font-semibold text-neutral-500">{Math.round(progressPct)}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-black rounded-full transition-all duration-700 ease-out"
                                    style={{ width: `${progressPct}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Error Banner */}
                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm mb-6 border border-red-100">
                            {error}
                        </div>
                    )}

                    {/* === STEP 0: Auth === */}
                    {step === 0 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-8">
                                <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-2">Start your free trial</h2>
                                <p className="text-neutral-500">14 days free. No credit card required.</p>
                            </div>

                            <div className="flex justify-center">
                                <GoogleLogin
                                    onSuccess={handleGoogleSuccess}
                                    onError={() => setError('Google sign-up failed. Please try again.')}
                                    theme="filled_black" shape="pill" size="large" width="480" text="signup_with"
                                />
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-neutral-100" /></div>
                                <div className="relative flex justify-center text-xs uppercase tracking-widest">
                                    <span className="px-4 bg-white text-neutral-400">or continue with email</span>
                                </div>
                            </div>

                            <form onSubmit={handleEmailAuth} className="space-y-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Work Email</label>
                                    <input type="email" name="email" value={formData.email} onChange={handleChange} required
                                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:border-black transition-all"
                                        placeholder="you@company.com" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Password</label>
                                    <input type="password" name="password" value={formData.password} onChange={handleChange} required
                                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:border-black transition-all"
                                        placeholder="Min 8 chars, uppercase, number & symbol" />
                                </div>
                                <button type="submit" disabled={isLoading}
                                    className="w-full bg-black hover:bg-neutral-800 text-white font-bold py-4 rounded-xl transition-all disabled:opacity-50 shadow-xl shadow-black/10">
                                    {isLoading ? <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating account...</span> : 'Create Free Account →'}
                                </button>
                            </form>

                            <p className="text-center text-neutral-500 text-sm">
                                Already have an account?{' '}
                                <Link to="/login" className="text-black font-bold hover:underline">Sign in</Link>
                            </p>
                        </div>
                    )}

                    {/* === STEP 1: Account Type === */}
                    {step === 1 && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-8">
                                <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-2">What describes you best?</h2>
                                <p className="text-neutral-500">Pick the one that fits most. You can always change it later.</p>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                {[
                                    { key: 'agency', label: 'Marketing Agency', desc: 'You manage clients & campaigns' },
                                    { key: 'freelancer', label: 'Freelancer / Consultant', desc: 'Solo or small project-based work' },
                                    { key: 'clinic', label: 'Clinic / Healthcare', desc: 'Patient management & appointments' },
                                    { key: 'real_estate', label: 'Real Estate', desc: 'Properties, leads & deals' },
                                    { key: 'other', label: 'Other Business', desc: 'Another type of business' },
                                ].map(({ key, label, desc }) => (
                                    <button key={key} onClick={() => handleStep1(key)} disabled={isLoading}
                                        className="flex items-center gap-4 w-full text-left px-5 py-4 bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 hover:border-neutral-900 rounded-xl transition-all group disabled:opacity-60">
                                        <span className="text-2xl">{icons[key]}</span>
                                        <div>
                                            <div className="font-semibold text-neutral-900 group-hover:text-black">{label}</div>
                                            <div className="text-sm text-neutral-500">{desc}</div>
                                        </div>
                                        <span className="ml-auto text-neutral-300 group-hover:text-neutral-700">→</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* === STEP 2: Company Details === */}
                    {step === 2 && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-8">
                                <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-2">Set up your workspace</h2>
                                <p className="text-neutral-500">Just the basics to get your CRM ready.</p>
                            </div>
                            <form onSubmit={handleStep2} className="space-y-5">
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Your Full Name <span className="text-red-500">*</span></label>
                                    <input type="text" name="name" value={formData.name} onChange={handleChange} required autoFocus
                                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:border-black transition-all"
                                        placeholder="Jane Doe" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Company Name <span className="text-red-500">*</span></label>
                                    <input type="text" name="companyName" value={formData.companyName} onChange={handleChange} required
                                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:border-black transition-all"
                                        placeholder="Acme Inc." />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Team Size</label>
                                        <select name="teamSize" value={formData.teamSize} onChange={handleChange}
                                            className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:border-black transition-all">
                                            <option value="">Select size</option>
                                            {['Just me', '2–10', '11–50', '51–200', '200+'].map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-semibold text-neutral-400 uppercase tracking-wider ml-1">Phone</label>
                                        <input type="tel" name="phone" value={formData.phone} onChange={handleChange}
                                            className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-xl text-neutral-900 focus:outline-none focus:border-black transition-all"
                                            placeholder="+91 99..." />
                                    </div>
                                </div>
                                <button type="submit" disabled={isLoading}
                                    className="w-full bg-black hover:bg-neutral-800 text-white font-bold py-4 rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 mt-2">
                                    {isLoading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</> : 'Continue →'}
                                </button>
                            </form>
                        </div>
                    )}

                    {/* === STEP 3: Activation Source === */}
                    {step === 3 && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="mb-8">
                                <h2 className="text-3xl font-bold text-neutral-900 tracking-tight mb-2">How will you get leads?</h2>
                                <p className="text-neutral-500">This helps us set up your first integrations automatically.</p>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                {[
                                    { key: 'meta_ads', label: 'Meta Ads', desc: 'Facebook & Instagram lead forms' },
                                    { key: 'whatsapp', label: 'WhatsApp', desc: 'Direct WhatsApp conversations' },
                                    { key: 'manual', label: 'Manual Upload', desc: 'Import from CSV or enter manually' },
                                    { key: 'other', label: 'Something else', desc: "I'll figure it out later" },
                                ].map(({ key, label, desc }) => (
                                    <button key={key} onClick={() => handleStep3(key)} disabled={isLoading}
                                        className="flex items-center gap-4 w-full text-left px-5 py-4 bg-neutral-50 hover:bg-black hover:text-white border border-neutral-200 hover:border-black rounded-xl transition-all group disabled:opacity-60">
                                        <span className="text-2xl">{key === 'other' ? icons.other_source : icons[key]}</span>
                                        <div>
                                            <div className="font-semibold">{label}</div>
                                            <div className="text-sm opacity-60">{desc}</div>
                                        </div>
                                        {isLoading ? <div className="ml-auto w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" /> : <span className="ml-auto opacity-30 group-hover:opacity-100">→</span>}
                                    </button>
                                ))}
                            </div>
                            <p className="text-center text-xs text-neutral-400 mt-6">🔒 Your 14-day free trial starts the moment you pick an option.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Onboarding;
