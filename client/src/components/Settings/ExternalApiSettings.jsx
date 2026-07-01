import React, { useState, useEffect, useCallback } from 'react';
import { useNotification } from '../../context/NotificationContext';
import api from '../../services/api';
import ApiDocsTab from './ApiDocsTab';

const BASE_URL = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://app.adfliker.com';

const API_BASE = `${BASE_URL}/api/v1`;

// ── Endpoint reference data ────────────────────────────────────────────────────
const ENDPOINTS = [
    { method: 'POST',   path: '/leads',                  desc: 'Create a lead (fires automations)' },
    { method: 'GET',    path: '/leads',                  desc: 'List leads (paginated)' },
    { method: 'GET',    path: '/leads/:id',              desc: 'Get a single lead' },
    { method: 'PUT',    path: '/leads/:id',              desc: 'Update lead fields or stage' },
    { method: 'POST',   path: '/leads/:id/note',         desc: 'Add a note to a lead' },
    { method: 'POST',   path: '/whatsapp/send',          desc: 'Send WhatsApp text message' },
    { method: 'POST',   path: '/whatsapp/template',      desc: 'Send WhatsApp template' },
    { method: 'GET',    path: '/whatsapp/templates',     desc: 'List approved WhatsApp templates' },
    { method: 'POST',   path: '/email/send',             desc: 'Send email to lead or address' },
    { method: 'POST',   path: '/appointments',           desc: 'Create appointment' },
    { method: 'PUT',    path: '/appointments/:id',       desc: 'Update appointment status/time' },
    { method: 'GET',    path: '/stats/leads',            desc: 'Lead stats (today/week/month/all)' },
    { method: 'GET',    path: '/stats/pipeline',         desc: 'Pipeline stage breakdown' },
    { method: 'GET',    path: '/ping',                   desc: 'Test if API key is valid' },
];

