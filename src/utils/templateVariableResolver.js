/**
 * templateVariableResolver.js
 * ────────────────────────────
 * Single-source-of-truth for resolving WhatsApp template variables
 * and building Meta API component payloads.
 *
 * Previously duplicated in:
 *   - whatsappAutomationService.js
 *   - whatsappConversationController.js
 *   - whatsappBroadcastController.js
 */

/**
 * Resolve a single template variable (e.g. {{1}}) to its actual value.
 * @param {Map|Object} mappingObj - The template's variableMapping (Mongoose Map or plain object)
 * @param {number} varNum - The variable number (1, 2, 3, …)
 * @param {Object} data - { leadName, leadPhone, leadEmail, stageName, companyName, userName }
 */
const resolveVariable = (mappingObj, varNum, data) => {
    // Handle Mongoose Map vs plain object
    const mapType = (mappingObj && typeof mappingObj.get === 'function')
        ? mappingObj.get(varNum.toString())
        : (mappingObj?.[varNum.toString()] || '');

    switch (mapType) {
        case 'lead.name': return data.leadName || 'Customer';
        case 'lead.phone': return data.leadPhone || '';
        case 'lead.email': return data.leadEmail || '';
        case 'lead.status': return data.stageName || 'New';
        case 'company.name': return data.companyName || '';
        case 'user.name': return data.userName || '';
        case 'custom':
            const customVal = (mappingObj && typeof mappingObj.get === 'function')
                ? mappingObj.get(`${varNum}_custom`)
                : (mappingObj?.[`${varNum}_custom`] || '');
            return customVal || '';
        default:
            // Fallback to older static convention if unmapped
            if (varNum === 1) return data.leadName || 'Customer';
            if (varNum === 2) return data.stageName || 'New';
            if (varNum === 3) return data.companyName || 'Our Company';
            if (varNum === 4) return data.userName || 'Representative';
            return '';
    }
};

/**
 * Sanitize a resolved value into a Meta-safe template parameter.
 * Meta rejects the whole template send if any body/header parameter is empty
 * or contains newlines, tabs, or more than 4 consecutive spaces. Collapse all
 * whitespace runs to a single space and never return an empty string.
 */
const sanitizeParam = (value) => {
    const text = (value == null ? '' : String(value)).replace(/\s+/g, ' ').trim();
    return text.length ? text : '-';
};

/**
 * Build the Meta API `components` array from the DB template components.
 * @param {Array} dbComponents - The template's components array from MongoDB
 * @param {Map|Object} variableMapping - The template's variableMapping
 * @param {Object} data - { leadName, leadPhone, leadEmail, stageName, companyName, userName }
 * @returns {Array} Meta-formatted components array for the API payload
 */
const buildMetaComponents = (dbComponents, variableMapping, data) => {
    const metaComponents = [];

    for (const comp of dbComponents) {
        // BODY variables
        if (comp.type === 'BODY' && comp.text) {
            const matches = comp.text.match(/\{\{(\d+)\}\}/g);
            if (matches && matches.length > 0) {
                const parameters = [];
                const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                for (const n of nums) {
                    parameters.push({ type: 'text', text: sanitizeParam(resolveVariable(variableMapping, n, data)) });
                }
                metaComponents.push({ type: 'body', parameters });
            }
        }
        // HEADER text and media variables
        if (comp.type === 'HEADER') {
            if (comp.format === 'TEXT' && comp.text) {
                const matches = comp.text.match(/\{\{(\d+)\}\}/g);
                if (matches && matches.length > 0) {
                    const parameters = [];
                    const nums = [...new Set(matches.map(m => parseInt(m.match(/\d+/)[0])))].sort((a, b) => a - b);
                    for (const n of nums) {
                        parameters.push({ type: 'text', text: sanitizeParam(resolveVariable(variableMapping, n, data)) });
                    }
                    metaComponents.push({ type: 'header', parameters });
                }
            } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(comp.format)) {
                // If a media payload was provided and matches the template's header format
                if (data.media && data.media.type === comp.format) {
                    const mediaObj = {};
                    if (data.media.media_id) {
                        mediaObj.id = data.media.media_id;
                    } else if (data.media.link) {
                        mediaObj.link = data.media.link;
                    }

                    if (comp.format === 'DOCUMENT' && data.media.filename) {
                        mediaObj.filename = data.media.filename;
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

module.exports = { resolveVariable, buildMetaComponents };
