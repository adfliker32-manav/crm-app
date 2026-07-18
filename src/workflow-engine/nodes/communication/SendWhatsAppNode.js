const NodeRegistry      = require('../../NodeRegistry');
const WhatsAppTemplate  = require('../../../models/WhatsAppTemplate');
const { sendWhatsAppMessage } = require('../../../services/whatsappService');
// RATE #1 FIX: Per-tenant WhatsApp send rate limiting
const { checkWhatsAppRate } = require('../../../utils/workflowRateLimiter');

// ─────────────────────────────────────────────────────────────────────────────
// SendWhatsAppNode
// Sends an approved WhatsApp template to the lead's phone number.
//
// RATE #1 FIX: Rate limiting added — Meta enforces ~80 messages/second per
// phone number and tier-based daily limits. We cap at 20/second per tenant
// using a Redis counter to prevent phone number suspension.
// ─────────────────────────────────────────────────────────────────────────────
const SendWhatsAppNode = {
    type: 'send_whatsapp',
    sideEffect: true, // L4/L5: real send — dry-run in Test Mode, idempotent on retry

    meta: () => ({
        type:     'send_whatsapp',
        name:     'Send WhatsApp',
        icon:     'fa-brands fa-whatsapp',
        category: 'communication',
        color:    '#25D366',
        description: 'Send an approved WhatsApp template to the contact'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',        label: 'In' }],
        outputs: [
            { id: 'output',     label: 'Sent' },
            { id: 'rate_limit', label: 'Rate Limited' },
            { id: 'error',      label: 'Failed' }
        ]
    }),

    schema: () => ({
        fields: [
            {
                key:         'templateName',
                label:       'WhatsApp Template',
                type:        'whatsapp_template_select',
                required:    true,
                description: 'Select an approved WhatsApp template to send'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.templateName) errors.push('Template name is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead = context.getLead();
        if (!lead?.phone) {
            console.warn('[SendWhatsAppNode] Lead has no phone number. Skipping.');
            return { nextPort: 'output', output: { 'whatsapp.skipped': true, 'whatsapp.reason': 'no_phone' } };
        }

        const templateName = data.templateName;
        const tenantId     = context.tenantId.toString();

        // RATE #1 FIX: Check per-tenant WhatsApp rate limit before sending.
        // Meta enforces rate limits per phone number. Exceeding them causes
        // temporary phone number suspension. We cap at 20 messages/second/tenant.
        const rateCheck = await checkWhatsAppRate(tenantId);
        if (!rateCheck.allowed) {
            console.warn(
                `[SendWhatsAppNode] Tenant ${tenantId} WhatsApp rate limit hit ` +
                `(${rateCheck.count}/${rateCheck.limit} per second). Message queued for retry.`
            );
            // Return rate_limit port so the workflow can handle backpressure
            return {
                nextPort: 'rate_limit',
                output: {
                    'whatsapp.rateLimited': true,
                    'whatsapp.retryAfterMs': 1000
                }
            };
        }

        // Verify template is still approved before sending
        const template = await WhatsAppTemplate.findOne({ userId: tenantId, name: templateName }).lean();
        if (!template || template.status !== 'APPROVED') {
            const reason = !template ? 'template_not_found' : 'template_not_approved';
            console.warn(`[SendWhatsAppNode] Template "${templateName}" is not approved (reason: ${reason}). Routing to 'error' port.`);
            // BUG #4 FIX: Was returning 'output' (Sent) port — downstream "Wait for Reply" nodes
            // would then wait forever for a reply to a message that was never actually sent.
            return { nextPort: 'error', output: { 'whatsapp.error': reason, 'whatsapp.skipped': true } };
        }

        // BUG #1 FIX: Wrap Meta API call in try/catch.
        // sendWhatsAppMessage() throws on ANY failure (expired token, wrong number, etc.).
        // Without this, BullMQ catches the throw, retries 3x, then marks the execution 'failed'.
        // The 'error' port on the canvas is never used. Now failures route there instead.
        try {
            await sendWhatsAppMessage(lead.phone, templateName, tenantId);
        } catch (err) {
            console.error(`[SendWhatsAppNode] Meta API send failed:`, err.message);
            return {
                nextPort: 'error',
                output: {
                    'whatsapp.error':   err.message,
                    'whatsapp.sent':    false,
                    'whatsapp.sentAt':  new Date().toISOString()
                }
            };
        }

        return {
            nextPort: 'output',
            output: {
                'whatsapp.sent':         true,
                'whatsapp.templateName': templateName,
                'whatsapp.sentAt':       new Date().toISOString()
            }
        };
    }
};

NodeRegistry.register(SendWhatsAppNode);
module.exports = SendWhatsAppNode;
