import React from 'react';
import { useHelp } from './HelpContext';

/**
 * The "? Help" affordance. One line per page header:
 *
 *   <HelpButton module="whatsapp" submodule={effectiveTab} />
 *
 * DESIGN RULES (from the brief, and they are the point of the feature)
 *   - Subtle. It sits in the existing right-hand control cluster of a header
 *     and flows with that flexbox, so it can never overlap anything.
 *   - Quiet until wanted: muted by default, full contrast on hover/focus.
 *   - No auto-open, no pulse, no attract loop. It waits to be clicked.
 *   - On narrow screens the word collapses and only the "?" icon remains.
 */

const VARIANTS = {
    // White / light headers — the default across the CRM.
    light: 'border-slate-200 bg-white/70 text-slate-500 hover:text-slate-800 hover:bg-white hover:border-slate-300 focus-visible:ring-slate-400',
    // Coloured or gradient headers (WhatsApp, Reports) where a white chip would shout.
    onDark: 'border-white/25 bg-white/10 text-white/85 hover:bg-white/20 hover:text-white focus-visible:ring-white/70',
    // Headers that sit directly on a tinted page background with no card behind them.
    subtle: 'border-slate-200/70 bg-slate-100/60 text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus-visible:ring-slate-400'
};

const HelpButton = ({
    module,
    submodule = '',
    variant = 'light',
    label = 'Help',
    className = ''
}) => {
    const help = useHelp();

    // Rendered outside the CRM layout (embed / public page) — there is no drawer
    // to open, so draw nothing rather than a button that does not work.
    if (!help || !module) return null;

    return (
        <button
            type="button"
            onClick={() => help.openHelp({ module, submodule })}
            title="Help & tutorials for this page"
            aria-label="Open help for this page"
            className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg border text-xs font-semibold
                transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1
                flex-shrink-0 ${VARIANTS[variant] || VARIANTS.light} ${className}`}
        >
            <i className="fa-regular fa-circle-question text-sm" aria-hidden="true"></i>
            <span className="hidden sm:inline">{label}</span>
        </button>
    );
};

export default HelpButton;
