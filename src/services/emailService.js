const nodemailer = require('nodemailer');
const { getUserEmailCredentials, resolveTenantId } = require('../utils/emailUtils');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { isEmailSuppressed } = require('../controllers/emailUnsubscribeController');
const mongoose = require('mongoose');
const { injectBeforeBodyEnd, injectTracking } = require('../utils/emailTemplateUtils');
const { recordOutboundEmail } = require('./emailSyncService');

// ═══════════════════════════════════════════════════════════════
// Transporter Cache — avoids per-request SMTP handshake overhead.
// Key: TENANT id or 'env-default', Value: { transporter, createdAt }
// TTL: 5 minutes — stale entries are auto-evicted on next access.
//
// Keyed by tenant, not by individual user: agents send with their manager's
// credentials, so keying by user id opened one pooled connection set per agent
// against the same mailbox (10 agents × maxConnections 5 = 50 concurrent
// connections, which Gmail throttles) and left agents on a stale transporter
// for 5 minutes after the manager changed the password.
// ═══════════════════════════════════════════════════════════════
const transporterCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invalidate a cached transporter (call when a tenant updates SMTP credentials).
 */
const clearTransporterCache = (tenantId) => {
    const key = tenantId ? String(tenantId) : 'env-default';
    if (transporterCache.has(key)) {
        const cached = transporterCache.get(key);
        if (cached.transporter && typeof cached.transporter.close === 'function') {
            cached.transporter.close(); // gracefully close pooled connection
        }
        transporterCache.delete(key);
        console.log(`🗑️ Transporter cache cleared for ${key}`);
    }
};

/**
 * Get or create a Nodemailer transporter (with cache).
 */
const getTransporter = (userCredentials = null, tenantId = null) => {
    // Cache key must distinguish: real tenant credentials vs env-fallback.
    // If tenantId was provided but credential lookup returned null, key falls
    // back to 'env-default' so we don't poison the tenant cache slot with
    // env credentials (which would shadow real creds once the user fixes them).
    const cacheKey = (tenantId && userCredentials) ? String(tenantId) : 'env-default';

    // Check cache first
    if (transporterCache.has(cacheKey)) {
        const cached = transporterCache.get(cacheKey);
        if (Date.now() - cached.createdAt < CACHE_TTL_MS) {
            return cached.transporter; // cache HIT
        }
        // TTL expired — close and re-create
        if (cached.transporter && typeof cached.transporter.close === 'function') {
            cached.transporter.close();
        }
        transporterCache.delete(cacheKey);
    }

    // Build fresh transporter
    const transporter = createTransporter(userCredentials);
    if (transporter) {
        transporterCache.set(cacheKey, { transporter, createdAt: Date.now() });
    }
    return transporter;
};

// Create reusable transporter for Gmail SMTP
const createTransporter = (userCredentials = null) => {
    let email, password;

    // Use user credentials if provided, otherwise fallback to env
    if (userCredentials && userCredentials.email && userCredentials.password) {
        email = userCredentials.email;
        password = userCredentials.password;
    } else {
        // Fallback to environment variables
        email = process.env.EMAIL_USER || process.env.GMAIL_USER;
        password = process.env.EMAIL_PASSWORD || process.env.GMAIL_APP_PASSWORD;
    }

    if (password) {
        const masked = password.length > 4 
            ? `${password.substring(0, 2)}...${password.substring(password.length - 2)} (len: ${password.length})`
            : `len: ${password.length}`;
        console.log(`[EmailService] SMTP Transporter built for ${email} using password ${masked}`);
    } else {
        console.log(`[EmailService] SMTP Transporter built for ${email} with NO password`);
    }

    if (!email || !password) {
        if (!userCredentials) {
            console.error('❌ EMAIL CONFIGURATION MISSING:');
            console.error('   Please configure email settings in Email Management or set EMAIL_USER and EMAIL_PASSWORD in .env file');
            console.error('   For Gmail, use App Password: https://support.google.com/accounts/answer/185833');
        }
        return null;
    }

    let host, port, service;
    if (userCredentials && userCredentials.serviceType === 'smtp') {
        service = undefined; // Do not use predefined service
        host = userCredentials.smtpHost;
        port = userCredentials.smtpPort || 587;
    } else {
        service = 'gmail';
        host = 'smtp.gmail.com';
        port = 587;
    }

    const transporter = nodemailer.createTransport({
        service: service,
        host: host,
        port: port,
        secure: port === 465, // true for 465, false for other ports
        auth: {
            user: email,
            pass: password
        },
        // Connection timeout settings
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000, // 10 seconds
        socketTimeout: 10000, // 10 seconds
        // Pool settings — optimized for throughput
        pool: true,
        maxConnections: 5,
        maxMessages: 100,
        // TLS — strict verification for production security
        tls: {
            rejectUnauthorized: true
        },
        // Debug mode (can be disabled in production)
        debug: process.env.NODE_ENV === 'development',
        logger: process.env.NODE_ENV === 'development'
    });

    return transporter;
};

