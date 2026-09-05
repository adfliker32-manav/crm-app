/**
 * Partner webhook event catalogue — the single source of truth.
 * ─────────────────────────────────────────────────────────────────────────────
 * Every event named here MUST have a real emitter. `account.created` and
 * `account.frozen` were previously offered as checkboxes in the SuperAdmin
 * Settings tab and listed as schema defaults while nothing in the codebase ever
 * emitted them (PA-M7) — partners could subscribe to events that would never
 * arrive. Adding a name here without a `forwardIfPartnerAccount` call site
 * recreates exactly that bug.
 *
 * Emitters:
 *   message.received       → whatsappWebhookController (inbound messages)
 *   message.status_update  → whatsappWebhookController (sent/delivered/read/failed)
 *   account.created        → partnerApiController.createAccount
 *   account.frozen         → partnerApiController.freeze/unfreezeAccount,
 *                            partnerAppAdminController.freeze/unfreezePartnerAccount
 *   account.deleted        → partnerAppAdminController.deletePartnerAccount
 */

const PARTNER_WEBHOOK_EVENTS = [
    'message.received',
    'message.status_update',
    'account.created',
    'account.frozen',
    'account.deleted'
];

// What a partner is subscribed to when they have never chosen explicitly.
const DEFAULT_PARTNER_WEBHOOK_EVENTS = [
    'message.received',
    'message.status_update'
];

module.exports = { PARTNER_WEBHOOK_EVENTS, DEFAULT_PARTNER_WEBHOOK_EVENTS };
