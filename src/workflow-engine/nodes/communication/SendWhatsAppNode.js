const NodeRegistry = require('../../NodeRegistry');
const WhatsAppTemplate = require('../../../models/WhatsAppTemplate');
const { sendWhatsAppMessage } = require('../../../services/whatsappService');

// ─────────────────────────────────────────────────────────────────────────────
// SendWhatsAppNode
// Sends an approved WhatsApp template to the lead's phone number.
// ─────────────────────────────────────────────────────────────────────────────
const SendWhatsAppNode = {
    type: 'send_whatsapp',

    meta: () => ({
        type:     'send_whatsapp',
        name:     'Send WhatsApp',
        icon:     'fa-brands fa-whatsapp',
        category: 'communication',
        color:    '#25D366',
        description: 'Send an approved WhatsApp template to the contact'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [{ id: 'output', label: 'Sent' }, { id: 'error', label: 'Failed' }]
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
            console.warn(`[SendWhatsAppNode] Lead has no phone number. Skipping.`);
            return { nextPort: 'output', output: { 'whatsapp.skipped': true, 'whatsapp.reason': 'no_phone' } };
        }

        const templateName = data.templateName;
        const tenantId = context.tenantId.toString();

        // Verify template is still approved before sending
        const template = await WhatsAppTemplate.findOne({ userId: tenantId, name: templateName }).lean();
        if (!template || template.status !== 'APPROVED') {
            const reason = !template ? 'template_not_found' : 'template_not_approved';
            console.warn(`[SendWhatsAppNode] Template "${templateName}" is not approved. Skipping.`);
            return { nextPort: 'output', output: { 'whatsapp.skipped': true, 'whatsapp.reason': reason } };
        }

        await sendWhatsAppMessage(lead.phone, templateName, tenantId);

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
