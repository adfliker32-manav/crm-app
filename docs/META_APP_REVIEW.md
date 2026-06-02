# Meta App Review — `business_management` submission guide

Goal: get **Advanced Access** for `business_management` so that **normal customers**
(not just app admins/testers) can see their Facebook Pages in **Settings → Meta Lead Sync**.

Why it's needed: production uses Facebook Login for Business (`META_CONFIG_ID`) with
**business asset access** ("opted in to all current and future Pages"). Those Pages are
owned by a **Meta Business Portfolio**, so `/me/accounts` returns 0 — the app must call
`/me/businesses → owned_pages` / `client_pages` to list them, which requires
`business_management`. See [getPages()](../src/controllers/metaController.js) and the
`meta-lead-sync-pages-blocker` memory.

---

## 0. Prerequisites checklist (do these first — review fails without them)

- [ ] **Business Verification complete** — App Dashboard → *Business Verification* (or via the
      linked Business Portfolio). `business_management` review will not pass without it.
- [ ] App is in **Live mode** (toggle at top of App Dashboard).
- [ ] **Privacy Policy URL** set in App Settings → Basic → `https://app.adfliker.com/privacy`
- [ ] **Terms of Service URL** → `https://app.adfliker.com/terms`
- [ ] **User Data Deletion** → "Data Deletion Callback URL" = `https://app.adfliker.com/api/meta/data-deletion`
      (already implemented — `metaRoutes.js`). A "Data Deletion Instructions URL" alternative:
      `https://app.adfliker.com/deletion-status`
- [ ] **Deauthorize Callback URL** = `https://app.adfliker.com/api/meta/deauth`
- [ ] App **icon** (1024×1024), **category**, and a complete **App Settings → Basic** section.
- [ ] A working **test login for the CRM** to give the reviewer (a tenant account that can
      reach Settings → Meta Lead Sync). Put it in the "App Review instructions" field.

> Already-approved permissions (no action): `pages_show_list`, `leads_retrieval`,
> `pages_read_engagement`, `pages_manage_metadata`, `public_profile`.
> Only submit `business_management` now. Add `pages_manage_ads` / `ads_management` **only**
> if/when you actually build ad-management features — extra permissions slow down review.

---

## 1. Permission to request

In **App Dashboard → App Review → Permissions and Features**, find **`business_management`**
→ **Request Advanced Access**.

---

## 2. "How will your app use this permission?" (paste into the justification box)

> Adfliker is a CRM that lets business owners sync their Facebook Lead Ads leads into their
> account. After a user connects with Facebook Login for Business, many users manage their
> Facebook Page through a Meta Business Portfolio rather than as a personal Page admin. Per
> Meta's Pages API documentation, the `business_management` permission is required to read Pages
> that are owned or claimed by a business. We use `business_management` to call `/me/businesses`
> and then `/{business-id}/owned_pages` and `/{business-id}/client_pages` to retrieve the list of
> Pages the user manages through their Business Portfolio. We display that list (name + picture)
> so the user can choose which Page's Lead Ads to sync, then we store only the selected Page ID
> and subscribe it to the leadgen webhook to receive leads. We do not modify, create, or delete
> any business assets, and we do not access ad accounts; the permission is used read-only to
> enumerate the user's business-owned Pages. Without it, users whose Pages live in a Business
> Portfolio cannot select their Page and cannot sync leads.

---

## 3. Step-by-step reviewer instructions (paste into "Instructions" field)

> Test CRM login: **<email>** / **<password>**   ← fill in a real test tenant
>
> 1. Go to https://app.adfliker.com and log in with the credentials above.
> 2. Open **Settings** (left sidebar) → **Meta Lead Sync** tab.
> 3. Click **Connect Facebook** and complete Facebook Login for Business. On the permissions
>    screen, keep all toggles ON and opt your Page(s) in.
> 4. After returning, the **Facebook Page** dropdown lists the Pages you manage — including Pages
>    owned by a Business Portfolio. This list is built using `business_management`
>    (`/me/businesses` → `owned_pages`/`client_pages`).
> 5. Select a Page, then select a **Lead Form**, then click **Start Syncing Leads**.
> 6. Submit a test lead on that Page's Lead Ad form. The lead appears in the CRM under **Leads**
>    within a few seconds (delivered via the leadgen webhook).

---

## 4. Screencast — word-for-word narration (required, ~90–120s, single take)

Record your screen with voice. Read each line while doing the action next to it. Reviewers
approve on what they SEE + HEAR, so name the permission out loud at step 4 (the money shot).

| # | Do this on screen | Say this (read verbatim) |
|---|---|---|
| 1 | Browser at `https://app.adfliker.com`, log in. | "This is Adfliker, a CRM at app dot adfliker dot com. I'm logging in as a business user." |
| 2 | Click **Settings → Meta Lead Sync**. | "In Settings, I open Meta Lead Sync, where a user connects their Facebook Page to sync Lead Ads." |
| 3 | Click **Connect Facebook**; complete the login; keep all toggles ON; opt the Page in. | "I click Connect Facebook and grant access, opting in my Page that is managed inside a Meta Business Portfolio." |
| 4 | Show the **Facebook Page dropdown populated** with the Business-Portfolio Page. | "The app now lists my Page. Because this Page is owned by a Business Portfolio, the app retrieves it using the business_management permission, via slash me slash businesses and owned_pages. This is the only way to list business-owned Pages." |
| 5 | Select the Page; select a **Lead Form**. | "I select the Page, then choose which Lead Form to sync." |
| 6 | Click **Start Syncing Leads**. | "I click Start Syncing Leads to subscribe this Page to the leadgen webhook." |
| 7 | Open the **Meta Lead Ads Testing Tool**, submit a test lead for this Page. | "Using Meta's Lead Ads Testing Tool, I submit a test lead on this Page." |
| 8 | Switch to CRM **Leads** page; show the new lead. | "The lead arrives in the CRM within seconds. That completes the flow that business_management enables." |

Recording tips:
- Use the **Meta Lead Ads Testing Tool**: developers.facebook.com/tools/lead-ads-testing
- Keep the **URL bar visible** so they see the live, reviewed app.
- One continuous take; don't cut between step 4 and step 8.
- Don't show Graph API Explorer — Meta wants the permission used **in your actual product UI**.

---

## 5. Common rejection reasons (avoid these)

- **No Business Verification** → instant fail for `business_management`.
- **Screencast doesn't show the permission in use** (e.g. only shows login, not the page list).
- **Reviewer can't reproduce** (missing/expired test login, or app in Dev mode).
- **Requesting more than you demonstrate** (don't add `ads_management` unless the screencast
  shows ad management).
- Privacy Policy / Data Deletion URLs not reachable or not matching the app.

---

## 6. While the review is pending

- App admins/testers already work — add pilot customers as **Testers** (App Roles) for
  immediate access.
- The in-app banner (commits `b901979`, `ac00118`) already tells affected users why their
  Page list is empty, so support load stays low until approval.

Typical turnaround: a few business days. Re-submit with a clearer screencast if rejected.
