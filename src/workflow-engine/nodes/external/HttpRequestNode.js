const NodeRegistry = require('../../NodeRegistry');
const axios = require('axios');
// WEAK #3 FIX: Import SSRF guard to block requests to private/internal addresses
const { validateOutboundUrl } = require('../../../utils/ssrfGuard');
const { resolveSecretsTracked, makeRedactor } = require('../../../utils/workflowSecrets');

// ── H4 FIX: bound the response and the clock ─────────────────────────────────
// axios 1.19.0 defaults to maxContentLength/maxBodyLength = -1 (unlimited —
// verified in axios/lib/defaults/index.js:153-154), so the whole body was
// buffered into the worker heap and only THEN truncated to 2KB for storage.
// Since the URL is user-supplied and the worker is shared by ALL tenants at
// concurrency 10, one oversized response OOM-killed the engine for everybody.
const MAX_RESPONSE_BYTES = Number(process.env.WORKFLOW_HTTP_MAX_BYTES) || 1_048_576;   // 1 MB
// Also cap the per-hop timeout: it was uncapped and applied per redirect hop
// (up to 6), so timeoutMs:60000 could hold one job for 6 minutes — far past the
// BullMQ lock and straight into the stalled-redelivery path.
const MAX_TIMEOUT_MS = Number(process.env.WORKFLOW_HTTP_MAX_TIMEOUT_MS) || 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// HttpRequestNode
// Makes an outbound HTTP request (GET, POST, PUT, PATCH, DELETE).
// Response body is stored in 'http.response' variable.
// Supports variable interpolation in URL and body.
// ─────────────────────────────────────────────────────────────────────────────
const HttpRequestNode = {
    type: 'http_request',
    sideEffect: true, // L4/L5: external HTTP call — dry-run in Test Mode, idempotent on retry
    slow: true,       // L-6: arbitrary third-party latency, up to 6 redirect hops

    meta: () => ({
        type:     'http_request',
        name:     'HTTP Request',
        icon:     'fa-solid fa-globe',
        category: 'external',
        color:    '#64748B',
        description: 'Make an outbound HTTP request to any URL'
    }),

    ports: () => ({
        inputs:  [{ id: 'input',   label: 'In' }],
        outputs: [
            { id: 'success', label: 'Success (2xx)' },
            { id: 'error',   label: 'Error (non-2xx)' }
        ]
    }),

    schema: () => ({
        fields: [
            {
                key:      'method',
                label:    'HTTP Method',
                type:     'select',
                required: true,
                options:  [
                    { value: 'GET',    label: 'GET' },
                    { value: 'POST',   label: 'POST' },
                    { value: 'PUT',    label: 'PUT' },
                    { value: 'PATCH',  label: 'PATCH' },
                    { value: 'DELETE', label: 'DELETE' }
                ]
            },
            {
                key:         'url',
                label:       'URL',
                type:        'text',
                required:    true,
                placeholder: 'https://api.example.com/leads/{{lead.id}}'
            },
            {
                key:         'headers',
                label:       'Headers (JSON)',
                type:        'json_editor',
                placeholder: '{"Authorization": "Bearer YOUR_TOKEN", "Content-Type": "application/json"}'
            },
            {
                key:         'body',
                label:       'Request Body (JSON)',
                type:        'json_editor',
                placeholder: '{"leadName": "{{lead.name}}", "phone": "{{lead.phone}}"}',
                showWhen:    { field: 'method', values: ['POST', 'PUT', 'PATCH'] }
            },
            {
                key:          'timeoutMs',
                label:        'Timeout (ms)',
                type:         'number',
                defaultValue: 10000
            }
        ]
    }),

    validate: (data) => {
        const errors = [];
        if (!data.method) errors.push('HTTP method is required');
        if (!data.url?.trim()) errors.push('URL is required');
        // M-N6 FIX: catch malformed JSON at publish, not with a confusing 401 later.
        // Interpolation placeholders are left intact, so only structural errors show up.
        for (const field of ['headers', 'body']) {
            const raw = data[field];
            if (typeof raw === 'string' && raw.trim() !== '' && !raw.includes('{{')) {
                try { JSON.parse(raw); } catch (e) {
                    if (field === 'headers') errors.push(`Headers must be valid JSON: ${e.message}`);
                    // A non-JSON body is legitimate (sent as a raw string), so only warn on headers.
                }
            }
        }
        // H4 FIX: surface the timeout ceiling at authoring time rather than
        // silently clamping it at runtime.
        if (data.timeoutMs !== undefined && data.timeoutMs !== '' && data.timeoutMs !== null) {
            const t = Number(data.timeoutMs);
            if (!Number.isFinite(t) || t < 1000 || t > MAX_TIMEOUT_MS) {
                errors.push(`Timeout must be between 1000 and ${MAX_TIMEOUT_MS} ms`);
            }
        }
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const vars = context.getAll();
        const interpolate = (str) => (str || '').replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');

        // Secrets are also allowed in the URL (some APIs key on a path/query token).
        // Track what was substituted so it can be scrubbed from anything we persist.
        const usedSecrets = [];
        const resolveTracked = async (s) => {
            const { value, used } = await resolveSecretsTracked(s, context.tenantId);
            usedSecrets.push(...used);
            return value;
        };
        const url     = await resolveTracked(interpolate(data.url));
        const method  = (data.method || 'GET').toUpperCase();
        // H4 FIX: clamp, so a legacy node saved with a huge timeout can't hold a
        // worker slot past the BullMQ lock.
        const timeout = Math.min(Number(data.timeoutMs) || 10000, MAX_TIMEOUT_MS);

        // M-N6 FIX: a malformed headers JSON used to be swallowed, so the request went
        // out with NO headers — an authenticated call silently became anonymous and
        // failed with a confusing 401 from the remote. Fail on the node's error port
        // with the actual reason instead. (validate() also rejects it at publish.)
        let headers = {};
        // Rows 23 + 55: resolve {{secret.NAME}} LAST and only into this local string.
        // The plaintext must never reach `variables`, node output or history — that is
        // the whole point of the store, and `interpolate` above deliberately cannot
        // see secrets because they are not execution variables.
        const rawHeaders = await resolveTracked(interpolate(data.headers || '{}'));
        if (rawHeaders && rawHeaders.trim() !== '') {
            try {
                headers = JSON.parse(rawHeaders);
                if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
                    throw new Error('Headers must be a JSON object');
                }
            } catch (e) {
                console.error(`[HttpRequestNode] Invalid headers JSON: ${e.message}`);
                return {
                    nextPort: 'error',
                    output: { 'http.success': false, 'http.error': `Invalid headers JSON: ${e.message}` }
                };
            }
        }

        let body = null;
        if (['POST', 'PUT', 'PATCH'].includes(method) && data.body) {
            const rawBody = await resolveTracked(interpolate(data.body));
            try { body = JSON.parse(rawBody); } catch { body = rawBody; }
        }

        // Rows 23 + 55: scrub every resolved plaintext from anything this node
        // persists. axios puts the request URL in err.message, so without this a
        // single failed request would write the secret into node output → variables
        // → execution history, which is exactly what the store exists to prevent.
        const redact = makeRedactor(usedSecrets);

        // SSRF FIX: a validated public URL can still 30x-redirect to a private/
        // metadata address, and axios's built-in maxRedirects follows that hop
        // without re-checking it. Follow redirects manually, bounded, re-validating
        // every hop (including the first) against the SSRF guard before connecting.
        const MAX_REDIRECTS = 5;

        try {
            let currentUrl = url;
            let response;
            for (let hop = 0; ; hop++) {
                if (hop > MAX_REDIRECTS) throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);

                // WEAK #3 FIX: Validate the resolved URL against SSRF rules before making
                // any network request. This blocks private IPs, localhost, cloud metadata
                // endpoints (169.254.x.x), and non-HTTP protocols.
                await validateOutboundUrl(currentUrl);

                response = await axios({
                    method, url: currentUrl, headers, data: body, timeout,
                    maxRedirects: 0,        // never let axios auto-follow — every hop must be re-validated
                    validateStatus: () => true, // inspect the status ourselves instead of throwing on non-2xx
                    // H4 FIX: reject an oversized body at the transport layer instead
                    // of buffering it all into the worker heap first.
                    maxContentLength: MAX_RESPONSE_BYTES,
                    maxBodyLength:    MAX_RESPONSE_BYTES,
                    // M-E12 FIX: let a cancel actually stop the request in flight.
                    ...(context.getAbortSignal() ? { signal: context.getAbortSignal() } : {})
                });

                const isRedirect = [301, 302, 303, 307, 308].includes(response.status) && response.headers.location;
                if (!isRedirect) break;

                const nextUrl = new URL(response.headers.location, currentUrl);
                // M-N7 FIX: never replay credentials to a different origin. The SSRF
                // guard vets each hop's address, but a *public* endpoint could still
                // 302 to another public host and harvest the bearer token.
                if (nextUrl.origin !== new URL(currentUrl).origin) {
                    for (const h of Object.keys(headers)) {
                        if (/^(authorization|cookie|x-api-key|x-auth-token)$/i.test(h)) {
                            delete headers[h];
                        }
                    }
                }
                currentUrl = nextUrl.href;
            }

            const ok = response.status >= 200 && response.status < 300;
            if (!ok) throw Object.assign(new Error(`Request failed with status code ${response.status}`), { response });

            const responseData = typeof response.data === 'object' ? response.data : { raw: response.data };

            return {
                nextPort: 'success',
                output: {
                    'http.status':   response.status,
                    'http.success':  true,
                    // A response can echo back a token it was sent — redact before storing.
                    'http.response': redact(JSON.stringify(responseData)).slice(0, 2000) // Cap at 2KB
                }
            };
        } catch (err) {
            const status = err.response?.status || 0;
            return {
                nextPort: 'error',
                output: {
                    'http.status':  status,
                    'http.success': false,
                    'http.error':   redact(err.message)
                }
            };
        }
    }
};

NodeRegistry.register(HttpRequestNode);
module.exports = HttpRequestNode;
