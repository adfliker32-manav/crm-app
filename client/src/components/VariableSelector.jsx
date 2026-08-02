import React, { useState, useRef, useEffect } from 'react';

const TEMPLATE_VARIABLES = {
    lead: {
        name: "Lead Name",
        email: "Lead Email",
        phone: "Lead Phone",
        company: "Company Name",
        stage: "Pipeline Stage",
        source: "Lead Source"
    },
    user: {
        name: "User Name",
        email: "User Email"
    },
    company: {
        name: "Company Name",
        address: "Company Address"
    },
    system: {
        date: "Current Date",
        time: "Current Time"
    }
};

/**
 * A searchable dropdown for inserting template variables.
 * @param {function} onInsert - Called with the formatted variable string e.g. '{{lead.name}}'
 */
const VariableSelector = ({ onInsert, className = '' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const dropdownRef = useRef(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (group, key) => {
        onInsert(`{{${group}.${key}}}`);
        setIsOpen(false);
        setSearch('');
    };

    // Filter variables based on search
    const filteredVars = Object.entries(TEMPLATE_VARIABLES).map(([group, vars]) => {
        const filtered = Object.entries(vars).filter(([key, label]) => 
            label.toLowerCase().includes(search.toLowerCase()) || 
            key.toLowerCase().includes(search.toLowerCase())
        );
        return { group, vars: filtered };
    }).filter(g => g.vars.length > 0);

    return (
        <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className="inline-flex justify-center items-center px-3 py-1.5 border border-slate-300 shadow-sm text-sm font-medium rounded-md text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
                title="Insert Variable"
            >
                <i className="fa-solid fa-code text-slate-400 mr-2"></i>
                Variables
            </button>

            {isOpen && (
                <div className="origin-top-right absolute right-0 mt-2 w-64 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-50 focus:outline-none">
                    <div className="p-2 border-b border-slate-100">
                        <input
                            type="text"
                            autoFocus
                            className="w-full text-sm border-slate-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                            placeholder="Search variables..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto py-1">
                        {filteredVars.length === 0 ? (
                            <div className="px-4 py-2 text-sm text-slate-500 text-center">No variables found</div>
                        ) : (
                            filteredVars.map(({ group, vars }) => (
                                <div key={group}>
                                    <div className="px-3 py-1 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50">
                                        {group}
                                    </div>
                                    {vars.map(([key, label]) => (
                                        <button
                                            key={key}
                                            type="button"
                                            className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus:bg-indigo-50"
                                            onClick={() => handleSelect(group, key)}
                                        >
                                            <div className="font-medium">{label}</div>
                                            <div className="text-xs text-slate-400 font-mono mt-0.5">{`{{${group}.${key}}}`}</div>
                                        </button>
                                    ))}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default VariableSelector;
