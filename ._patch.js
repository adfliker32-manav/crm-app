const fs = require('fs');
const p = 'scripts/mock_partner_crm.js';
let s = fs.readFileSync(p, 'utf8');
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error('NOT FOUND: ' + label);
  s = s.replace(a, b);
};

rep(`require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Set your partner credentials here or in a .env file next to this script
const ADFLIKER_API_URL = process.env.ADFLIKER_API_URL || 'http://localhost:5000/api';`,
`const path = require('path');

// Credentials come from scripts/.env.mock-crm (written by setup_partner_test.js),
// NOT from the project .env — that one belongs to the Adfliker backend and its
// PORT=5000 would make this mock server fight the real API for the same port.
require('dotenv').config({ path: path.join(__dirname, '.env.mock-crm') });

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
// Deliberately NOT \`PORT\` — see the dotenv note above.
const PORT = process.env.MOCK_CRM_PORT || 3000;

// Set your partner credentials here or in scripts/.env.mock-crm
const ADFLIKER_API_URL = process.env.ADFLIKER_API_URL || 'http://localhost:5000/api';`, 'head');

rep(`const ADFLIKER_ACCOUNT_ID = process.env.ADFLIKER_ACCOUNT_ID || 'YOUR_ACCOUNT_ID';`,
`const ADFLIKER_ACCOUNT_ID = process.env.ADFLIKER_ACCOUNT_ID || 'YOUR_ACCOUNT_ID';

// The backend builds embedUrl from its own FRONTEND_URL, which in this repo's
// .env points at production (https://app.adfliker.com). Locally that would load
// the production SPA with a token minted by the local backend, which fails.
// Rewriting only the origin keeps the path and token the backend issued.
const EMBED_ORIGIN = process.env.MOCK_EMBED_ORIGIN || '';
const localiseEmbedUrl = (url) => {
    if (!EMBED_ORIGIN || !url) return url;
    try {
        const parsed = new URL(url);
        return \`\${EMBED_ORIGIN.replace(/\/+$/, '')}\${parsed.pathname}\${parsed.search}\`;
    } catch {
        return url;
    }
};`, 'embed origin');

rep(`        res.json({ embedUrl: response.data.embedUrl });
    } catch (err) {
        console.error('Failed to get embed token:', err.response?.data || err.message);
        res.status(500).json({ error: 'Failed to generate token' });
    }`,
`        res.json({ embedUrl: localiseEmbedUrl(response.data.embedUrl) });
    } catch (err) {
        // Surface the upstream reason instead of a bare 500 — a bad partner key
        // and an unreachable backend are different problems, and the page showed
        // the same "Error: No URL" for both.
        const detail = err.response?.data || err.message;
        console.error('Failed to get embed token:', err.response?.status || '', detail);
        res.status(err.response?.status || 500).json({ error: 'Failed to generate token', detail });
    }`, 'error detail');

rep(`                        } else {
                            statusEl.innerText = 'Error: No URL';
                        }`,
`                        } else {
                            const d = data.detail;
                            statusEl.innerText = 'Error: ' + (d?.message || d?.error || JSON.stringify(d || data));
                        }`, 'frontend error');

rep("    console.log(`3. Run this server with PARTNER_KEY, WEBHOOK_SECRET, and ADFLIKER_ACCOUNT_ID env vars set.`);",
"    console.log(`3. Run this server with PARTNER_KEY, WEBHOOK_SECRET, and ADFLIKER_ACCOUNT_ID env vars set.`);\n" +
"    console.log(`\n   Or just run: node scripts/setup_partner_test.js  (does all three)`);\n" +
"    const configured = PARTNER_KEY !== 'YOUR_PARTNER_KEY' && ADFLIKER_ACCOUNT_ID !== 'YOUR_ACCOUNT_ID';\n" +
"    console.log(`\n   Credentials: ${configured ? 'loaded OK' : 'MISSING — the embed button will fail'}`);\n" +
"    console.log(`   Backend:      ${ADFLIKER_API_URL}`);\n" +
"    console.log(`   Embed origin: ${EMBED_ORIGIN || '(as issued by backend)'}`);", 'listen log');

fs.writeFileSync(p, s, 'utf8');
console.log('patched OK');
