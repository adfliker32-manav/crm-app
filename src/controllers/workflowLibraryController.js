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

        // M-S3 FIX: cap shares per tenant per day. There was no limit at all, so the
        // global library could be flooded by one account.
        const MAX_SHARES_PER_DAY = Number(process.env.WORKFLOW_LIBRARY_MAX_PER_DAY) || 5;
        const since = new Date(Date.now() - 24 * 3600 * 1000);
        const recent = await WorkflowLibraryItem.countDocuments({
            authorTenantId: tenantId, createdAt: { $gte: since }
        });
        if (recent >= MAX_SHARES_PER_DAY) {
            return res.status(429).json({
                message: `You can share up to ${MAX_SHARES_PER_DAY} workflows per day. Try again tomorrow.`
            });
        }

        // Don't allow the same workflow to be shared twice over.
        const already = await WorkflowLibraryItem.findOne({
            authorTenantId: tenantId, name: workflow.name, deletedAt: null
        }).select('_id').lean();
        if (already) {
            return res.status(409).json({
                message: 'You have already shared a workflow with this name. Withdraw it first to re-share.'
            });
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

        // H19 FIX: this pushes tenant content into a GLOBAL, cross-tenant collection.
        // It was completely unaudited, so there was no way to trace who published
        // what if the content turned out to contain customer data.
        require('../services/auditLogger').log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_PUBLISHED_TO_LIBRARY',
            targetType: 'WorkflowLibraryItem', targetId: String(libraryItem._id),
            targetName: workflow.name,
            details: { sourceWorkflowId: String(workflow._id), authorName },
            req
        });

        res.status(201).json({
            libraryItem,
            message: libraryItem.status === 'approved'
                ? 'Shared to the Community Library.'
                : 'Submitted to the Community Library — it will appear once reviewed.'
        });
    } catch (err) {
        console.error('[workflowLibraryController] publishToLibrary:', err);
        res.status(500).json({ message: 'Failed to share workflow to the community library' });
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/workflow-library/:id
// M-S5 FIX: withdraw a share. There was no way to remove a published item — so
// content that turned out to contain customer data was permanently global.
// ─────────────────────────────────────────────────────────────────────────────
exports.withdrawFromLibrary = async (req, res) => {
    try {
        const tenantId = req.tenantId;
        const { id }   = req.params;

        // Only the author may withdraw their own item.
        const item = await WorkflowLibraryItem.findOneAndUpdate(
            { _id: id, authorTenantId: tenantId, deletedAt: null },
            { $set: { deletedAt: new Date() } },
            { returnDocument: 'after' }
        );
        if (!item) return res.status(404).json({ message: 'Shared template not found' });

        require('../services/auditLogger').log({
            actor: req.user, actionCategory: 'SYSTEM', action: 'WORKFLOW_WITHDRAWN_FROM_LIBRARY',
            targetType: 'WorkflowLibraryItem', targetId: String(item._id), targetName: item.name,
            req
        });

        res.json({ message: 'Withdrawn from the Community Library' });
    } catch (err) {
        console.error('[workflowLibraryController] withdrawFromLibrary:', err);
        res.status(500).json({ message: 'Failed to withdraw the shared workflow' });
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

        // M-S3 / M-S5 FIX: only approved, undeleted items are browsable. Previously
        // find({}) exposed every submission to every tenant with no review step.
        const visible = { status: 'approved', deletedAt: null };

        const [items, total] = await Promise.all([
            WorkflowLibraryItem.find(visible)
                .sort(sortSpec)
                .skip((Number(page) - 1) * Number(limit))
                .limit(Number(limit))
                // list view: omit heavy graph fields, mirrors listWorkflows.
                // ⚠️ `authorTenantId` is EXCLUDED deliberately: it is a workspace
                // owner's User._id, and this endpoint is readable by every tenant.
                // Returning it handed any authenticated account a directory of other
                // tenants' owner ids — the exact input needed to target them in
                // id-based attacks elsewhere. `authorName` is stored separately and
                // is what the UI actually renders, so nothing is lost here.
                .select('-nodes -connections -authorTenantId')
                .lean(),
            WorkflowLibraryItem.countDocuments(visible)
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

        // M-S3 FIX: an unapproved or withdrawn item must not be clonable by id.
        const item = await WorkflowLibraryItem.findOne({
            _id: id, status: 'approved', deletedAt: null
        }).lean();
        if (!item) return res.status(404).json({ message: 'Template not found' });

        // ── M-S4 FIX: re-validate node types on the way in ────────────────────
        // Library items are stored graphs that may predate a node type being renamed
        // or removed. NodeRegistry.get() THROWS on an unknown type, so an unchecked
        // clone produced a workflow that failed at runtime with an internal error.
        const NodeRegistry = require('../workflow-engine/NodeRegistry');
        const unknownTypes = [...new Set((item.nodes || [])
            .map(n => n.type)
            .filter(t => !NodeRegistry.has(t)))];
        if (unknownTypes.length > 0) {
            return res.status(422).json({
                message: 'This template uses steps that are no longer available and cannot be cloned.',
                errors: unknownTypes.map(t => `Unknown step type: "${t}"`)
            });
        }

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
