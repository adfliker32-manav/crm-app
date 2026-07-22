const Workflow            = require('../models/Workflow');
const WorkflowLibraryItem = require('../models/WorkflowLibraryItem');
const User                = require('../models/User');

// ─────────────────────────────────────────────────────────────────────────────
// SANITIZATION
// A shared workflow's node `data` can hold tenant-specific references (a
// WhatsApp/email template id, a stage/tag id, an assigned agent id) or literal
// contact details (a hardcoded phone/email) that only make sense — or worse,
// only resolve to real data — inside the author's own tenant. We strip those
// before the copy becomes visible to every other tenant, while leaving generic
// config (wait durations, condition operators, static message copy) intact so
// the template is still useful once cloned.
// ─────────────────────────────────────────────────────────────────────────────
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const PII_OR_SECRET_KEYS = new Set(['email', 'phone', 'phonenumber', 'recipient', 'to']);

const isIdKey = (key) => /[a-z0-9]Id$/.test(key);
const isSecretOrPiiKey = (key) =>
    /secret|token|password|apikey|webhookurl/i.test(key) || PII_OR_SECRET_KEYS.has(key.toLowerCase());

// Duck-types a BSON/Mongoose ObjectId instance. Documents fetched with .lean()
// keep ObjectId fields as instances (not strings), so a string-only check would
// miss them whenever the field name doesn't hint "...Id" either.
const looksLikeObjectId = (val) => {
    if (typeof val === 'string') return OBJECT_ID_PATTERN.test(val);
    return !!(val && typeof val.toHexString === 'function');
};

// Node types whose `data` holds raw connection/credential config that the
// generic key-name walk below can't safely vet. HttpRequestNode stores
// `headers`/`body` as free-form JSON *strings* (its own placeholder shows
// `{"Authorization": "Bearer YOUR_TOKEN"}`) — a string value never enters the
// key-based checks, so a tenant's live bearer token would otherwise be
// published verbatim to every other tenant. Drop the connection-specific
// fields for these types; whatever's left (e.g. `method`) is harmless shape.
const CONNECTION_FIELDS_BY_TYPE = {
    http_request: ['url', 'headers', 'body']
};

function sanitizeValue(value) {
    if (Array.isArray(value)) return value.map(sanitizeValue);
    // Dates have no enumerable own keys — walking them as a plain object below
    // would silently collapse them to {}. Not reachable by any node type today,
    // but a future date-typed field must not lose data this way.
    if (value instanceof Date) return value;
    if (value && typeof value === 'object') {
        const out = {};
        for (const [key, val] of Object.entries(value)) {
            if (isIdKey(key) || isSecretOrPiiKey(key)) continue;
            if (looksLikeObjectId(val)) continue;
            out[key] = sanitizeValue(val);
        }
        return out;
    }
    return value;
}

const sanitizeNodesForLibrary = (nodes = []) =>
    nodes.map(n => {
        const data = sanitizeValue(n.data || {});
        for (const field of CONNECTION_FIELDS_BY_TYPE[n.type] || []) delete data[field];
        return { id: n.id, type: n.type, name: n.name || '', data };
    });

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflows/:id/publish-to-library
// Publish a sanitized copy of a tenant's workflow to the global community library.
// ─────────────────────────────────────────────────────────────────────────────
exports.publishToLibrary = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;

        const workflow = await Workflow.findOne({ _id: id, tenantId }).lean();
        if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

        if (!workflow.nodes || workflow.nodes.length === 0) {
            return res.status(400).json({ message: 'Add at least one node before sharing this workflow' });
        }

        const author     = await User.findById(tenantId).select('name companyName').lean();
        const authorName = author?.companyName || author?.name || 'A CRM user';

        const libraryItem = await WorkflowLibraryItem.create({
            name:           workflow.name,
            description:    workflow.description || '',
            trigger:        workflow.trigger,
            nodes:          sanitizeNodesForLibrary(workflow.nodes),
            connections:    workflow.connections || [],
            authorTenantId: tenantId,
            authorName
        });

        res.status(201).json({ libraryItem });
    } catch (err) {
        console.error('[workflowLibraryController] publishToLibrary:', err);
        res.status(500).json({ message: 'Failed to share workflow to the community library' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/workflow-library
// Browse public templates, sorted by popularity (clone count) or recency.
// ─────────────────────────────────────────────────────────────────────────────
exports.getLibrary = async (req, res) => {
    try {
        const { sort = 'popular', page = 1, limit = 24 } = req.query;
        const sortSpec = sort === 'newest' ? { createdAt: -1 } : { cloneCount: -1, createdAt: -1 };

        const [items, total] = await Promise.all([
            WorkflowLibraryItem.find({})
                .sort(sortSpec)
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                .select('-nodes -connections') // list view: omit heavy graph fields, mirrors listWorkflows
                .lean(),
            WorkflowLibraryItem.countDocuments({})
        ]);

        res.json({ items, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        console.error('[workflowLibraryController] getLibrary:', err);
        res.status(500).json({ message: 'Failed to load community library' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/workflow-library/:id/clone
// Copy a community template into the current tenant's workspace as a draft.
// ─────────────────────────────────────────────────────────────────────────────
exports.cloneFromLibrary = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const userId   = req.user.userId || req.user.id;
        const { id }   = req.params;

        const item = await WorkflowLibraryItem.findById(id).lean();
        if (!item) return res.status(404).json({ message: 'Template not found' });

        const workflow = await Workflow.create({
            tenantId,
            name:          item.name,
            description:   item.description,
            trigger:       item.trigger,
            triggerConfig: {},
            nodes:         item.nodes,
            connections:   item.connections,
            variables:     {},
            status:        'draft',
            version:       1,
            createdBy:     userId
        });

        await WorkflowLibraryItem.updateOne({ _id: id }, { $inc: { cloneCount: 1 } });

        res.status(201).json({ workflow });
    } catch (err) {
        console.error('[workflowLibraryController] cloneFromLibrary:', err);
        res.status(500).json({ message: 'Failed to clone workflow from the library' });
    }
};
