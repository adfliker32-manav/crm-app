import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHelp } from './HelpContext';

/**
 * The right-side Help panel. Rendered once by HelpProvider (via Layout), never
 * by a page.
 *
 * NOTHING AUTOPLAYS. The player is not even in the DOM until the user clicks
 * the poster frame — up to that moment the panel has loaded a still image and
 * no third-party script. That is both the brief's requirement and the reason
 * opening Help never costs the user's bandwidth or attention.
 *
 * Every URL on screen (embed, watch, thumbnail) arrives built from the API.
 * This file contains no YouTube address of any kind, which is what makes
 * "change the video in Super Admin and it takes effect immediately" true.
 */

const drawerKeyframes = `
@keyframes helpDrawerIn {
    from { transform: translateX(24px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
}
@keyframes helpScrimIn {
    from { opacity: 0; }
    to   { opacity: 1; }
}
`;

/* ─── One video: poster frame first, player only on demand ─── */
//
// Every call site keys this on video.id, so swapping the video remounts the card
// and the player state resets with it. That is deliberate: a card that kept
// `playing` across a change would show the OLD iframe under the NEW title after
// a super admin edits the link.
const VideoCard = ({ video, primary = false }) => {
    const [playing, setPlaying] = useState(false);

    if (!video) return null;

    return (
        <div className={primary
            ? 'rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm'
            : 'rounded-xl border border-slate-200 bg-white overflow-hidden'}>

            <div className="relative bg-slate-900 aspect-video">
                {playing ? (
                    <iframe
                        src={video.embedUrl}
                        title={video.title}
                        className="absolute inset-0 w-full h-full"
                        frameBorder="0"
                        allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        referrerPolicy="strict-origin-when-cross-origin"
                        allowFullScreen
                    />
                ) : (
                    <button
                        type="button"
                        onClick={() => setPlaying(true)}
                        className="absolute inset-0 w-full h-full group"
                        aria-label={`Play ${video.title}`}
                    >
                        <img
                            src={video.thumbnailUrl}
                            alt=""
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                            // A missing thumbnail must not leave a broken-image
                            // icon — the dark panel behind it reads fine alone.
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                        <span className="absolute inset-0 flex items-center justify-center">
                            <span className="w-14 h-14 rounded-full bg-white/95 shadow-lg flex items-center justify-center group-hover:scale-105 transition-transform">
                                <i className="fa-solid fa-play text-slate-900 text-lg ml-0.5" aria-hidden="true"></i>
                            </span>
                        </span>
                    </button>
                )}
            </div>

            <div className={primary ? 'p-4' : 'p-3'}>
                <h4 className={primary
                    ? 'font-bold text-slate-900 text-[15px] leading-snug'
                    : 'font-semibold text-slate-800 text-sm leading-snug'}>
                    {video.title}
                </h4>

                {video.description && (
                    <p className="text-sm text-slate-500 mt-1.5 leading-relaxed whitespace-pre-line">
                        {video.description}
                    </p>
                )}

                <div className="flex items-center justify-between gap-3 mt-3">
                    {/* A module-level video has the internal label "Module overview";
                        name the module instead so the caption reads as product
                        language rather than a database bucket. */}
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 truncate">
                        {video.submodule ? video.submoduleLabel : video.moduleLabel}
                    </span>
                    <a
                        href={video.watchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1.5 flex-shrink-0"
                    >
                        Watch on YouTube
                        <i className="fa-solid fa-arrow-up-right-from-square text-[10px]" aria-hidden="true"></i>
                    </a>
                </div>
            </div>
        </div>
    );
};

const HelpDrawer = () => {
    const help = useHelp();
    const navigate = useNavigate();

    if (!help || !help.open) return null;

    const { content, loading, error, closeHelp } = help;
    const primary = content?.primary || null;
    const related = content?.related || [];
    const moduleLabel = content?.module?.label || '';

    // A sub-module key of '' is the module-level bucket, whose label is the
    // internal phrase "Module overview". <HelpButton> lets a page omit the
    // sub-module entirely, so that phrase could reach the customer as
    // "the walkthrough for Module overview". Treat that topic as having no
    // sub-module for display, and let the module name speak for it.
    const hasSubmodule = Boolean(content?.submodule?.key);
    const submoduleLabel = hasSubmodule ? (content?.submodule?.label || '') : '';
    // What to call the thing the user asked for help with, in prose.
    const topicLabel = submoduleLabel || moduleLabel || 'this page';

    // The Help Center widget lives on the Dashboard. Routing there with
    // ?support=1 opens it — a plain navigation rather than a cross-component
    // event, so it behaves the same whether or not the widget is mounted yet.
    const contactSupport = () => {
        closeHelp();
        navigate('/dashboard?support=1');
    };

    return (
        <>
            <style>{drawerKeyframes}</style>

            {/* Scrim — click anywhere outside to dismiss */}
            <div
                className="fixed inset-0 z-[60] bg-slate-900/30"
                style={{ animation: 'helpScrimIn 150ms ease-out' }}
                onClick={closeHelp}
                aria-hidden="true"
            />

            <aside
                role="dialog"
                aria-modal="true"
                aria-label="Help and tutorials"
                className="fixed top-0 right-0 z-[61] h-full w-full sm:w-[420px] lg:w-[460px]
                    bg-slate-50 shadow-2xl flex flex-col border-l border-slate-200"
                style={{ animation: 'helpDrawerIn 200ms ease-out' }}
            >
                {/* ── Header ── */}
                <div className="flex-shrink-0 bg-white border-b border-slate-200 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
                                    <i className="fa-regular fa-circle-question text-sm" aria-hidden="true"></i>
                                </span>
                                <h3 className="text-base font-bold text-slate-900">Help &amp; Guides</h3>
                            </div>

                            {/* Breadcrumb: which page this help is for. The labels come
                                from the API, so until the first response lands there is
                                nothing to show but the raw key — a placeholder reads better
                                than flashing "whatsapp" and then "WhatsApp". */}
                            {moduleLabel ? (
                                <p className="text-xs text-slate-500 mt-2 truncate">
                                    {moduleLabel}
                                    {submoduleLabel && (
                                        <>
                                            <span className="mx-1.5 text-slate-300">›</span>
                                            <span className="font-semibold text-slate-600">{submoduleLabel}</span>
                                        </>
                                    )}
                                </p>
                            ) : (
                                <div className="h-3 w-32 rounded bg-slate-200 animate-pulse mt-2.5" />
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={closeHelp}
                            aria-label="Close help"
                            className="w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-center flex-shrink-0"
                        >
                            <i className="fa-solid fa-xmark text-lg" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>

                {/* ── Body ── */}
                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
                    {loading && !primary ? (
                        <div className="space-y-3" aria-busy="true">
                            <div className="aspect-video rounded-2xl bg-slate-200 animate-pulse" />
                            <div className="h-4 w-2/3 rounded bg-slate-200 animate-pulse" />
                            <div className="h-3 w-full rounded bg-slate-200 animate-pulse" />
                        </div>
                    ) : error && !primary ? (
                        <div className="text-center py-10">
                            <i className="fa-solid fa-cloud-arrow-down text-3xl text-slate-300" aria-hidden="true"></i>
                            <p className="text-sm font-semibold text-slate-700 mt-3">Could not load help right now</p>
                            <p className="text-xs text-slate-500 mt-1">Check your connection and try again.</p>
                        </div>
                    ) : primary ? (
                        <>
                            {/* Honest about what is on screen: when the exact tab has no
                                video of its own, say the general guide is standing in. */}
                            {content?.isFallback && (
                                <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5">
                                    <i className="fa-solid fa-circle-info text-amber-500 text-xs mt-0.5" aria-hidden="true"></i>
                                    <p className="text-xs text-amber-800 leading-relaxed">
                                        A dedicated <strong>{submoduleLabel}</strong> video is coming soon — here is the
                                        general {moduleLabel} guide in the meantime.
                                    </p>
                                </div>
                            )}

                            <VideoCard key={primary.id} video={primary} primary />

                            {related.length > 0 && (
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
                                        Related guides
                                    </p>
                                    <div className="space-y-3">
                                        {related.map(v => <VideoCard key={v.id} video={v} />)}
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        /* Nothing configured for this topic — a clean, finished state,
                           never an empty panel or a broken player. */
                        <div className="text-center py-12">
                            <span className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center mx-auto">
                                <i className="fa-solid fa-film text-2xl" aria-hidden="true"></i>
                            </span>
                            <p className="text-sm font-bold text-slate-700 mt-4">Help video coming soon.</p>
                            <p className="text-xs text-slate-500 mt-1.5 max-w-[260px] mx-auto leading-relaxed">
                                We are still recording the walkthrough for
                                {' '}<strong>{topicLabel}</strong>.
                                Our team can walk you through it in the meantime.
                            </p>
                            <button
                                type="button"
                                onClick={contactSupport}
                                className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-black text-white text-xs font-bold transition-colors"
                            >
                                <i className="fa-solid fa-life-ring" aria-hidden="true"></i>
                                Contact Support
                            </button>
                        </div>
                    )}
                </div>

                {/* ── Footer ── */}
                <div className="flex-shrink-0 border-t border-slate-200 bg-white px-5 py-3 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-400">Still stuck?</p>
                    <button
                        type="button"
                        onClick={contactSupport}
                        className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
                    >
                        <i className="fa-solid fa-life-ring" aria-hidden="true"></i>
                        Contact Support
                    </button>
                </div>
            </aside>
        </>
    );
};

export default HelpDrawer;
