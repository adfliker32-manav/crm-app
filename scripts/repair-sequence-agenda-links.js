/**
 * Re-link SequenceEnrollment.agendaJobId for enrollments stranded by the
 * "Unsupported BSON version" crash, and optionally re-derive Sequence.enrollmentCount.
 *
 * WHY THIS EXISTS
 *   SequenceEnrollment.agendaJobId used to be Schema.Types.Mixed. Agenda bundles its
 *   own mongodb@4 (bson 4) while Mongoose 9 uses bson 7, so the ObjectId returned by
 *   agenda.schedule() carried the wrong BSON version stamp. A typed path re-casts such
 *   a value; Mixed passed it straight to the bson 7 serializer, which threw
 *   "Unsupported BSON version, bson types must be from bson 7.x.x".
 *
 *   The throw landed in scheduleStepJob AFTER agenda.schedule() had already persisted
 *   the job, so those enrollments are NOT dead — their next step still fires. What they
 *   lost is the back-reference: with agendaJobId null, pauseLeadSequences() and
 *   deleteSequence() cannot cancel the pending job, so a lead who replies keeps
 *   receiving the rest of the sequence. That is what this script repairs.
 *
 *   Manual enrolments additionally 500'd after the row was written, so
 *   Sequence.enrollmentCount was never incremented for them (--recount fixes that).
 *
 * USAGE
 *   node scripts/repair-sequence-agenda-links.js --dry-run     # report only, no writes
 *   node scripts/repair-sequence-agenda-links.js               # re-link agendaJobId
 *   node scripts/repair-sequence-agenda-links.js --recount     # also re-derive enrollmentCount
 *
 * WHAT IT DOES
 *   Finds active enrollments with agendaJobId null but nextStepAt set — the exact
 *   fingerprint of the crash, since nextStepAt is written one line before the throw —
 *   looks up the real job in the agendaJobs collection by data.enrollmentId, and
 *   restores the link. Nothing is cancelled, deleted or rescheduled.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *   It does not touch enrollments where nextStepAt is also null. Those were never
 *   scheduled at all (Agenda was not running when they were created), so there is no
 *   job to link; inventing one would double-send. They are reported, not modified.
 *
 * SAFETY
 *   - Idempotent. It only fills in a null back-reference to a job that already exists,
 *     so a second run changes nothing.
 *   - --dry-run performs no writes at all.
 *   - Reads agendaJobs through mongoose's own driver, never Agenda's, so no bson-4
 *     value can enter the process.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Sequence = require('../src/models/Sequence');
const SequenceEnrollment = require('../src/models/SequenceEnrollment');

const isDryRun = process.argv.includes('--dry-run');
const doRecount = process.argv.includes('--recount');

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGO_URI is not set in .env - cannot connect.');
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log('Connected' + (isDryRun ? '  (DRY RUN - no writes)' : '') + '\n');

    const jobsCol = mongoose.connection.db.collection('agendaJobs');

    // ── 1. Re-link agendaJobId ──────────────────────────────────────────────
    const stranded = await SequenceEnrollment.find({
        status: 'active',
        agendaJobId: null,
        nextStepAt: { $ne: null }
    }).select('_id sequenceId leadId nextStepAt').lean();

    const neverScheduled = await SequenceEnrollment.countDocuments({
        status: 'active',
        agendaJobId: null,
        nextStepAt: null
    });

    console.log(`Active enrollments missing their job link : ${stranded.length}`);
    console.log(`Active enrollments never scheduled at all : ${neverScheduled}  (left untouched)\n`);

    let relinked = 0;
    let noJob = 0;

    for (const e of stranded) {
        // Prefer a job that has not run yet; fall back to the most recent match.
        const job =
            (await jobsCol.findOne({
                name: 'PROCESS_SEQUENCE_STEP',
                'data.enrollmentId': String(e._id),
                lastRunAt: null
            })) ||
            (await jobsCol.findOne(
                { name: 'PROCESS_SEQUENCE_STEP', 'data.enrollmentId': String(e._id) },
                { sort: { nextRunAt: -1 } }
            ));

        if (!job) {
            noJob++;
            console.log(`  - enrollment ${e._id}: no agendaJobs row (already ran or purged) - skipped`);
            continue;
        }

        if (!isDryRun) {
            await SequenceEnrollment.updateOne({ _id: e._id }, { $set: { agendaJobId: job._id } });
        }
        relinked++;
        console.log(`  + enrollment ${e._id} -> job ${job._id}  (next run ${job.nextRunAt ? job.nextRunAt.toISOString() : 'n/a'})`);
    }

    console.log(`\nRe-linked: ${relinked}   No job found: ${noJob}`);

    // ── 2. Optional: re-derive enrollmentCount ──────────────────────────────
    if (doRecount) {
        console.log('\nRe-deriving Sequence.enrollmentCount from actual enrollments...');
        const seqs = await Sequence.find({}).select('_id name enrollmentCount').lean();
        let fixed = 0;

        for (const s of seqs) {
            const actual = await SequenceEnrollment.countDocuments({ sequenceId: s._id });
            if (actual === (s.enrollmentCount || 0)) continue;

            if (!isDryRun) {
                await Sequence.updateOne({ _id: s._id }, { $set: { enrollmentCount: actual } });
            }
            fixed++;
            console.log(`  ~ "${s.name}": ${s.enrollmentCount || 0} -> ${actual}`);
        }
        console.log(`enrollmentCount corrected on ${fixed} sequence(s).`);
    } else {
        console.log('\n(enrollmentCount not touched - pass --recount to re-derive it.)');
    }

    console.log('\n' + (isDryRun ? 'DRY RUN - no writes were performed.' : 'Repair complete.'));
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Repair failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
