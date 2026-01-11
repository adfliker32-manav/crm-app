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
        // Optional: For better error handling
        tls: {
            rejectUnauthorized: false
        }
    });

    return transporter;
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
        // Verify connection
        await transporter.verify();
        console.log('✅ SMTP Server is ready to send emails');

        // Send email
        const info = await transporter.sendMail(mailOptions);
        
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
        throw error;
    }
};

module.exports = {
    sendEmail,
    createTransporter
};
