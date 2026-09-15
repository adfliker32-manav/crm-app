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
    'manage_link': 'appointment.manageLink',
    // The Template Builder's "Lead Stage" option saves `lead.status`, but the
    // context exposes that field as `lead.stage` (see TEMPLATE_VARIABLES), so
    // every template mapped through it resolved to nothing and sanitizeParam
    // rendered a bare "-". Aliased rather than migrated so the mappings already
    // saved in the database keep working.
    'lead.status': 'lead.stage'
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
            // A multi-select custom field resolves to an array. String coercion
            // would render "SEO,Ads" with no spacing, so join it readably first.
            const value = Array.isArray(current) ? current.join(', ') : current;
            return options.sanitize ? options.sanitize(value) : value;
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
        // No caller ever passed `company`, so the builder's "Company Name"
        // option resolved to nothing and sent "-". That option means the
        // workspace owner's own company, and every send path already loads that
        // user, so derive it here instead of editing eight call sites.
        company: company ? {
            name: company.name || '',
            address: company.address || ''
        } : {
            name: user?.companyName || '',
            address: user?.address || ''
        },
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

// ─── Caller-supplied variables ───────────────────────────────────────────────
//
// {{1}}, {{2}} … are normally filled from variableMapping, which the tenant
// configures in the Template Builder. The External API also lets the CALLER
// supply values, because a third-party CRM holds facts this workspace does not
// (an order number, a slot it just booked).
//
// Two sources filling one placeholder is exactly where silent mismatches breed,
// so precedence is decided ONCE — in planTemplateVariables — and every consumer
// (buildMetaComponents included) only applies that decision:
//
//   mapping 'api'          → the caller's value wins. None sent? the tenant's
//                            fallback text, and a `missing` entry when there is
//                            none, so the caller is told rather than guessed for.
//   mapping <field|custom> → the TENANT wins and the caller's value comes back
//                            as an ignored-warning. A workspace's own static
//                            text (legal wording, brand name) must not be
//                            replaceable from outside.
//   mapping '' (Auto)      → the caller's value wins; positional default if none.
//
// Nothing here mutates the template, its mapping or the request body — the plan
// is a fresh object, so two concurrent sends of one template carrying different
// variables can never see each other's values.
const API_MAPPING   = 'api';
const MAX_PARAM_LEN = 1024;  // Meta's per-parameter ceiling
const MAX_VAR_NUM   = 100;
// A body is capped at 100kb by express.json, which still fits thousands of
// entries — and one error line per entry would answer a small request with a
// megabyte of text. No template has more than MAX_VAR_NUM placeholders, so
// anything past that is refused wholesale instead of itemised.
const MAX_ENTRIES   = MAX_VAR_NUM;
const MAX_ERRORS    = 10;
const VAR_SCOPES    = ['body', 'header'];

/** Read one key out of a variableMapping that may be a Mongoose Map or a POJO. */
const readMapping = (variableMapping, key) => {
    if (!variableMapping) return '';
    const raw = (typeof variableMapping.get === 'function')
        ? variableMapping.get(key)
        : variableMapping[key];
    return raw == null ? '' : String(raw);
};

/**
 * The placeholder numbers a template actually carries, per component scope.
 * Mirrors exactly what buildMetaComponents emits parameters for — a scope it
 * skips must not appear here, or a caller would be asked to fill a variable
 * that never reaches Meta.
 */
const extractTemplateVariables = (dbComponents) => {
    const out = { body: [], header: [] };
    for (const comp of dbComponents || []) {
        const scope = comp?.type === 'BODY' ? 'body'
            : (comp?.type === 'HEADER' && comp.format === 'TEXT') ? 'header'
            : null;
        if (!scope || !comp.text) continue;
        const nums = [...comp.text.matchAll(/\{\{(\d+)\}\}/g)].map(m => parseInt(m[1], 10));
        out[scope] = [...new Set([...out[scope], ...nums])].sort((a, b) => a - b);
    }
    return out;
};

/**
 * Normalize whatever a caller sent as `variables` into { body: { n: text }, … }.
 *
 * Accepted shapes — positional, numbered, or scoped per component:
 *   ["Rahul", "3 PM"]               → body {{1}}, {{2}}
 *   { "1": "Rahul", "2": "3 PM" }   → body {{1}}, {{2}}
 *   { body: {…}, header: {…} }      → each component separately
 *
 * @returns {{ok: true, value: object} | {ok: false, errors: string[]}}
 */