// Connection-level failures are worth another attempt; auth and validation
// failures are not — they will fail identically every time.
const isRetryableError = (error) =>
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('timeout') ||
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ECONNECTION');

/**
 * Retry helper for transient failures.
 *
 * Retries are applied to the SMTP handoff inside sendEmail() rather than around
 * it. Wrapping the whole function re-ran the suppression check, the daily-cap
 * counter and — since logging moved inside sendEmail — recorded a bogus
 * "failed" message in the Inbox for every attempt that later succeeded.
 */
const sendEmailWithRetry = async (options, maxRetries = 2) =>
    sendEmail({ ...options, maxRetries });

// Send Email Function
const sendEmail = async (options) => {
    if (await isFeatureDisabled('DISABLE_EMAILS')) {
        console.log(`🛑 EMAIL KILL SWITCH ACTIVE. Blocked email to ${options.to}`);
        throw new Error("Emergency: Email sending is temporarily disabled platform-wide.");
    }

    const { to, subject, text, html, from, attachments, userId, cc, bcc, transactional, conversational } = options;

    if (!to || !subject || (!text && !html)) {
        throw new Error('Missing required email fields: to, subject, and text/html are required');
    }

    // Agents send with their manager's mailbox, so every downstream lookup —
    // credentials, suppression, transporter cache, inbox records — is keyed by
    // the owning tenant rather than the individual user.
    const tenantId = userId ? await resolveTenantId(userId) : null;

    // FIX B3: Check suppression list before sending.
    // Transactional emails (payment receipts, failure alerts, security) bypass
    // the marketing suppression list — a customer who unsubscribed from marketing
    // must still receive billing/account-critical notices. Direct 1:1 replies
    // typed by a human in the Inbox are also flagged transactional by the caller.
    if (!transactional && await isEmailSuppressed(to, tenantId, { conversational })) {
        console.log(`🚫 Email to ${to} blocked — address is on suppression list (unsubscribed/bounced).`);
        throw new Error(`Email to ${to} is blocked: address has been unsubscribed or bounced.`);
    }

    // FIX D4: enforce the per-tenant daily cap for ALL machine-generated mail.
    // This check used to exist only in the workflow "Send Email" node, so drip
    // sequences, automation rules, the follow-up cron, the chatbot and the
    // external API sent without any limit — the fastest route to having the
    // tenant's Gmail account suspended for exceeding ~500 sends/day.
    // Human-typed and transactional mail is exempt.
    if (tenantId && options.isAutomated && !transactional && !conversational) {
        const { checkEmailDailyLimit } = require('../utils/workflowRateLimiter');
        const daily = await checkEmailDailyLimit(String(tenantId));
        if (!daily.allowed) {
            console.warn(`🚫 Tenant ${tenantId} hit the daily email cap (${daily.count}/${daily.limit}). Blocked send to ${to}.`);
            throw new Error(`Daily email limit reached (${daily.limit}/day). This email was not sent.`);
        }
    }

    // Get user credentials if userId provided
    let userCredentials = null;
    let fromName = process.env.EMAIL_FROM_NAME || 'Adfliker';

    if (userId) {
        userCredentials = await getUserEmailCredentials(userId);
        if (userCredentials) {
            fromName = userCredentials.fromName;
        } else {
            console.warn(`⚠️ [EmailService] userId ${userId} provided but no credentials found in IntegrationConfig — falling back to env vars.`);
        }
    }

    console.log(`[EmailService] Sending email to ${to} using userId: ${userId || 'default-env'}. Credentials resolved: ${userCredentials ? 'YES' : 'NO'}. SMTP User: ${userCredentials ? userCredentials.email : (process.env.EMAIL_USER || process.env.GMAIL_USER || 'NONE')}`);

    const transporter = getTransporter(userCredentials, tenantId);
    if (!transporter) {
        const errorMsg = userId
            ? 'Email configuration not found. Please configure your email settings in Email Management.'
            : 'Email service not configured. Please configure email settings.';
        throw new Error(errorMsg);
    }

    // Default from email (can be overridden)
    const fromEmail = from || (userCredentials ? userCredentials.email : (process.env.EMAIL_USER || process.env.GMAIL_USER));

    // Per-user email signature (if configured)
    const signatureHtml = userCredentials?.signature ? `<br><br>${userCredentials.signature}` : '';
    const signatureText = userCredentials?.signature ? `\n\n${userCredentials.signature.replace(/<[^>]*>/g, '')}` : '';

    // FIX B1: Unsubscribe link must point to the BACKEND API, not the frontend.
    // Transactional emails skip the unsubscribe footer + List-Unsubscribe headers
    // entirely — there's nothing to unsubscribe from for a payment receipt.
    // A human-typed 1:1 reply is not bulk marketing, so it carries no
    // unsubscribe footer either — previously every personal reply a salesperson
    // sent ended with "you can unsubscribe at any time".
    let unsubscribeHtml = '';
    let unsubscribeText = '';
    let unsubscribeHeaders = {};
    if (!transactional && !conversational) {
        const backendUrl = process.env.BACKEND_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
        const { buildUnsubscribeToken } = require('../controllers/emailUnsubscribeController');
        const unsubscribeToken = buildUnsubscribeToken(to);
        const unsubscribeLink = `${backendUrl}/api/email/unsubscribe?email=${encodeURIComponent(to)}&token=${unsubscribeToken}`;

        // FIX B4: CAN-SPAM requires physical postal address
        const businessAddress = userCredentials?.businessAddress || process.env.BUSINESS_ADDRESS || '';
        const addressHtml = businessAddress ? `<br><span style="font-size:11px;color:#999;">${businessAddress}</span>` : '';
        const addressText = businessAddress ? `\n${businessAddress}` : '';

        unsubscribeHtml = `<br><br><div style="border-top:1px solid #eee;padding-top:10px;margin-top:20px;font-size:12px;color:#777;text-align:center;">This email was sent to ${to}. If you no longer wish to receive these emails, you can <a href="${unsubscribeLink}" style="color:#0056b3;text-decoration:none;">unsubscribe</a> at any time.${addressHtml}</div>`;
        unsubscribeText = `\n\n---\nThis email was sent to ${to}. To unsubscribe, visit: ${unsubscribeLink}${addressText}`;
        unsubscribeHeaders = {
            // FIX B2: RFC 8058 / Gmail 2024 Sender Guidelines compliance
            'List-Unsubscribe': `<${unsubscribeLink}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        };
    }

    // FIX D1: The signature and unsubscribe footer must be injected INSIDE the
    // document. wrapEmailHtml() returns a complete `<!DOCTYPE html>…</html>`
    // string, and plain concatenation put both fragments after the closing tag
    // where Outlook (and others) discard them — silently stripping the legally
    // required unsubscribe link from exactly the bulk mail that needs it.
    const baseHtml = html || text || '';

    // FIX W1: open/click tracking. The EmailLog row is created after the send,
    // so its _id is generated up-front and reused when the row is written —
    // that's what lets the pixel URL exist before the log does.
    //
    // All non-transactional mail is tracked for opens, including human-typed 
    // 1:1 replies, so that the EMAIL_OPENED trigger functions universally.
    const trackingEnabled = !!userId && !transactional;
    const trackingLogId = trackingEnabled ? new mongoose.Types.ObjectId() : null;
    const trackedHtml = trackingEnabled
        ? injectTracking(baseHtml, trackingLogId.toString(), process.env.BACKEND_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`)
        : baseHtml;

    const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to: to,
        subject: subject,
        text: (text || html?.replace(/<[^>]*>/g, '')) + signatureText + unsubscribeText,
        html: injectBeforeBodyEnd(trackedHtml, signatureHtml + unsubscribeHtml),
        attachments: attachments || [],
        headers: unsubscribeHeaders
    };

    // CC/BCC support
    if (cc) mailOptions.cc = cc;
    if (bcc) mailOptions.bcc = bcc;

    // FIX F4: Reply threading — pass In-Reply-To and References if available
    if (options.inReplyTo) {
        mailOptions.inReplyTo = options.inReplyTo;
        mailOptions.references = options.references || options.inReplyTo;
    }

    try {
        // Verify connection removed for performance - sendMail will handle connection errors

        // Send email with timeout handling, retrying only transient connection
        // failures. Retrying here (rather than around the whole function) keeps
        // suppression checks, the daily-cap counter and the Inbox record to
        // exactly one execution per email.
        const maxRetries = Number(options.maxRetries) || 0;
        let info;
        for (let attempt = 0; ; attempt++) {
            try {
                info = await Promise.race([
                    transporter.sendMail(mailOptions),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Send timeout: Email sending took too long')), 30000)
                    )
                ]);
                break;
            } catch (sendErr) {
                if (attempt >= maxRetries || !isRetryableError(sendErr)) throw sendErr;

                // Exponential backoff: 1s, 2s, 4s...
                const delay = Math.pow(2, attempt) * 1000;
                console.log(`⚠️ Email send failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        console.log('✅ Email sent successfully:');
        console.log('   To:', to);
        console.log('   Subject:', subject);
        console.log('   Message ID:', info.messageId);

        // Record centrally so EVERY sender (workflow node, sequences, cron,
        // chatbot, external API, …) lands in the Inbox and the analytics log.
        // Transactional mail (receipts, password resets, system alerts) is
        // deliberately excluded — it isn't part of a contact conversation.
        if (userId && !transactional) {
            await recordOutboundEmail({
                userId,
                to,
                subject,
                text,
                html: baseHtml,
                messageId: info.messageId,
                status: 'sent',
                isAutomated: options.isAutomated === true,
                triggerType: options.triggerType || 'manual',
                templateId: options.templateId || null,
                leadId: options.leadId || null,
                attachments: options.attachments || [],
                bodyForInbox: options.bodyForInbox,
                senderEmail: fromEmail,
                logId: trackingLogId // pre-allocated so the tracking pixel resolves
            });
        }

        return {
            success: true,
            messageId: info.messageId,
            response: info.response
        };
    } catch (error) {
        console.error('❌ Error sending email:', error);

        // FIX D7: a failed send used to vanish from the thread entirely — the
        // user's typed message disappeared behind a toast. Record it so the
        // Inbox can show the failed state it already knows how to render.
        if (userId && !transactional) {
            await recordOutboundEmail({
                userId,
                to,
                subject,
                text,
                html: baseHtml,
                status: 'failed',
                error: error.message,
                isAutomated: options.isAutomated === true,
                triggerType: options.triggerType || 'manual',
                templateId: options.templateId || null,
                leadId: options.leadId || null,
                attachments: options.attachments || [],
                bodyForInbox: options.bodyForInbox,
                senderEmail: fromEmail,
                logId: trackingLogId // pre-allocated so the tracking pixel resolves
            });
        }

        // Provide more helpful error messages
        if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
            throw new Error('Connection timeout: Could not connect to email server. Please check your internet connection, firewall settings, or try again later.');
        } else if (error.message.includes('ECONNREFUSED')) {
            throw new Error('Connection refused: Email server is not reachable. Please check your network connection.');
        } else if (error.message.includes('Invalid login')) {
            throw new Error('Invalid email credentials. Please check your email and password in Email Management settings.');
        } else if (error.message.includes('EAUTH')) {
            throw new Error('Authentication failed. Please verify your email credentials in Email Management settings.');
        }

        throw error;
    }
};

module.exports = {
    sendEmail,
    sendEmailWithRetry,
    createTransporter,
    clearTransporterCache
};
