// src/utils/emailTemplateUtils.js
// Shared utility for template variable replacement — single source of truth.
// Used by: emailTemplateController.js, emailAutomationService.js

/**
 * Replaces template variables like {{leadName}}, {{LeadName}}, {{LEADNAME}} etc.
 * Matching is case-insensitive so any capitalisation the user types works.
 */
const replaceVariables = (template, data) => {
    if (!template) return '';

    // Build a lowercase-keyed lookup that merges built-ins with caller-supplied data
    const lookup = {
        leadname:    data.leadName    || '',
        leademail:   data.leadEmail   || '',
        leadphone:   data.leadPhone   || '',
        companyname: data.companyName || '',
        username:    data.userName    || '',
        stagename:   data.stageName   || '',
        date:        new Date().toLocaleDateString(),
        time:        new Date().toLocaleTimeString(),
    };

    // Also add any extra keys from data (custom CRM fields) in lowercase
    Object.keys(data).forEach(k => {
        if (lookup[k.toLowerCase()] === undefined) {
            lookup[k.toLowerCase()] = data[k] != null ? String(data[k]) : '';
        }
    });

    // Single case-insensitive pass — replaces every {{AnyCase}} token
    return template.replace(/\{\{(\w+)\}\}/gi, (match, key) => {
        const val = lookup[key.toLowerCase()];
        return val !== undefined ? val : match;
    });
};

/**
 * Wraps an email body in a clean, industry-standard HTML email shell.
 * If the body already contains HTML tags it is used as-is (rich-text editor output).
 * Plain-text bodies get newlines converted to <br> and are wrapped in a styled container.
 */
const wrapEmailHtml = (body) => {
    if (!body) return '';

    const isHtml = /<[a-z][\s\S]*>/i.test(body);
    const content = isHtml
        ? body
        : body
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <tr><td style="padding:32px 40px;font-size:15px;line-height:1.7;color:#333333;">
          ${content}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

module.exports = { replaceVariables, wrapEmailHtml };
