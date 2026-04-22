const nodemailer = require('nodemailer');
const { getUserEmailCredentials } = require('../utils/emailUtils');
const { isFeatureDisabled } = require('../utils/systemConfig');
const { isEmailSuppressed } = require('../controllers/emailUnsubscribeController');

// ═══════════════════════════════════════════════════════════════
// Transporter Cache — avoids per-request SMTP handshake overhead.
// Key: userId or 'env-default', Value: { transporter, createdAt }
// TTL: 5 minutes — stale entries are auto-evicted on next access.
// ═══════════════════════════════════════════════════════════════
const transporterCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Invalidate a cached transporter (call when user updates SMTP credentials).
 */
const clearTransporterCache = (userId) => {
    const key = userId || 'env-default';
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
const getTransporter = (userCredentials = null, userId = null) => {
    const cacheKey = userId || 'env-default';

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

// Retry helper for transient failures
const sendEmailWithRetry = async (options, maxRetries = 2) => {
    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await sendEmail(options);
        } catch (error) {
            lastError = error;

            // Only retry on connection/timeout errors, not auth errors
            const isRetryable = error.message.includes('ETIMEDOUT') ||
                error.message.includes('timeout') ||
                error.message.includes('ECONNREFUSED') ||
                error.message.includes('ECONNECTION');

            if (!isRetryable || attempt === maxRetries) {
                throw error;
            }

            // Exponential backoff: wait 1s, 2s, 4s...
            const delay = Math.pow(2, attempt) * 1000;
            console.log(`⚠️ Email send failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
};

// Send Email Function
const sendEmail = async (options) => {
    if (await isFeatureDisabled('DISABLE_EMAILS')) {
        console.log(`🛑 EMAIL KILL SWITCH ACTIVE. Blocked email to ${options.to}`);
        throw new Error("Emergency: Email sending is temporarily disabled platform-wide.");
    }

    const { to, subject, text, html, from, attachments, userId, cc, bcc } = options;

    if (!to || !subject || (!text && !html)) {
        throw new Error('Missing required email fields: to, subject, and text/html are required');
    }

    // FIX B3: Check suppression list before sending
    if (await isEmailSuppressed(to)) {
        console.log(`🚫 Email to ${to} blocked — address is on suppression list (unsubscribed/bounced).`);
        throw new Error(`Email to ${to} is blocked: address has been unsubscribed or bounced.`);
    }

    // Get user credentials if userId provided
    let userCredentials = null;
    let fromName = process.env.EMAIL_FROM_NAME || 'Adfliker';

    if (userId) {
        userCredentials = await getUserEmailCredentials(userId);
        if (userCredentials) {
            fromName = userCredentials.fromName;
        }
    }

    const transporter = getTransporter(userCredentials, userId);
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

    // FIX B1: Unsubscribe link must point to the BACKEND API, not the frontend
    const backendUrl = process.env.BACKEND_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 5000}`;
    const unsubscribeLink = `${backendUrl}/api/email/unsubscribe?email=${encodeURIComponent(to)}`;

    // FIX B4: CAN-SPAM requires physical postal address
    const businessAddress = userCredentials?.businessAddress || process.env.BUSINESS_ADDRESS || '';
    const addressHtml = businessAddress ? `<br><span style="font-size:11px;color:#999;">${businessAddress}</span>` : '';
    const addressText = businessAddress ? `\n${businessAddress}` : '';

    const unsubscribeHtml = `<br><br><div style="border-top:1px solid #eee;padding-top:10px;margin-top:20px;font-size:12px;color:#777;text-align:center;">This email was sent to ${to}. If you no longer wish to receive these emails, you can <a href="${unsubscribeLink}" style="color:#0056b3;text-decoration:none;">unsubscribe</a> at any time.${addressHtml}</div>`;
    const unsubscribeText = `\n\n---\nThis email was sent to ${to}. To unsubscribe, visit: ${unsubscribeLink}${addressText}`;

    const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to: to,
        subject: subject,
        text: (text || html?.replace(/<[^>]*>/g, '')) + signatureText + unsubscribeText,
        html: (html || text) + signatureHtml + unsubscribeHtml,
        attachments: attachments || [],
        // FIX B2: RFC 8058 / Gmail 2024 Sender Guidelines compliance
        headers: {
            'List-Unsubscribe': `<${unsubscribeLink}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
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


        // Send email with timeout handling
        const info = await Promise.race([
            transporter.sendMail(mailOptions),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Send timeout: Email sending took too long')), 30000)
            )
        ]);

        console.log('✅ Email sent successfully:');
        console.log('   To:', to);
        console.log('   Subject:', subject);
        console.log('   Message ID:', info.messageId);

        return {
            success: true,
            messageId: info.messageId,
            response: info.response
        };
    } catch (error) {
        console.error('❌ Error sending email:', error);

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
