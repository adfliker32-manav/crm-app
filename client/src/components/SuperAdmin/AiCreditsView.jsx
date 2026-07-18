import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';

// Super-admin editor for the AI credit rate table. Each model's credits-per-1K-tokens
// is editable live (no deploy) and takes effect on the next AI call (server cache
// busts on save). Credit money value is shown so rates can be reasoned about in ₹.
const AiCreditsView = () => {
    const { showSuccess, showError } = useNotification();
    const [loading, setLoading] = useState(true);
    const [rates, setRates] = useState([]);
    const [creditValueInr, setCreditValueInr] = useState(0.01);
    const [defaultRate, setDefaultRate] = useState(20);
    const [savingModel, setSavingModel] = useState(null);

    // New-model form
    const [newModel, setNewModel] = useState({ model: '', provider: 'gemini', label: '', creditsPer1kTokens: '' });

    const fetchRates = async () => {
        try {
            setLoading(true);
            const res = await api.get('/superadmin/ai-model-rates');
            setRates(res.data.rates || []);
            setCreditValueInr(res.data.creditValueInr ?? 0.01);
            setDefaultRate(res.data.defaultRatePer1k ?? 20);
        } catch (err) {
            console.error('Failed to load AI model rates:', err);
            showError('Failed to load AI model rates.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchRates(); }, []);

    // Local edit of a rate cell before saving.
    const updateLocal = (model, field, value) => {
        setRates(prev => prev.map(r => r.model === model ? { ...r, [field]: value } : r));
    };

    const saveRate = async (row) => {
        const credits = Number(row.creditsPer1kTokens);
        if (isNaN(credits) || credits < 0) {
            showError('Credits per 1K tokens must be a non-negative number.');
            return;
        }
        try {
            setSavingModel(row.model);
            await api.put('/superadmin/ai-model-rates', {
                model: row.model,
                provider: row.provider,
                label: row.label,
                creditsPer1kTokens: credits,
                active: row.active
            });
            showSuccess(`Saved rate for ${row.model}.`);
            fetchRates();
        } catch (err) {
            console.error('Failed to save rate:', err);
            showError(err.response?.data?.message || 'Failed to save rate.');
        } finally {
            setSavingModel(null);
        }
    };

    const addModel = async () => {
        if (!newModel.model.trim()) { showError('Model id is required.'); return; }
        const credits = Number(newModel.creditsPer1kTokens);
        if (isNaN(credits) || credits < 0) { showError('Enter a valid credits-per-1K value.'); return; }
        try {
            setSavingModel('__new__');
            await api.put('/superadmin/ai-model-rates', {
                model: newModel.model.trim(),
                provider: newModel.provider,
                label: newModel.label.trim(),
                creditsPer1kTokens: credits,
                active: true
            });
            showSuccess(`Added ${newModel.model}.`);
            setNewModel({ model: '', provider: 'gemini', label: '', creditsPer1kTokens: '' });
            fetchRates();
        } catch (err) {
            console.error('Failed to add model:', err);
            showError(err.response?.data?.message || 'Failed to add model.');
        } finally {
            setSavingModel(null);
        }
    };

    // Credits per rupee, e.g. ₹0.01/credit -> 100 credits = ₹1.
    const creditsPerRupee = creditValueInr > 0 ? Math.round(1 / creditValueInr) : 0;
    const inrPer1k = (credits) => (Number(credits || 0) * creditValueInr).toFixed(2);

    return (
        <div className="p-6 lg:p-8 max-w-6xl mx-auto">
            <div className="mb-6">
                <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
                    <i className="fa-solid fa-coins text-indigo-500"></i> AI Credit Rates
                </h1>
                <p className="text-slate-500 mt-1">
                    Set how many credits each model costs per 1,000 tokens. Changes take effect immediately on the next AI call.
                </p>
            </div>

            {/* Credit value banner */}
            <div className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm mb-6 flex flex-wrap items-center gap-6">
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Credit Value</p>
                    <p className="text-lg font-black text-slate-800">₹{creditValueInr} <span className="text-sm font-bold text-slate-400">/ credit</span></p>
                </div>
                <div className="h-8 w-px bg-slate-100"></div>
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Conversion</p>
                    <p className="text-lg font-black text-slate-800">₹1 = {creditsPerRupee.toLocaleString()} credits</p>
                </div>
                <div className="h-8 w-px bg-slate-100"></div>
                <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Fallback Rate</p>
                    <p className="text-lg font-black text-slate-800">{defaultRate} <span className="text-sm font-bold text-slate-400">cr / 1K (untabled models)</span></p>
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <i className="fa-solid fa-spinner fa-spin text-3xl text-indigo-500"></i>
                    <p className="text-slate-500 font-semibold">Loading rates...</p>
                </div>
            ) : (
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-slate-400 bg-slate-50/70 text-[11px] uppercase tracking-wider">
                                    <th className="px-5 py-3 font-black">Model</th>
                                    <th className="px-5 py-3 font-black">Provider</th>
                                    <th className="px-5 py-3 font-black">Label</th>
                                    <th className="px-5 py-3 font-black text-right">Credits / 1K</th>
                                    <th className="px-5 py-3 font-black text-right">≈ ₹ / 1K</th>
                                    <th className="px-5 py-3 font-black text-center">Active</th>
                                    <th className="px-5 py-3 font-black text-right">Save</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {rates.map((row) => (
                                    <tr key={row.model} className="hover:bg-slate-50/60">
                                        <td className="px-5 py-3 font-mono text-xs font-bold text-slate-700">{row.model}</td>
                                        <td className="px-5 py-3 text-slate-500">{row.provider}</td>
                                        <td className="px-5 py-3">
                                            <input
                                                type="text"
                                                value={row.label || ''}
                                                onChange={(e) => updateLocal(row.model, 'label', e.target.value)}
                                                className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                            />
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <input
                                                type="number"
                                                min="0"
                                                value={row.creditsPer1kTokens}
                                                onChange={(e) => updateLocal(row.model, 'creditsPer1kTokens', e.target.value)}
                                                className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                                            />
                                        </td>
                                        <td className="px-5 py-3 text-right text-slate-500 font-semibold">₹{inrPer1k(row.creditsPer1kTokens)}</td>
                                        <td className="px-5 py-3 text-center">
                                            <button
                                                type="button"
                                                onClick={() => updateLocal(row.model, 'active', !row.active)}
                                                className={`w-11 h-6 rounded-full transition-colors inline-flex items-center p-0.5 ${row.active ? 'bg-emerald-500 justify-end' : 'bg-slate-300 justify-start'}`}
                                            >
                                                <span className="w-5 h-5 rounded-full bg-white shadow-md"></span>
                                            </button>
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <button
                                                onClick={() => saveRate(row)}
                                                disabled={savingModel === row.model}
                                                className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-60"
                                            >
                                                {savingModel === row.model ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Save'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Add-new-model row */}
                    <div className="p-5 border-t border-slate-100 bg-slate-50/50">
                        <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">Add a model</p>
                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                            <input
                                type="text"
                                placeholder="model id (e.g. claude-sonnet)"
                                value={newModel.model}
                                onChange={(e) => setNewModel({ ...newModel, model: e.target.value })}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                            />
                            <select
                                value={newModel.provider}
                                onChange={(e) => setNewModel({ ...newModel, provider: e.target.value })}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                            >
                                <option value="gemini">gemini</option>
                                <option value="openai">openai</option>
                                <option value="anthropic">anthropic</option>
                                <option value="other">other</option>
                            </select>
                            <input
                                type="text"
                                placeholder="label"
                                value={newModel.label}
                                onChange={(e) => setNewModel({ ...newModel, label: e.target.value })}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                            <input
                                type="number"
                                min="0"
                                placeholder="credits / 1K"
                                value={newModel.creditsPer1kTokens}
                                onChange={(e) => setNewModel({ ...newModel, creditsPer1kTokens: e.target.value })}
                                className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-right font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                            <button
                                onClick={addModel}
                                disabled={savingModel === '__new__'}
                                className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-bold transition disabled:opacity-60"
                            >
                                {savingModel === '__new__' ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Add Model'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AiCreditsView;
