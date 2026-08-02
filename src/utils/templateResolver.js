const { TEMPLATE_VARIABLES } = require('../config/templateVariables');

/**
 * Validates a template string against the central registry.
 * Returns { valid: boolean, errors: string[] }
 */
const validateTemplate = (template) => {
    if (!template) return { valid: true, errors: [] };
    
    const errors = [];
    // Match anything looking like {{a.b}} or {{a}} or {{a.b.c}}
    const matches = [...template.matchAll(/\{\{([^}]+)\}\}/g)];
    
    for (const match of matches) {
        const fullPath = match[1].trim();
        const parts = fullPath.split('.');
        
        // If it's a known group in TEMPLATE_VARIABLES, we can check it
        const groupName = parts[0];
        
        if (TEMPLATE_VARIABLES[groupName]) {
            // It's a standard group. Validate the subfield unless it's dynamic (e.g. customData)
            const fieldName = parts.slice(1).join('.');
            if (fieldName !== 'customData' && !fieldName.startsWith('customData.')) {
                if (!TEMPLATE_VARIABLES[groupName][fieldName]) {
                    errors.push(`Unknown variable: ${fullPath}`);
                }
            }
        } else {
            // Might be a totally unknown top-level group
            errors.push(`Unknown variable group: ${fullPath}`);
        }
    }
    
    return { valid: errors.length === 0, errors };
};

/**
 * Resolves template variables safely from a nested context object.
 * 
 * @param {string} template - The template string with {{vars}}
 * @param {object} context - Standardized context: { lead, user, company, system }
 * @param {object} options - Options { sanitize: function(val) }
 * @returns {string} - The resolved template
 */
const resolveTemplate = (template, context, options = {}) => {
    if (!template) return '';
    if (!context) return template;

    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        // If the context contains the exact flat key, use it immediately
        if (context[key.trim()] !== undefined) {
            const val = context[key.trim()];
            return options.sanitize ? options.sanitize(val) : val;
        }

        const path = key.trim().split('.');
        let current = context;
        
        // Traverse the context object based on the dot path
        for (let i = 0; i < path.length; i++) {
            if (current == null || typeof current !== 'object') {
                return match; // Path breaks, leave placeholder intact
            }
            current = current[path[i]];
        }
        
        // Return resolved value, or leave placeholder if undefined
        if (current !== undefined) {
            return options.sanitize ? options.sanitize(current) : current;
        }
        return match;
    });
};

/**
 * Builds a standardized context object for resolving templates.
 * 
 * @param {object} args - { lead, user, company }
 * @returns {object} - Standardized context { lead, user, company, system }
 */
const buildTemplateContext = ({ lead, user, company }) => {
    return {
        lead: lead ? {
            name: lead.name || '',
            email: lead.email || '',
            phone: lead.phone || '',
            company: lead.company || lead.customData?.company || lead.customData?.Company || '',
            stage: lead.status || lead.stage || '',
            source: lead.source || '',
            customData: lead.customData || {}
        } : {},
        user: user ? {
            name: user.name || '',
            email: user.email || ''
        } : {},
        company: company ? {
            name: company.name || '',
            address: company.address || ''
        } : {},
        system: {
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString()
        }
    };
};

module.exports = {
    validateTemplate,
    resolveTemplate,
    buildTemplateContext
};
