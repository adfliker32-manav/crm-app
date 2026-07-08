const NodeRegistry = require('../../NodeRegistry');
const User = require('../../../models/User');
const { sendEmail } = require('../../../services/emailService');
const { replaceVariables, wrapEmailHtml } = require('../../../utils/emailTemplateUtils');

// ─────────────────────────────────────────────────────────────────────────────
// SendEmailNode
// Sends a plain-text or HTML email to the lead's email address.
// Subject and body support variable interpolation using {{variable.name}} syntax.
// ─────────────────────────────────────────────────────────────────────────────
const SendEmailNode = {
    type: 'send_email',

    meta: () => ({
        type:     'send_email',
        name:     'Send Email',
        icon:     'fa-solid fa-envelope',
        category: 'communication',
        color:    '#3B82F6',
        description: 'Send a personalised email to the contact'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',  label: 'In' }],
        outputs: [{ id: 'output', label: 'Sent' }, { id: 'error', label: 'Failed' }]
    }),

    schema: () => ({
        fields: [
            {
                key:      'subject',
                label:    'Email Subject',
                type:     'text',
                required: true,
                placeholder: 'e.g. Following up on your enquiry, {{lead.name}}'
            },
            {
                key:      'body',
                label:    'Email Body',
                type:     'textarea',
                required: true,
                rows:     6,
                placeholder: 'Hi {{lead.name}}, ...',
                description: 'Supports {{lead.name}}, {{lead.phone}}, {{lead.email}} variables'
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.subject?.trim()) errors.push('Email subject is required');
        if (!data.body?.trim())    errors.push('Email body is required');
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const lead = context.getLead();
        if (!lead?.email) {
            console.warn(`[SendEmailNode] Lead has no email address. Skipping.`);
            return { nextPort: 'output', output: { 'email.skipped': true, 'email.reason': 'no_email' } };
        }

        const tenantId = context.tenantId.toString();
        const user = await User.findById(tenantId).select('name companyName').lean();

        // Build template data from execution variables
        const templateData = {
            leadName:    context.get('lead.name') || lead.name || '',
            leadEmail:   lead.email,
            leadPhone:   context.get('lead.phone') || lead.phone || '',
            companyName: user?.companyName || '',
            userName:    user?.name || '',
            stageName:   context.get('lead.status') || lead.status || '',
            ...context.getAll()
        };

        const subject = replaceVariables(data.subject || '', templateData);
        const body    = replaceVariables(data.body || '', templateData);

        await sendEmail({
            to:      lead.email,
            subject,
            html:    wrapEmailHtml(body),
            userId:  tenantId
        });

        return {
            nextPort: 'output',
            output: {
                'email.sent':    true,
                'email.subject': subject,
                'email.sentAt':  new Date().toISOString()
            }
        };
    }
};

NodeRegistry.register(SendEmailNode);
module.exports = SendEmailNode;
