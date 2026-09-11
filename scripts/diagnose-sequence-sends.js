/**
 * Explain, per step, why a sequence would or would not actually send.
 *
 * WHY THIS EXISTS
 *   "The email went out but the WhatsApp did not" has several causes that all
 *   look identical from the Sequences screen, and only one of them is a failure:
 *
 *     1. The channel is switched off for that sequence, so its content is stored
 *        but never sent. A sequence saved before the switches existed has them
 *        unset, and each of its steps still sends only its own single type —
 *        opening it in the builder and saving switches both channels on.
 *     2. The WhatsApp template is no longer APPROVED in this workspace, so the
 *        send is refused before it reaches Meta.
 *     3. The lead has no phone number.
 *
 *   The engine now writes 2 and 3 to the lead's history, but that only helps
 *   AFTER the next send. This tells you before.
 *
 * USAGE
 *   node scripts/diagnose-sequence-sends.js --email owner@example.com
 *   node scripts/diagnose-sequence-sends.js --tenant <userId>
 *   node scripts/diagnose-sequence-sends.js --tenant <userId> --sequence "Welcome series"
 *
 * SAFETY
 *   Read-only. It performs no writes of any kind and sends no messages.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Sequence = require('../src/models/Sequence');
const SequenceEnrollment = require('../src/models/SequenceEnrollment');
const WhatsAppTemplate = require('../src/models/WhatsAppTemplate');
const EmailTemplate = require('../src/models/EmailTemplate');
const User = require('../src/models/User');

const argAfter = (flag) => {
    const i = process.argv.indexOf(flag);
    return i !== -1 ? process.argv[i + 1] : null;
};

const onlyTenant = argAfter('--tenant');
const onlyEmail = argAfter('--email');
const onlySequence = argAfter('--sequence');

const OK = '  OK  ';
const BAD = ' STOP ';
const WARN = ' NOTE ';

async function main() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error('MONGO_URI is not set in .env - cannot connect.');
        process.exit(1);
    }
    await mongoose.connect(uri);

    let tenantId = onlyTenant;
    if (onlyEmail) {
        const owner = await User.findOne({ email: String(onlyEmail).toLowerCase().trim() }).select('_id email').lean();
        if (!owner) {
            console.error('No user with email ' + onlyEmail);
            process.exit(1);
        }
        tenantId = owner._id;
    }
    if (!tenantId) {
        console.error('Pass --tenant <userId> or --email <owner email>.');
        process.exit(1);
    }

    const seqFilter = { tenantId };
    if (onlySequence) seqFilter.name = onlySequence;

    const sequences = await Sequence.find(seqFilter).sort({ createdAt: -1 }).lean();
    if (!sequences.length) {
        console.log('No sequences found for this workspace.');
        await mongoose.disconnect();
        return;
    }

    // One query for every WhatsApp template this workspace has.
    const waTemplates = await WhatsAppTemplate.find({ userId: tenantId })
        .select('name status language').lean();
    const waByName = new Map(waTemplates.map(t => [t.name, t]));

    console.log(`\nWorkspace ${tenantId} — ${sequences.length} sequence(s), ${waTemplates.length} WhatsApp template(s) in CRM\n`);

    for (const seq of sequences) {
        const counts = await SequenceEnrollment.aggregate([
            { $match: { sequenceId: seq._id } },
            { $group: { _id: '$status', n: { $sum: 1 } } }
        ]);
        const countLine = counts.length
            ? counts.map(c => `${c._id}: ${c.n}`).join(', ')
            : 'no enrollments yet';

        const legacyChannels = seq.sendWhatsApp === null || seq.sendWhatsApp === undefined;
        const waOn = legacyChannels ? null : seq.sendWhatsApp === true;
        const emailOn = legacyChannels ? null : seq.sendEmail === true;

        console.log('─'.repeat(78));
        console.log(`${seq.name}   [${seq.isActive ? 'ACTIVE' : 'INACTIVE'}]  trigger: ${seq.trigger}`);
        console.log(`  enrollments — ${countLine}`);
        console.log(legacyChannels
            ? `${WARN} channels: not set (saved before the channel switches). Each step sends only `
              + `its own type. Open the sequence and save it to switch both channels on.`
            : `  channels — WhatsApp: ${waOn ? 'ON' : 'off'}, Email: ${emailOn ? 'ON' : 'off'}`);
        if (!legacyChannels && !waOn && !emailOn) {
            console.log(`${BAD} both channels are switched off - this sequence sends nothing at all`);
        }

        if (!seq.isActive) {
            console.log(`${BAD} the sequence is switched off: due steps are held until it is switched back on`);
        }

        const steps = seq.steps || [];
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const action = step.action || {};
            const hasWa = !!action.templateId;
            const hasEmail = !!(action.emailTemplateId || String(action.subject || '').trim());

            // The same rule the engine uses (resolveStepChannels): a switched-on
            // channel sends only if the step has content for it, and a sequence saved
            // before the switches falls back to the step's own type.
            const sendsWa = legacyChannels ? (action.type === 'SEND_WHATSAPP' && hasWa) : (waOn && hasWa);
            const sendsEmail = legacyChannels ? (action.type === 'SEND_EMAIL' && hasEmail) : (emailOn && hasEmail);
            const label = [sendsWa && 'WHATSAPP', sendsEmail && 'EMAIL'].filter(Boolean).join(' + ') || 'NOTHING';

            console.log(`\n  Step ${i + 1}  (wait ${step.delayHours || 0}h)  SENDS: ${label}`);
            if (label === 'NOTHING') {
                console.log(`${BAD} this step sends nothing - no content for any switched-on channel`);
            }

            if (sendsWa) {
                const name = action.templateId;
                if (!name) {
                    console.log(`${BAD} no WhatsApp template on this step - nothing can be sent`);
                } else {
                    const tpl = waByName.get(name);
                    if (!tpl) {
                        console.log(`${WARN} template "${name}" is not in the CRM (never synced, or renamed at Meta).`);
                        console.log(`       The send is attempted anyway, so Meta decides - re-sync templates to be sure.`);
                    } else if (tpl.status !== 'APPROVED') {
                        console.log(`${BAD} template "${name}" is ${tpl.status}, not APPROVED - every send is refused.`);
                        console.log(`       THIS IS THE USUAL REASON WHATSAPP STEPS GO QUIET WHILE EMAIL STEPS WORK.`);
                        console.log(`       Get it approved in Meta, re-sync templates, then re-enrol the lead.`);
                    } else {
                        console.log(`${OK} template "${name}" is APPROVED (language ${tpl.language || 'unset'})`);
                    }
                }

                if (hasEmail && !sendsEmail) {
                    console.log(`${WARN} this step has email content saved but is NOT sending it.`);
                    console.log(`       ${legacyChannels
                        ? 'Open the sequence and save it to switch the Email channel on.'
                        : 'Switch on Email at the top of the sequence to send both together.'}`);
                }
            }

            if (sendsEmail) {
                if (action.emailMode === 'template' || (!action.emailMode && action.emailTemplateId)) {
                    const tpl = action.emailTemplateId
                        ? await EmailTemplate.findOne({ _id: action.emailTemplateId, userId: tenantId }).select('name subject').lean()
                        : null;
                    console.log(tpl
                        ? `${OK} email template "${tpl.name}" resolves`
                        : `${BAD} the chosen email template is missing - it falls back to the subject saved on the step`);
                } else if (!action.subject) {
                    console.log(`${BAD} custom email with no subject - the step throws before sending`);
                } else {
                    console.log(`${OK} custom email, subject "${String(action.subject).slice(0, 50)}"`);
                }

                if (hasWa && !sendsWa) {
                    console.log(`${WARN} this step has the WhatsApp template "${action.templateId}" saved but is NOT sending it.`);
                    console.log(`       ${legacyChannels
                        ? 'Open the sequence and save it to switch the WhatsApp channel on.'
                        : 'Switch on WhatsApp at the top of the sequence to send both together.'}`);
                }
            }
        }
        console.log('');
    }

    console.log('─'.repeat(78));
    console.log('Read-only: nothing was changed and no messages were sent.\n');
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error('Diagnosis failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
});