const normalizeVariableInput = (input) => {
    if (input === undefined || input === null) return { ok: true, value: {} };

    const errors = [];
    const value  = {};

    const readScope = (raw, scope) => {
        const size = Array.isArray(raw) ? raw.length
            : (raw && typeof raw === 'object') ? Object.keys(raw).length : 0;
        if (size > MAX_ENTRIES) {
            errors.push(`\`variables.${scope}\` carries ${size} entries; a template has at most ${MAX_VAR_NUM} variables.`);
            return;
        }

        const bucket = {};
        if (Array.isArray(raw)) {
            raw.forEach((v, i) => { bucket[i + 1] = v; });
        } else if (raw && typeof raw === 'object') {
            for (const [k, v] of Object.entries(raw)) {
                if (!/^\d+$/.test(String(k).trim())) {
                    errors.push(`\`variables.${scope}\` keys must be variable numbers like "1" — got "${k}".`);
                    continue;
                }
                bucket[parseInt(k, 10)] = v;
            }
        } else {
            errors.push(`\`variables.${scope}\` must be an array of values, or an object keyed by variable number.`);
            return;
        }

        const clean = {};
        for (const [key, v] of Object.entries(bucket)) {
            const n  = parseInt(key, 10);
            const at = `\`variables.${scope}.${n}\``;
            if (!(n >= 1 && n <= MAX_VAR_NUM)) {
                errors.push(`Variable number ${n} is out of range (1-${MAX_VAR_NUM}).`);
                continue;
            }
            if (typeof v === 'number' && Number.isFinite(v)) { clean[n] = String(v); continue; }
            if (typeof v !== 'string') {
                errors.push(`${at} must be text — objects, arrays, booleans and null are not accepted.`);
                continue;
            }
            // Meta rejects a parameter holding a newline, a tab or four-plus
            // consecutive spaces with an opaque 132000, so collapse it here
            // rather than let the send fail at the far end.
            const text = v.replace(/\s+/g, ' ').trim();
            if (!text) {
                errors.push(`${at} is empty. Send a value, or drop the key and let the CRM fill it.`);
                continue;
            }
            if (text.length > MAX_PARAM_LEN) {
                errors.push(`${at} is ${text.length} characters; WhatsApp allows ${MAX_PARAM_LEN}.`);
                continue;
            }
            clean[n] = text;
        }
        if (Object.keys(clean).length) value[scope] = clean;
    };

    if (Array.isArray(input)) {
        readScope(input, 'body');
    } else if (typeof input === 'object') {
        const keys   = Object.keys(input);
        const scoped = keys.filter(k => VAR_SCOPES.includes(k));
        if (scoped.length && scoped.length !== keys.length) {
            errors.push('`variables` must either be keyed by variable number, or scoped as { "body": …, "header": … } — not a mix of both.');
        } else if (scoped.length) {
            for (const s of scoped) readScope(input[s], s);
        } else {
            readScope(input, 'body');
        }
    } else {
        errors.push('`variables` must be an array of values, or an object keyed by variable number.');
    }

    if (errors.length > MAX_ERRORS) {
        const hidden = errors.length - MAX_ERRORS;
        errors.splice(MAX_ERRORS, hidden, `…and ${hidden} more problem${hidden === 1 ? '' : 's'} with \`variables\`.`);
    }
    return errors.length ? { ok: false, errors } : { ok: true, value };
};

/**
 * Decide, per placeholder, whose value wins — see the precedence note above.
 *
 * @param {object} args - { components, variableMapping, provided }
 * @returns {{applied, sources, errors, missing, warnings, present}}
 *   applied  - overrides to hand buildMetaComponents, scope → { n: text }
 *   sources  - "body.1" → 'api' | 'fallback' | 'crm:<mapping>' | 'auto'
 *   errors   - caller mistakes that must fail the request
 *   missing  - "scope.n" the caller was required to supply and did not
 *   warnings - values ignored, or fallbacks used: worth telling the caller
 */
