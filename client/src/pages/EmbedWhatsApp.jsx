/**
 * EmbedWhatsApp — Standalone embedded WhatsApp page for partner CRM iframes.
 * ─────────────────────────────────────────────────────────────────────────────
 * This page renders the full WhatsApp management UI (Inbox, Templates,
 * Broadcasts, Chatbot, Analytics, Settings) inside a standalone page with
 * no sidebar, no header, no navigation — designed to be loaded inside an
 * iframe in a partner's CRM.
 *
 * Auth Flow:
 *   1. Page loads with ?token=emb_xxx in the URL
 *   2. Exchanges the embed token for a JWT via /api/partner/v1/embed/auth
 *   3. Stores it under the EMBED-ONLY session keys (see below)
 *   4. Renders WhatsAppManagement with the embedded flag
 *
 * ⚠️ SESSION ISOLATION (PA-H1)
 * This page is served from the same origin as the main CRM, so it shares one
 * localStorage with it. Writing the plain `token` / `user` keys — as this
 * component used to, directly contradicting its own comment about "memory only"
 * — silently replaced the session of anyone with the CRM open in another tab,
 * and the unmount cleanup then logged them out of the real app.
 *
 * Credentials now go through setAuthSession/clearAuthSession, which put embed
 * sessions in sessionStorage under `embed_token` / `embed_user`: a different
 * key (no collision) in a tab-scoped store (no leak to the user's other tabs).
 *
 * Route: /embed/whatsapp?token=emb_xxx
 */

import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import WhatsAppManagement from './WhatsAppManagement';
import api, { setAuthSession, clearAuthSession } from '../services/api';

const EmbedWhatsApp = () => {
    const [searchParams] = useSearchParams();
    const [state, setState] = useState('loading'); // loading | authenticated | error
    const [error, setError] = useState('');
    const [user, setUser] = useState(null);
    const [jwt, setJwt] = useState(null);

    useEffect(() => {
        const token = searchParams.get('token');

        if (!token) {
            setState('error');
            setError('Missing embed token. The partner CRM must include a token parameter.');
            return;
        }

        // Exchange embed token for JWT
        const exchangeToken = async () => {
            try {
                // Use the standard api instance so baseURL is handled correctly
                const res = await api.get(`/partner/v1/embed/auth?token=${encodeURIComponent(token)}`);
                const data = res.data;

                if (!data.success) {
                    setState('error');
                    setError(data.message || 'Authentication failed. Token may have expired.');
                    return;
                }

                // Persist under the embed-only keys BEFORE rendering the app, so
                // the first request WhatsAppManagement fires already carries the
                // Authorization header.
                setAuthSession(data.token, data.user);

                setJwt(data.token);
                setUser(data.user);
                setState('authenticated');

            } catch (err) {
                setState('error');
                const serverMessage = err?.response?.data?.message;
                // A deactivated partner / revoked account gets a real
                // explanation rather than a generic network error.
                setError(serverMessage || 'Failed to connect. Please try again.');
                console.error('[Embed] Token exchange failed:', err);
            }
        };

        exchangeToken();

        // Cleanup on unmount — clears only the embed keys, never the main app's.
        return () => {
            clearAuthSession();
        };
    }, [searchParams]);

    // ── LOADING ─────────────────────────────────────────────────────────────
    if (state === 'loading') {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-4 border-green-500 border-t-transparent mx-auto mb-4" />
                    <p className="text-slate-500 font-medium">Connecting WhatsApp...</p>
                </div>
            </div>
        );
    }

    // ── ERROR ────────────────────────────────────────────────────────────────
    if (state === 'error') {
        return (
            <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
                <div className="text-center max-w-md px-6">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <i className="fa-solid fa-exclamation-triangle text-2xl text-red-500" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900 mb-2">Connection Failed</h2>
                    <p className="text-slate-500 text-sm">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-6 px-6 py-2.5 bg-slate-900 text-white rounded-lg font-medium text-sm hover:bg-slate-800 transition"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    // ── AUTHENTICATED — RENDER WHATSAPP UI ───────────────────────────────────
    return (
        <div className="h-screen w-screen overflow-hidden bg-white">
            {/* Powered by badge (if partner config says so) */}
            {user?.showPoweredBy && (
                <div className="bg-slate-50 border-b border-slate-200 px-4 py-1.5 flex items-center justify-between text-xs text-slate-400">
                    <span>Powered by <span className="font-semibold text-slate-600">Adfliker</span></span>
                    {user?.partnerName && (
                        <span>Integrated with {user.partnerName}</span>
                    )}
                </div>
            )}

            {/* Full WhatsApp UI — render the same component used in the main app.
                `embedUser` carries the partner's allowedModules grant; AuthContext
                is empty here because the embed session is stored separately. */}
            <div className={`${user?.showPoweredBy ? 'h-[calc(100vh-33px)]' : 'h-screen'}`}>
                <WhatsAppManagement embedded={true} embedUser={user} />
            </div>
        </div>
    );
};

export default EmbedWhatsApp;
