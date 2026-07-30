const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// WorkflowSecret  (rows 23 + 55)
// ─────────────────────────────────────────────────────────────────────────────
// Encrypted, per-tenant credential store for workflows.
//
// Before this there was no secret type at all. HttpRequestNode's own placeholder
// invited a live bearer token into plaintext node config
// (`{"Authorization": "Bearer YOUR_TOKEN"}`), which was stored verbatim in
// Workflow.nodes[].data — readable by any authenticated tenant user via
// GET /api/workflows/:id, copied into Mongo backups, and with no rotation path.
//
// Ciphertext is never selected by default, so a stray `.find()` cannot leak it.
// The plaintext is resolved ONLY at execute time, inside the node, and never
// enters `variables` or the execution history.
// ─────────────────────────────────────────────────────────────────────────────
const WorkflowSecretSchema = new mongoose.Schema({
    tenantId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Referenced from node config as {{secret.NAME}}. Uppercase/underscore so it is
    // visually distinct from an ordinary variable and cannot collide with a
    // lead./webhook./http. namespace.
    name: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
        match: [/^[A-Z0-9_]{2,64}$/, 'Secret names may contain only A-Z, 0-9 and underscore']
    },

    description: { type: String, default: '', maxlength: 200 },

    // AES-256-GCM. `select: false` so the ciphertext is excluded from every query
    // that does not explicitly ask for it.
    ciphertext: { type: String, required: true, select: false },
    iv:         { type: String, required: true, select: false },
    authTag:    { type: String, required: true, select: false },

    // Last 4 plaintext characters, for "is this the key I think it is?" in the UI
    // without ever revealing the value.
    hint: { type: String, default: '' },

    createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    lastUsedAt: { type: Date, default: null },
    usageCount: { type: Number, default: 0 }

}, { timestamps: true });

// One secret per (tenant, name) — the reference {{secret.NAME}} must be unambiguous.
WorkflowSecretSchema.index({ tenantId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('WorkflowSecret', WorkflowSecretSchema);