const planTemplateVariables = ({ components, variableMapping, provided = {} } = {}) => {
    const present  = extractTemplateVariables(components);
    const applied  = {};
    const sources  = {};
    const errors   = [];
    const missing  = [];
    const warnings = [];

    // A number with no matching placeholder is a caller bug worth failing on:
    // applied quietly, the message goes out wrong with a 200 in the caller's hand.
    for (const scope of VAR_SCOPES) {
        for (const key of Object.keys(provided[scope] || {})) {
            if (present[scope].includes(parseInt(key, 10))) continue;
            errors.push(
                `This template has no {{${key}}} in its ${scope}. ` +
                (present[scope].length
                    ? `Its ${scope} variables are ${present[scope].map(n => `{{${n}}}`).join(', ')}.`
                    : `Its ${scope} takes no variables.`)
            );
        }
    }

    const put = (scope, n, text) => {
        applied[scope] = { ...(applied[scope] || {}), [n]: text };
    };

    for (const scope of VAR_SCOPES) {
        for (const n of present[scope]) {
            const supplied = provided[scope]?.[n];
            const mapType  = readMapping(variableMapping, String(n));
            const fallback = readMapping(variableMapping, `${n}_custom`).trim();
            const at       = `${scope}.${n}`;

            if (mapType === API_MAPPING) {
                if (supplied !== undefined) {
                    put(scope, n, supplied);
                    sources[at] = 'api';
                } else if (fallback) {
                    put(scope, n, fallback);
                    sources[at] = 'fallback';
                    warnings.push(`{{${n}}} (${scope}) is set to "Filled by API" but no value was sent — the template's fallback text was used.`);
                } else {
                    missing.push(at);
                }
                continue;
            }

            if (supplied !== undefined) {
                if (mapType) {
                    // The tenant pinned this one to their own data. Refusing the
                    // send would be harsher than it needs to be, and applying the
                    // caller's value would rewrite the workspace's own wording —
                    // so the tenant wins and the caller is told plainly.
                    warnings.push(`{{${n}}} (${scope}) is mapped to "${mapType}" in this workspace, so the value you sent was ignored. Switch it to "Filled by API" on the template to control it from here.`);
                    sources[at] = `crm:${mapType}`;
                    continue;
                }
                put(scope, n, supplied);
                sources[at] = 'api';
                continue;
            }
            sources[at] = mapType ? `crm:${mapType}` : 'auto';
        }
    }

    return { applied, sources, errors, missing, warnings, present };
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
 * @param {Object} [overrides] - Caller-supplied values, scope → { n: text }, as
 *   returned in `applied` by planTemplateVariables. Precedence was already
 *   settled there; this function only applies it, so the two can never disagree.
 *   Omit it and behaviour is exactly what it was before overrides existed.
 * @returns {Array} Meta-formatted components array for the API payload
 */
const buildMetaComponents = (dbComponents, variableMapping, context, overrides = {}) => {
    const metaComponents = [];

    const resolveMappedVariable = (varNum, scope) => {
        // planTemplateVariables has already decided this one belongs to the
        // caller — do not re-litigate it here.
        const override = overrides?.[scope]?.[varNum];
        if (override !== undefined && override !== null && String(override) !== '') {
            return override;
        }

        const mapType   = readMapping(variableMapping, varNum.toString());
        const customVal = readMapping(variableMapping, `${varNum}_custom`);

        if (mapType === 'custom') {
            return customVal || '';
        }

        // 'api' with nothing supplied only reaches here on a CRM-side send —
        // manual, broadcast, automation, workflow — which has no caller to ask.
        // Resolving it as a data path would render "-" into every one of those
        // messages, so use the tenant's fallback text and then the positional
        // default instead.
        if (mapType === API_MAPPING) {
            if (customVal) return customVal;
        } else if (mapType) {
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
                    parameters.push({ type: 'text', text: sanitizeParam(resolveMappedVariable(n, 'body')) });
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
                        parameters.push({ type: 'text', text: sanitizeParam(resolveMappedVariable(n, 'header')) });
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
    buildMetaComponents,
    // Caller-supplied variables (External API). API_MAPPING is exported so the
    // controller, the builder's option list and the tests all name the same
    // string instead of three copies of 'api' drifting apart.
    API_MAPPING,
    MAX_PARAM_LEN,
    extractTemplateVariables,
    normalizeVariableInput,
    planTemplateVariables
};
