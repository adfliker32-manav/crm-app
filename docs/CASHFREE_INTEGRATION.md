# Cashfree Payments Integration Guide

## Overview

This CRM uses **Cashfree Subscriptions (AutoDebit)** for recurring billing.  
Customers authorize a bank mandate once; Cashfree auto-debits on each renewal cycle.

**API Version used:** `2025-01-01`  
**Mode:** Sandbox (testing) → Production (live)

---

## Architecture

```
Customer clicks "Get started" on /plans
        │
        ▼
POST /api/billing/me/subscribe  (or /me/change-plan)
        │
        ▼
subscriptionService.initiateSubscription()
        │
        ▼
cashfreeService.createSubscription()  ─────► Cashfree API (sandbox/production)
        │                                       Returns: subscription_session_id
        ▼
Frontend: openSubscriptionCheckout({ sessionId })
        │
        ▼
Cashfree mandate page (bank chooses UPI / eNACH / card)
        │
        ▼
Customer authorizes → Cashfree POSTs webhook to:
  https://app.adfliker.com/api/billing/cashfree/webhook
        │
        ├── SUBSCRIPTION_ACTIVATED  → applyActivation()  → grant provisional access
        ├── SUBSCRIPTION_PAYMENT_SUCCESS → applyChargeSuccess()  → extend expiry + create ledger row
        ├── SUBSCRIPTION_PAYMENT_FAILED  → applyChargeFailure()  → bump failedAttempts → enter grace
        └── SUBSCRIPTION_CANCELLED       → applyCancellation()   → keep access until period end
```

---

## Required Environment Variables

```env
# ─── Cashfree Credentials ────────────────────────────────────────────────────
CASHFREE_APP_ID=<x-client-id from Cashfree Dashboard>
CASHFREE_SECRET_KEY=<x-client-secret from Cashfree Dashboard>

# 'sandbox' for testing, 'production' for live payments
CASHFREE_ENV=sandbox

# From: Cashfree Dashboard → Developers → Webhooks → Webhook Secret
CASHFREE_WEBHOOK_SECRET=<your webhook secret>

# Where Cashfree redirects the customer after mandate authorization
# Must be your live frontend URL — NEVER localhost in production
CASHFREE_RETURN_URL=https://app.adfliker.com/billing?cf_return=1

# ─── Server URL (critical for webhook) ───────────────────────────────────────
# Cashfree POSTs webhooks to: {BACKEND_URL}/api/billing/cashfree/webhook
# For a monorepo on the same domain: BACKEND_URL === FRONTEND_URL
BACKEND_URL=https://app.adfliker.com
```

---

## Webhook Configuration

### What Cashfree sends

| Event | Handler | Effect |
|---|---|---|
| `SUBSCRIPTION_ACTIVATED` / `SUBSCRIPTION_AUTHORIZED` | `applyActivation()` | Grants provisional 2-day access window |
| `SUBSCRIPTION_PAYMENT_SUCCESS` / `SUBSCRIPTION_CHARGED` | `applyChargeSuccess()` | Extends `planExpiryDate` + creates Payment ledger row |
| `SUBSCRIPTION_PAYMENT_FAILED` / `SUBSCRIPTION_PAYMENT_DECLINED` | `applyChargeFailure()` | Bumps `failedAttempts`; enters `grace` after 3 failures |
| `SUBSCRIPTION_CANCELLED` / `SUBSCRIPTION_CANCELED` | `applyCancellation()` | Flips `autoDebitEnabled=false`; access continues until period end |

### Signature Verification
Cashfree signs each webhook with `HMAC-SHA256(timestamp + rawBody, CASHFREE_WEBHOOK_SECRET)`.  
Our code verifies this in `cashfreeService.verifyWebhookSignature()`. The raw body is captured by the `express.json({ verify: ... })` hook in `index.js`.

**Security note:** In `NODE_ENV=production`, a missing webhook secret causes all webhooks to be rejected. This is intentional — it prevents forged payment events.

---

## Subscription Lifecycle

