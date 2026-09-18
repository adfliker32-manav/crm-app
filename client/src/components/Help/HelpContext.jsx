import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../services/api';

/**
 * Contextual Help — the state behind the "? Help" button.
 *
 * The provider lives once in Layout.jsx and owns the single drawer. A page only
 * ever renders <HelpButton module="whatsapp" submodule={activeTab} />; the
 * button hands this context its topic, and everything else (fetching, caching,
 * the panel itself) happens here.
 *
 * WHY A CONTEXT AND NOT LOCAL STATE PER PAGE
 *   One drawer, one fetch, one place that knows how to close on navigation.
 *   A per-page copy would mean twelve slightly different drawers to keep in
 *   step, and two of them open at once on any page with nested tabs.
 */
const HelpContext = createContext(null);

const emptyTopic = { module: '', submodule: '' };

export const HelpProvider = ({ children }) => {
    const [open, setOpen] = useState(false);
    const [topic, setTopic] = useState(emptyTopic);
    const [content, setContent] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(false);
    const location = useLocation();

    // Last successful response per topic. Reopening the same panel paints
    // instantly from here while a fresh request revalidates in the background —
    // so a video the super admin changed a minute ago still shows up, but the
    // common case never stares at a spinner.
    const cacheRef = useRef(new Map());
    // Guards against a slow earlier request overwriting a newer topic's answer.
    const requestIdRef = useRef(0);

    const load = useCallback(async (module, submodule) => {
        const key = `${module}::${submodule}`;
        const cached = cacheRef.current.get(key);
        const requestId = ++requestIdRef.current;

        setError(false);
        if (cached) {
            setContent(cached);
            setLoading(false);
        } else {
            setContent(null);
            setLoading(true);
        }

        try {
            const res = await api.get('/help-videos', { params: { module, submodule } });
            if (requestId !== requestIdRef.current) return; // a newer topic won
            cacheRef.current.set(key, res.data);
            setContent(res.data);
        } catch {
            if (requestId !== requestIdRef.current) return;
            // A stale-but-real answer beats an error card.
            if (!cached) setError(true);
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, []);

    const openHelp = useCallback((next) => {
        const module = next?.module || '';
        const submodule = next?.submodule || '';
        if (!module) return;
        setTopic({ module, submodule });
        setOpen(true);
        load(module, submodule);
    }, [load]);

    const closeHelp = useCallback(() => setOpen(false), []);

    // Navigating away means the topic on screen no longer matches the drawer.
    // Close rather than leave a Leads tutorial hanging over the Reports page.
    const pathRef = useRef(location.pathname);
    useEffect(() => {
        if (pathRef.current !== location.pathname) {
            pathRef.current = location.pathname;
            setOpen(false);
        }
    }, [location.pathname]);

    // Escape closes, like every other dismissible surface in the app.
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    const value = useMemo(() => ({
        open, topic, content, loading, error, openHelp, closeHelp
    }), [open, topic, content, loading, error, openHelp, closeHelp]);

    return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
};

/**
 * Returns null when no provider is mounted — <HelpButton> uses that to render
 * nothing rather than throwing, so dropping the button into a page that lives
 * outside the CRM layout (an embed, a public page) can never break it.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useHelp = () => useContext(HelpContext);

export default HelpContext;
