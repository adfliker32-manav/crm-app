/**
 * Object storage key layout — the ONE place that decides where a file lives.
 *
 *   tenants/<tenantId>/<area>/<...>
 *
 *   tenants/<t>/media-library/<uuid>.<ext>
 *   tenants/<t>/whatsapp/inbound/<metaMediaId>.<ext>
 *   tenants/<t>/whatsapp/outbound/<uuid>.<ext>
 *   tenants/<t>/lead-docs/<leadId>/<uuid>.<ext>
 *   tenants/<t>/knowledge-base/<uuid>.<ext>
 *   tenants/<t>/email-attachments/<file>
 *   tenants/<t>/email-inbound/<messageId>/<n>-<name>
 *   platform/support/<ticketId>/<file>        (platform-owned, outlives the tenant)
 *
 * WHY one prefix per tenant: deleting, exporting, measuring or auditing a
 * client's files is a single prefix operation, and a bucket rule can target one
 * tenant. The previous layout scattered each tenant across six top-level
 * folders (Media Library even sat at the bucket root), and account deletion's
 * prefix sweep had already missed one of them.
 *
 * LEGACY KEYS: rows written before this layout keep their stored key and keep
 * working — keys are always read from the database, never rebuilt. Anything that
 * checks OWNERSHIP by prefix must go through isOwnedKey(), which accepts both.
 * scripts/migrate-storage-layout.js moves old objects into the new layout.
 */

const OBJECT_ID_RE = /^[a-f\d]{24}$/i;

const AREAS = Object.freeze({
    MEDIA_LIBRARY: 'media-library',
    WHATSAPP_INBOUND: 'whatsapp/inbound',
    WHATSAPP_OUTBOUND: 'whatsapp/outbound',
    LEAD_DOCS: 'lead-docs',
    KNOWLEDGE_BASE: 'knowledge-base',
    EMAIL_ATTACHMENTS: 'email-attachments',
    EMAIL_INBOUND: 'email-inbound'
});

// Where each area lived before the tenants/ layout. `<t>` is the tenant id.
const LEGACY_PREFIX = Object.freeze({
    [AREAS.MEDIA_LIBRARY]: (t) => `${t}/`,
    [AREAS.WHATSAPP_INBOUND]: (t) => `wa-inbound/${t}/`,
    [AREAS.WHATSAPP_OUTBOUND]: null, // did not exist
    [AREAS.LEAD_DOCS]: (t) => `lead-docs/${t}/`,
    [AREAS.KNOWLEDGE_BASE]: (t) => `knowledge-base/${t}/`,
    [AREAS.EMAIL_ATTACHMENTS]: (t) => `email-attachments/${t}/`,
    [AREAS.EMAIL_INBOUND]: (t) => `email-inbound/${t}/`
});

const assertTenantId = (tenantId) => {
    const id = String(tenantId ?? '');
    if (!OBJECT_ID_RE.test(id)) {
        // A missing id would otherwise produce "tenants/undefined/…" and pool
        // every such file into one shared folder.
        throw new Error(`Invalid tenant id for storage key: "${id}"`);
    }
    return id.toLowerCase();
};

const assertArea = (area) => {
    if (!Object.values(AREAS).includes(area)) throw new Error(`Unknown storage area: "${area}"`);
    return area;
};

/**
 * One path segment: no separators, no traversal, no control characters, bounded.
 * Callers pass generated ids and sanitized names; this is the last line.
 */
const safeSegment = (value) => {
    const s = String(value ?? '');
    if (!s || s === '.' || s === '..' || s.length > 200 || /[\/\\\x00-\x1f\x7f]/.test(s)) {
        throw new Error(`Unsafe storage key segment: "${s.slice(0, 50)}"`);
    }
    return s;
};

/** Root of everything a tenant owns: "tenants/<t>/". */
const tenantRoot = (tenantId) => `tenants/${assertTenantId(tenantId)}/`;

/** Prefix for one area of one tenant: "tenants/<t>/<area>/". */
const areaPrefix = (tenantId, area) => `${tenantRoot(tenantId)}${assertArea(area)}/`;

/** Build a key: tenantKey(t, AREAS.LEAD_DOCS, leadId, 'uuid.pdf'). */
const tenantKey = (tenantId, area, ...segments) => {
    if (!segments.length) throw new Error('A storage key needs at least one segment after the area');
    return `${areaPrefix(tenantId, area)}${segments.map(safeSegment).join('/')}`;
};

/** Support attachments belong to the platform's ticket record, not the tenant. */
const supportKey = (ticketId, fileName) => `platform/support/${safeSegment(ticketId)}/${safeSegment(fileName)}`;

/**
 * Does `key` belong to one of `tenantIds` in `area`? Accepts the current layout
 * and the legacy one. Use this for every ownership check that looks at a key.
 */
const isOwnedKey = (key, tenantIds, area) => {
    if (typeof key !== 'string' || !key || key.includes('..')) return false;
    assertArea(area);
    const ids = (Array.isArray(tenantIds) ? tenantIds : [tenantIds])
        .map(id => String(id ?? ''))
        .filter(id => OBJECT_ID_RE.test(id));
    return ids.some(id => {
        if (key.startsWith(areaPrefix(id, area))) return true;
        const legacy = LEGACY_PREFIX[area];
        return !!legacy && key.startsWith(legacy(id));
    });
};

/** Every prefix a tenant's objects can live under — for account deletion sweeps. */
const allTenantPrefixes = (tenantId) => {
    const id = assertTenantId(tenantId);
    const legacy = Object.values(LEGACY_PREFIX).filter(Boolean).map(fn => fn(id));
    return [tenantRoot(id), ...new Set(legacy)];
};

module.exports = {
    AREAS,
    tenantRoot,
    areaPrefix,
    tenantKey,
    supportKey,
    isOwnedKey,
    allTenantPrefixes,
    safeSegment
};
