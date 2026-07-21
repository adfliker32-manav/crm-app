import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Automations from './Automations';
import Workflows from './Workflows';
import Sequences from './Sequences';

// Unified "Automation" module. Merges the three former sidebar entries —
// Legacy Automation rules, the visual Workflow builder, and Drip Sequences —
// behind a single segmented toggle. They are all "do-the-right-thing-
// automatically" tools, so users shouldn't hunt for them across the sidebar.
//
// Each view keeps its own top-level route (/automations, /workflows, /sequences)
// so the fullscreen workflow builder's "back to /workflows" navigation and any
// existing deep links keep working.
//
// IMPORTANT: the active tab is DERIVED FROM THE URL on every render, never held
// in local state. All three routes render this same component, so React Router
// updates (does not remount) it when switching between them — a useState seed
// would run only once and desync the tab from the URL. The URL is the single
// source of truth.
const VIEWS = [
    { id: 'legacy',    label: 'Legacy Automation', icon: 'fa-robot',               path: '/automations', render: () => <Automations /> },
    { id: 'workflow',  label: 'Workflow',          icon: 'fa-bolt',                path: '/workflows',   render: () => <Workflows /> },
    { id: 'sequences', label: 'Sequences',         icon: 'fa-wand-magic-sparkles', path: '/sequences',   render: () => <Sequences /> },
];

// Longest-prefix match: /workflows and /sequences resolve to their own view;
// everything else (incl. /automations) falls back to the legacy tab.
const viewForPath = (pathname) =>
    VIEWS.find(v => v.id !== 'legacy' && pathname.startsWith(v.path)) || VIEWS[0];

export default function AutomationHub() {
    const location = useLocation();
    const navigate = useNavigate();

    const active = viewForPath(location.pathname);

    const switchView = (v) => {
        if (v.id === active.id) return;
        // Navigating changes the URL, which re-derives `active` on the next render.
        navigate(v.path, { replace: true });
    };

    return (
        <div className="animate-fade-in-up">
            {/* Segmented control — matches the Settings / WhatsApp tab styling */}
            <div className="flex flex-wrap gap-2 mb-6 bg-slate-100/70 p-1.5 rounded-2xl border border-slate-200/60 w-fit">
                {VIEWS.map(v => (
                    <button
                        key={v.id}
                        onClick={() => switchView(v)}
                        className={`px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2.5 transition-all duration-200 ${
                            active.id === v.id
                                ? 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200/50'
                                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                        }`}
                    >
                        <i className={`fa-solid ${v.icon} ${active.id === v.id ? 'text-blue-500' : 'text-slate-400'}`}></i>
                        {v.label}
                    </button>
                ))}
            </div>

            {active.render()}
        </div>
    );
}
