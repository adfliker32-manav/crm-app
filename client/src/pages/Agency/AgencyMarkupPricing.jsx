import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useNotification } from '../../context/NotificationContext';

const AgencyMarkupPricing = () => {
    const { user } = useAuth();
    const { showSuccess, showError } = useNotification();
    const [saving, setSaving] = useState(false);
    const [pricing, setPricing] = useState({
        trialDays: 14,
        basicPrice: 4900,
        basicLimit: { whatsapp: 1000, emails: 5000, clients: 5 },
        premiumPrice: 14900,
        premiumLimit: { whatsapp: 10000, emails: 50000, clients: 25 },
        currency: 'INR'
    });

    const handleSave = async () => {
        try {
            setSaving(true);
            await api.put('/agency/branding', { planLimits: pricing });
            showSuccess('Pricing & limits saved successfully!');
        } catch (e) {
            showError('Failed to save pricing.');
        } finally {
            setSaving(false);
        }
    };

    const Field = ({ label, value, onChange, prefix = '', suffix = '' }) => (
        <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">{label}</label>
            <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500">
                {prefix && <span className="px-3 py-2.5 bg-slate-50 text-slate-500 text-sm border-r border-slate-200">{prefix}</span>}
                <input
                    type="number"
                    value={value}
                    onChange={e => onChange(Number(e.target.value))}
                    className="flex-1 px-3 py-2.5 outline-none text-slate-900 font-semibold bg-white text-sm"
                />
                {suffix && <span className="px-3 py-2.5 bg-slate-50 text-slate-500 text-sm border-l border-slate-200">{suffix}</span>}
            </div>
        </div>
    );

    return (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-4xl mx-auto pb-20">
            <div className="mb-8">
                <h1 className="text-3xl font-black text-slate-900">Markup Pricing</h1>
                <p className="text-slate-500 mt-1">Set the prices and feature limits you charge your sub-clients. Your margin is the difference between what you charge and what you pay the platform.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                {/* Basic Plan */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                            <i className="fa-solid fa-seedling text-blue-600"></i>
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-800">Basic Plan</h2>
                            <p className="text-xs text-slate-400">Entry-level for new clients</p>
                        </div>
                    </div>

                    <Field label="Monthly Price (charged to client)" prefix="₹" value={pricing.basicPrice}
                        onChange={v => setPricing(p => ({...p, basicPrice: v}))} />
                    <Field label="WhatsApp Messages / Month" suffix="msgs" value={pricing.basicLimit.whatsapp}
                        onChange={v => setPricing(p => ({...p, basicLimit: {...p.basicLimit, whatsapp: v}}))} />
                    <Field label="Emails / Month" suffix="emails" value={pricing.basicLimit.emails}
                        onChange={v => setPricing(p => ({...p, basicLimit: {...p.basicLimit, emails: v}}))} />
                    <Field label="Max CRM Users" suffix="users" value={pricing.basicLimit.clients}
                        onChange={v => setPricing(p => ({...p, basicLimit: {...p.basicLimit, clients: v}}))} />

                    <div className="pt-2 border-t border-slate-100">
                        <p className="text-xs text-slate-400">Platform cost: <span className="font-bold text-slate-600">₹1,999/mo</span></p>
                        <p className="text-xs text-emerald-600 font-bold">Your margin: ₹{(pricing.basicPrice - 1999).toLocaleString()}/mo per client</p>
                    </div>
                </div>

                {/* Premium Plan */}
                <div className="bg-white rounded-2xl border-2 border-indigo-200 p-6 shadow-sm space-y-4 relative overflow-hidden">
                    <div className="absolute top-4 right-4 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-full uppercase">Popular</div>
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                            <i className="fa-solid fa-rocket text-indigo-600"></i>
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-800">Premium Plan</h2>
                            <p className="text-xs text-slate-400">Full-power for growing clients</p>
                        </div>
                    </div>

                    <Field label="Monthly Price (charged to client)" prefix="₹" value={pricing.premiumPrice}
                        onChange={v => setPricing(p => ({...p, premiumPrice: v}))} />
                    <Field label="WhatsApp Messages / Month" suffix="msgs" value={pricing.premiumLimit.whatsapp}
                        onChange={v => setPricing(p => ({...p, premiumLimit: {...p.premiumLimit, whatsapp: v}}))} />
                    <Field label="Emails / Month" suffix="emails" value={pricing.premiumLimit.emails}
                        onChange={v => setPricing(p => ({...p, premiumLimit: {...p.premiumLimit, emails: v}}))} />
                    <Field label="Max CRM Users" suffix="users" value={pricing.premiumLimit.clients}
                        onChange={v => setPricing(p => ({...p, premiumLimit: {...p.premiumLimit, clients: v}}))} />

                    <div className="pt-2 border-t border-slate-100">
                        <p className="text-xs text-slate-400">Platform cost: <span className="font-bold text-slate-600">₹4,999/mo</span></p>
                        <p className="text-xs text-emerald-600 font-bold">Your margin: ₹{(pricing.premiumPrice - 4999).toLocaleString()}/mo per client</p>
                    </div>
                </div>
            </div>

            {/* Trial & Currency Settings */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-6">
                <h2 className="font-bold text-slate-800 mb-4">Trial & Global Settings</h2>
                <div className="grid grid-cols-2 gap-4">
                    <Field label="Free Trial Duration" suffix="days" value={pricing.trialDays}
                        onChange={v => setPricing(p => ({...p, trialDays: v}))} />
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Currency</label>
                        <select value={pricing.currency} onChange={e => setPricing(p => ({...p, currency: e.target.value}))}
                            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold text-slate-900 bg-white cursor-pointer">
                            <option value="INR">₹ INR – Indian Rupee</option>
                            <option value="USD">$ USD – US Dollar</option>
                            <option value="EUR">€ EUR – Euro</option>
                        </select>
                    </div>
                </div>
            </div>

            <button onClick={handleSave} disabled={saving}
                className="w-full py-3.5 bg-black hover:bg-slate-800 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-xl shadow-black/10 disabled:opacity-70 flex items-center justify-center gap-2 text-sm">
                {saving ? <><i className="fa-solid fa-spinner fa-spin"></i> Saving...</> : <><i className="fa-solid fa-floppy-disk"></i> Save Pricing Configuration</>}
            </button>
        </div>
    );
};

export default AgencyMarkupPricing;
