// Regression: the inbound-conversation upsert must never touch the same path in
// both $set and $setOnInsert.
//
// MongoDB validates an update document STATICALLY, before it decides insert vs
// update, so a path present in both operators throws
//   MongoServerError: Updating the path 'assignedTo' would create a conflict at 'assignedTo'
// even when only one of the two could ever apply. In production this killed
// processIncomingMessage outright: the message was never stored, and because the
// payload is rebuilt identically on every BullMQ retry, the job failed forever.
// Symptom is total inbound loss while outbound still works.
//
// Four backfills in that function ($set) target paths $setOnInsert also declares:
// waBsuid, phone, leadId, assignedTo. This suite asserts the de-conflict step
// exists, runs before the upsert, and covers every such path.
//
// Source-assertion rather than runtime: the payload is built inline inside a
// ~400-line function with Meta webhook I/O around it, and the failure is a
// property of the update DOCUMENT, not of any return value. Verified to fail
// against the pre-fix file.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CONTROLLER = path.join(__dirname, '..', '..', 'src', 'controllers', 'whatsappWebhookController.js');
const src = fs.readFileSync(CONTROLLER, 'utf8');

// Narrow to the upsert region: from the updatePayload literal to the
// findOneAndUpdate that sends it.
function upsertRegion() {
    const start = src.indexOf('const updatePayload = {');
    assert.ok(start !== -1, 'updatePayload literal not found — did the upsert get renamed?');
    const end = src.indexOf('WhatsAppConversation.findOneAndUpdate', start);
    assert.ok(end !== -1, 'findOneAndUpdate not found after updatePayload');
    return { start, end, text: src.slice(start, end) };
}

describe('inbound conversation upsert — $set / $setOnInsert path conflict', () => {

    test('the de-conflict loop exists and runs BEFORE the upsert', () => {
        const { text } = upsertRegion();

        const hasLoop = /for\s*\(\s*const\s+key\s+of\s+Object\.keys\(\s*updatePayload\.\$set\s*\)\s*\)/.test(text);
        assert.ok(hasLoop, 'no loop over updatePayload.$set keys before findOneAndUpdate');

        const deletes = /delete\s+updatePayload\.\$setOnInsert\[\s*key\s*\]/.test(text);
        assert.ok(deletes, 'the loop does not delete the conflicting $setOnInsert key');

        const guarded = /if\s*\(\s*key\s+in\s+updatePayload\.\$setOnInsert\s*\)/.test(text);
        assert.ok(guarded, 'the delete is not guarded by an "in $setOnInsert" check');
    });

    test('every $set backfill path is declared in $setOnInsert (so the loop must cover it)', () => {
        const { text } = upsertRegion();

        // Paths written dynamically onto $set after the literal.
        const setPaths = [...text.matchAll(/updatePayload\.\$set\.([A-Za-z0-9_]+)\s*=/g)].map(m => m[1]);
        assert.ok(setPaths.length >= 4, `expected the known backfills, found ${setPaths.length}`);

        // The $setOnInsert literal block.
        const soiMatch = text.match(/\$setOnInsert:\s*\{([\s\S]*?)\n\s*\},/);
        assert.ok(soiMatch, '$setOnInsert block not found');
        const soiKeys = [...soiMatch[1].matchAll(/^\s*'?([A-Za-z0-9_.]+)'?\s*:/gm)].map(m => m[1]);

        // These four are the documented conflict set. If a future edit adds a new
        // backfill on a $setOnInsert path, it is covered by the loop automatically —
        // this assertion just pins the known ones so the loop is never dropped.
        for (const p of ['waBsuid', 'phone', 'leadId', 'assignedTo']) {
            assert.ok(setPaths.includes(p), `backfill for '${p}' disappeared — update this test`);
            assert.ok(soiKeys.includes(p), `'${p}' no longer in $setOnInsert — conflict set changed`);
        }
    });

    test('the E11000 retry path never sends $setOnInsert', () => {
        // The retry runs after a concurrent insert won, so the document exists and
        // insert-only fields must not be replayed.
        const retryStart = src.indexOf('E11000 on conversation upsert');
        assert.ok(retryStart !== -1, 'E11000 retry branch not found');
        const retry = src.slice(retryStart, retryStart + 700);
        assert.ok(!retry.includes('$setOnInsert'), 'E11000 retry must not include $setOnInsert');
    });

    test('the de-conflict loop mirrors MongoDB semantics on a representative payload', () => {
        // Reproduces the exact shape the controller builds when all four backfills
        // fire, then applies the same loop, and asserts the result is a legal
        // MongoDB update document (no path in both operators).
        const payload = {
            $setOnInsert: {
                userId: 'T', waContactId: '9194', phone: '9194', waBsuid: 'B',
                leadId: 'L', assignedTo: 'A', initiatedBy: 'customer',
                'metadata.firstMessageAt': 'ts'
            },
            $set: {
                lastMessage: 'Hello', lastMessageAt: 'ts', status: 'active',
                waBsuid: 'B', phone: '9194', leadId: 'L', assignedTo: 'A'
            },
            $inc: { unreadCount: 1 }
        };

        for (const key of Object.keys(payload.$set)) {
            if (key in payload.$setOnInsert) delete payload.$setOnInsert[key];
        }

        const overlap = Object.keys(payload.$set).filter(k => k in payload.$setOnInsert);
        assert.deepStrictEqual(overlap, [], `paths still in both operators: ${overlap.join(', ')}`);

        // The insert-only identity fields must survive — dropping them would break
        // genuine inserts.
        for (const k of ['userId', 'waContactId', 'initiatedBy', 'metadata.firstMessageAt']) {
            assert.ok(k in payload.$setOnInsert, `insert-only field '${k}' was wrongly stripped`);
        }
    });
});
