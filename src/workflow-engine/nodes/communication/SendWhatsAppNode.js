const NodeRegistry      = require('../../NodeRegistry');
const WhatsAppTemplate  = require('../../../models/WhatsAppTemplate');
const User              = require('../../../models/User');
const { sendWhatsAppMessage } = require('../../../services/whatsappService');
const { buildMetaComponents } = require('../../../utils/templateVariableResolver');
const { resolveTemplateMedia } = require('../../../services/mediaLibraryService');
// RATE #1 FIX: Per-tenant WhatsApp send rate limiting
const { checkWhatsAppRate } = require('../../../utils/workflowRateLimiter');
const { syncAutomatedSendToConversation } = require('../../../services/whatsappAutomationService');

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
    slow: true,       // L-6: the queue reads this instead of keeping its own hardcoded list

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
            // M-N1 FIX: was routing to 'output' (labelled "Sent"). That is the same
            // defect BUG #4 fixed for unapproved templates below — a downstream
            // "wait for reply" node would wait forever for a reply to a message that
            // was never sent, and analytics counted it as delivered.
            console.warn('[SendWhatsAppNode] Lead has no phone number. Routing to error port.');
            return { nextPort: 'error', output: { 'whatsapp.skipped': true, 'whatsapp.error': 'no_phone' } };
        }

        const templateName = data.templateName;
        const tenantId     = context.tenantId.toString();

        // RATE #1 FIX: Check per-tenant WhatsApp rate limit before sending.
        // Meta enforces rate limits per phone number. Exceeding them causes
        // temporary phone number suspension. We cap at 20 messages/second/tenant.
        const rateCheck = await checkWhatsAppRate(tenantId);
        if (!rateCheck.allowed) {
            // H6 FIX: DEFER, don't route away. This used to return the 'rate_limit'
            // port, which is optional on the canvas — so when unwired the branch
            // terminated and the message was silently lost while the execution
            // reported 'completed'. (The old comment here claimed "queued for retry";
            // nothing was queued.) The engine now re-runs this node after the delay.
            // Jitter prevents a burst from re-colliding on the same tick.
            const retryAfterMs = 1000 + Math.floor(Math.random() * 1000);
            console.warn(
                `[SendWhatsAppNode] Tenant ${tenantId} WhatsApp rate limit hit ` +
                `(${rateCheck.count}/${rateCheck.limit} per second). Deferring ${retryAfterMs}ms.`
            );
            return {
                retryAfterMs,
                retryReason: 'whatsapp_rate_limit',
                output: { 'whatsapp.rateLimited': true }
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

        // FIX: Build Meta API components from template variables + lead data.
        // Previously passed `null` for components, so templates with variables
        // (e.g. {{1}}) always failed with Meta error 132000:
        // "number of localizable_params (0) does not match the expected number of params (1)".
        // Now resolves variables from lead/user data exactly like automation/broadcast callers.
        let metaComponents = null;
        try {
            const user = await User.findById(tenantId).select('name companyName').lean();
            const templateData = {
                leadName:    lead.name || '',
                leadEmail:   lead.email || '',
                leadPhone:   lead.phone || '',
                companyName: user?.companyName || '',
                userName:    user?.name || '',
                stageName:   lead.status || 'New'
            };

            // Resolve media for IMAGE/VIDEO/DOCUMENT header templates
            const media = await resolveTemplateMedia(template, tenantId);
            metaComponents = buildMetaComponents(
                template.components || [], template.variableMapping, { ...templateData, media }
            );

            // Only pass components if there are actual parameters to send
            if (metaComponents.length === 0) metaComponents = null;
        } catch (err) {
            console.warn(`[SendWhatsAppNode] Failed to build template components: ${err.message}. Sending without variables.`);
            metaComponents = null;
        }

        // BUG #1 FIX: Wrap Meta API call in try/catch.
        // sendWhatsAppMessage() throws on ANY failure (expired token, wrong number, etc.).
        // Without this, BullMQ catches the throw, retries 3x, then marks the execution 'failed'.
        // The 'error' port on the canvas is never used. Now failures route there instead.
        try {
            // Pass the template's own language. The template was just loaded above,
            // so this costs nothing — and omitting it meant Meta was asked for
            // 'en_US' while the template is created as 'en', which fails with 132001
            // and routed every workflow WhatsApp send to the error port.
            const result = await sendWhatsAppMessage(lead.phone, templateName, tenantId, metaComponents, template.language);
            
            // Sync to conversation DB so downstream Wait nodes can find this conversation
            const messageId = result?.messages?.[0]?.id;
            if (messageId) {
                await syncAutomatedSendToConversation(lead, tenantId, templateName, messageId, 'template');
            }
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
