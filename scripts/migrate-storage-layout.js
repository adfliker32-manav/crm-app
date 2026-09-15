// Moves existing object-storage files into the tenants/<tenantId>/<area>/ layout.
//
// Usage:
//   node scripts/migrate-storage-layout.js                 dry run: counts only, no writes
//   node scripts/migrate-storage-layout.js --apply         copy + repoint + delete old
//   node scripts/migrate-storage-layout.js --apply --keep-old   copy + repoint, leave old objects
//   node scripts/migrate-storage-layout.js --only MediaAsset    one collection
//
// Safe to stop and re-run at any point. For each file, in this order:
//   1. server-side COPY old key → new key   (skipped if the new object already exists)
//   2. repoint the database row, CONDITIONAL on it still holding the old key
//   3. delete the old object — only if step 2 actually changed the row
// A crash between steps leaves at worst a duplicate object, never a row pointing
// at a missing file. Nothing is needed before or after: the app reads every key
// from the database and accepts both layouts.
//
// The id already embedded in a legacy key is kept as-is. Readers check ownership
// against that same id (e.g. email template attachments use the template owner's
// id), so re-parenting it here would make them refuse their own files.
//
// A mapping of every move is written to scripts/backups/ (gitignored).

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const storage = require('../src/services/storageService');
const { tenantKey, supportKey, AREAS } = require('../src/services/storageKeys');

const APPLY = process.argv.includes('--apply');
const KEEP_OLD = process.argv.includes('--keep-old');
const onlyIdx = process.argv.indexOf('--only');
const ONLY = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;

const ID = '([a-f\\d]{24})';
const REST = '(.+)';

// Each job: which rows, how to read the key(s), how to map a legacy key, and
// how to repoint one key on one row atomically.
const JOBS = [
    {
        name: 'MediaAsset',
        model: () => require('../src/models/MediaAsset'),
        filter: { storageKey: { $regex: `^${ID}/` } },
        keysOf: (row) => [row.storageKey],
        map: (key) => {
            const m = new RegExp(`^${ID}/([^/]+)$`, 'i').exec(key);
            return m && tenantKey(m[1], AREAS.MEDIA_LIBRARY, m[2]);
        },
        repoint: (Model, row, from, to) => Model.updateOne(
            { _id: row._id, storageKey: from },
            { $set: { storageKey: to, publicUrl: null } }
        )
    },
    {
        name: 'LeadDocument',
        model: () => require('../src/models/LeadDocument'),
        filter: { storageKey: { $regex: '^lead-docs/' } },
        keysOf: (row) => [row.storageKey],
        map: (key) => {
            const m = new RegExp(`^lead-docs/${ID}/${ID}/([^/]+)$`, 'i').exec(key);
            return m && tenantKey(m[1], AREAS.LEAD_DOCS, m[2], m[3]);
        },
        repoint: (Model, row, from, to) => Model.updateOne({ _id: row._id, storageKey: from }, { $set: { storageKey: to } })
    },
    {
        name: 'KnowledgeDocument',
        model: () => require('../src/models/KnowledgeDocument'),
        filter: { storageKey: { $regex: '^knowledge-base/' } },
        keysOf: (row) => [row.storageKey],
        map: (key) => {
            const m = new RegExp(`^knowledge-base/${ID}/([^/]+)$`, 'i').exec(key);
            return m && tenantKey(m[1], AREAS.KNOWLEDGE_BASE, m[2]);
        },
        repoint: (Model, row, from, to) => Model.updateOne({ _id: row._id, storageKey: from }, { $set: { storageKey: to } })
    },
    {
        name: 'WhatsAppMessage',
        model: () => require('../src/models/WhatsAppMessage'),
        filter: { 'content.storageKey': { $regex: '^wa-inbound/' } },
        keysOf: (row) => [row.content?.storageKey],
        map: (key) => {
            const m = new RegExp(`^wa-inbound/${ID}/([^/]+)$`, 'i').exec(key);
            return m && tenantKey(m[1], AREAS.WHATSAPP_INBOUND, m[2]);
        },
        repoint: (Model, row, from, to) => Model.updateOne(
            { _id: row._id, 'content.storageKey': from },
            { $set: { 'content.storageKey': to } }
        )
    },
    {
        name: 'EmailMessage',
        model: () => require('../src/models/EmailMessage'),
        filter: { 'attachments.storageKey': { $regex: '^email-inbound/' } },
        keysOf: (row) => (row.attachments || []).map(a => a?.storageKey),
        map: (key) => {
            const m = new RegExp(`^email-inbound/${ID}/${REST}$`, 'i').exec(key);
            return m && tenantKey(m[1], AREAS.EMAIL_INBOUND, ...m[2].split('/'));
        },
        repoint: (Model, row, from, to) => Model.updateOne(
            { _id: row._id, 'attachments.storageKey': from },
            { $set: { 'attachments.$.storageKey': to } }
        )
    },
    {
        name: 'EmailTemplate',
        model: () => require('../src/models/EmailTemplate'),
        filter: { 'attachments.storageKey': { $regex: '^email-attachments/' } },
        keysOf: (row) => (row.attachments || []).map(a => a?.storageKey),
        map: (key) => {
            const m = new RegExp(`^email-attachments/${ID}/([^/]+)$`, 'i').exec(key);
            return m && tenantKey(m[1], AREAS.EMAIL_ATTACHMENTS, m[2]);
        },
        repoint: (Model, row, from, to) => Model.updateOne(
            { _id: row._id, 'attachments.storageKey': from },
            { $set: { 'attachments.$.storageKey': to } }
        )
    },
    {
        name: 'SupportMessage',
        model: () => require('../src/models/SupportMessage'),
        filter: { 'attachments.storageKey': { $regex: '^support/' } },
        keysOf: (row) => (row.attachments || []).map(a => a?.storageKey),
        map: (key) => {
            const m = /^support\/([^/]+)\/([^/]+)$/.exec(key);
            return m && supportKey(m[1], m[2]);
        },
        repoint: (Model, row, from, to) => Model.updateOne(
            { _id: row._id, 'attachments.storageKey': from },
            { $set: { 'attachments.$.storageKey': to } }
        )
    }
];

