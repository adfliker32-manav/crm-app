import React, { useState, useRef, useEffect } from 'react';
import { optionsForField } from '../../utils/customFieldHelpers';

/**
 * The ONE renderer for a custom field input. Add Lead and Edit Lead both use it,
 * so the two forms can never drift apart on how a dropdown behaves.
 *
 * An option an admin has since removed but the lead still holds is rendered with
 * a "(removed)" marker rather than dropped, so editing an old lead never wipes it.
 */

const MultiSelect = ({ field, value, onChange, className }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    const selected = Array.isArray(value) ? value : [];
    const options = optionsForField(field, selected);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, [open]);

    const toggle = (option) => {
        onChange(selected.includes(option)
            ? selected.filter(v => v !== option)
            : [...selected, option]);
    };

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className={`${className} text-left flex items-center justify-between gap-2`}
            >
                <span className={selected.length ? 'text-slate-800' : 'text-slate-400'}>
                    {selected.length === 0
                        ? `Select ${field.label}`
                        : selected.length <= 2
                            ? selected.join(', ')
                            : `${selected.length} selected`}
                </span>
                <i className={`fa-solid fa-chevron-${open ? 'up' : 'down'} text-[10px] text-slate-400 shrink-0`}></i>
            </button>

            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                    {selected.map(v => (
                        <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[11px]">
                            {v}
                            <button type="button" onClick={() => toggle(v)} className="text-indigo-400 hover:text-red-500">
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {open && (
                <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg p-1">
                    {options.length === 0 ? (
                        <p className="text-xs text-slate-400 p-3">No options defined. Add them in Settings → Custom Fields.</p>
                    ) : options.map(({ value: opt, retired }) => (
                        <label
                            key={opt}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                checked={selected.includes(opt)}
                                onChange={() => toggle(opt)}
                                className="w-4 h-4 text-indigo-600"
                            />
                            <span className="flex-1">{opt}</span>
                            {retired && <span className="text-[10px] text-amber-600 shrink-0">removed</span>}
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};

const CustomFieldInput = ({ field, value, onChange, className }) => {
    const set = (v) => onChange(field.key, v);

    switch (field.type) {
        case 'multiselect':
            return <MultiSelect field={field} value={value} onChange={set} className={className} />;

        case 'dropdown':
            return (
                <select value={value || ''} onChange={(e) => set(e.target.value)} className={className} required={field.required}>
                    <option value="">Select {field.label}</option>
                    {optionsForField(field, value).map(({ value: opt, retired }) => (
                        <option key={opt} value={opt}>{retired ? `${opt} (removed)` : opt}</option>
                    ))}
                </select>
            );

        case 'date':
            return <input type="date" value={value || ''} onChange={(e) => set(e.target.value)} className={className} required={field.required} />;

        case 'number':
            return <input type="number" value={value || ''} onChange={(e) => set(e.target.value)} className={className} placeholder={`Enter ${field.label}`} required={field.required} />;

        case 'email':
            return <input type="email" value={value || ''} onChange={(e) => set(e.target.value)} className={className} placeholder={`Enter ${field.label}`} required={field.required} />;

        case 'phone':
            return <input type="tel" value={value || ''} onChange={(e) => set(e.target.value)} className={className} placeholder={`Enter ${field.label}`} required={field.required} />;

        default:
            return <input type="text" value={value || ''} onChange={(e) => set(e.target.value)} className={className} placeholder={`Enter ${field.label}`} required={field.required} />;
    }
};

export default CustomFieldInput;
