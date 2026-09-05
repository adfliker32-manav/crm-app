/* eslint-disable no-unused-vars, react-hooks/exhaustive-deps */
import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useNotification } from '../../context/NotificationContext';
import { useConfirm } from '../../context/ConfirmContext';

const PartnerApiKeyTab = ({ partner, onRefresh }) => {
    const { showSuccess, showError } = useNotification();
    const { showDanger } = useConfirm();
    const [usage, setUsage] = useState([]);
    const [loadingUsage, setLoadingUsage] = useState(true);
    const [copied, setCopied] = useState(false);
    const [newlyGeneratedKey, setNewlyGeneratedKey] = useState(null); // holds full key after regenerate
    const [showKey, setShowKey] = useState(false);
    const [newWebhookSecret, setNewWebhookSecret] = useState(null);   // holds full secret after rotate
    const [secretCopied, setSecretCopied] = useState(false);

    useEffect(() => { fetchUsage(); }, [partner._id]);

    const fetchUsage = async () => {
        setLoadingUsage(true);
        try {
            const res = await api.get(`/superadmin/partner-apps/${partner._id}/api-usage`);
            setUsage(res.data.data || []);
        } catch { /* silent */ }
        finally { setLoadingUsage(false); }
    };

    const handleRegenerate = async () => {
        const confirmed = await showDanger(
            'This will invalidate the current API key immediately. The partner must update their integration with the new key.',
            'Regenerate API Key?'
        );
        if (!confirmed) return;

        try {
            const res = await api.post(`/superadmin/partner-apps/${partner._id}/regenerate-key`);
            // Store the full new key locally — onRefresh() returns masked version
            setNewlyGeneratedKey(res.data.apiKey);
            setShowKey(true); // auto-reveal so user can copy it
            showSuccess('✅ New API key generated — copy it now, it will be hidden after!');
            onRefresh();
        } catch { showError('Failed to regenerate key'); }
    };

    const handleRotateSecret = async () => {
        const confirmed = await showDanger(
            'A new signing secret takes effect immediately. Deliveries signed with the old secret will fail the partner\'s verification until they update it.',
            'Rotate Webhook Secret?'
        );
        if (!confirmed) return;

        try {
            const res = await api.post(`/superadmin/partner-apps/${partner._id}/rotate-webhook-secret`);
            setNewWebhookSecret(res.data.secret);
            showSuccess('New signing secret generated — copy it now, it is not shown again!');
            onRefresh();
        } catch { showError('Failed to rotate webhook secret'); }
    };

    // PA-M6: this used to fall back to `partner.apiKey`, which the API returns
    // MASKED ("partner_abc123••••••"). Copying outside the regenerate flow
    // therefore handed the partner a dead string that looked plausible. The full
    // key only exists in this component immediately after a rotation — and,
    // since keys are now stored hashed, nowhere else at all — so there is
    // nothing to copy unless we have it.
    const handleCopyKey = () => {
        if (!newlyGeneratedKey) return;
        navigator.clipboard.writeText(newlyGeneratedKey);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
    };

    // Build chart data from last 7 days
    const last7 = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const entry = usage.find(u => u.date === dateStr);
        last7.push({
            date: dateStr,
            label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
            count: entry?.count || 0
        });
    }
    const maxCount = Math.max(...last7.map(d => d.count), 1);

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Current Key */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">API Key</h3>

                {/* Banner shown only right after regeneration */}
                {newlyGeneratedKey && (
                    <div className="mb-3 flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-xl p-3 text-xs text-amber-800">
                        <i className="fa-solid fa-triangle-exclamation mt-0.5 flex-shrink-0" />
                        <span><strong>Copy this key now!</strong> It will be hidden once you leave this page. The old key is already invalid.</span>
                    </div>
                )}

                <div className={`rounded-xl p-4 ${newlyGeneratedKey ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                    <div className="flex items-center justify-between mb-3 gap-2">
                        <div className="font-mono text-sm break-all flex-1 text-slate-700">
                            {newlyGeneratedKey
                                ? (showKey ? newlyGeneratedKey : `${newlyGeneratedKey.slice(0, 12)}${'•'.repeat(20)}`)
                                : (partner.apiKey || 'No key on record')
                            }
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {/* Show/hide toggle — only useful when we have the full key */}
                            {newlyGeneratedKey && (
                                <button onClick={() => setShowKey(v => !v)}
                                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 text-slate-600 hover:bg-slate-300 transition">
                                    <i className={`fa-solid ${showKey ? 'fa-eye-slash' : 'fa-eye'} mr-1`} />
                                    {showKey ? 'Hide' : 'Reveal'}
                                </button>
                            )}
                            {/* Only offered when a real key is in hand — otherwise
                                there is nothing but the mask to copy. */}
                            <button onClick={handleCopyKey}
                                disabled={!newlyGeneratedKey}
                                title={newlyGeneratedKey ? 'Copy the full API key' : 'The full key is only available immediately after generating it'}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                                    copied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                                } disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-200`}>
                                {copied ? <><i className="fa-solid fa-check mr-1" />Copied</> : <><i className="fa-solid fa-clipboard mr-1" />Copy</>}
                            </button>
                        </div>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                        <span><i className="fa-solid fa-calendar mr-1" />Created {new Date(partner.createdAt).toLocaleDateString('en-IN')}</span>
                    </div>
                </div>

                <button onClick={handleRegenerate}
                    className="mt-3 px-5 py-2 border border-amber-300 text-amber-700 rounded-lg text-sm font-semibold hover:bg-amber-50 transition flex items-center gap-2">
                    <i className="fa-solid fa-rotate" />
                    Regenerate Key
                </button>
                <p className="text-xs text-slate-400 mt-1">
                    ⚠️ This invalidates the current key immediately. Keys are stored hashed, so the
                    full value exists only in the moment it is generated — there is no way to look
                    an existing key up later.
                </p>
            </section>

            {/* ── Webhook signing secret ─────────────────────────────────────
                Previously unreachable: generated at partner creation, discarded
                by the create modal, and shown only as a stub in Settings — so an
                admin had no way to hand a partner the secret their signature
                verification needs, and no way to rotate a leaked one. */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Webhook Signing Secret</h3>
                {newWebhookSecret ? (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
                        <p className="text-xs text-amber-800 mb-2">
                            <i className="fa-solid fa-triangle-exclamation mr-1" />
                            <strong>Send this to the partner now.</strong> It is not shown again, and deliveries are signed with it from this moment.
                        </p>
                        <div className="flex items-center gap-2">
                            <code className="font-mono text-xs break-all flex-1 bg-white border border-amber-200 rounded-lg p-2.5 text-slate-700">
                                {newWebhookSecret}
                            </code>
                            <button
                                onClick={() => {
                                    navigator.clipboard.writeText(newWebhookSecret);
                                    setSecretCopied(true);
                                    setTimeout(() => setSecretCopied(false), 3000);
                                }}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0 transition ${
                                    secretCopied ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                                }`}
                            >
                                {secretCopied ? <><i className="fa-solid fa-check mr-1" />Copied</> : <><i className="fa-solid fa-clipboard mr-1" />Copy</>}
                            </button>
                        </div>
                    </div>
                ) : (
                    <p className="text-xs text-slate-400 mb-2">
                        <i className="fa-solid fa-lock mr-1" />
                        {partner.hasWebhookSecret
                            ? 'A signing secret is set. Its value is not retrievable — rotate to issue a new one.'
                            : 'No signing secret set yet. Rotate to issue one.'}
                    </p>
                )}
                <button onClick={handleRotateSecret}
                    className="mt-3 px-5 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-50 transition flex items-center gap-2">
                    <i className="fa-solid fa-rotate" />
                    Rotate Signing Secret
                </button>
            </section>

            {/* Usage Chart */}
            <section>
                <h3 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">API Usage — Last 7 Days</h3>
                {loadingUsage ? (
                    <div className="h-32 flex items-center justify-center text-slate-400">
                        <i className="fa-solid fa-spinner fa-spin mr-2" /> Loading usage...
                    </div>
                ) : (
                    <div className="space-y-2">
                        {last7.map(day => (
                            <div key={day.date} className="flex items-center gap-3">
                                <span className="text-xs text-slate-500 w-24 text-right">{day.label}</span>
                                <div className="flex-1 bg-slate-100 rounded-full h-6 overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-500"
                                        style={{ width: `${Math.max(1, (day.count / maxCount) * 100)}%` }}
                                    />
                                </div>
                                <span className="text-sm font-bold text-slate-700 w-16 text-right">{day.count.toLocaleString()}</span>
                            </div>
                        ))}
                    </div>
                )}
                <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                    <span>Total this week: <span className="font-bold text-slate-600">{last7.reduce((s, d) => s + d.count, 0).toLocaleString()}</span></span>
                    {(() => {
                        const rl = partner.rateLimit || {};
                        // Mirrors the middleware exactly: same Math.max(1, …) floor
                        // on the account count and the same schema defaults
                        // (30/500/30, not the 200/5000/200 this used to show).
                        const n = Math.max(1, partner.accounts?.length || partner.accountIds?.length || 0);
                        const perMin = rl.perAccountPerMinute ?? 30;
                        const perDay = rl.perAccountPerDay ?? 500;
                        const floor  = rl.floor ?? 30;
                        const effMin = Math.max(floor, n * perMin);
                        const effDay = Math.max(floor * 48, n * perDay);
                        return (
                            <span title={`${n} accounts × ${perMin}/min = ${effMin}/min`}>
                                Limit: <strong className="text-slate-600">{effMin.toLocaleString()}/min</strong>
                                <span className="mx-1">·</span>
                                <strong className="text-slate-600">{effDay.toLocaleString()}/day</strong>
                                <span className="text-slate-300 ml-1">({n} accts × {perMin})</span>
                            </span>
                        );
                    })()}
                </div>
            </section>
        </div>
    );
};

export default PartnerApiKeyTab;