async function runJob(job, report) {
    const Model = job.model();
    const stats = { rows: 0, keys: 0, copied: 0, alreadyCopied: 0, repointed: 0, oldDeleted: 0, skipped: 0, failed: 0 };
    const cursor = Model.find(job.filter).lean().cursor();

    for await (const row of cursor) {
        stats.rows++;
        for (const from of job.keysOf(row)) {
            if (typeof from !== 'string' || !from) continue;
            let to;
            try { to = job.map(from); } catch { to = null; }
            if (!to || to === from) {
                stats.skipped++;
                report.skipped.push({ collection: job.name, id: String(row._id), key: from });
                continue;
            }
            stats.keys++;
            if (!APPLY) continue;

            try {
                if (await storage.objectExists(to)) {
                    stats.alreadyCopied++;
                } else if (await storage.objectExists(from)) {
                    await storage.copyObject(from, to);
                    stats.copied++;
                } else {
                    // The row points at nothing — don't invent a new broken pointer.
                    stats.failed++;
                    report.missing.push({ collection: job.name, id: String(row._id), key: from });
                    continue;
                }

                const res = await job.repoint(Model, row, from, to);
                if ((res.modifiedCount ?? res.nModified ?? 0) > 0) {
                    stats.repointed++;
                    report.moved.push({ collection: job.name, id: String(row._id), from, to });
                    if (!KEEP_OLD) {
                        if (await storage.deleteObject(from)) stats.oldDeleted++;
                    }
                }
            } catch (err) {
                stats.failed++;
                report.errors.push({ collection: job.name, id: String(row._id), key: from, error: err.message });
            }
        }
    }
    return stats;
}

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGO_URI is not set in .env - cannot connect.');
        process.exit(1);
    }
    if (APPLY && storage.DRIVER !== 'r2') {
        console.error('R2 is not configured — refusing to --apply against the local disk driver.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log(`Connected — ${APPLY ? `APPLY${KEEP_OLD ? ' (keeping old objects)' : ''}` : 'DRY RUN (no writes)'}\n`);

    const report = { startedAt: new Date().toISOString(), apply: APPLY, keepOld: KEEP_OLD, moved: [], skipped: [], missing: [], errors: [] };
    let totalFailed = 0;

    for (const job of JOBS) {
        if (ONLY && job.name !== ONLY) continue;
        const s = await runJob(job, report);
        totalFailed += s.failed;
        console.log(
            `${job.name.padEnd(18)} rows ${String(s.rows).padStart(6)}  legacy keys ${String(s.keys).padStart(6)}` +
            (APPLY ? `  copied ${s.copied}  already ${s.alreadyCopied}  repointed ${s.repointed}  old deleted ${s.oldDeleted}` : '') +
            `  skipped ${s.skipped}  failed ${s.failed}`
        );
    }

    const dir = path.resolve(__dirname, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `storage-layout-${APPLY ? 'apply' : 'dryrun'}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\nReport: ${file}`);
    if (!APPLY) console.log('Dry run only. Re-run with --apply to move the files.');

    await mongoose.disconnect();
    process.exit(totalFailed ? 2 : 0);
}

main().catch(async (err) => {
    console.error('Migration failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
