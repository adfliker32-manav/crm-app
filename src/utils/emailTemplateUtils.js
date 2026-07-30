// src/utils/emailTemplateUtils.js
// Shared utility for template variable replacement — single source of truth.
// Used by: emailTemplateController.js, emailAutomationService.js

/**
 * Replaces template variables like {{leadName}}, {{LeadName}}, {{LEADNAME}} etc.
 * Matching is case-insensitive so any capitalisation the user types works.
 */
const replaceVariables = (template, data) => {
    if (!template) return '';

    // Build a lowercase-keyed lookup that merges built-ins with caller-supplied data.
    // Friendly aliases ({{name}}, {{email}}, {{phone}}, {{company}}) are included so the
    // editor's example placeholder ("Hello {{name}}") resolves in both manual and
    // automated sends — otherwise those tokens were left literal in the email.
    const lookup = {
        leadname:    data.leadName    || '',
        leademail:   data.leadEmail   || '',
        leadphone:   data.leadPhone   || '',
        companyname: data.companyName || '',
        username:    data.userName    || '',
        stagename:   data.stageName   || '',
        name:        data.leadName    || '',
        email:       data.leadEmail   || '',
        phone:       data.leadPhone   || '',
        company:     data.companyName || '',
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
          <!--body:start-->${content}<!--body:end-->
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
};

// Marker comment embedded in the wrapper so unwrapEmailHtml can reliably find
// the content cell without fragile HTML parsing.
const BODY_START = '<!--body:start-->';
const BODY_END = '<!--body:end-->';

/**
 * Inverse of wrapEmailHtml — returns just the author-written body.
 *
 * The inbox thread renders messages inside a small chat bubble, so storing the
 * full 600px table shell made automated emails render as a giant grey box.
 * Falls back to the input unchanged when it isn't a wrapped document.
 */
const unwrapEmailHtml = (html) => {
    if (!html) return '';
    const start = html.indexOf(BODY_START);
    const end = html.indexOf(BODY_END);
    if (start !== -1 && end !== -1 && end > start) {
        return html.slice(start + BODY_START.length, end).trim();
    }
    // Legacy rows written before the markers existed: strip the shell heuristically.
    if (/^\s*<!DOCTYPE html>/i.test(html)) {
        const td = html.match(/<td style="padding:32px 40px[^"]*">([\s\S]*?)<\/td>/i);
        if (td) return td[1].trim();
    }
    return html;
};

/**
 * Injects a fragment immediately before </body> (falling back to </html>, then
 * append) so signatures and unsubscribe footers land INSIDE the document.
 *
 * Previously these were concatenated onto the end of a complete
 * `<!DOCTYPE html>…</html>` string, which put them outside the document —
 * Outlook and several other clients drop everything after </html>, silently
 * removing the legally required unsubscribe link.
 */
const injectBeforeBodyEnd = (html, fragment) => {
    if (!fragment) return html || '';
    if (!html) return fragment;

    const bodyClose = html.toLowerCase().lastIndexOf('</body>');
    if (bodyClose !== -1) {
        return html.slice(0, bodyClose) + fragment + html.slice(bodyClose);
    }
    const htmlClose = html.toLowerCase().lastIndexOf('</html>');
    if (htmlClose !== -1) {
        return html.slice(0, htmlClose) + fragment + html.slice(htmlClose);
    }
    return html + fragment;
};

/**
 * FIX W1: adds open- and click-tracking to an outgoing HTML email.
 *
 * EmailLog has carried openedAt/opens/clickedAt/clicks/clickedLinks fields and
 * /api/email/track/* endpoints (which even fire the EMAIL_OPENED workflow
 * trigger) for a long time — but nothing ever embedded the pixel or rewrote the
 * links, so every one of those counters was permanently zero and the
 * EMAIL_OPENED trigger could never fire.
 *
 * Must run BEFORE the unsubscribe footer is appended, so the unsubscribe link
 * itself is never rewritten through the click tracker.
 *
 * @param {string} html
 * @param {string} logId      EmailLog _id this email will be stored under
 * @param {string} backendUrl Public base URL of the API
 */
const injectTracking = (html, logId, backendUrl) => {
    if (!html || !logId || !backendUrl) return html || '';

    const base = String(backendUrl).replace(/\/+$/, '');

    // ── Click tracking: wrap outbound links ──────────────────────────────────
    const withLinks = html.replace(
        /href\s*=\s*(["'])(https?:\/\/[^"']+)\1/gi,
        (match, quote, url) => {
            // Never rewrite links that already point at our own tracking or
            // unsubscribe endpoints — that would double-wrap or break opt-out.
            if (url.startsWith(`${base}/api/email/track/`) || url.includes('/api/email/unsubscribe')) {
                return match;
            }
            const wrapped = `${base}/api/email/track/click/${logId}?url=${encodeURIComponent(url)}`;
            return `href=${quote}${wrapped}${quote}`;
        }
    );

    // ── Open tracking: 1x1 pixel as the last element in the body ─────────────
    const pixel = `<img src="${base}/api/email/track/open/${logId}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;" />`;

    return injectBeforeBodyEnd(withLinks, pixel);
};

module.exports = {
    replaceVariables,
    wrapEmailHtml,
    unwrapEmailHtml,
    injectBeforeBodyEnd,
    injectTracking
};
