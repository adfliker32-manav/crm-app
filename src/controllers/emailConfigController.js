const User = require('../models/User');
const IntegrationConfig = require('../models/IntegrationConfig');
const nodemailer = require('nodemailer');
const { encrypt, decrypt } = require('../utils/emailUtils');
const { clearTransporterCache } = require('../services/emailService');

// Get email configuration
exports.getEmailConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        // Must use '+' to include select:false fields (emailPassword)
        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+email.emailPassword email.emailUser email.emailFromName email.emailSignature email.emailServiceType email.smtpHost email.smtpPort email.businessAddress email.imapHost email.imapPort email.imapEnabled email.imapLastSyncAt email.imapLastError email.imapLastErrorAt');

        if (!config || !config.email) {
            return res.json({
                emailUser: '',
                emailPassword: '',
                emailFromName: '',
                businessAddress: '',
                imapHost: '',
                imapPort: 993,
                imapEnabled: true,
                inboundSupported: true,
                isConfigured: false
            });
        }

        // SECURITY FIX (A1): Never return the decrypted password to the frontend.
        // The UI only needs to know IF a password is set, not the actual value.
        const hasPassword = !!config.email.emailPassword;

        const serviceType = config.email.emailServiceType || 'gmail';
        const imapHost = config.email.imapHost || '';

        res.json({
            emailUser: config.email.emailUser || '',
            emailPassword: hasPassword ? '••••••••' : '', // Masked — never expose real password
            hasPassword: hasPassword,
            emailFromName: config.email.emailFromName || '',
            emailSignature: config.email.emailSignature || '',
            emailServiceType: serviceType,
            smtpHost: config.email.smtpHost || '',
            smtpPort: config.email.smtpPort || 587,
            businessAddress: config.email.businessAddress || '',
            imapHost,
            imapPort: config.email.imapPort || 993,
            imapEnabled: config.email.imapEnabled !== false,
            imapSecure: config.email.imapSecure,
            smtpSecure: config.email.smtpSecure,
            // How this mailbox authenticates, so the UI can offer "Connect
            // Google" instead of an app-password field it no longer needs.
            authType: config.email.authType || 'password',
            // Inbound health. A mailbox that stopped receiving used to look
            // exactly like a mailbox nobody had written to, so a rejected login
            // could go unnoticed indefinitely.
            imapLastSyncAt: config.email.imapLastSyncAt || null,
            imapLastError: config.email.imapLastError || null,
            imapLastErrorAt: config.email.imapLastErrorAt || null,
            // FIX F2: the UI presented "Custom SMTP" as equivalent to Gmail while
            // inbound sync silently skipped those tenants. Tell the client
            // whether replies can actually be received with this configuration.
            inboundSupported: serviceType !== 'smtp' || !!imapHost,
            isConfigured: !!(config.email.emailUser && hasPassword)
        });
    } catch (error) {
        console.error('Error fetching email config:', error);
        res.status(500).json({ message: 'Error fetching email configuration', error: 'Server error' });
    }
};

// Update email configuration
exports.updateEmailConfig = async (req, res) => {
    try {
        const canAccessSettings = ['superadmin', 'manager'].includes(req.user.role) || req.user.permissions?.accessSettings === true;
        if (!canAccessSettings) return res.status(403).json({ message: 'Unauthorized to modify email settings' });

        const ownerId = req.tenantId;
        const {
            emailUser, emailPassword, emailFromName, emailSignature,
            emailServiceType, smtpHost, smtpPort, smtpSecure,
            businessAddress, imapHost, imapPort, imapSecure, imapEnabled
        } = req.body;

        // Validation
        if (!emailUser) {
            return res.status(400).json({ message: 'Email address is required' });
        }

        // Email format validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailUser)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }

        // If password is provided, encrypt it
        const updateData = {
            'email.emailUser': emailUser.toLowerCase().trim(),
            'email.emailFromName': emailFromName || null,
            'email.emailSignature': emailSignature !== undefined ? emailSignature : null,
            'email.emailServiceType': emailServiceType || 'gmail',
            'email.smtpHost': smtpHost || null,
            'email.smtpPort': smtpPort || 587,
            'email.businessAddress': businessAddress || null,
            'email.imapHost': imapHost || null,
            'email.imapPort': imapPort || 993,
            'email.imapEnabled': imapEnabled !== false,
            // Tri-state on purpose: null means "infer from the port", which is
            // right for the standard 465/587 and 993/143 pairs. Only an
            // explicit boolean overrides, for the servers that do not follow
            // the convention — coercing to false here would silently force
            // STARTTLS on every implicit-TLS server.
            'email.smtpSecure': typeof smtpSecure === 'boolean' ? smtpSecure : null,
            'email.imapSecure': typeof imapSecure === 'boolean' ? imapSecure : null
        };

        if (emailPassword) {
            updateData['email.emailPassword'] = encrypt(emailPassword);

            // Saving a password means this mailbox is on password auth. Without
            // this, a tenant who had connected Google and then typed an app
            // password would keep authenticating via the stale OAuth grant and
            // wonder why the new password changed nothing.
            updateData['email.authType'] = 'password';

            // Changing the mailbox invalidates the incremental IMAP cursor —
            // otherwise the new account resumes from the old account's UID and
            // skips everything below it. The uidvalidity goes with it: a UID is
            // only meaningful within the generation it was issued in.
            updateData['email.lastImapUid'] = 0;
            updateData['email.lastImapUidValidity'] = null;

            // A new credential deserves a clean slate — a stale "login was
            // rejected" banner against a password the user has just fixed is
            // worse than no banner at all.
            updateData['email.imapLastError'] = null;
            updateData['email.imapLastErrorAt'] = null;
        }

        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: updateData },
            { returnDocument: 'after', upsert: true, select: 'email' }
        );

        // Invalidate cached transporter so next send uses new credentials
        clearTransporterCache(ownerId);

        res.json({
            success: true,
            message: 'Email configuration updated successfully',
            emailUser: config.email.emailUser,
            emailFromName: config.email.emailFromName,
            emailSignature: config.email.emailSignature,
            emailServiceType: config.email.emailServiceType,
            smtpHost: config.email.smtpHost,
            smtpPort: config.email.smtpPort,
            businessAddress: config.email.businessAddress,
            imapHost: config.email.imapHost,
            imapPort: config.email.imapPort,
            imapEnabled: config.email.imapEnabled !== false,
            inboundSupported: config.email.emailServiceType !== 'smtp' || !!config.email.imapHost,
            isConfigured: true
        });
    } catch (error) {
        console.error('Error updating email config:', error);
        res.status(500).json({ message: 'Error updating email configuration', error: 'Server error' });
    }
};

