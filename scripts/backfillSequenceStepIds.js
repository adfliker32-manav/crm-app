/**
 * Give every existing sequence step a stable stepId, point in-flight enrollments
 * at the step they are actually on, and clear the way for the new unique index.
 *
 * WHY THIS EXISTS
 *   Enrollments used to remember their position in a sequence as an ARRAY INDEX.
 *   Insert, delete or reorder a step in a live sequence and every lead mid-flight
 *   silently slid onto a different message. Steps now carry
 *   Sequence.steps[].stepId and enrollments track SequenceEnrollment.currentStepId
 *   plus processedStepIds, so position is re-derived from identity on every send.
 *
 *   New rows get all of this automatically. Rows already in the database do not:
 *   until this runs, existing enrollments fall back to the old index lookup (the
 *   engine handles that deliberately — see resolveStepToRun), which means they
 *   keep the old shifting behaviour.
 *
 *   It also creates SequenceEnrollment's uniq_active_enrollment index, which
 *   cannot build while duplicate active enrollments exist — so it cancels the
 *   duplicates first.
 *
 * USAGE
 *   node scripts/backfillSequenceStepIds.js --dry-run     # report only, no writes
 *   node scripts/backfillSequenceStepIds.js               # apply
 *   node scripts/backfillSequenceStepIds.js --tenant <userId>
 *
 * WHAT IT DOES
 *   1. Every Sequence step missing a stepId gets one (existing ids are kept).
 *   2. Every active/paused enrollment gets currentStepId = the step at its current
 *      index, and processedStepIds = every step before it — i.e. exactly the
 *      history the index implied, so nothing is re-sent and nothing is skipped.
 *   3. Duplicate ACTIVE enrollments for the same (sequence, lead) are cancelled,
 *      oldest kept. These are the ones that were double-sending every step.
 *   4. syncIndexes() on SequenceEnrollment to build uniq_active_enrollment.
 *
 * SAFETY
 *   - Idempotent: a second run finds nothing to do.
 *   - --dry-run performs no writes and still reports the duplicate set.
 *   - Cancelling a duplicate does not message anyone; it stops the extra copy.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Sequence = require('../src/models/Sequence');
const SequenceEnrollment = require('../src/models/SequenceEnrollment');
const User = require('../src/models/User');

const isDryRun = process.argv.includes('--dry-run');

const argAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};
const onlyTenant = argAfter('--tenant');

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGO_URI is not set in .env - cannot connect.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected' + (isDryRun ? '  (DRY RUN - no writes)' : '') + '\n');

    const seqFilter = {};
    if (onlyTenant) {
        const owner = await User.findById(onlyTenant).select('_id').lean();
        if (!owner) {
            console.error('No user with id ' + onlyTenant);
            process.exit(1);
        }
        seqFilter.tenantId = owner._id;
        console.log('Scoped to tenant ' + onlyTenant + '\n');
    }

    // ── 1. stepIds ──────────────────────────────────────────────────────────
    const sequences = await Sequence.find(seqFilter).lean();
    let seqTouched = 0;
    let stepsStamped = 0;
    const stepIdsBySequence = new Map();

    for (const seq of sequences) {
        const steps = seq.steps || [];
        let changed = false;
        const stamped = steps.map((step) => {
            if (step.stepId) return step;
            changed = true;
            stepsStamped++;
            return { ...step, stepId: new mongoose.Types.ObjectId().toString() };
        });

        stepIdsBySequence.set(String(seq._id), stamped.map(s => s.stepId));

        if (changed) {
            seqTouched++;
            if (!isDryRun) {
                await Sequence.updateOne({ _id: seq._id }, { $set: { steps: stamped } });
            }
        }
    }
    console.log(`Sequences: ${sequences.length} scanned, ${seqTouched} updated, ${stepsStamped} steps stamped`);

    // ── 2. point live enrollments at a step id ──────────────────────────────
    const liveFilter = { status: { $in: ['active', 'paused'] } };
    if (onlyTenant) liveFilter.tenantId = seqFilter.tenantId;

    const live = await SequenceEnrollment.find(liveFilter).lean();
    let enrolTouched = 0;
    let enrolOrphaned = 0;

    for (const row of live) {
        if (row.currentStepId) continue;   // already migrated

        const ids = stepIdsBySequence.get(String(row.sequenceId));
        if (!ids) { enrolOrphaned++; continue; }   // sequence gone; the engine cancels it on the next firing

        const idx = Math.max(0, Number(row.currentStep) || 0);
        const currentStepId = ids[idx] || null;
        // Everything before the current index is, by definition, what this lead
        // has already been through.
        const processedStepIds = ids.slice(0, idx).filter(Boolean);

        enrolTouched++;
        if (!isDryRun) {
            await SequenceEnrollment.updateOne(
                { _id: row._id },
                { $set: { currentStepId, processedStepIds } }
            );
        }
    }
    console.log(
        `Enrollments: ${live.length} live, ${enrolTouched} given a step id` +
        (enrolOrphaned ? `, ${enrolOrphaned} skipped (sequence deleted)` : '')
    );

    // ── 3. duplicate active enrollments ─────────────────────────────────────
    const dupeMatch = { status: 'active' };
    if (onlyTenant) dupeMatch.tenantId = seqFilter.tenantId;

    const dupes = await SequenceEnrollment.aggregate([
        { $match: { ...dupeMatch, deletedAt: null } },
        { $sort: { enrolledAt: 1, _id: 1 } },
        { $group: {
            _id: { sequenceId: '$sequenceId', leadId: '$leadId' },
            ids: { $push: '$_id' },
            count: { $sum: 1 }
        } },
        { $match: { count: { $gt: 1 } } }
    ]);

    const losers = dupes.flatMap(d => d.ids.slice(1));   // keep the oldest
    if (losers.length) {
        console.log(`Duplicate active enrollments: ${dupes.length} lead/sequence pairs, cancelling ${losers.length} extra rows`);
        for (const d of dupes.slice(0, 10)) {
            console.log(`   lead ${d._id.leadId} in sequence ${d._id.sequenceId}: ${d.count} active rows`);
        }
        if (dupes.length > 10) console.log(`   … and ${dupes.length - 10} more`);

        if (!isDryRun) {
            await SequenceEnrollment.updateMany(
                { _id: { $in: losers } },
                { $set: { status: 'cancelled', lastError: 'duplicate active enrollment, cancelled by backfill' } }
            );
        }
    } else {
        console.log('Duplicate active enrollments: none');
    }

    // ── 4. build the indexes ────────────────────────────────────────────────
    if (!isDryRun) {
        await SequenceEnrollment.syncIndexes();
        console.log('Indexes synced (uniq_active_enrollment is now enforced by the database)');
    } else {
        console.log('Indexes: skipped in dry run');
    }

    console.log('\n' + (isDryRun ? 'DRY RUN - no writes were performed.' : 'Backfill complete.'));
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Backfill failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
