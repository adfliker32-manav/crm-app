// Parse Meta WhatsApp API errors into actionable messages with a category tag.
// category values: 'billing' | 'auth' | 'permission' | 'template' | 'window' | 'recipient' | 'policy' | 'config' | 'unknown'
const parseMetaError = (error) => {
    const raw = error.response?.data?.error;
    if (!raw) return { msg: error.message, code: null, category: 'unknown' };

    const code = raw.code;
    const metaMsg = raw.error_user_msg || raw.message || 'WhatsApp API Error';

    switch (code) {
        case 131048:
            return { msg: 'Billing issue: Your WhatsApp Business account has a payment problem. Go to Meta Business Manager → WhatsApp → Payment Settings to add/fix your payment method.', code, category: 'billing' };
        case 190:
            return { msg: 'Permission issue: Your WhatsApp access token has expired or is invalid. Go to Settings → WhatsApp Config and update your access token.', code, category: 'auth' };
        case 10:
        case 200:
        case 294:
            return { msg: `Permission issue: Your Meta app is missing required WhatsApp permissions. Ensure whatsapp_business_messaging is granted in Meta Developers. (Code ${code})`, code, category: 'permission' };
        case 131009:
            return { msg: 'Template not approved: The template must be approved by Meta before sending. Wait for approval in WhatsApp Manager.', code, category: 'template' };
        case 131026:
            return { msg: 'Undeliverable: Recipient has not interacted with your business or the 24-hour window has closed. Use an approved template to re-open the window.', code, category: 'window' };
        case 131030:
            return { msg: "Undeliverable: The recipient's phone number is not registered on WhatsApp.", code, category: 'recipient' };
        case 368:
            return { msg: 'Temporarily blocked: Your WhatsApp Business account has been temporarily restricted by Meta for policy violations.', code, category: 'policy' };
        case 100:
            return { msg: `Invalid parameter: ${metaMsg} — Check your Phone Number ID and template name in WhatsApp Config.`, code, category: 'config' };
        default:
            return { msg: `Meta API Error (${code}): ${metaMsg}`, code, category: 'unknown' };
    }
};

module.exports = { parseMetaError };
