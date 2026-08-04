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

const LEGACY_MAP = {
    'name': 'lead.name',
    'leadname': 'lead.name',
    'email': 'lead.email',
    'leademail': 'lead.email',
    'phone': 'lead.phone',
    'leadphone': 'lead.phone',
    'company': 'lead.company',
    'companyname': 'lead.company',
    'username': 'user.name',
    'date': 'appointment.date',
    'time': 'appointment.time',
    'service': 'appointment.service',
    'manage_link': 'appointment.manageLink'
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
        let trimmedKey = key.trim();
        // Fallback backward compatibility map
        if (LEGACY_MAP[trimmedKey.toLowerCase()]) {
            trimmedKey = LEGACY_MAP[trimmedKey.toLowerCase()];
        }

        // If the context contains the exact flat key, use it immediately
        if (context[trimmedKey] !== undefined) {
            const val = context[trimmedKey];
            return options.sanitize ? options.sanitize(val) : val;
        }

        const path = trimmedKey.split('.');
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
const buildTemplateContext = ({ lead, user, company, system, appointment }) => {
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
            ...system,
            date: new Date().toLocaleDateString(),
            time: new Date().toLocaleTimeString()
        },
        appointment: appointment ? {
            date: appointment.appointmentDate ? new Date(appointment.appointmentDate).toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '',
            time: appointment.appointmentTime || '',
            service: appointment.serviceType || '',
            manageLink: appointment.manageLink || ''
        } : {}
    };
};

/**
 * Sanitize a resolved value into a Meta-safe template parameter.
 */
const sanitizeParam = (value) => {
    const text = (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
    return text.length ? text : '-';
};

/**
 * Build the Meta API `components` array from the DB template components.
 * @param {Array} dbComponents - The template's components array from MongoDB
 * @param {Map|Object} variableMapping - The template's variableMapping
 * @param {Object} context - Standardized context { lead, user, company, system }
 * @returns {Array} Meta-formatted components array for the API payload
 */
const buildMetaComponents = (dbComponents, variableMapping, context) => {
    const metaComponents = [];

    const resolveMappedVariable = (varNum) => {
        const mapType = (variableMapping && typeof variableMapping.get === 'function')
            ? variableMapping.get(varNum.toString())
            : (variableMapping?.[varNum.toString()] || '');

        if (mapType === 'custom') {
            const customVal = (variableMapping && typeof variableMapping.get === 'function')
                ? variableMapping.get(`${varNum}_custom`)
                : (variableMapping?.[`${varNum}_custom`] || '');
            return customVal || '';
        }

        if (mapType) {
            const resolved = resolveTemplate(`{{${mapType}}}`, context);
            return resolved !== `{{${mapType}}}` ? resolved : '';
        }

        // Fallbacks for unmapped variables using the standardized context
        if (varNum === 1) return context.lead?.name || 'Customer';
        if (varNum === 2) return context.lead?.stage || 'New';
        if (varNum === 3) return context.company?.name || 'Our Company';
        if (varNum === 4) return context.user?.name || 'Representative';
        return '';
    };

    for (const comp of dbComponents || []) {
        if (comp.type === 'BODY' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                for (const n of nums) {
                    parameters.push({ type: 'text', text: sanitizeParam(resolveMappedVariable(n)) });
                }
                metaComponents.push({ type: 'body', parameters });
            }
        }
        
        if (comp.type === 'HEADER') {
            if (comp.format === 'TEXT' && comp.text) {
                const matches = comp.text.match(/\{\{(\d+)\}\}/g);
                if (matches && matches.length > 0) {
                    const parameters = [];
                    const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                    for (const n of nums) {
                        parameters.push({ type: 'text', text: sanitizeParam(resolveMappedVariable(n)) });
                    }
                    metaComponents.push({ type: 'header', parameters });
                }
            } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(comp.format)) {
                if (context.system?.customData?.media && context.system.customData.media.type === comp.format) {
                    const mediaObj = {};
                    const mediaData = context.system.customData.media;
                    if (mediaData.media_id) {
                        mediaObj.id = mediaData.media_id;
                    } else if (mediaData.link) {
                        mediaObj.link = mediaData.link;
                    }

                    if (comp.format === 'DOCUMENT' && mediaData.filename) {
                        mediaObj.filename = mediaData.filename;
                    }

                    if (mediaObj.id || mediaObj.link) {
                        metaComponents.push({
                            type: 'header',
                            parameters: [
                                {
                                    type: comp.format.toLowerCase(),
                                    [comp.format.toLowerCase()]: mediaObj
                                }
                            ]
                        });
                    }
                }
            }
        }
    }
    return metaComponents;
};

module.exports = {
    validateTemplate,
    resolveTemplate,
    buildTemplateContext,
    buildMetaComponents
};
