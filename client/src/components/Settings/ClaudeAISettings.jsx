import React, { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../../context/NotificationContext';
import api from '../../services/api';

const MCP_URL = 'https://app.adfliker.com/mcp';
const SERVER_NAME = 'adfliker-crm';

const formatDate = (value) => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

const CopyButton = ({ id, text, copiedId, onCopy, disabled = false, dark = false }) => {
    const copied = copiedId === id;
    const base = dark
        ? 'bg-slate-700 hover:bg-slate-600 text-slate-200'
        : 'bg-blue-600 hover:bg-blue-700 text-white';
    return (
        <button
            type="button"
            onClick={() => onCopy(id, text)}
            disabled={disabled}
            className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                disabled ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : copied ? 'bg-emerald-500 text-white' : base
            }`}
        >
            {copied
                ? <><i className="fa-solid fa-check"></i> Copied</>
                : <><i className="fa-solid fa-copy"></i> Copy</>}
        </button>
    );
};

const CodeBlock = ({ id, text, copiedId, onCopy }) => (
    <div className="relative mt-2">
        <pre className="bg-slate-900 text-slate-100 text-xs rounded-xl p-4 pr-24 overflow-x-auto leading-relaxed font-mono whitespace-pre">{text}</pre>
        <div className="absolute top-2.5 right-2.5">
            <CopyButton id={id} text={text} copiedId={copiedId} onCopy={onCopy} dark />
        </div>
    </div>
);

const Step = ({ n, title, children }) => (
    <li className="flex gap-3">
        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">{n}</span>
        <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-700">{title}</p>
            {children}
        </div>
    </li>
);

const ClaudeAISettings = () => {
    const { showSuccess, showError } = useNotification();

    const [hasKey, setHasKey] = useState(false);
    const [maskedKey, setMaskedKey] = useState(null);
    const [revealedKey, setRevealedKey] = useState(null); // full key, shown once after generate
    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [revoking, setRevoking] = useState(false);
    const [showConfirmRevoke, setShowConfirmRevoke] = useState(false);
    const [copiedId, setCopiedId] = useState(null);

    const [connections, setConnections] = useState([]);
    const [connectionsError, setConnectionsError] = useState(false);
    const [disconnectingId, setDisconnectingId] = useState(null);
    const [confirmDisconnectAll, setConfirmDisconnectAll] = useState(false);

    const fetchKeyStatus = useCallback(async () => {
        try {
            const { data } = await api.get('/auth/mcp-key');
            setHasKey(data.hasKey);
            setMaskedKey(data.maskedKey);
        } catch {
            showError('Failed to load API key status.');
        }
    }, []);

    const fetchConnections = useCallback(async () => {
        try {
            const { data } = await api.get('/auth/mcp-connections');
            setConnections(data.connections || []);
            setConnectionsError(false);
        } catch {
            setConnectionsError(true);
        }
    }, []);

    useEffect(() => {
        Promise.all([fetchKeyStatus(), fetchConnections()]).finally(() => setLoading(false));
    }, [fetchKeyStatus, fetchConnections]);

    const handleCopy = async (id, text) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(current => (current === id ? null : current)), 2000);
        } catch {
            showError('Could not copy to clipboard. Please copy manually.');
        }
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setRevealedKey(null);
        try {
            const { data } = await api.post('/auth/mcp-key');
            setRevealedKey(data.key);
            setHasKey(true);
            setMaskedKey(`${data.key.slice(0, 8)}${'•'.repeat(data.key.length - 8)}`);
            showSuccess('API key generated. Copy it now — it will not be shown again.');
            fetchConnections();
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
            showSuccess('API key revoked. Claude connections using it are disconnected.');
            fetchConnections();
        } catch {
            showError('Failed to revoke API key. Please try again.');
        } finally {
            setRevoking(false);
        }
    };

    const handleDisconnect = async (id) => {
        setDisconnectingId(id);
        try {
            await api.delete(`/auth/mcp-connections/${id}`);
            setConnections(list => list.filter(c => c.id !== id));
            showSuccess('App disconnected.');
        } catch {
            showError('Failed to disconnect the app. Please try again.');
        } finally {
            setDisconnectingId(null);
        }
    };

    const handleDisconnectAll = async () => {
        setDisconnectingId('all');
        try {
            await api.delete('/auth/mcp-connections');
            setConnections([]);
            setConfirmDisconnectAll(false);
            showSuccess('All apps disconnected.');
        } catch {
            showError('Failed to disconnect apps. Please try again.');
        } finally {
            setDisconnectingId(null);
        }
    };

    const keyForSnippets = revealedKey || 'YOUR_MCP_KEY';
    const oauthCommand = `claude mcp add --transport http ${SERVER_NAME} ${MCP_URL}`;
    const headerCommand = `claude mcp add --transport http ${SERVER_NAME} ${MCP_URL} --header "Authorization: Bearer ${keyForSnippets}"`;
    const mcpJsonBlock = `{
  "mcpServers": {
    "${SERVER_NAME}": {
      "type": "http",
      "url": "${MCP_URL}",
      "headers": {
        "Authorization": "Bearer ${keyForSnippets}"
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
                        Connect Claude to your CRM so it can work with your live data — leads, pipeline, campaigns, revenue — and answer business questions in plain English.
                    </p>
                </div>
            </div>

            {/* Server URL */}
            <div className="space-y-3">
                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Your MCP server URL</h4>
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                    <i className="fa-solid fa-link text-slate-400 flex-shrink-0 text-sm"></i>
                    <code className="flex-1 text-xs font-mono text-slate-700 break-all select-all">{MCP_URL}</code>
                    <CopyButton id="url" text={MCP_URL} copiedId={copiedId} onCopy={handleCopy} />
                </div>
                <p className="text-xs text-slate-500">
                    This is the same for every workspace. When you connect, Claude opens a sign-in page and the connection is locked to the account you sign in with.
                </p>
            </div>

            <hr className="border-slate-100" />

            {/* Claude.ai / Desktop */}
            <div className="space-y-4">
                <div>
                    <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Connect Claude.ai or Claude Desktop</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Recommended. No key needed — you sign in with your CRM login.</p>
                </div>
                <ol className="space-y-4">
                    <Step n={1} title="Open Settings → Connectors in Claude">
                        <p className="text-xs text-slate-500 mt-0.5">Click <strong>Add custom connector</strong>.</p>
                    </Step>
                    <Step n={2} title="Paste the server URL above">
                        <p className="text-xs text-slate-500 mt-0.5">Name it anything, e.g. “Adfliker CRM”. Leave the advanced OAuth fields empty.</p>
                    </Step>
                    <Step n={3} title="Click Connect and sign in">
                        <p className="text-xs text-slate-500 mt-0.5">
                            Use the workspace owner's email and password, then click <strong>Allow access</strong>. If you log in with Google, choose <strong>API key</strong> on that page and paste a key from below.
                        </p>
                    </Step>
                </ol>
            </div>

            <hr className="border-slate-100" />

            {/* Claude Code */}
            <div className="space-y-4">
                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Connect Claude Code</h4>
                <ol className="space-y-5">
                    <Step n={1} title="Add the server from your terminal">
                        <CodeBlock id="oauth-cmd" text={oauthCommand} copiedId={copiedId} onCopy={handleCopy} />
                    </Step>
                    <Step n={2} title="Sign in">
                        <p className="text-xs text-slate-500 mt-0.5">
                            Start <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">claude</code>, type <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">/mcp</code>, select <strong>{SERVER_NAME}</strong> and choose <strong>Authenticate</strong>. Your browser opens the Adfliker sign-in page.
                        </p>
                    </Step>
                    <Step n={3} title="Start asking questions">
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
                    </Step>
                </ol>
            </div>

            <hr className="border-slate-100" />

            {/* Connected apps */}
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">Connected apps</h4>
                        <p className="text-xs text-slate-400 mt-0.5">Apps that signed in to this workspace. Disconnecting takes effect immediately.</p>
                    </div>
                    {connections.length > 1 && !confirmDisconnectAll && (
                        <button
                            type="button"
                            onClick={() => setConfirmDisconnectAll(true)}
                            className="px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg font-bold text-xs transition-all"
                        >
                            Disconnect all
                        </button>
                    )}
                </div>

                {confirmDisconnectAll && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl flex-wrap">
                        <p className="text-sm text-red-700 flex-1">Disconnect all {connections.length} apps? Each will need to sign in again.</p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setConfirmDisconnectAll(false)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-white font-medium">Cancel</button>
                            <button type="button" onClick={handleDisconnectAll} disabled={disconnectingId === 'all'} className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold disabled:opacity-60">
                                {disconnectingId === 'all' ? 'Disconnecting...' : 'Disconnect all'}
                            </button>
                        </div>
                    </div>
                )}

                {connectionsError ? (
                    <p className="text-xs text-red-600">Could not load connected apps.</p>
                ) : connections.length === 0 ? (
                    <div className="p-4 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-xs text-slate-500 text-center">
                        No apps connected yet.
                    </div>
                ) : (
                    <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
                        {connections.map(c => (
                            <li key={c.id} className="flex items-center gap-3 p-4 flex-wrap">
                                <i className="fa-solid fa-plug text-violet-400 flex-shrink-0"></i>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-slate-700 truncate">{c.clientName}</p>
                                    <p className="text-xs text-slate-500">
                                        Connected {formatDate(c.connectedAt)} · Last used {formatDate(c.lastUsedAt)}
                                        {c.authMethod === 'api_key' ? ' · via API key' : ''}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => handleDisconnect(c.id)}
                                    disabled={disconnectingId === c.id}
                                    className="px-3 py-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg font-bold text-xs transition-all disabled:opacity-60"
                                >
                                    {disconnectingId === c.id ? 'Disconnecting...' : 'Disconnect'}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <hr className="border-slate-100" />

            {/* API Key Section */}
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">API key (optional)</h4>
                        <p className="text-xs text-slate-400 mt-0.5">For Google-login accounts, or a Claude Code setup without the browser sign-in. Scoped to your workspace only.</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-bold flex-shrink-0 ${
                        hasKey
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                            : 'bg-slate-100 text-slate-500 border border-slate-200'
                    }`}>
                        {hasKey ? 'Active' : 'Not configured'}
                    </span>
                </div>

                {hasKey && (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
                        <i className="fa-solid fa-key text-slate-400 flex-shrink-0"></i>
                        <code className="flex-1 text-sm font-mono text-slate-700 break-all select-all">
                            {revealedKey || maskedKey}
                        </code>
                        {revealedKey && (
                            <CopyButton id="key" text={revealedKey} copiedId={copiedId} onCopy={handleCopy} />
                        )}
                    </div>
                )}

                {revealedKey && (
                    <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl">
                        <i className="fa-solid fa-triangle-exclamation text-amber-500 mt-0.5 flex-shrink-0"></i>
                        <p className="text-xs text-amber-700 leading-relaxed">
                            <strong>Copy this key now.</strong> For security, the full key is only shown once immediately after generation. After you leave this page, you will only see a masked preview.
                        </p>
                    </div>
                )}

                <div className="flex flex-wrap gap-3 pt-1">
                    <button
                        type="button"
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
                            type="button"
                            onClick={() => setShowConfirmRevoke(true)}
                            className="flex items-center gap-2 px-5 py-2.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-xl font-bold text-sm transition-all"
                        >
                            <i className="fa-solid fa-ban"></i> Revoke Key
                        </button>
                    )}
                </div>

                {hasKey && (
                    <p className="text-xs text-slate-500">Regenerating or revoking the key also disconnects apps that were connected with it.</p>
                )}

                {showConfirmRevoke && (
                    <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-xl flex-wrap">
                        <i className="fa-solid fa-triangle-exclamation text-red-500 flex-shrink-0"></i>
                        <p className="text-sm text-red-700 flex-1">
                            This will immediately disconnect any Claude sessions using this key.
                        </p>
                        <div className="flex gap-2 flex-shrink-0">
                            <button
                                type="button"
                                onClick={() => setShowConfirmRevoke(false)}
                                className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg text-slate-600 hover:bg-white transition-all font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleRevoke}
                                disabled={revoking}
                                className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-all disabled:opacity-60"
                            >
                                {revoking ? 'Revoking...' : 'Confirm Revoke'}
                            </button>
                        </div>
                    </div>
                )}

                {hasKey && (
                    <div className="space-y-3 pt-2">
                        <p className="text-sm font-semibold text-slate-700">Use the key with Claude Code</p>
                        <p className="text-xs text-slate-500">Run this in your terminal{revealedKey ? '' : ' (replace YOUR_MCP_KEY with your key)'}:</p>
                        <CodeBlock id="header-cmd" text={headerCommand} copiedId={copiedId} onCopy={handleCopy} />
                        <p className="text-xs text-slate-500 pt-1">
                            Or share it with a project by saving this as <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono">.mcp.json</code> in the project folder (don't commit a real key):
                        </p>
                        <CodeBlock id="mcp-json" text={mcpJsonBlock} copiedId={copiedId} onCopy={handleCopy} />
                    </div>
                )}
            </div>

            <hr className="border-slate-100" />

            {/* Security note */}
            <div className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <i className="fa-solid fa-shield-halved text-slate-400 mt-0.5 flex-shrink-0"></i>
                <div className="text-xs text-slate-500 leading-relaxed space-y-1">
                    <p><strong className="text-slate-600">Safe by default.</strong> Send actions always preview first (dry run) and require your explicit confirmation before sending.</p>
                    <p><strong className="text-slate-600">Capped sends.</strong> MCP sending is limited to 50 leads at a time. Larger campaigns must use the CRM Broadcasts feature.</p>
                    <p><strong className="text-slate-600">Fully isolated.</strong> Every connection is locked to your workspace. No other client's data is ever exposed.</p>
                    <p><strong className="text-slate-600">Short-lived tokens.</strong> Sign-in tokens expire hourly and renew automatically. Changing your password disconnects every app.</p>
                </div>
            </div>
        </div>
    );
};

export default ClaudeAISettings;
