// src/models/BillingReminderConfig.js
//
// A singleton document (one per platform) that stores which WhatsApp template
// the Super Admin has assigned to each billing reminder step.
//
// The Super Admin creates templates in Meta Business Manager and they get
// synced into the WhatsAppTemplate collection under the Super Admin's userId.
// This config simply maps each billing day to one of those template names.

const mongoose = require('mongoose');

const billingReminderConfigSchema = new mongoose.Schema({
    // day0  → template sent immediately when payment is created (pending)
    // day5  → template sent 5 days later if still pending
    // day7  → template sent 7 days later if still pending
    // day10 → template sent 10 days later if still pending
    day0TemplateName:  { type: String, default: '' },
    day0LanguageCode:  { type: String, default: 'en' },

    day5TemplateName:  { type: String, default: '' },
    day5LanguageCode:  { type: String, default: 'en' },

    day7TemplateName:  { type: String, default: '' },
    day7LanguageCode:  { type: String, default: 'en' },

    day10TemplateName: { type: String, default: '' },
    day10LanguageCode: { type: String, default: 'en' },

    // receipt → template sent when payment is confirmed/marked received
    receiptTemplateName: { type: String, default: '' },
    receiptLanguageCode: { type: String, default: 'en' },

    // payment_failed → template sent to CUSTOMER when charge fails / sub halted
    paymentFailedTemplateName: { type: String, default: '' },
    paymentFailedLanguageCode: { type: String, default: 'en' },

    // webhook_failure_alert → template sent to SUPERADMIN OPS when a webhook handler crashes.
    // This is an internal ops alert, NOT a customer-facing template.
    // Parameters expected by Razorpay template (in order): [eventType, failureCount, errorMessage]
    // Leave blank to disable WhatsApp ops alerts (email will still fire).
    webhookAlertTemplateName: { type: String, default: '' },
    webhookAlertLanguageCode: { type: String, default: 'en' },

    // Also controls whether email is still sent alongside the WA template
    sendEmail: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('BillingReminderConfig', billingReminderConfigSchema);