const METHOD_COLORS = {
    GET:    { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
    POST:   { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
    PUT:    { bg: '#fff3e0', color: '#e65100', border: '#ffcc80' },
    DELETE: { bg: '#fce4ec', color: '#b71c1c', border: '#f48fb1' },
};

const ExternalApiSettings = () => {
    const { showSuccess, showError } = useNotification();

    const [hasKey,            setHasKey]            = useState(false);
    const [maskedKey,         setMaskedKey]         = useState(null);
    const [revealedKey,       setRevealedKey]       = useState(null);
    const [planAllowed,       setPlanAllowed]        = useState(false);
    const [plan,              setPlan]               = useState(null);
    const [loading,           setLoading]            = useState(true);
    const [generating,        setGenerating]         = useState(false);
    const [revoking,          setRevoking]           = useState(false);
    const [showConfirmRevoke, setShowConfirmRevoke]  = useState(false);
    const [copiedKey,         setCopiedKey]          = useState(false);
    const [copiedSnippet,     setCopiedSnippet]      = useState(false);
    const [activeTab,         setActiveTab]          = useState('setup');

    const fetchKeyStatus = useCallback(async () => {
        try {
            const { data } = await api.get('/ext-api/key');
            setHasKey(data.hasKey);
            setMaskedKey(data.maskedKey);
            setPlanAllowed(data.planAllowed);
            setPlan(data.plan);
        } catch {
            showError('Failed to load External API key status.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchKeyStatus(); }, [fetchKeyStatus]);

    const handleGenerate = async () => {
        setGenerating(true);
        setRevealedKey(null);
        try {
            const { data } = await api.post('/ext-api/key/generate');
            setRevealedKey(data.key);
            setHasKey(true);
            setMaskedKey(`${data.key.slice(0, 8)}${'•'.repeat(data.key.length - 8)}`);
            showSuccess('API key generated! Copy it now — it will not be shown again in full.');
        } catch (err) {
            const msg = err?.response?.data?.message || 'Failed to generate API key.';
            showError(msg);
        } finally {
            setGenerating(false);
        }
    };

    const handleRevoke = async () => {
        setRevoking(true);
        try {
            await api.delete('/ext-api/key');
            setHasKey(false);
            setMaskedKey(null);
            setRevealedKey(null);
            setShowConfirmRevoke(false);
            showSuccess('API key revoked. All external connections are immediately blocked.');
        } catch {
            showError('Failed to revoke API key. Please try again.');
        } finally {
            setRevoking(false);
        }
    };

    const copyToClipboard = async (text, setter) => {
        try {
            await navigator.clipboard.writeText(text);
            setter(true);
            setTimeout(() => setter(false), 2000);
        } catch {
            showError('Could not copy. Please copy manually.');
        }
    };

    const codeSnippet = `// Example: Create a lead from your CRM
fetch("${API_BASE}/leads", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${revealedKey || 'YOUR_API_KEY'}"
  },
  body: JSON.stringify({
    name: "Ravi Sharma",
    phone: "+919876543210",
    email: "ravi@example.com",
    status: "New",
    source: "HubSpot"
  })
});`;

    const whatsappSnippet = `// Send WhatsApp after lead changes in your CRM
fetch("${API_BASE}/whatsapp/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "${revealedKey || 'YOUR_API_KEY'}"
  },
  body: JSON.stringify({
    phone: "+919876543210",
    message: "Hello! Thanks for your interest. Our team will contact you shortly."
  })
});`;

    // ── Loading state ──────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div style={styles.loadingWrap}>
                <div style={styles.spinner} />
                <span style={{ color: '#64748b', fontSize: 14 }}>Loading API settings…</span>
            </div>
        );
    }

    // ── Plan upgrade required ──────────────────────────────────────────────────
    if (!planAllowed) {
        return (
            <div style={styles.card}>
                <div style={styles.cardHeader}>
                    <span style={styles.headerIcon}>🔌</span>
                    <div>
                        <h3 style={styles.headerTitle}>External CRM Integration API</h3>
                        <p style={styles.headerSub}>Connect any CRM or app to your workspace</p>
                    </div>
                </div>

                <div style={styles.upgradeBox}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>🚀</div>
                    <h4 style={{ margin: '0 0 8px', color: '#1e293b', fontSize: 18 }}>
                        Growth or Enterprise Plan Required
                    </h4>
                    <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
                        The External API allows other software (HubSpot, Salesforce, custom apps) to
                        create leads, send WhatsApp messages, and trigger actions in your CRM automatically.
                        This feature is available on <strong>Growth</strong> and <strong>Enterprise</strong> plans.
                    </p>
                    {plan && (
                        <div style={styles.currentPlanBadge}>
                            Current plan: <strong>{plan}</strong>
                        </div>
                    )}
                    <p style={{ margin: '16px 0 0', color: '#94a3b8', fontSize: 12 }}>
                        Contact support or upgrade your plan to unlock this feature.
                    </p>
                </div>
            </div>
        );
    }

    // ── Main UI ───────────────────────────────────────────────────────────────
    return (
        <div style={styles.card}>
            {/* Header */}
            <div style={styles.cardHeader}>
                <span style={styles.headerIcon}>🔌</span>
                <div>
                    <h3 style={styles.headerTitle}>External CRM Integration API</h3>
                    <p style={styles.headerSub}>
                        Allow other apps and CRMs to connect to your workspace via API key
                    </p>
                </div>
                <div style={styles.planBadge}>✅ {plan || 'Growth/Enterprise'}</div>
            </div>

            {/* Tabs */}
            <div style={styles.tabBar}>
                {['setup', 'documentation'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        style={{
                            ...styles.tabBtn,
                            ...(activeTab === tab ? styles.tabBtnActive : {})
                        }}
                    >
                        {tab === 'setup'         && '⚙️ '}
                        {tab === 'documentation' && '📚 '}
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* ── TAB: SETUP ─────────────────────────────────────────────────── */}
            {activeTab === 'setup' && (
                <div style={styles.tabContent}>
                    {/* Info boxes */}
                    <div style={styles.infoGrid}>
                        <div style={styles.infoBox}>
                            <span style={{ fontSize: 22 }}>🔐</span>
                            <div>
                                <strong style={{ fontSize: 13 }}>Secure API Key</strong>
                                <p style={styles.infoText}>One key per workspace. Keep it secret — anyone with it can trigger actions.</p>
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <span style={{ fontSize: 22 }}>⚡</span>
                            <div>
                                <strong style={{ fontSize: 13 }}>Rate Limited</strong>
                                <p style={styles.infoText}>30 requests/min, 500/day per key to prevent abuse.</p>
                            </div>
                        </div>
                        <div style={styles.infoBox}>
                            <span style={{ fontSize: 22 }}>🤖</span>
                            <div>
                                <strong style={{ fontSize: 13 }}>Automations Fire</strong>
                                <p style={styles.infoText}>Leads created via API trigger your automation rules automatically.</p>
                            </div>
                        </div>
                    </div>

                    {/* Base URL */}
                    <div style={styles.section}>
                        <label style={styles.label}>Base URL</label>
                        <div style={styles.codeRow}>
                            <code style={styles.codeText}>{API_BASE}</code>
                        </div>
                    </div>

                    {/* Key Display */}
                    <div style={styles.section}>
                        <label style={styles.label}>Your API Key</label>

                        {revealedKey ? (
                            <div style={styles.keyBox}>
                                <div style={styles.newKeyAlert}>
                                    ⚠️ Copy this key now — it will not be shown in full again after you leave this page.
                                </div>
                                <div style={styles.keyRow}>
                                    <code style={{ ...styles.codeText, flex: 1, fontSize: 13 }}>{revealedKey}</code>
                                    <button
                                        onClick={() => copyToClipboard(revealedKey, setCopiedKey)}
                                        style={copiedKey ? styles.btnCopied : styles.btnCopy}
                                    >
                                        {copiedKey ? '✅ Copied!' : '📋 Copy'}
                                    </button>
                                </div>
                            </div>
                        ) : hasKey ? (
                            <div style={styles.keyRow}>
                                <code style={{ ...styles.codeText, flex: 1, fontSize: 13, color: '#94a3b8' }}>
                                    {maskedKey}
                                </code>
                                <span style={styles.keyActiveBadge}>● Active</span>
                            </div>
                        ) : (
                            <p style={{ color: '#94a3b8', fontSize: 14, margin: 0 }}>
                                No API key generated yet. Click Generate below.
                            </p>
                        )}
                    </div>

                    {/* Actions */}
                    <div style={styles.actionRow}>
                        <button
                            onClick={handleGenerate}
                            disabled={generating}
                            style={styles.btnPrimary}
                        >
                            {generating ? '⏳ Generating…' : hasKey ? '🔄 Regenerate Key' : '✨ Generate API Key'}
                        </button>

                        {hasKey && !showConfirmRevoke && (
                            <button
                                onClick={() => setShowConfirmRevoke(true)}
                                style={styles.btnDanger}
                            >
                                🗑️ Revoke Key
                            </button>
                        )}
                    </div>

                    {/* Revoke confirm */}
                    {showConfirmRevoke && (
                        <div style={styles.confirmBox}>
                            <p style={{ margin: '0 0 12px', color: '#1e293b', fontWeight: 600 }}>
                                ⚠️ Revoke API Key?
                            </p>
                            <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: 14 }}>
                                Any external system using this key will immediately lose access.
                                This action cannot be undone — you will need to generate a new key and update all connected systems.
                            </p>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button
                                    onClick={handleRevoke}
                                    disabled={revoking}
                                    style={styles.btnDangerSolid}
                                >
                                    {revoking ? '⏳ Revoking…' : '✅ Yes, Revoke Key'}
                                </button>
                                <button
                                    onClick={() => setShowConfirmRevoke(false)}
                                    style={styles.btnSecondary}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── TAB: DOCUMENTATION ─────────────────────────────────────────── */}
            {activeTab === 'documentation' && (
                <div style={styles.tabContent}>
                    <ApiDocsTab apiKey={revealedKey || maskedKey} />
                </div>
            )}
        </div>
    );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = {
    card: {
        background: '#fff',
        borderRadius: 16,
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 1px 3px rgba(0,0,0,0.07)'
    },
    loadingWrap: {
        display: 'flex', alignItems: 'center', gap: 12,
        padding: 32, color: '#64748b'
    },
    spinner: {
        width: 20, height: 20, border: '2px solid #e2e8f0',
        borderTop: '2px solid #6366f1', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite'
    },
    cardHeader: {
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '20px 24px',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        color: '#fff'
    },
    headerIcon: { fontSize: 32, lineHeight: 1 },
    headerTitle: { margin: 0, fontSize: 18, fontWeight: 700, color: '#fff' },
    headerSub:   { margin: '2px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.8)' },
    planBadge: {
        marginLeft: 'auto', background: 'rgba(255,255,255,0.2)',
        color: '#fff', padding: '4px 12px', borderRadius: 20,
        fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap'
    },
    currentPlanBadge: {
        display: 'inline-block', background: '#f1f5f9',
        color: '#475569', padding: '4px 12px', borderRadius: 8, fontSize: 13
    },
    upgradeBox: {
        padding: 40, textAlign: 'center'
    },
    tabBar: {
        display: 'flex', borderBottom: '1px solid #e2e8f0',
        background: '#f8fafc'
    },
    tabBtn: {
        padding: '12px 20px', border: 'none', background: 'transparent',
        cursor: 'pointer', fontSize: 13, color: '#64748b', fontWeight: 500,
        borderBottom: '2px solid transparent', transition: 'all 0.2s'
    },
    tabBtnActive: {
        color: '#6366f1', borderBottom: '2px solid #6366f1',
        background: '#fff', fontWeight: 600
    },
    tabContent: { padding: 24 },
    section:    { marginBottom: 24 },
    label: {
        display: 'block', marginBottom: 8,
        fontSize: 13, fontWeight: 600, color: '#374151'
    },
    infoGrid: {
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 12, marginBottom: 24
    },
    infoBox: {
        display: 'flex', gap: 12, alignItems: 'flex-start',
        padding: 14, background: '#f8fafc', borderRadius: 10,
        border: '1px solid #e2e8f0'
    },
    infoText: { margin: '4px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.5 },
    codeRow: {
        background: '#1e293b', borderRadius: 8,
        padding: '10px 14px', display: 'flex', alignItems: 'center'
    },
    codeText: {
        fontFamily: 'monospace', fontSize: 13,
        color: '#94a3b8', wordBreak: 'break-all'
    },
    keyBox: { display: 'flex', flexDirection: 'column', gap: 8 },
    newKeyAlert: {
        background: '#fffbeb', border: '1px solid #fbbf24',
        borderRadius: 8, padding: '8px 12px',
        color: '#92400e', fontSize: 13, fontWeight: 500
    },
    keyRow: {
        display: 'flex', gap: 10, alignItems: 'center',
        background: '#1e293b', borderRadius: 8, padding: '10px 14px'
    },
    keyActiveBadge: {
        color: '#4ade80', fontSize: 12, fontWeight: 600,
        whiteSpace: 'nowrap', flexShrink: 0
    },
    actionRow: { display: 'flex', gap: 12, flexWrap: 'wrap' },
    btnPrimary: {
        padding: '10px 20px', borderRadius: 8, border: 'none',
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer',
        transition: 'opacity 0.2s'
    },
    btnDanger: {
        padding: '10px 20px', borderRadius: 8,
        border: '1px solid #fca5a5', background: '#fff2f2',
        color: '#dc2626', fontWeight: 600, fontSize: 14, cursor: 'pointer'
    },
    btnDangerSolid: {
        padding: '10px 20px', borderRadius: 8, border: 'none',
        background: '#dc2626', color: '#fff',
        fontWeight: 600, fontSize: 14, cursor: 'pointer'
    },
    btnSecondary: {
        padding: '10px 20px', borderRadius: 8,
        border: '1px solid #e2e8f0', background: '#fff',
        color: '#374151', fontWeight: 500, fontSize: 14, cursor: 'pointer'
    },
    btnCopy: {
        padding: '6px 14px', borderRadius: 6, border: '1px solid #6366f1',
        background: 'transparent', color: '#6366f1',
        fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0
    },
    btnCopied: {
        padding: '6px 14px', borderRadius: 6, border: '1px solid #10b981',
        background: '#ecfdf5', color: '#059669',
        fontSize: 13, fontWeight: 600, cursor: 'pointer', flexShrink: 0
    },
    confirmBox: {
        marginTop: 20, padding: 20, background: '#fff5f5',
        border: '1px solid #fca5a5', borderRadius: 10
    },
    endpointList: { display: 'flex', flexDirection: 'column', gap: 8 },
    endpointRow: {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', background: '#f8fafc',
        borderRadius: 8, border: '1px solid #e2e8f0',
        flexWrap: 'wrap'
    },
    methodBadge: {
        padding: '2px 8px', borderRadius: 5, fontSize: 11,
        fontWeight: 700, fontFamily: 'monospace', flexShrink: 0
    },
    endpointPath: {
        fontFamily: 'monospace', fontSize: 12,
        color: '#334155', flexShrink: 0
    },
    endpointDesc: { color: '#64748b', fontSize: 13, marginLeft: 'auto' },
    exampleBlock: {
        marginBottom: 24, borderRadius: 10,
        border: '1px solid #e2e8f0', overflow: 'hidden'
    },
    exampleHeader: {
        padding: '12px 16px', background: '#f8fafc',
        borderBottom: '1px solid #e2e8f0'
    },
    exampleSubtext: { margin: '4px 0 0', fontSize: 13, color: '#64748b' },
    codeBlock: { position: 'relative', background: '#1e293b' },
    pre: {
        margin: 0, padding: '16px', overflow: 'auto',
        fontFamily: 'monospace', fontSize: 12,
        color: '#94a3b8', lineHeight: 1.6
    },
    copyOverlay: {
        position: 'absolute', top: 8, right: 8,
        padding: '4px 10px', borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.2)',
        background: 'rgba(255,255,255,0.1)', color: '#fff',
        fontSize: 12, cursor: 'pointer'
    },
    inlineCode: {
        fontFamily: 'monospace', background: '#f1f5f9',
        padding: '1px 6px', borderRadius: 4, fontSize: 12, color: '#6366f1'
    }
};

export default ExternalApiSettings;
