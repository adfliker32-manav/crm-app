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
            .select('+email.emailPassword email.emailUser email.emailFromName email.emailSignature email.emailServiceType email.smtpHost email.smtpPort');

        if (!config || !config.email) {
            return res.json({
                emailUser: '',
                emailPassword: '',
                emailFromName: '',
                isConfigured: false
            });
        }

        // SECURITY FIX (A1): Never return the decrypted password to the frontend.
        // The UI only needs to know IF a password is set, not the actual value.
        const hasPassword = !!config.email.emailPassword;

        res.json({
            emailUser: config.email.emailUser || '',
            emailPassword: hasPassword ? '••••••••' : '', // Masked — never expose real password
            hasPassword: hasPassword,
            emailFromName: config.email.emailFromName || '',
            emailSignature: config.email.emailSignature || '',
            emailServiceType: config.email.emailServiceType || 'gmail',
            smtpHost: config.email.smtpHost || '',
            smtpPort: config.email.smtpPort || 587,
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
        const { emailUser, emailPassword, emailFromName, emailSignature, emailServiceType, smtpHost, smtpPort } = req.body;

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
            'email.smtpPort': smtpPort || 587
        };

        if (emailPassword) {
            updateData['email.emailPassword'] = encrypt(emailPassword);
        }

        const config = await IntegrationConfig.findOneAndUpdate(
            { userId: ownerId },
            { $set: updateData },
            { new: true, upsert: true, select: 'email' }
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
