const nodemailer = require('nodemailer');
const { getUserEmailCredentials } = require('../utils/emailUtils');

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

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: email,
            pass: password
        },
        // Connection timeout settings
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000, // 10 seconds
        socketTimeout: 10000, // 10 seconds
        // Retry settings
        pool: true,
        maxConnections: 1,
        maxMessages: 3,
        // Optional: For better error handling
        tls: {
            rejectUnauthorized: false
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
    const { to, subject, text, html, from, attachments, userId } = options;

    if (!to || !subject || (!text && !html)) {
        throw new Error('Missing required email fields: to, subject, and text/html are required');
    }

    // Get user credentials if userId provided
    let userCredentials = null;
    let fromName = process.env.EMAIL_FROM_NAME || 'CRM Pro';

    if (userId) {
        userCredentials = await getUserEmailCredentials(userId);
        if (userCredentials) {
            fromName = userCredentials.fromName;
        }
    }

    const transporter = createTransporter(userCredentials);
    if (!transporter) {
        const errorMsg = userId
            ? 'Email configuration not found. Please configure your email settings in Email Management.'
            : 'Email service not configured. Please configure email settings.';
        throw new Error(errorMsg);
    }

    // Default from email (can be overridden)
    const fromEmail = from || (userCredentials ? userCredentials.email : (process.env.EMAIL_USER || process.env.GMAIL_USER));

    const mailOptions = {
        from: `"${fromName}" <${fromEmail}>`,
        to: to,
        subject: subject,
        text: text || html?.replace(/<[^>]*>/g, ''), // Plain text fallback
        html: html || text, // HTML version
        attachments: attachments || [] // File attachments
    };

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
    createTransporter
};
