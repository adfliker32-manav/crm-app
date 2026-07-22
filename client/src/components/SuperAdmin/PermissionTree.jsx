import React from 'react';

// Reusable registry permission tree — the single tree UI shared by the per-client
// Module Permissions manager AND the plan builder. Controlled: parent owns the
// `values` map ({ nodeKey: boolean }); this renders toggles and reports changes.
//
// Cascade rule (industry standard): turning a parent OFF forces all descendants
// OFF and disables them; a node whose ancestor is off is shown dimmed.

const Toggle = ({ checked, disabled, onChange }) => (
    <button
        type="button"
        disabled={disabled}
        onClick={onChange}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-purple-500 ${
            disabled ? 'bg-slate-200 cursor-not-allowed' : checked ? 'bg-purple-600' : 'bg-slate-300'
        }`}
    >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
);

const PermissionTree = ({ registry = [], values = {}, onChange, showEnforcedBadge = true }) => {
    const toggle = (node, newVal) => {
        onChange((prevValues) => {
            const currentValues = prevValues || {};
            const next = { ...currentValues, [node.key]: newVal };
            if (!newVal && node.children) {
                const cascadeOff = (nodes) => nodes.forEach((c) => {
                    next[c.key] = false;
                    if (c.children) cascadeOff(c.children);
                });
                cascadeOff(node.children);
            }
            return next;
        });
    };

    const renderNodes = (nodes, depth, parentOn) => nodes.map((node) => {
        const on = !!values[node.key];
        const actionable = parentOn;
        const childrenOn = actionable && on;
        return (
            <React.Fragment key={node.key}>
                <div
                    className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition ${
                        actionable ? 'hover:bg-slate-50' : 'opacity-50'
                    } ${depth === 0 ? 'mt-1' : ''}`}
                    style={{ marginLeft: depth * 22 }}
                >
                    {depth > 0 && <span className="text-slate-300 -ml-3 mr-0.5"><i className="fa-solid fa-turn-up fa-rotate-90 text-[10px]" /></span>}
                    <i className={`${node.icon?.startsWith('fa-brands') ? '' : 'fa-solid '}${node.icon || 'fa-circle'} w-5 text-center ${on && actionable ? 'text-purple-600' : 'text-slate-400'}`} />
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className={`text-sm font-semibold truncate ${depth === 0 ? 'text-slate-800' : 'text-slate-600'}`}>{node.label}</span>
                        {showEnforcedBadge && node.enforced === false && (
                            <span className="text-[9px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded uppercase tracking-wide" title="Stored now; runtime enforcement pending">
                                UI only
                            </span>
                        )}
                    </div>
                    <Toggle checked={on} disabled={!actionable} onChange={() => toggle(node, !on)} />
                </div>
                {node.children && renderNodes(node.children, depth + 1, childrenOn)}
            </React.Fragment>
        );
    });

    return <div className="space-y-0.5">{renderNodes(registry, 0, true)}</div>;
};

export default PermissionTree;
