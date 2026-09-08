const path = require('path');

// Credentials come from scripts/.env.mock-crm (written by setup_partner_test.js),
// NOT from the project .env — that one belongs to the Adfliker backend and its
// PORT=5000 would make this mock server fight the real API for the same port.
require('dotenv').config({ path: path.join(__dirname, '.env.mock-crm') });

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
// Deliberately NOT `PORT` — see the dotenv note above.
const PORT = process.env.MOCK_CRM_PORT || 3000;

// Set your partner credentials here or in scripts/.env.mock-crm
const ADFLIKER_API_URL = process.env.ADFLIKER_API_URL || 'http://localhost:5000/api';
const PARTNER_KEY = process.env.PARTNER_KEY || 'YOUR_PARTNER_KEY';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'YOUR_WEBHOOK_SECRET';
const ADFLIKER_ACCOUNT_ID = process.env.ADFLIKER_ACCOUNT_ID || 'YOUR_ACCOUNT_ID';

// The backend builds embedUrl from its own FRONTEND_URL, which in this repo's
// .env points at production (https://app.adfliker.com). Locally that would load
// the production SPA with a token minted by the local backend, which fails.
// Rewriting only the origin keeps the path and token the backend issued.
const EMBED_ORIGIN = process.env.MOCK_EMBED_ORIGIN || '';
const localiseEmbedUrl = (url) => {
    if (!EMBED_ORIGIN || !url) return url;
    try {
        const parsed = new URL(url);
        return `${EMBED_ORIGIN.replace(/[/]+$/, '')}${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
};

app.use(express.json());

// 1. Webhook Endpoint
app.post('/webhooks/adfliker', (req, res) => {
    const signature = req.headers['x-partner-signature'];
    const deliveryId = req.headers['x-partner-delivery-id'];
    const event = req.headers['x-partner-event'];

    // Use the raw body buffer for signature verification
    const rawBody = JSON.stringify(req.body);
    const expectedSignature = crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

    if (signature !== expectedSignature) {
        console.error('❌ Webhook signature verification failed!');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log(`✅ Received Webhook [${event}] (Delivery ID: ${deliveryId})`);
    console.log(JSON.stringify(req.body, null, 2));

    res.status(200).json({ received: true });
});

// 2. Token Generation Endpoint
app.get('/api/whatsapp-embed/:accountId', async (req, res) => {
    try {
        const accountId = req.params.accountId;
        const response = await axios.post(
            `${ADFLIKER_API_URL}/partner/v1/accounts/${accountId}/embed-token`,
            {},
            {
                headers: {
                    'x-partner-key': PARTNER_KEY
                }
            }
        );
        res.json({ embedUrl: localiseEmbedUrl(response.data.embedUrl) });
    } catch (err) {
        // Surface the upstream reason instead of a bare 500 — a bad partner key
        // and an unreachable backend are different problems, and the page showed
        // the same "Error: No URL" for both.
        const detail = err.response?.data || err.message;
        console.error('Failed to get embed token:', err.response?.status || '', detail);
        res.status(err.response?.status || 500).json({ error: 'Failed to generate token', detail });
    }
});

// 3. Simple CRM Frontend to render the iframe
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Mock Partner CRM</title>
            <style>
                body { font-family: sans-serif; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; background: #f1f5f9; }
                .header { background: #1e293b; color: white; padding: 1rem; }
                .content { display: flex; flex: 1; overflow: hidden; }
                .sidebar { width: 250px; background: white; border-right: 1px solid #e2e8f0; padding: 1rem; }
                .main { flex: 1; padding: 1rem; }
                #whatsapp-container { width: 100%; height: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>Mock Partner CRM</h2>
            </div>
            <div class="content">
                <div class="sidebar">
                    <p><strong>Customer:</strong> John Doe</p>
                    <p><strong>Phone:</strong> +1234567890</p>
                    <button onclick="loadWhatsApp()">Open WhatsApp</button>
                    <p id="status"></p>
                </div>
                <div class="main">
                    <div id="whatsapp-container">
                        <iframe id="whatsapp-embed" src="" style="width: 100%; height: 100%; border: none;" allow="clipboard-write"></iframe>
                    </div>
                </div>
            </div>

            <script>
                async function loadWhatsApp() {
                    const statusEl = document.getElementById('status');
                    statusEl.innerText = 'Loading...';
                    try {
                        const accountId = '${ADFLIKER_ACCOUNT_ID}';
                        const res = await fetch('/api/whatsapp-embed/' + accountId);
                        const data = await res.json();
                        if (data.embedUrl) {
                            document.getElementById('whatsapp-embed').src = data.embedUrl;
                            statusEl.innerText = 'Loaded!';
                        } else {
                            const d = data.detail;
                            statusEl.innerText = 'Error: ' + (d?.message || d?.error || JSON.stringify(d || data));
                        }
                    } catch (err) {
                        statusEl.innerText = 'Error loading embed';
                        console.error(err);
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`🏢 Mock Partner CRM Server running on http://localhost:${PORT}`);
    console.log(`\nTo test, you need to:`);
    console.log(`1. Create a partner in Adfliker SuperAdmin`);
    console.log(`2. Provision an account for that partner`);
    console.log(`3. Run this server with PARTNER_KEY, WEBHOOK_SECRET, and ADFLIKER_ACCOUNT_ID env vars set.`);
    console.log(`
   Or just run: node scripts/setup_partner_test.js  (does all three)`);
    const configured = PARTNER_KEY !== 'YOUR_PARTNER_KEY' && ADFLIKER_ACCOUNT_ID !== 'YOUR_ACCOUNT_ID';
    console.log(`
   Credentials: ${configured ? 'loaded OK' : 'MISSING — the embed button will fail'}`);
    console.log(`   Backend:      ${ADFLIKER_API_URL}`);
    console.log(`   Embed origin: ${EMBED_ORIGIN || '(as issued by backend)'}`);
});