// Test email configuration
exports.testEmailConfig = async (req, res) => {
    try {
        const ownerId = req.tenantId;
        const { emailUser, emailPassword } = req.body;

        // Use provided credentials or get from user
        let userEmail = emailUser;
        let userPassword = emailPassword;
        let serviceType = 'gmail';
        let smtpHost = 'smtp.gmail.com';
        let smtpPort = 587;

        if (!userEmail || !userPassword) {
            // Must use '+' to include select:false fields (emailPassword)
            const config = await IntegrationConfig.findOne({ userId: ownerId })
                .select('+email.emailPassword email.emailUser email.emailServiceType email.smtpHost email.smtpPort');
            if (!config || !config.email?.emailUser || !config.email?.emailPassword) {
                return res.status(400).json({
                    message: 'Email configuration not found. Please configure your email settings first.'
                });
            }
            userEmail = config.email.emailUser;
            userPassword = decrypt(config.email.emailPassword);
            serviceType = config.email.emailServiceType || 'gmail';
            smtpHost = config.email.smtpHost || 'smtp.gmail.com';
            smtpPort = config.email.smtpPort || 587;
        }

        // FIX A3: Build transporter dynamically based on provider type
        const transporterConfig = {
            host: serviceType === 'smtp' ? smtpHost : 'smtp.gmail.com',
            port: serviceType === 'smtp' ? smtpPort : 587,
            secure: (serviceType === 'smtp' ? smtpPort : 587) === 465,
            auth: {
                user: userEmail,
                pass: userPassword
            },
            connectionTimeout: 10000,
            greetingTimeout: 10000,
            socketTimeout: 10000,
            tls: {
                rejectUnauthorized: true
            }
        };
        if (serviceType !== 'smtp') {
            transporterConfig.service = 'gmail';
        }

        // Create test transporter
        const transporter = nodemailer.createTransport(transporterConfig);

        // Verify connection with timeout handling
        try {
            await Promise.race([
                transporter.verify(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Connection timeout: SMTP server did not respond in time')), 10000)
                )
            ]);
        } catch (verifyError) {
            if (verifyError.message.includes('timeout') || verifyError.message.includes('ETIMEDOUT')) {
                throw new Error('Connection timeout: Could not connect to email server. Please check your internet connection and try again.');
            }
            throw verifyError;
        }

        // Send test email to the user's own email
        const testEmail = {
            from: `"Adfliker" <${userEmail}>`,
            to: userEmail,
            subject: 'Test Email from Adfliker',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #4CAF50;">✅ Email Configuration Successful!</h2>
                    <p>This is a test email from your Adfliker account.</p>
                    <p>Your email configuration is working correctly.</p>
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
                    <p style="color: #666; font-size: 12px;">
                        Sent from Adfliker Email Management System
                    </p>
                </div>
            `,
            text: 'Test Email from Adfliker - Your email configuration is working correctly!'
        };

        const info = await Promise.race([
            transporter.sendMail(testEmail),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Send timeout: Email sending took too long')), 30000)
            )
        ]);

        res.json({
            success: true,
            message: 'Test email sent successfully! Please check your inbox.',
            messageId: info.messageId
        });
    } catch (error) {
        console.error('Error testing email config:', error);

        let errorMessage = 'Failed to test email configuration';
        if (error.message.includes('ETIMEDOUT') || error.message.includes('timeout')) {
            errorMessage = 'Connection timeout: Could not connect to email server. Please check your internet connection, firewall settings, or try again later.';
        } else if (error.message.includes('ECONNREFUSED')) {
            errorMessage = 'Connection refused: Email server is not reachable. Please check your network connection.';
        } else if (error.message.includes('Invalid login') || error.message.includes('EAUTH')) {
            errorMessage = 'Invalid email credentials. Please check your email and password.';
        } else if (error.message.includes('ECONNECTION')) {
            errorMessage = 'Could not connect to email server. Please check your internet connection.';
        } else {
            errorMessage = error.message || 'Failed to send test email';
        }

        res.status(500).json({
            success: false,
            message: errorMessage
        });
    }
};

/**
 * POST /api/email/config/test-imap
 *
 * The receiving-side twin of testEmailConfig. Sending had a Test button from
 * the start; receiving had none, which is part of why a dead inbound path could
 * go unnoticed indefinitely — there was no way for a user to ask.
 *
 * Opens a real IMAP session and selects INBOX, because that is exactly what the
 * poller does: a server can accept the TCP connection and the login and still
 * refuse the mailbox.
 */
exports.testImapConfig = async (req, res) => {
    const { ImapFlow } = require('imapflow');

    try {
        const ownerId = req.tenantId;

        const config = await IntegrationConfig.findOne({ userId: ownerId })
            .select('+email.emailPassword +email.oauthRefreshToken +email.oauthAccessToken '
                + 'email.authType email.oauthExpiryDate email.emailUser email.emailServiceType '
                + 'email.imapHost email.imapPort email.imapSecure')
            .lean();

        if (!config?.email?.emailUser) {
            return res.status(400).json({ success: false, message: 'Configure your mailbox first.' });
        }

        const email = config.email;
        const host = email.imapHost || (email.emailServiceType === 'smtp' ? null : 'imap.gmail.com');
        if (!host) {
            return res.status(400).json({
                success: false,
                message: 'No IMAP server is configured, so incoming mail cannot be received. '
                    + 'Add an IMAP host under Receiving.'
            });
        }

        const port = email.imapPort || 993;

        let auth;
        if (email.authType === 'oauth_google') {
            const { getAccessToken } = require('../services/googleOAuthService');
            const accessToken = await getAccessToken(ownerId, { config });
            if (!accessToken) {
                return res.status(400).json({
                    success: false,
                    message: 'Google access has expired or been revoked. Reconnect the mailbox.'
                });
            }
            auth = { user: email.emailUser, accessToken };
        } else {
            const pass = email.emailPassword ? decrypt(email.emailPassword) : null;
            if (!pass) {
                return res.status(400).json({ success: false, message: 'No mailbox password is stored.' });
            }
            auth = { user: email.emailUser, pass };
        }

        const client = new ImapFlow({
            host,
            port,
            secure: typeof email.imapSecure === 'boolean' ? email.imapSecure : port !== 143,
            auth,
            logger: false
        });

        try {
            await Promise.race([
                client.connect(),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('Connection timeout: the IMAP server did not respond in time')), 15000))
            ]);

            // Connecting is not enough — the poller needs INBOX specifically.
            const lock = await client.getMailboxLock('INBOX');
            const total = client.mailbox?.exists ?? null;
            lock.release();

            res.json({
                success: true,
                message: 'Connected. Incoming mail can be received.',
                host,
                port,
                mailbox: 'INBOX',
                messages: total
            });
        } catch (connErr) {
            const raw = connErr.message || '';
            let message = raw;
            if (/AUTHENTICATIONFAILED|Invalid credentials|LOGIN failed/i.test(raw)) {
                message = email.authType === 'oauth_google'
                    ? 'Google rejected the connection. Disconnect and reconnect the mailbox.'
                    : 'Login was rejected. Gmail needs a 16-character App Password with '
                      + '2-Step Verification enabled — not your normal password.';
            } else if (/ENOTFOUND|EAI_AGAIN/i.test(raw)) {
                message = 'That IMAP host could not be found. Check the server address.';
            } else if (/ECONNREFUSED/i.test(raw)) {
                message = 'The server refused the connection. Check the IMAP port.';
            } else if (/timeout/i.test(raw)) {
                message = 'The server did not respond. Check the host, the port, and whether '
                    + 'this port uses TLS (993) or STARTTLS (143).';
            }
            res.status(400).json({ success: false, message });
        } finally {
            try { await client.logout(); } catch { try { client.close(); } catch { /* gone */ } }
        }
    } catch (error) {
        console.error('Error testing IMAP configuration:', error);
        res.status(500).json({ success: false, message: 'Could not test the incoming mail connection' });
    }
};
