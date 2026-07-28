// ─────────────────────────────────────────────────────────────────────────────
// ssrfGuard.js — Server-Side Request Forgery (SSRF) Protection
// ─────────────────────────────────────────────────────────────────────────────
// FIX WEAK #3: HttpRequestNode allowed any URL including internal/private
// addresses which could be used to attack the server or cloud metadata endpoints.
//
// This utility validates URLs before outbound HTTP requests are made by
// workflow nodes. It blocks:
//   - Private IP ranges (RFC1918)
//   - Loopback addresses (127.x.x.x, ::1)
//   - Cloud metadata endpoints (169.254.169.254, etc.)
//   - Non-HTTP(S) protocols
//   - Internal hostnames
// ─────────────────────────────────────────────────────────────────────────────

const dns = require('dns').promises;
const net = require('net');

/**
 * Private / reserved IPv4 CIDR blocks that should never be reached by outbound
 * workflow HTTP requests.
 */
const BLOCKED_CIDR = [
    { start: '10.0.0.0',      end: '10.255.255.255' },   // RFC1918
    { start: '172.16.0.0',    end: '172.31.255.255' },   // RFC1918
    { start: '192.168.0.0',   end: '192.168.255.255' },  // RFC1918
    { start: '127.0.0.0',     end: '127.255.255.255' },  // Loopback
    { start: '169.254.0.0',   end: '169.254.255.255' },  // Link-local / AWS metadata
    { start: '100.64.0.0',    end: '100.127.255.255' },  // Carrier-grade NAT
    { start: '0.0.0.0',       end: '0.255.255.255' },    // This network
    { start: '192.0.0.0',     end: '192.0.0.255' },      // IETF Protocol Assignments
    { start: '198.18.0.0',    end: '198.19.255.255' },   // Benchmarking
    { start: '224.0.0.0',     end: '255.255.255.255' },  // Multicast + broadcast
];

const BLOCKED_HOSTNAMES = [
    'localhost', 'metadata.google.internal', 'instance-data',
    'metadata', 'computeMetadata'
];

/**
 * Convert dotted-decimal IPv4 to a 32-bit integer for range comparison.
 */
const ipToInt = (ip) => {
    const parts = ip.split('.').map(Number);
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
};

/**
 * Check if an IPv4 address falls inside any blocked range.
 */
const isPrivateIPv4 = (ip) => {
    const int = ipToInt(ip);
    for (const { start, end } of BLOCKED_CIDR) {
        if (int >= ipToInt(start) && int <= ipToInt(end)) return true;
    }
    return false;
};

/**
 * Check if an IPv6 address falls inside a blocked/reserved range:
 * loopback (::1), unspecified (::), unique local (fc00::/7),
 * link-local (fe80::/10), and IPv4-mapped (::ffff:a.b.c.d — the embedded
 * IPv4 address is re-checked against the IPv4 blocklist rather than being
 * allowed through unchecked).
 */
const isPrivateIPv6 = (ip) => {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;

    // Dotted form, e.g. from dns.lookup() output on some platforms.
    const dottedV4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dottedV4Mapped) return isPrivateIPv4(dottedV4Mapped[1]);

    // WHATWG URL normalizes "::ffff:a.b.c.d" into pure-hex hextets
    // (e.g. "::ffff:127.0.0.1" becomes "::ffff:7f00:1") — decode those back
    // into a dotted IPv4 address before checking the blocklist.
    const hexV4Mapped = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexV4Mapped) {
        const hi = parseInt(hexV4Mapped[1], 16);
        const lo = parseInt(hexV4Mapped[2], 16);
        const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        return isPrivateIPv4(v4);
    }

    // Compare the first hextet numerically (not by string prefix) so compressed
    // forms like "fc0::1" (0x0fc0, NOT in range) aren't confused with "fc00::1"
    // (0xfc00, in range).
    const firstHextet = parseInt(normalized.split(':')[0] || '0', 16);
    if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // fc00::/7 (ULA)
    if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // fe80::/10 (link-local)

    return false;
};

/**
 * Check if an IP (v4 or v6) falls inside a blocked/reserved range.
 * Accepts IPv6 literals with or without surrounding brackets (e.g. from a URL's
 * `hostname`, which may retain "[::1]" form).
 */
const isPrivateIP = (ip) => {
    const stripped = ip.replace(/^\[|\]$/g, '');
    if (net.isIPv4(stripped)) return isPrivateIPv4(stripped);
    if (net.isIPv6(stripped)) return isPrivateIPv6(stripped);
    return false;
};

/**
 * Validate a URL before making an outbound request.
 * Throws an error with a descriptive message if the URL is blocked.
 *
 * @param {string} rawUrl — The URL to validate
 * @throws {Error} if the URL is blocked or invalid
 */
const validateOutboundUrl = async (rawUrl) => {
    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        throw new Error(`[SSRF Guard] Invalid URL: "${rawUrl}"`);
    }

    // 1. Protocol check — only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`[SSRF Guard] Protocol "${parsed.protocol}" is not allowed. Only http/https permitted.`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // 2. Blocked hostname check
    if (BLOCKED_HOSTNAMES.some(b => hostname === b || hostname.endsWith(`.${b}`))) {
        throw new Error(`[SSRF Guard] Hostname "${hostname}" is not allowed.`);
    }

    // 3. If hostname is an IP, validate it directly (v4 or v6)
    if (net.isIP(hostname.replace(/^\[|\]$/g, ''))) {
        if (isPrivateIP(hostname)) {
            throw new Error(`[SSRF Guard] Direct IP access to private/reserved address "${hostname}" is blocked.`);
        }
        return; // Public IP — allowed
    }

    // 4. Resolve hostname to IP and validate the resolved address
    try {
        const { address } = await dns.lookup(hostname);
        if (isPrivateIP(address)) {
            throw new Error(`[SSRF Guard] Hostname "${hostname}" resolves to private/reserved IP "${address}" — blocked.`);
        }
    } catch (err) {
        if (err.message.startsWith('[SSRF Guard]')) throw err;
        // DNS resolution failed — block the request to be safe
        throw new Error(`[SSRF Guard] Could not resolve hostname "${hostname}": ${err.message}`);
    }
};

module.exports = { validateOutboundUrl };
