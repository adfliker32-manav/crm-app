import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

const ALL_MODULES = [
    { id: 'leads',       name: 'Lead Management',     icon: 'fa-address-book',  desc: 'Capture, assign, and pipeline leads' },
    { id: 'whatsapp',    name: 'WhatsApp',            icon: 'fa-whatsapp',      desc: 'Send messages, broadcasts, templates', isBrand: true },
    { id: 'email',       name: 'Email',               icon: 'fa-envelope',      desc: 'Send campaigns and templates' },
    { id: 'automations', name: 'Automations',         icon: 'fa-bolt',          desc: 'Workflow rules and triggers' },
    { id: 'team',        name: 'Team',                icon: 'fa-users',         desc: 'Add agents, set permissions' },
    { id: 'reports',     name: 'Reports',             icon: 'fa-chart-pie',     desc: 'Analytics dashboards' },
    { id: 'api',         name: 'API Access',          icon: 'fa-code',          desc: 'Programmatic access via tokens' },
    { id: 'whitelabel',  name: 'White-Label',         icon: 'fa-palette',       desc: 'Custom branding & domain' },
    { id: 'settings',    name: 'Settings',            icon: 'fa-gear',          desc: 'Workspace configuration' }
];

// Sub-permissions surface as toggles only when the parent module is selected.
// Each links to a planFeatures.<key> on the WorkspaceSettings doc.
const SUB_PERMISSIONS = [
    { key: 'aiChatbot',         label: 'AI Chatbot',          desc: 'Auto-reply with chatbot flows on incoming WhatsApp', parentModule: 'whatsapp', icon: 'fa-robot' },
    { key: 'whatsappAutomation', label: 'WhatsApp Automation', desc: 'Trigger WhatsApp from automation rules',           parentModule: 'whatsapp', icon: 'fa-bolt-lightning' },
    { key: 'emailAutomation',   label: 'Email Automation',    desc: 'Trigger emails from automation rules',              parentModule: 'email',    icon: 'fa-envelopes-bulk' },
    { key: 'campaigns',         label: 'Bulk Campaigns',      desc: 'Send broadcasts to large audiences',                parentModule: 'email',    icon: 'fa-bullhorn' },
    { key: 'metaSync',          label: 'Meta Lead Ads Sync',  desc: 'Auto-import leads from Facebook/Instagram ads',     parentModule: 'leads',    icon: 'fa-meta' },
    { key: 'webhooks',          label: 'Webhooks',            desc: 'Outbound webhook events for integrations',          parentModule: 'api',      icon: 'fa-plug' },
    { key: 'advancedAnalytics', label: 'Advanced Analytics',  desc: 'Cohort, funnel, and revenue dashboards',            parentModule: 'reports',  icon: 'fa-chart-line' }
];

const passwordStrength = (pw) => {
    if (!pw) return { score: 0, label: '', color: 'bg-slate-200' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    const map = [
        { label: 'Too weak',  color: 'bg-red-500'    },
        { label: 'Weak',      color: 'bg-orange-500' },
        { label: 'Fair',      color: 'bg-amber-500'  },
        { label: 'Strong',    color: 'bg-emerald-500'},
        { label: 'Excellent', color: 'bg-emerald-600'}
    ];
    return { score, ...map[score] };
};

const generatePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const symbols = '!@#$%&*';
    let pw = '';
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    pw += symbols[Math.floor(Math.random() * symbols.length)];
    return pw;
};

