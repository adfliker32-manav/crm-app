const NodeRegistry  = require('../../NodeRegistry');
const User          = require('../../../models/User');
const { sendEmail } = require('../../../services/emailService');
const { wrapEmailHtml } = require('../../../utils/emailTemplateUtils');
const { resolveTemplate, buildTemplateContext } = require('../../../utils/templateResolver');
// RATE #3 FIX: Per-tenant daily email limit tracking
// Read-only peek: the counter is actually consumed inside sendEmail() so that
// every automated sender shares one per-tenant daily budget. Incrementing here
// as well would charge two slots for a single email.
//
// M-N3 NOTE (accepted TOCTOU): peek-then-send means N concurrent branches can all
// observe count < limit and all send, overshooting by up to the worker concurrency
// (10). That is deliberate: the alternative — consuming a slot here — double-charges
// every email, which is a worse bug. The 300/day cap already sits well under Gmail's
// ~500/day, so a ~10 overshoot stays inside the safety margin. Tighten
// WF_EMAIL_RATE_PER_DAY rather than moving the counter.
const { peekEmailDailyLimit } = require('../../../utils/workflowRateLimiter');

// ─────────────────────────────────────────────────────────────────────────────
// SendEmailNode
// Sends a plain-text or HTML email to the lead's email address.
// Subject and body support variable interpolation using {{variable.name}} syntax.
//
// RATE #3 FIX: Daily email limit added — Gmail SMTP allows ~500 emails/day
// per account. We track per-tenant daily send count in Redis and cap at 300
// to leave headroom. Exceeding the limit routes to 'limit_reached' port.
// ─────────────────────────────────────────────────────────────────────────────
const SendEmailNode = {
    type: 'send_email',
    sideEffect: true, // L4/L5: real send — dry-run in Test Mode, idempotent on retry
    slow: true,       // L-6: SMTP latency — lower queue priority than logic nodes

    meta: () => ({
        type:     'send_email',
        name:     'Send Email',
        icon:     'fa-solid fa-envelope',
        category: 'communication',
        color:    '#3B82F6',
        description: 'Send a personalised email to the contact'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',         label: 'In' }],
        outputs: [
            { id: 'output',        label: 'Sent' },
            { id: 'limit_reached', label: 'Daily Limit Reached' },
            { id: 'error',         label: 'Failed' }
        ]
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
        const lead     = context.getLead();
        const tenantId = context.tenantId.toString();

        if (!lead?.email) {
            // M-N1 FIX: was routing to 'output' (labelled "Sent"), so a lead with no
            // email address counted as a successful send in both the graph and the
            // analytics. The 'error' port is the honest signal.
            console.warn('[SendEmailNode] Lead has no email address. Routing to error port.');
            return { nextPort: 'error', output: { 'email.skipped': true, 'email.error': 'no_email' } };
        }

        // RATE #3 FIX: Check per-tenant daily email send limit before sending.
        // Gmail SMTP and most SMTP providers cap sending at a few hundred/day.
        // Exceeding this causes delivery failures and SMTP account blocks.
        const dailyCheck = await peekEmailDailyLimit(tenantId);
        if (!dailyCheck.allowed) {
            // H6 FIX: DEFER until the daily counter rolls over instead of routing to
            // the optional 'limit_reached' port. Unwired, that port terminated the
            // branch, so once a tenant crossed the cap EVERY remaining email that day
            // was silently dropped while executions reported 'completed'.
            // The counter key is partitioned by UTC date (workflowRateLimiter
            // todayKey()), so the next UTC midnight is when capacity returns.
            const now = new Date();
            const nextUtcMidnight = Date.UTC(
                now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1
            );
            const retryAfterMs = Math.max(60_000, Math.min(nextUtcMidnight - now.getTime() + 60_000, 24 * 3600 * 1000));
            console.warn(
                `[SendEmailNode] Tenant ${tenantId} daily email limit reached ` +
                `(${dailyCheck.count}/${dailyCheck.limit}). Deferring email to ${lead.email} ` +
                `by ${Math.round(retryAfterMs / 60000)} min.`
            );
            return {
                retryAfterMs,
                retryReason: 'email_daily_limit',
                output: {
                    'email.limitReached': true,
                    'email.dailyCount':   dailyCheck.count,
                    'email.dailyLimit':   dailyCheck.limit
                }
            };
        }

        const user = await User.findById(tenantId).select('name companyName').lean();

        // Build template data from execution variables
        // M-N2 FIX: this used to spread ALL execution variables (`...context.getAll()`)
        // into the template data, so any accumulated value — an http.response body, a
        // flattened webhook field, a credential-looking variable — could be
        // interpolated into a customer-facing email. Pass an explicit allow-list plus
        // the lead/webhook namespaces authors actually reference.
        const allVars = context.getAll();
        // WF-H1: 'trigger.' carries the event's own data (the booked appointment, the
        // reply text, the stage it moved to) — exactly the things an author wants to
        // put in the email. It is caller-supplied like 'webhook.', so it belongs in
        // the same allow-list rather than in the everything-spread this replaced.
        const SAFE_VAR_PREFIXES = [
            'lead.', 'webhook.', 'trigger.', 'signal.', 'loop.',
            'switch.', 'condition.', 'ai.classification'
        ];
        const safeVars = {};
        for (const [k, v] of Object.entries(allVars)) {
            if (SAFE_VAR_PREFIXES.some(p => k === p || k.startsWith(p))) safeVars[k] = v;
        }

        const tplContext = buildTemplateContext({
            lead,
            user,
            system: { customData: safeVars }
        });

        const subject = resolveTemplate(data.subject || '', tplContext);
        const body    = resolveTemplate(data.body || '', tplContext);

        try {
            await sendEmail({
                to:     lead.email,
                subject,
                html:   wrapEmailHtml(body),
                // Store the author-written body in the Inbox thread, not the
                // 600px table shell wrapEmailHtml adds for the real email.
                bodyForInbox: body,
                userId: tenantId,
                isAutomated: true,
                triggerType: 'workflow',
                leadId: lead._id
            });
        } catch (err) {
            console.error(`[SendEmailNode] Failed to send email to ${lead.email}:`, err.message);
            return {
                nextPort: 'error',
                output: {
                    'email.sent':    false,
                    'email.error':   err.message,
                    'email.sentAt':  new Date().toISOString()
                }
            };
        }

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
