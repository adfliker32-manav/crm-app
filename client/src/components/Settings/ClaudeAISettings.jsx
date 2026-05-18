import React, { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../../context/NotificationContext';
import api from '../../services/api';

const MCP_URL = 'https://app.adfliker.com/mcp';

const ClaudeAISettings = () => {
    const { showSuccess, showError } = useNotification();

    const [hasKey, setHasKey] = useState(false);
    const [maskedKey, setMaskedKey] = useState(null);
    const [revealedKey, setRevealedKey] = useState(null); // full key, shown once after generate
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [revoking, setRevoking] = useState(false);
    const [showConfirmRevoke, setShowConfirmRevoke] = useState(false);
    const [copied, setCopied] = useState(false);

    const fetchKeyStatus = useCallback(async () => {
        try {
            const { data } = await api.get('/auth/mcp-key');
            setHasKey(data.hasKey);
            setMaskedKey(data.maskedKey);
        } catch {
            showError('Failed to load API key status.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchKeyStatus(); }, [fetchKeyStatus]);

    const handleGenerate = async () => {
        setGenerating(true);
        setRevealedKey(null);
        try {
            const { data } = await api.post('/auth/mcp-key');
            setRevealedKey(data.key);
            setHasKey(true);
            setMaskedKey(`${data.key.slice(0, 8)}${'•'.repeat(data.key.length - 8)}`);
            showSuccess('API key generated. Copy it now — it will not be shown again.');
        } catch {
            showError('Failed to generate API key. Please try again.');
        } finally {
            setGenerating(false);
        }
    };

    const handleRevoke = async () => {
        setRevoking(true);
        try {
            await api.delete('/auth/mcp-key');
            setHasKey(false);
            setMaskedKey(null);
            setRevealedKey(null);
            setShowConfirmRevoke(false);
            showSuccess('API key revoked. Claude connections are immediately disconnected.');
        } catch {
            showError('Failed to revoke API key. Please try again.');
        } finally {
            setRevoking(false);
        }
    };

    const handleCopy = async (text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            showError('Could not copy to clipboard. Please copy manually.');
        }
    };

    const settingsBlock = `{
  "mcpServers": {
    "adfliker-crm": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${revealedKey || maskedKey || 'YOUR_MCP_KEY'}"
      }
    }
  }
}`;

    if (loading) {
        return (
            <div className="flex items-center justify-center py-16">
                <i className="fa-solid fa-spinner fa-spin text-blue-500 text-2xl"></i>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-3xl">

            {/* Header */}
            <div className="flex items-start gap-4 p-5 bg-gradient-to-r from-violet-50 to-blue-50 rounded-2xl border border-violet-100">
                <div className="w-12 h-12 bg-white rounded-xl shadow-sm flex items-center justify-center flex-shrink-0 border border-violet-100">
                    <i className="fa-solid fa-robot text-violet-500 text-xl"></i>
                </div>
                <div>
                    <h3 className="font-bold text-slate-800 text-base">Claude AI Integration</h3>
                    <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">
                        Connect Claude Code to your CRM so Claude can read your live data — leads, pipeline, campaigns, revenue — and answer business questions in plain English.
                    </p>
                </div>
            </div>

            {/* API Key Section */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">API Key</h4>
                        <p className="text-xs text-slate-400 mt-0.5">Read-only access, scoped to your workspace only.</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                        hasKey
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                        {hasKey ? 'Active' : 'Not configured'}
                    </span>
                </div>

                {/* Key display */}
                {hasKey && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                        <i className="fa-solid fa-key text-slate-400 flex-shrink-0"></i>
                        <code className="flex-1 text-sm font-mono text-slate-700 break-all select-all">
                            {revealedKey || maskedKey}
                        </code>
                        {revealedKey && (
                            <button
                                onClick={() => handleCopy(revealedKey)}
                                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    copied
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                                }`}
                            >
                                {copied ? (
                                    <><i className="fa-solid fa-check mr-1"></i>Copied</>
                                ) : (
                                    <><i className="fa-solid fa-copy mr-1"></i>Copy</>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* One-time notice */}
                {revealedKey && (
                    <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
                        <i className="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5 flex-shrink-0"></i>
                        <p className="text-xs text-amber-700 leading-relaxed">
                            <strong>Copy this key now.</strong> For security, the full key is only shown once immediately after generation. After you leave this page, you will only see a masked preview.
                        </p>
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-3 pt-1">
                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-sm shadow-sm shadow-blue-500/20 transition-all disabled:opacity-60 disabled:cursor-wait"
                    >
                        {generating ? (
                            <><i className="fa-solid fa-spinner fa-spin"></i> Generating...</>
                        ) : hasKey ? (
                            <><i className="fa-solid fa-rotate-right"></i> Regenerate Key</>
                        ) : (
                            <><i className="fa-solid fa-plus"></i> Generate Key</>
                        )}
                    </button>

                    {hasKey && !showConfirmRevoke && (
                        <button
                            onClick={() => setShowConfirmRevoke(true)}
                            className="flex items-center gap-2 px-5 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl font-bold text-sm transition-all"
                        >
                            <i className="fa-solid fa-ban"></i> Revoke Key
                        </button>
                    )}
                </div>

                {/* Revoke confirmation */}
                {showConfirmRevoke && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
                        <i className="fa-solid fa-triangle-exclamation text-red-500 flex-shrink-0"></i>
                        <p className="text-sm text-red-700 flex-1">
                            This will immediately disconnect any Claude sessions using this key.
                        </p>
                        <div className="flex gap-2 flex-shrink-0">
                            <button
                                onClick={() => setShowConfirmRevoke(false)}
                                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-white transition-all font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleRevoke}
                                disabled={revoking}
                                className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-all disabled:opacity-60"
                            >
                                {revoking ? 'Revoking...' : 'Confirm Revoke'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <hr className="border-slate-100" />

            {/* Setup instructions */}
            <div className="space-y-5">
                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Connect Claude Code</h4>

                <ol className="space-y-5">
                    <li className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
                        <div>
                            <p className="text-sm font-semibold text-slate-700">Generate your API key above</p>
                            <p className="text-xs text-slate-500 mt-0.5">Click "Generate Key" and copy the full key before leaving this page.</p>
                        </div>
                    </li>

                    <li className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-700">Open Claude Code settings</p>
                            <p className="text-xs text-slate-500 mt-0.5 mb-2">
                                In your terminal, run: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">claude settings</code> — or edit <code className="bg-slate-100 px-1.5 py-0.5 rounded text-xs font-mono">.claude/settings.json</code> in your project.
                            </p>
                        </div>
                    </li>

                    <li className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
                        <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-700">Add this block to your Claude settings</p>
                            <div className="mt-2 relative">
                                <pre className="bg-slate-900 text-slate-100 text-xs rounded-xl p-4 overflow-x-auto leading-relaxed font-mono">
                                    {settingsBlock}
                                </pre>
                                <button
                                    onClick={() => handleCopy(settingsBlock)}
                                    className="absolute top-2.5 right-2.5 px-2.5 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg font-medium transition-all flex items-center gap-1.5"
                                >
                                    {copied
                                        ? <><i className="fa-solid fa-check"></i> Copied</>
                                        : <><i className="fa-solid fa-copy"></i> Copy</>
                                    }
                                </button>
                            </div>
                        </div>
                    </li>

                    <li className="flex gap-3">
                        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">4</span>
                        <div>
                            <p className="text-sm font-semibold text-slate-700">Start asking questions</p>
                            <p className="text-xs text-slate-500 mt-0.5">Restart Claude Code. You can now ask things like:</p>
                            <ul className="mt-2 space-y-1.5">
                                {[
                                    'How many leads came from Meta Ads this month?',
                                    'Which pipeline stage has the most stuck leads?',
                                    'Show me our WhatsApp campaign delivery rates.',
                                    'What is our revenue from won deals this week?',
                                    'Which agent has the best conversion rate?'
                                ].map((q, i) => (
                                    <li key={i} className="flex items-start gap-2 text-xs text-slate-600">
                                        <i className="fa-solid fa-circle-check text-emerald-400 mt-0.5 flex-shrink-0"></i>
                                        <span>"{q}"</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </li>
                </ol>
            </div>

            {/* Security note */}
            <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <i className="fa-solid fa-shield-halved text-slate-400 mt-0.5 flex-shrink-0"></i>
                <div className="text-xs text-slate-500 leading-relaxed space-y-1">
                    <p><strong className="text-slate-600">Safe by default.</strong> Send actions always preview first (dry run) and require your explicit confirmation before sending.</p>
                    <p><strong className="text-slate-600">Capped sends.</strong> MCP sending is limited to 50 leads at a time. Larger campaigns must use the CRM Broadcasts feature.</p>
                    <p><strong className="text-slate-600">Fully isolated.</strong> Your key only accesses your workspace. No other client's data is ever exposed.</p>
                    <p><strong className="text-slate-600">Instant revocation.</strong> Revoking the key immediately blocks all Claude connections — no delay.</p>
                </div>
            </div>
        </div>
    );
};

export default ClaudeAISettings;