const CreateSubClientModal = ({ isOpen, onClose, agencyWorkspace, onSuccess }) => {
    const { showError } = useNotification();
    const [step, setStep] = useState(1);
    const [submitting, setSubmitting] = useState(false);
    const [createdCredentials, setCreatedCredentials] = useState(null);
    const [showPassword, setShowPassword] = useState(false);

    const [form, setForm] = useState({
        companyName: '',
        adminName: '',
        adminEmail: '',
        phone: '',
        password: '',
        activeModules: ['leads', 'team', 'reports', 'settings'],
        leadLimit: 100,
        agentLimit: 2,
        planFeatures: {
            aiChatbot: false,
            whatsappAutomation: false,
            emailAutomation: false,
            campaigns: false,
            metaSync: false,
            webhooks: false,
            advancedAnalytics: false
        }
    });

    const agencyModules = agencyWorkspace?.activeModules || [];
    const agencyFeatures = agencyWorkspace?.planFeatures || {};
    const maxAgentLimit = agencyWorkspace?.agentLimit || 50;

    // Reset state when modal closes
    useEffect(() => {
        if (!isOpen) {
            setStep(1);
            setCreatedCredentials(null);
            setSubmitting(false);
            setShowPassword(false);
            setForm({
                companyName: '', adminName: '', adminEmail: '', phone: '', password: '',
                activeModules: ['leads', 'team', 'reports', 'settings'],
                leadLimit: 100, agentLimit: 2,
                planFeatures: {
                    aiChatbot: false, whatsappAutomation: false, emailAutomation: false,
                    campaigns: false, metaSync: false, webhooks: false, advancedAnalytics: false
                }
            });
        }
    }, [isOpen]);

    const pwInfo = useMemo(() => passwordStrength(form.password), [form.password]);

    const toggleModule = (modId) => {
        if (!agencyModules.includes(modId)) return; // Inheritance — locked
        setForm(prev => {
            const has = prev.activeModules.includes(modId);
            const next = { ...prev, activeModules: has
                ? prev.activeModules.filter(id => id !== modId)
                : [...prev.activeModules, modId]
            };
            // If we just removed a module, also disable its sub-permissions
            if (has) {
                const newFeatures = { ...prev.planFeatures };
                SUB_PERMISSIONS
                    .filter(sp => sp.parentModule === modId)
                    .forEach(sp => { newFeatures[sp.key] = false; });
                next.planFeatures = newFeatures;
            }
            return next;
        });
    };

    const toggleFeature = (key) => {
        setForm(prev => ({
            ...prev,
            planFeatures: { ...prev.planFeatures, [key]: !prev.planFeatures[key] }
        }));
    };

    const validateStep = (s) => {
        if (s === 1) {
            if (!form.companyName.trim()) return 'Company name is required.';
            if (!form.adminEmail.trim()) return 'Admin email is required.';
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) return 'Enter a valid email.';
        }
        if (s === 2 && form.activeModules.length === 0) return 'Select at least one module.';
        if (s === 4) {
            if (!form.password) return 'Password is required.';
            if (form.password.length < 8) return 'Password must be at least 8 characters.';
            if (pwInfo.score < 2) return 'Password is too weak. Use upper-case, numbers, or symbols.';
        }
        return null;
    };

    const handleNext = () => {
        const err = validateStep(step);
        if (err) return showError(err);
        setStep(s => Math.min(4, s + 1));
    };

    const handleSubmit = async () => {
        const err = validateStep(1) || validateStep(2) || validateStep(4);
        if (err) return showError(err);
        setSubmitting(true);
        try {
            const res = await api.post('/agency/clients', {
                companyName: form.companyName.trim(),
                adminName: form.adminName.trim(),
                adminEmail: form.adminEmail.trim().toLowerCase(),
                phone: form.phone.trim() || null,
                password: form.password,
                activeModules: form.activeModules,
                leadLimit: form.leadLimit,
                agentLimit: form.agentLimit,
                planFeatures: form.planFeatures
            });
            if (res.data?.success) {
                setCreatedCredentials(res.data.credentials);
                if (onSuccess) onSuccess();
            }
        } catch (e) {
            showError(e.response?.data?.message || 'Failed to create client.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    // ─────────────────────────────────────── SUCCESS SCREEN ───────────────────────────────────────
    if (createdCredentials) {
        return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
                    <div className="p-6 text-center">
                        <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <i className="fa-solid fa-hourglass-half text-amber-600 text-3xl" />
                        </div>
                        <h2 className="text-xl font-black text-slate-900">Submitted for Approval</h2>
                        <p className="text-sm text-slate-500 mt-1">
                            The Super Admin will review your request. Share these credentials only after approval.
                        </p>
                    </div>
                    <div className="px-6 pb-2 space-y-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-slate-500 uppercase">Email</span>
                                <span className="font-mono text-sm font-bold text-slate-800">{createdCredentials.email}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs font-bold text-slate-500 uppercase">Password</span>
                                <span className="font-mono text-sm font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{createdCredentials.tempPassword}</span>
                            </div>
                        </div>
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
                            <i className="fa-solid fa-shield-check text-amber-600 mt-0.5 text-xs" />
                            <p className="text-xs text-amber-700">
                                The client cannot log in until the Super Admin approves the account. Watch the dashboard for status.
                            </p>
                        </div>
                    </div>
                    <div className="p-6">
                        <button
                            onClick={onClose}
                            className="w-full py-2.5 bg-slate-900 hover:bg-black text-white font-bold rounded-xl transition"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ─────────────────────────────────────── FORM ───────────────────────────────────────
    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl my-8 animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-black text-slate-900">Create Client Account</h2>
                        <p className="text-xs text-slate-500 mt-0.5">Configure access — Super Admin will review and approve.</p>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center">
                        <i className="fa-solid fa-times" />
                    </button>
                </div>

                {/* Stepper */}
                <div className="px-8 pt-5 pb-2 flex items-center gap-2 flex-wrap">
                    {[
                        { n: 1, label: 'Company' },
                        { n: 2, label: 'Modules' },
                        { n: 3, label: 'Limits' },
                        { n: 4, label: 'Password' }
                    ].map((s, idx, arr) => (
                        <React.Fragment key={s.n}>
                            <button
                                type="button"
                                onClick={() => { if (s.n < step) setStep(s.n); }}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold transition
                                    ${step === s.n ? 'bg-blue-600 text-white' :
                                      step > s.n  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 cursor-pointer' :
                                                    'bg-slate-100 text-slate-400 cursor-default'}`}
                            >
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black
                                    ${step === s.n ? 'bg-white text-blue-600' :
                                      step > s.n  ? 'bg-emerald-600 text-white' : 'bg-white text-slate-400'}`}>
                                    {step > s.n ? <i className="fa-solid fa-check text-[8px]" /> : s.n}
                                </span>
                                {s.label}
                            </button>
                            {idx < arr.length - 1 && <div className="flex-1 h-px bg-slate-200 max-w-[40px]" />}
                        </React.Fragment>
                    ))}
                </div>

                {/* Body */}
                <div className="px-8 py-6 overflow-y-auto flex-1">
                    {/* STEP 1: Company Info */}
                    {step === 1 && (
                        <div className="space-y-4 animate-in fade-in duration-200">
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2 text-xs text-blue-800">
                                <i className="fa-solid fa-circle-info text-blue-600 mt-0.5" />
                                <span>Tell us about the client's business and admin contact.</span>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Company Name *</label>
                                <input type="text" value={form.companyName}
                                    onChange={e => setForm({ ...form, companyName: e.target.value })}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                                    placeholder="e.g. Acme Real Estate" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Admin Name</label>
                                    <input type="text" value={form.adminName}
                                        onChange={e => setForm({ ...form, adminName: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                                        placeholder="John Doe" />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Phone</label>
                                    <input type="text" value={form.phone}
                                        onChange={e => setForm({ ...form, phone: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                                        placeholder="+91 98765 43210" />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Admin Email (Login ID) *</label>
                                <input type="email" value={form.adminEmail}
                                    onChange={e => setForm({ ...form, adminEmail: e.target.value })}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium"
                                    placeholder="admin@acme.com" />
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Modules + Sub-permissions */}
                    {step === 2 && (
                        <div className="space-y-5 animate-in fade-in duration-200">
                            <div>
                                <h3 className="text-sm font-black text-slate-900 mb-1">Modules to Grant</h3>
                                <p className="text-xs text-slate-500 mb-4">Tick the modules this client can access. Greyed modules are locked because your agency doesn't own them.</p>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                    {ALL_MODULES.map(mod => {
                                        const owned = agencyModules.includes(mod.id);
                                        const enabled = form.activeModules.includes(mod.id);
                                        return (
                                            <button
                                                type="button"
                                                key={mod.id}
                                                onClick={() => toggleModule(mod.id)}
                                                disabled={!owned}
                                                className={`text-left p-3 rounded-xl border-2 transition-all relative
                                                    ${!owned ? 'bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed' :
                                                      enabled ? 'border-blue-600 bg-blue-50 ring-2 ring-blue-100' :
                                                                'border-slate-200 hover:border-slate-300 bg-white'}`}
                                            >
                                                <div className="flex items-start justify-between mb-1">
                                                    <i className={`${mod.isBrand ? 'fa-brands' : 'fa-solid'} ${mod.icon} text-base ${enabled ? 'text-blue-600' : 'text-slate-400'}`} />
                                                    {enabled && (
                                                        <div className="w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center">
                                                            <i className="fa-solid fa-check text-[8px]" />
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={`text-[12px] font-bold ${enabled ? 'text-blue-900' : 'text-slate-700'}`}>{mod.name}</div>
                                                <div className="text-[10px] text-slate-500 leading-tight mt-0.5">{mod.desc}</div>
                                                {!owned && <div className="text-[9px] font-bold text-red-500 uppercase mt-1">Locked</div>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Sub-permissions — only show those whose parent module is selected */}
                            {(() => {
                                const visibleSubs = SUB_PERMISSIONS.filter(sp =>
                                    form.activeModules.includes(sp.parentModule)
                                );
                                if (visibleSubs.length === 0) return null;
                                return (
                                    <div className="border-t border-slate-100 pt-5">
                                        <h3 className="text-sm font-black text-slate-900 mb-1">Sub-Permissions</h3>
                                        <p className="text-xs text-slate-500 mb-4">Fine-grained toggles within the modules you've granted. Locked items aren't enabled on your agency plan.</p>
                                        <div className="space-y-2">
                                            {visibleSubs.map(sp => {
                                                const enabled = !!form.planFeatures[sp.key];
                                                // Inheritance: agency must have the feature themselves
                                                const agencyHas = agencyFeatures[sp.key] !== false; // undefined = treat as available
                                                return (
                                                    <div key={sp.key}
                                                        className={`flex items-center gap-3 p-3 rounded-xl border transition
                                                            ${!agencyHas ? 'bg-slate-50 border-slate-100 opacity-50' :
                                                              enabled ? 'border-blue-300 bg-blue-50/50' : 'border-slate-200 bg-white'}`}
                                                    >
                                                        <i className={`fa-solid ${sp.icon} text-base ${enabled ? 'text-blue-600' : 'text-slate-400'}`} />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                                                                {sp.label}
                                                                <span className="text-[9px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded uppercase">{sp.parentModule}</span>
                                                            </div>
                                                            <div className="text-[11px] text-slate-500">{sp.desc}</div>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            disabled={!agencyHas}
                                                            onClick={() => toggleFeature(sp.key)}
                                                            className={`relative w-10 h-5 rounded-full transition flex-shrink-0
                                                                ${enabled ? 'bg-blue-600' : 'bg-slate-300'}
                                                                ${!agencyHas ? 'cursor-not-allowed opacity-50' : ''}`}
                                                        >
                                                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all
                                                                ${enabled ? 'left-5' : 'left-0.5'}`} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* STEP 3: Limits */}
                    {step === 3 && (
                        <div className="space-y-5 animate-in fade-in duration-200">
                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-start gap-2 text-xs text-blue-800">
                                <i className="fa-solid fa-circle-info text-blue-600 mt-0.5" />
                                <span>Set monthly lead intake and number of agent seats. Super Admin can adjust these on approval.</span>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                                    <span>Monthly Lead Limit</span>
                                    <span className="text-blue-600 font-black text-base">{form.leadLimit.toLocaleString()}</span>
                                </label>
                                <input type="range" min="50" max="10000" step="50"
                                    value={form.leadLimit}
                                    onChange={e => setForm({ ...form, leadLimit: parseInt(e.target.value) })}
                                    className="w-full accent-blue-600"
                                />
                                <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                                    <span>50</span><span>2,500</span><span>5,000</span><span>10,000</span>
                                </div>
                                <div className="flex gap-2 mt-2">
                                    {[100, 500, 1000, 5000].map(v => (
                                        <button type="button" key={v} onClick={() => setForm({ ...form, leadLimit: v })}
                                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition
                                                ${form.leadLimit === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                                            {v.toLocaleString()}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                                    <span>Agent Seats</span>
                                    <span className="text-blue-600 font-black text-base">{form.agentLimit}</span>
                                </label>
                                <input type="range" min="1" max={Math.max(20, maxAgentLimit)} step="1"
                                    value={form.agentLimit}
                                    onChange={e => setForm({ ...form, agentLimit: parseInt(e.target.value) })}
                                    className="w-full accent-blue-600"
                                />
                                <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-medium">
                                    <span>1</span>
                                    <span>{Math.floor(Math.max(20, maxAgentLimit) / 2)}</span>
                                    <span>{Math.max(20, maxAgentLimit)}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* STEP 4: Password */}
                    {step === 4 && (
                        <div className="space-y-5 animate-in fade-in duration-200">
                            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-800">
                                <i className="fa-solid fa-key text-amber-600 mt-0.5" />
                                <span>Set the initial login password. Share with the client only after Super Admin approves the account.</span>
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 block">Password *</label>
                                <div className="relative">
                                    <input type={showPassword ? 'text' : 'password'} value={form.password}
                                        onChange={e => setForm({ ...form, password: e.target.value })}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-24 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-sm"
                                        placeholder="At least 8 characters" />
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                                        <button type="button" onClick={() => setShowPassword(s => !s)}
                                            className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-500 flex items-center justify-center" title={showPassword ? 'Hide' : 'Show'}>
                                            <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'} text-xs`} />
                                        </button>
                                        <button type="button" onClick={() => { setForm({ ...form, password: generatePassword() }); setShowPassword(true); }}
                                            className="w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-500 flex items-center justify-center" title="Generate">
                                            <i className="fa-solid fa-wand-magic-sparkles text-xs" />
                                        </button>
                                    </div>
                                </div>
                                {form.password && (
                                    <div className="mt-2">
                                        <div className="flex gap-1 mb-1">
                                            {[1,2,3,4].map(i => (
                                                <div key={i} className={`flex-1 h-1.5 rounded-full ${pwInfo.score >= i ? pwInfo.color : 'bg-slate-200'}`} />
                                            ))}
                                        </div>
                                        <div className="text-[11px] font-bold text-slate-500">{pwInfo.label}</div>
                                    </div>
                                )}
                            </div>

                            {/* Final review summary */}
                            <div className="border-t border-slate-100 pt-4">
                                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-3">Review Before Submit</h4>
                                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-xs">
                                    <div className="flex justify-between"><span className="text-slate-500">Company</span><span className="font-bold text-slate-800">{form.companyName}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Admin Email</span><span className="font-bold text-slate-800">{form.adminEmail}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Modules</span><span className="font-bold text-slate-800">{form.activeModules.length}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Sub-permissions</span><span className="font-bold text-slate-800">{Object.values(form.planFeatures).filter(Boolean).length}</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Lead Limit</span><span className="font-bold text-slate-800">{form.leadLimit.toLocaleString()}/mo</span></div>
                                    <div className="flex justify-between"><span className="text-slate-500">Agent Seats</span><span className="font-bold text-slate-800">{form.agentLimit}</span></div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-8 py-4 border-t border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-b-3xl">
                    <button
                        type="button"
                        onClick={() => step === 1 ? onClose() : setStep(s => s - 1)}
                        className="px-5 py-2.5 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition flex items-center gap-2"
                    >
                        <i className={`fa-solid ${step === 1 ? 'fa-times' : 'fa-arrow-left'} text-xs`} />
                        {step === 1 ? 'Cancel' : 'Back'}
                    </button>
                    {step < 4 ? (
                        <button
                            type="button"
                            onClick={handleNext}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-blue-600/20"
                        >
                            Next
                            <i className="fa-solid fa-arrow-right text-xs" />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleSubmit}
                            disabled={submitting}
                            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition flex items-center gap-2 shadow-lg shadow-emerald-600/20 disabled:opacity-60"
                        >
                            {submitting ? (
                                <><i className="fa-solid fa-spinner fa-spin text-xs" />Submitting...</>
                            ) : (
                                <><i className="fa-solid fa-paper-plane text-xs" />Submit for Approval</>
                            )}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CreateSubClientModal;
