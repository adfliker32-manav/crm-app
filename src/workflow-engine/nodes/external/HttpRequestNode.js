const NodeRegistry = require('../../NodeRegistry');
const axios = require('axios');
// WEAK #3 FIX: Import SSRF guard to block requests to private/internal addresses
const { validateOutboundUrl } = require('../../../utils/ssrfGuard');

// ─────────────────────────────────────────────────────────────────────────────
// HttpRequestNode
// Makes an outbound HTTP request (GET, POST, PUT, PATCH, DELETE).
// Response body is stored in 'http.response' variable.
// Supports variable interpolation in URL and body.
// ─────────────────────────────────────────────────────────────────────────────
const HttpRequestNode = {
    type: 'http_request',
    sideEffect: true, // L4/L5: external HTTP call — dry-run in Test Mode, idempotent on retry

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
        return { valid: errors.length === 0, errors };
    },

    execute: async (context, data) => {
        const vars = context.getAll();
        const interpolate = (str) => (str || '').replace(/\{\{([^}]+)\}\}/g, (_, key) => vars[key.trim()] ?? '');

        const url     = interpolate(data.url);
        const method  = (data.method || 'GET').toUpperCase();
        const timeout = Number(data.timeoutMs) || 10000;

        let headers = {};
        try { headers = JSON.parse(interpolate(data.headers || '{}')); } catch {}

        let body = null;
        if (['POST', 'PUT', 'PATCH'].includes(method) && data.body) {
            try { body = JSON.parse(interpolate(data.body)); } catch { body = interpolate(data.body); }
        }

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
                    validateStatus: () => true // inspect the status ourselves instead of throwing on non-2xx
                });

                const isRedirect = [301, 302, 303, 307, 308].includes(response.status) && response.headers.location;
                if (!isRedirect) break;

                currentUrl = new URL(response.headers.location, currentUrl).href;
            }

            const ok = response.status >= 200 && response.status < 300;
            if (!ok) throw Object.assign(new Error(`Request failed with status code ${response.status}`), { response });

            const responseData = typeof response.data === 'object' ? response.data : { raw: response.data };

            return {
                nextPort: 'success',
                output: {
                    'http.status':   response.status,
                    'http.success':  true,
                    'http.response': JSON.stringify(responseData).slice(0, 2000) // Cap at 2KB
                }
            };
        } catch (err) {
            const status = err.response?.status || 0;
            return {
                nextPort: 'error',
                output: {
                    'http.status':  status,
                    'http.success': false,
                    'http.error':   err.message
                }
            };
        }
    }
};

NodeRegistry.register(HttpRequestNode);
module.exports = HttpRequestNode;
