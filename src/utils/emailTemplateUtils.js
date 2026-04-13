// src/utils/emailTemplateUtils.js
// Shared utility for template variable replacement — single source of truth.
// Used by: emailTemplateController.js, emailAutomationService.js

/**
 * Replaces template variables like {{leadName}}, {{leadEmail}}, etc. with actual data.
 * @param {string} template - The template string containing {{variables}}
 * @param {object} data - Key-value pairs for replacement
 * @returns {string} - Template with variables replaced
 */
const replaceVariables = (template, data) => {
    if (!template) return '';
    let result = template;

    // Built-in variables (always available)
    const builtInVariables = {
        '{{leadName}}': data.leadName || '',
        '{{leadEmail}}': data.leadEmail || '',
        '{{leadPhone}}': data.leadPhone || '',
        '{{companyName}}': data.companyName || '',
        '{{userName}}': data.userName || '',
        '{{stageName}}': data.stageName || '',
        '{{date}}': new Date().toLocaleDateString(),
        '{{time}}': new Date().toLocaleTimeString()
    };

    // Replace built-in variables
    Object.keys(builtInVariables).forEach(key => {
        const regex = new RegExp(key.replace(/[{}]/g, '\\$&'), 'g');
        result = result.replace(regex, builtInVariables[key]);
    });

    // FIX F5: Replace any remaining {{customKey}} patterns from data object
    // This supports custom CRM fields without hardcoding
    result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return data[key] !== undefined ? String(data[key]) : match;
    });

    return result;
};

module.exports = { replaceVariables };
