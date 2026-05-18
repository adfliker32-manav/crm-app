# Meta Conversions API (CAPI) Setup Guide for Adfliker CRM

Complete step-by-step guide to connect your Adfliker CRM to Meta Conversions API so lead lifecycle events (Lead, SubscribedLead, Purchase) flow to Meta and unlock **Conversion Leads** ad optimization.

---

## Overview

Your CRM is the **server-side sender**. You don't need to install any Meta code snippets on a website. The flow is:

```
Lead created/stage changed in CRM
        ↓
CRM sends event to Meta Graph API (server-to-server)
        ↓
Meta matches event to original ad click (via lead_id)
        ↓
Meta optimizes campaigns for high-quality leads
```

**What you'll need before starting:**
- Meta Business Manager account
- A Meta Ad Account
- Admin access to a Facebook Page (the one running Lead Ads)
- Adfliker CRM admin login

---

## Part 1: Create a Dataset (Pixel) in Meta

### Step 1.1 — Open Events Manager
1. Go to **[business.facebook.com](https://business.facebook.com)**
2. Click the menu (☰) → **Events Manager**
3. Click **Connect Data Sources** (green button on left)

### Step 1.2 — Choose Data Source Type
1. Select **Web** → Click **Connect**
2. Enter a name (e.g., `Adfliker CRM Dataset`) → Click **Create**

### Step 1.3 — Choose Connection Method
A dialog appears: **"How do you want to connect your website?"**

- ✅ Select **Conversions API and Meta pixel** (Recommended)
- Click **Next**

### Step 1.4 — Choose Setup Method
- Select **Set up manually** (your CRM is already the developer implementation)
- Click **Next**

### Step 1.5 — Select Event Parameters
Check ALL of these boxes:

**Event detail parameters:**
- ☑ Event time *(required)*
- ☑ Event name *(required)*
- ☑ Event source URL *(required)*
- ☑ Action source *(required)*
- ☑ Event ID *(for deduplication)*

**Customer information parameters:**
- ☑ Email address
- ☑ Phone number
- ☑ First name
- ☑ Surname
- ☑ Town/city
- ☑ External ID
- ☑ Country

Skip: Client IP, Client user agent, Click ID (fbc), Browser ID (fbp) — these are browser-only.

Click **Next**

### Step 1.6 — Choose Direct Integration Option
- ✅ Select **Set up with Dataset Quality API** (Recommended)
- Click **Continue**

### Step 1.7 — Generate Access Token
1. Click **Generate access token**
2. **⚠️ CRITICAL: Copy the token immediately** — Meta shows it only ONCE
3. Save it in a password manager or secure note

### Step 1.8 — Copy Your Pixel/Dataset ID
- The Dataset ID is shown at the top of the wizard (a 15-16 digit number like `866790142798147`)
- Copy this too

---

## Part 2: Configure CAPI in Adfliker CRM

### Step 2.1 — Open CRM CAPI Settings
1. Log in to your CRM at `https://app.adfliker.com`
2. Go to **Settings → Meta Integration**
3. Scroll to the **CAPI Settings** section

### Step 2.2 — Enter Credentials
Fill in these fields:

| Field | Value |
|-------|-------|
| **Pixel ID** | `866790142798147` *(from Step 1.8)* |
| **CAPI Access Token** | The token you copied in Step 1.7 |
| **Test Event Code** | Leave empty for now (we'll set it during testing) |
| **Enable CAPI** | Toggle **ON** |

### Step 2.3 — Configure Stage Mapping
Map your CRM stages to Meta event types:

| Meta Event | CRM Stage | Purpose |
|------------|-----------|---------|
| First funnel → `Lead` | `New` | Initial lead captured |
| Middle funnel → `SubscribedLead` | `Contacted` | Sales contacted the lead |
| Qualified → `Purchase` | `Won` | Deal closed (with monetary value) |
| Dead → `Lead_Lost` | `Dead Lead` | Lead lost (optional custom event) |

### Step 2.4 — Save Settings
Click **Save CAPI Settings**

---

## Part 3: Test the Connection

### Step 3.1 — Get Test Event Code from Meta
1. In Events Manager, open your Dataset
2. Click the **Test Events** tab
3. You'll see a code like `TEST70864` at the top — copy it

### Step 3.2 — Add Test Code to CRM Temporarily
1. Back in CRM CAPI Settings
2. Paste the code in **Test Event Code** field
3. Save

### Step 3.3 — Send Test Event
1. Click **Test Connection** button in CRM
2. Wait 2-3 seconds
3. Switch to Meta **Events Manager → Test Events** tab

You should see:
```
Event: Lead | Processed | Server | Manual setup
```

### Step 3.4 — Test with Real Lead Lifecycle
1. Create a test lead in CRM (or move an existing one)
2. Change the lead status: `New` → `Contacted` → `Won`
3. Each stage change should fire a separate event in Meta's Test Events tab:
   - `New` → fires `Lead`
   - `Contacted` → fires `SubscribedLead`
   - `Won` → fires `Purchase`

### Step 3.5 — Remove Test Event Code (CRITICAL!)
Once verified working:
1. Go back to CRM CAPI Settings
2. **Clear the Test Event Code field**
3. Save

> If you leave the test code in, all your live events will be tagged as test events and won't help optimization!

---

## Part 4: Verify Events Are Live

### Step 4.1 — Check Overview Tab
1. Wait 20-30 minutes after removing the test code
2. In Events Manager → **Overview** tab
3. You should see events appearing under your Dataset:
   - Total events received per day
   - Event match quality score (target: 6.0+)
   - Recent activity

### Step 4.2 — Check Match Rate
1. Go to **Data Sources → Diagnostics**
2. Check the **Event Match Quality** score
3. Target: **6.0 or higher** out of 10
4. If lower, you may need to send more user_data fields (already configured in your CRM)

---

## Part 5: Enable Conversion Leads Optimization in Ads Manager

This is what unlocks the real value of CAPI — optimizing campaigns for high-quality leads, not just any lead.

### Step 5.1 — Open Ads Manager
1. Go to **[business.facebook.com/adsmanager](https://business.facebook.com/adsmanager)**
2. Click **+ Create**

### Step 5.2 — Set Campaign Objective
1. Choose **Leads** objective
2. Click **Continue**

### Step 5.3 — Choose Performance Goal
At the Ad Set level:
1. **Conversion location:** Select **Website** (uses CAPI events)
2. **Performance goal:** Select **Maximize number of conversions**
3. **Conversion event:** Choose the event you want to optimize for:
   - `SubscribedLead` — optimize for leads that get contacted
   - `Purchase` — optimize for leads that close (best, but needs volume)

### Step 5.4 — Select Your Dataset
- Under **Pixel**, select the dataset you created in Part 1

### Step 5.5 — Launch
Complete the rest of campaign setup (audience, budget, creative) and **Publish**.

> **Note:** Meta needs at least **50 conversion events per week** for the algorithm to optimize properly. If you don't have that volume yet, start with `SubscribedLead` instead of `Purchase`.

---

## Part 6: Meta Lead Ads Webhook Integration (Bonus)

If you're running Meta Lead Ads, connect them to CRM so the `lead_id` flows through for proper attribution:

### Step 6.1 — Connect Facebook Page
1. CRM → **Settings → Meta Integration**
2. Click **Connect to Facebook**
3. Authorize permissions (`leads_retrieval`, `pages_show_list`, etc.)
4. Select your Page
5. Select the Lead Form you want to sync

### Step 6.2 — Enable Lead Sync
1. Toggle **Lead Sync** ON
2. New Lead Ads submissions will now appear in CRM automatically
3. Each lead will have `metaLeadgenId` stored (used by CAPI for attribution)

### Step 6.3 — Verify Attribution Chain
When a lead from Meta Lead Ads moves through CRM stages:
- Meta receives the CRM event WITH the original `lead_id`
- Meta matches it back to the ad click that generated the lead
- Conversion Leads optimization learns which ads produce real customers

---

## Troubleshooting

### "events_received: 0" or "events_dropped > 0"
- ❌ Wrong Pixel ID → Verify it matches Events Manager
- ❌ Wrong/expired access token → Generate a new one
- ❌ Malformed user_data → Make sure emails/phones are valid

### Events not showing in Overview tab
- ⏱️ Wait 20-30 mins (Meta has processing delay)
- ⚠️ Check if Test Event Code is still set → it routes events to test feed only

### Low Event Match Quality (< 6.0)
- Add more user_data fields (you should already be sending: em, ph, fn, ln, ct, country, external_id)
- Ensure lead data quality (real emails, phones with country code)

### "Conversion Leads" option missing in Ads Manager
- ✅ You need at least 1 event of the selected type received in last 7 days
- ✅ Dataset must show "Active" status with green dot
- ✅ Lead Ads must be connected to the same Page that owns the Pixel

### Lead Ads webhook not triggering
- Check webhook subscription in Meta App Dashboard
- Verify `META_VERIFY_TOKEN` matches in both `.env` and Meta webhook config
- Ensure your CRM domain is HTTPS (not HTTP)

---

## Reference: Required Environment Variables

```env
APP_URL=https://app.adfliker.com
META_APP_ID=978612311487105
META_APP_SECRET=<get from Meta Developer Dashboard>
META_REDIRECT_URI=https://app.adfliker.com/api/meta/callback
META_VERIFY_TOKEN=mysecretpassword123
ENCRYPTION_KEY=<your-encryption-key>
```

---

## What Your CRM Sends (Technical Reference)

For every lead stage change, your CRM POSTs to `https://graph.facebook.com/v25.0/{PIXEL_ID}/events`:

```json
{
  "data": [{
    "event_name": "SubscribedLead",
    "event_time": 1779125201,
    "event_id": "65fa1b2c_SubscribedLead",
    "action_source": "system_generated",
    "user_data": {
      "em": ["<sha256-hashed email>"],
      "ph": ["<sha256-hashed phone>"],
      "fn": ["<sha256-hashed first name>"],
      "ln": ["<sha256-hashed last name>"],
      "ct": ["<sha256-hashed city>"],
      "country": ["<sha256-hashed 'in'>"],
      "external_id": ["<crm-lead-id>"]
    },
    "custom_data": {
      "lead_event_source": "Adfliker CRM",
      "event_source": "crm",
      "lead_id": "<meta-leadgen-id>",
      "lead_status": "Contacted",
      "lead_source": "Facebook"
    }
  }],
  "access_token": "<CAPI_ACCESS_TOKEN>"
}
```

All PII is SHA256-hashed before sending (Meta requirement for privacy).

---

## Quick Checklist

- [ ] Created Meta Dataset (Pixel ID copied)
- [ ] Generated CAPI Access Token (saved securely)
- [ ] Entered Pixel ID + Access Token in CRM CAPI Settings
- [ ] Set `APP_URL` env variable
- [ ] Mapped CRM stages to Meta events
- [ ] Enabled CAPI toggle in CRM
- [ ] Tested with Test Event Code (verified in Events Manager)
- [ ] Removed Test Event Code after verification
- [ ] Connected Facebook Page + Lead Form for Lead Sync
- [ ] Created Conversion Leads campaign in Ads Manager
- [ ] Monitoring Event Match Quality (target 6.0+)

---

**Need help?** Contact: adfliker32@gmail.com
