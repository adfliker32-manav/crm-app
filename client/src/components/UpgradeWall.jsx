import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loadFeatureMeta, logUpgradeEvent } from '../utils/featureMeta';

// Shown in place of a feature the current plan doesn't unlock. Industry-standard
// soft paywall: the feature stays discoverable in the nav and this screen SELLS
// it (benefits + plan hint) rather than just denying access.
//
// Fully registry-driven — pass the feature key and everything (name, tagline,
// benefits, plan hint) is looked up from the backend feature metadata. Fires the
// monetization signals (prompt viewed / upgrade clicked) so you learn what people
// actually want to pay for.
const UpgradeWall = ({ feature, featureLabel = 'This feature', destination = '/billing', source = 'route' }) => {
    const navigate = useNavigate();
    const [meta, setMeta] = useState(null);

    useEffect(() => {
        let alive = true;
        loadFeatureMeta().then((all) => { if (alive) setMeta(all?.[feature] || null); });
        // One signal per wall view.
        logUpgradeEvent('upgrade_prompt_viewed', feature, { featureName: featureLabel, source });
        return () => { alive = false; };
    }, [feature, featureLabel, source]);

    const name = meta?.name || featureLabel;
    const tagline = meta?.tagline;
    const benefits = meta?.benefits || [];
    const planHint = meta?.planHint || 'Available on a higher plan';

    const handleUpgrade = () => {
        logUpgradeEvent('upgrade_button_clicked', feature, { featureName: name, source });
        navigate(destination);
    };

    return (
        <div className="flex-1 flex items-center justify-center p-6 min-h-[70vh]">
            <div className="max-w-md w-full text-center bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] ring-1 ring-slate-100 p-10">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-500/30 mb-6">
                    <i className={`fa-solid ${meta?.icon && !meta.icon.startsWith('fa-brands') ? meta.icon : 'fa-lock'} text-white text-2xl`} />
                </div>

                <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">{name}</h2>
                {tagline && <p className="text-slate-500 mt-2 leading-relaxed">{tagline}</p>}

                {benefits.length > 0 && (
                    <ul className="text-left mt-6 space-y-2.5 max-w-xs mx-auto">
                        {benefits.map((b, i) => (
                            <li key={i} className="flex items-start gap-2.5 text-sm text-slate-700">
                                <i className="fa-solid fa-circle-check text-emerald-500 mt-0.5" />
                                <span>{b}</span>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="mt-7 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wide bg-purple-50 text-purple-600 px-3 py-1.5 rounded-full">
                    <i className="fa-solid fa-crown" /> {planHint}
                </div>

                <button
                    onClick={handleUpgrade}
                    className="mt-6 w-full inline-flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-purple-500/30 transition-all hover:-translate-y-0.5"
                >
                    <i className="fa-solid fa-arrow-up-right-dots" />
                    Upgrade Plan
                </button>
                <p className="text-xs text-slate-400 mt-4">Already upgraded? Reload to refresh your access.</p>
            </div>
        </div>
    );
};

export default UpgradeWall;
