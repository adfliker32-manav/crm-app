const User = require('../models/User');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Encryption/Decryption keys (should be in env in production)
// SECURITY: Use a fixed key from environment. If not set, use a default (NOT recommended for production)
const ENCRYPTION_KEY_STRING = process.env.ENCRYPTION_KEY || 'default-encryption-key-change-in-production-min-32-chars';
const IV_LENGTH = 16; // For AES, this is always 16

// Derive 32-byte key from string using SHA-256
const getEncryptionKey = () => {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY_STRING).digest();
};

// Encrypt function
function encrypt(text) {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const key = getEncryptionKey();
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('Encryption error:', error);
        return null;
    }
}

// Decrypt function
function decrypt(text) {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        const iv = Buffer.from(textParts.shift(), 'hex');
        const encryptedText = textParts.join(':');
        const key = getEncryptionKey();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
}

// Get email configuration
exports.getEmailConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const user = await User.findById(userId).select('emailUser emailPassword emailFromName');

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Decrypt password before returning
        const decryptedPassword = user.emailPassword ? decrypt(user.emailPassword) : '';

        // Return config with decrypted password
        res.json({
            emailUser: user.emailUser || '',
            emailPassword: decryptedPassword || '',
            emailFromName: user.emailFromName || user.name || '',
            isConfigured: !!(user.emailUser && user.emailPassword)
        });
    } catch (error) {
        console.error('Error fetching email config:', error);
        res.status(500).json({ message: 'Error fetching email configuration', error: error.message });
    }
};

// Update email configuration
exports.updateEmailConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { emailUser, emailPassword, emailFromName } = req.body;

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
            emailUser: emailUser.toLowerCase().trim(),
            emailFromName: emailFromName || null
        };

        if (emailPassword) {
            updateData.emailPassword = encrypt(emailPassword);
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, select: 'emailUser emailFromName' }
        );

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({
            success: true,
            message: 'Email configuration updated successfully',
            emailUser: user.emailUser,
            emailFromName: user.emailFromName,
            isConfigured: true
        });
    } catch (error) {
        console.error('Error updating email config:', error);
        res.status(500).json({ message: 'Error updating email configuration', error: error.message });
    }
};

// Test email configuration
exports.testEmailConfig = async (req, res) => {
    try {
        const userId = req.user.userId || req.user.id;
        const { emailUser, emailPassword } = req.body;

        // Use provided credentials or get from user
        let userEmail = emailUser;
        let userPassword = emailPassword;

        if (!userEmail || !userPassword) {
            const user = await User.findById(userId).select('emailUser emailPassword');
            if (!user || !user.emailUser || !user.emailPassword) {
                return res.status(400).json({
                    message: 'Email configuration not found. Please configure your email settings first.'
                });
            }
            userEmail = user.emailUser;
            userPassword = decrypt(user.emailPassword);
        }

        // Create test transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            host: 'smtp.gmail.com',
            port: 587,
            secure: false,
            auth: {
                user: userEmail,
                pass: userPassword
            },
            // Connection timeout settings
            connectionTimeout: 10000, // 10 seconds
            greetingTimeout: 10000, // 10 seconds
            socketTimeout: 10000, // 10 seconds
            tls: {
                rejectUnauthorized: false
            }
        });

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
            from: `"CRM Pro" <${userEmail}>`,
            to: userEmail,
            subject: 'Test Email from CRM Pro',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2 style="color: #4CAF50;">✅ Email Configuration Successful!</h2>
                    <p>This is a test email from your CRM Pro account.</p>
                    <p>Your email configuration is working correctly.</p>
                    <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
                    <p style="color: #666; font-size: 12px;">
                        Sent from CRM Pro Email Management System
                    </p>
                </div>
            `,
            text: 'Test Email from CRM Pro - Your email configuration is working correctly!'
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