```
pending_auth  ──(customer authorizes)──►  active
    │                                       │
    │                                (charge succeeds)
    │                                       │  (planExpiryDate extended)
    │                                       │
    │                              (charge fails ×3 or ON_HOLD)
    │                                       │
    │                                     grace  ──(7 days, no recovery)──► expired
    │                                       │
    │                              (retry succeeds)
    │                                       │
    │                                     active
    │
    └─────(customer / admin cancels)──► cancelled
                                            │
                                   (planExpiryDate passes)
                                            │
                                         expired (account read-only)
```

---

## Idempotency

The `cashfreePaymentId` field on the `Payment` model has a **partial unique index** (only for non-null string values). This means:
- A duplicate `SUBSCRIPTION_PAYMENT_SUCCESS` webhook for the same charge → inserts fail with `E11000` → charge is skipped (no double-extension of `planExpiryDate`)
- Manual payments with `cashfreePaymentId=null` → NOT affected by the unique constraint

---

## Cron Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `runSubscriptionStatusSweep` | Every hour | Downgrade tenants past grace window |
| `runRenewalReminder` | Daily 09:00 | Email T-7 / T-3 / T-1 reminders before charge |
| `runSubscriptionReconcile` | Daily 02:00 | Sync status from Cashfree + replay missed payments |

---

## Go-Live Checklist (Sandbox → Production)

- [ ] Log in to [Cashfree Dashboard (Production)](https://merchant.cashfree.com)
- [ ] Get Production App ID and Secret Key
- [ ] Update `.env`:
  ```env
  CASHFREE_APP_ID=<production-app-id>
  CASHFREE_SECRET_KEY=<production-secret-key>
  CASHFREE_ENV=production
  CASHFREE_WEBHOOK_SECRET=<production-webhook-secret>
  ```
- [ ] Register webhook URL in Cashfree Dashboard:  
  `https://app.adfliker.com/api/billing/cashfree/webhook`
- [ ] Select webhook events: `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_PAYMENT_SUCCESS`, `SUBSCRIPTION_PAYMENT_FAILED`, `SUBSCRIPTION_CANCELLED`
- [ ] Copy the webhook secret from the dashboard → set `CASHFREE_WEBHOOK_SECRET`
- [ ] Restart server
- [ ] Test with a real small-amount plan (₹1 test mandate)

---

## Testing in Sandbox

### Local Testing with ngrok
```bash
# Install ngrok (already in devDependencies)
npx ngrok http 5000

# Update .env temporarily for local testing:
BACKEND_URL=https://<your-ngrok-id>.ngrok-free.app
CASHFREE_RETURN_URL=http://localhost:5173/billing?cf_return=1
```

### Sandbox Test Cards / UPI
- Use Cashfree sandbox test credentials from their docs
- Test UPI ID: `testsuccess@gocash`
- Test failure: `testfailure@gocash`

### Simulating Webhooks
From the Cashfree Sandbox Dashboard → Subscriptions → select a subscription → "Simulate event"

---

## Troubleshooting

| Issue | Likely Cause | Fix |
|---|---|---|
| Plans page empty | No Plan docs in DB | Check MongoDB `plans` collection via SuperAdmin → Finance |
| "Cashfree credentials not configured" | Missing `CASHFREE_APP_ID` or `CASHFREE_SECRET_KEY` | Set both in `.env` + restart |
| Webhook signature FAILED | Wrong `CASHFREE_WEBHOOK_SECRET` | Copy secret from Cashfree Dashboard → Developers → Webhooks |
| Webhook not received | Wrong `BACKEND_URL` | Ensure `BACKEND_URL` is your public server URL (not localhost) |
| "A valid 10-digit mobile number is required" | User has no phone in profile | Manager must add phone in Settings before subscribing |
| Session expired after mandate | `cashfreeSessionId` stale | Click "View plans" → subscribe again (fresh session created) |
| Double charge in invoices | Duplicate webhook replay | Already handled by `cashfreePaymentId` unique index — safe |
