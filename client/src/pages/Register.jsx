import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Register = () => {
    const navigate = useNavigate();
    const { register } = useAuth();

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        companyName: '',
        industry: '',
        teamSize: '',
        phone: ''
    });

    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [step, setStep] = useState(1);
    const [touched, setTouched] = useState({});

    const INDUSTRIES = [
        'Marketing Agency', 'Real Estate', 'E-commerce', 'SaaS / Software',
        'Consulting', 'Financial Services', 'Education', 'Healthcare', 'Other'
    ];

    const TEAM_SIZES = [
        'Just me', '2-5', '6-20', '21-50', '50+'
    ];

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (error) setError('');
    };

    const handleBlur = (e) => {
        setTouched(prev => ({ ...prev, [e.target.name]: true }));
    };

    const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    const validateStep1 = () => {
        if (!formData.name.trim()) return "Name is required";
        if (!formData.email.trim()) return "Email is required";
        if (!isValidEmail(formData.email)) return "Please enter a valid email";
        if (!formData.password || formData.password.length < 6) return "Password must be at least 6 characters";
        return null;
    };

    const nextStep = () => {
        const stepError = validateStep1();
        if (stepError) {
            setError(stepError);
            return;
        }
        setError('');
        setStep(2);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!formData.companyName.trim()) {
            setError("Company name is required");
            return;
        }
        setError('');
        setIsLoading(true);

        const result = await register(formData);
        if (result.success) {
            navigate('/dashboard');
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
                        Start closing more deals today.
                    </h1>
                    <p className="text-neutral-400 text-lg leading-relaxed mb-8">
                        Join thousands of teams using CRM Pro to streamline their sales process.
                    </p>

                    <div className="flex items-center gap-6">
                        <div className="text-center">
                            <div className="text-3xl font-semibold text-white">10K+</div>
                            <div className="text-sm text-neutral-500">Teams</div>
                        </div>
                        <div className="w-px h-10 bg-neutral-800"></div>
                        <div className="text-center">
                            <div className="text-3xl font-semibold text-white">4.9</div>
                            <div className="text-sm text-neutral-500">Rating</div>
                        </div>
                        <div className="w-px h-10 bg-neutral-800"></div>
                        <div className="text-center">
                            <div className="text-3xl font-semibold text-white">99%</div>
                            <div className="text-sm text-neutral-500">Uptime</div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-8 text-neutral-500 text-sm">
                    <span>© 2026 CRM Pro</span>
                    <a href="#" className="hover:text-white transition-colors">Privacy</a>
                    <a href="#" className="hover:text-white transition-colors">Terms</a>
                </div>
            </div>

            {/* Right - Form */}
            <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
                <div className="w-full max-w-md">
                    {/* Mobile Logo */}
                    <div className="lg:hidden flex items-center gap-2 mb-12">
                        <div className="w-8 h-8 bg-neutral-950 rounded-lg flex items-center justify-center">
                            <span className="text-white font-black text-sm">C</span>
                        </div>
                        <span className="text-neutral-950 font-semibold text-lg">CRM Pro</span>
                    </div>

                    {/* Step Indicator */}
                    <div className="flex items-center gap-3 mb-8">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${step >= 1 ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'}`}>1</div>
                        <div className={`flex-1 h-0.5 ${step >= 2 ? 'bg-neutral-900' : 'bg-neutral-100'}`}></div>
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${step >= 2 ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-400'}`}>2</div>
                    </div>

                    <div className="mb-8">
                        <h2 className="text-2xl font-semibold text-neutral-900 mb-2">
                            {step === 1 ? 'Create your account' : 'About your business'}
                        </h2>
                        <p className="text-neutral-500">
                            {step === 1 ? 'Start your 14-day free trial' : 'Help us personalize your experience'}
                        </p>
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-6 border border-red-100">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {/* Step 1 */}
                        <div className={step === 1 ? 'block space-y-5' : 'hidden'}>
                            <div>
                                <label className="block text-sm font-medium text-neutral-700 mb-2">Full name</label>
                                <input
                                    type="text"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleChange}
                                    onBlur={handleBlur}
                                    className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                                    placeholder="John Doe"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-neutral-700 mb-2">Work email</label>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    onBlur={handleBlur}
                                    className={`w-full px-4 py-3 bg-neutral-50 border rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all ${touched.email && formData.email && !isValidEmail(formData.email)
                                            ? 'border-red-300'
                                            : 'border-neutral-200'
                                        }`}
                                    placeholder="you@company.com"
                                />
                                {touched.email && formData.email && !isValidEmail(formData.email) && (
                                    <p className="text-red-500 text-xs mt-1">Please enter a valid email</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-neutral-700 mb-2">Password</label>
                                <input
                                    type="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                                    placeholder="6+ characters"
                                />
                            </div>

                            <button
                                type="button"
                                onClick={nextStep}
                                className="w-full bg-neutral-900 hover:bg-neutral-800 text-white font-medium py-3 rounded-lg transition-colors"
                            >
                                Continue
                            </button>
                        </div>

                        {/* Step 2 */}
                        <div className={step === 2 ? 'block space-y-5' : 'hidden'}>
                            <div>
                                <label className="block text-sm font-medium text-neutral-700 mb-2">Company name</label>
                                <input
                                    type="text"
                                    name="companyName"
                                    value={formData.companyName}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                                    placeholder="Acme Inc."
                                    autoFocus
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-2">Industry</label>
                                    <select
                                        name="industry"
                                        value={formData.industry}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all appearance-none cursor-pointer"
                                    >
                                        <option value="">Select</option>
                                        {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-neutral-700 mb-2">Team size</label>
                                    <select
                                        name="teamSize"
                                        value={formData.teamSize}
                                        onChange={handleChange}
                                        className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all appearance-none cursor-pointer"
                                    >
                                        <option value="">Select</option>
                                        {TEAM_SIZES.map(size => <option key={size} value={size}>{size}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-neutral-700 mb-2">
                                    Phone <span className="text-neutral-400 font-normal">(optional)</span>
                                </label>
                                <input
                                    type="tel"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className="w-full px-4 py-3 bg-neutral-50 border border-neutral-200 rounded-lg text-neutral-900 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all"
                                    placeholder="+1 555 000 0000"
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => setStep(1)}
                                    className="px-6 py-3 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 font-medium rounded-lg transition-colors"
                                >
                                    Back
                                </button>
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-white font-medium py-3 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    {isLoading ? 'Creating account...' : 'Start free trial'}
                                </button>
                            </div>
                        </div>
                    </form>

                    <div className="mt-8 pt-8 border-t border-neutral-100 text-center">
                        <p className="text-neutral-500 text-sm">
                            Already have an account?{' '}
                            <Link to="/login" className="text-neutral-900 font-medium hover:underline">
                                Sign in
                            </Link>
                        </p>
                    </div>

                    <p className="mt-6 text-xs text-neutral-400 text-center">
                        By continuing, you agree to our Terms of Service and Privacy Policy.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default Register;
