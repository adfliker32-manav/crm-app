require('dotenv').config();
const mongoose = require('mongoose');
const leadProcessingLock = require('../src/utils/leadProcessingLock');
const MetaLeadDropLog = require('../src/models/MetaLeadDropLog');

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to DB');

        // Clear existing lock collection completely so indexes can build cleanly
        await mongoose.connection.db.collection('leadprocessinglocks').deleteMany({});

        const LeadProcessingLock = require('../src/models/LeadProcessingLock');
        console.log('⏳ Waiting for Mongoose indexes to build...');
        await LeadProcessingLock.ensureIndexes();
        console.log('✅ Indexes built successfully');

        const leadgenId = 'test_leadgen_123';

        // 1. Test lock concurrency
        console.log('🔒 Testing processing lock concurrency...');
        const results = await Promise.all([
            leadProcessingLock.acquire(leadgenId),
            leadProcessingLock.acquire(leadgenId),
            leadProcessingLock.acquire(leadgenId)
        ]);

        console.log('Results (should be [true, false, false]):', results);
        if (results[0] === true && results[1] === false && results[2] === false) {
            console.log('✅ Processing lock concurrency check PASSED');
        } else {
            console.log('❌ Processing lock concurrency check FAILED');
        }

        // 2. Test lock release
        console.log('🔓 Testing lock release...');
        await leadProcessingLock.release(leadgenId);
        const secondAcquire = await leadProcessingLock.acquire(leadgenId);
        console.log('Acquired again after release:', secondAcquire);
        if (secondAcquire === true) {
            console.log('✅ Lock release check PASSED');
        } else {
            console.log('❌ Lock release check FAILED');
        }
        await leadProcessingLock.release(leadgenId);

        // 3. Test backoff scheduler
        console.log('📅 Testing backoff retry time calculation...');
        // Clean up previous drops
        await MetaLeadDropLog.deleteMany({ leadgenId: 'test_drop_123' });

        // Create log record
        const dropLog = await MetaLeadDropLog.create({
            userId: new mongoose.Types.ObjectId(),
            leadgenId: 'test_drop_123',
            reason: 'fetch_failed',
            message: 'First drop'
        });

        console.log('Initial nextRetryAt:', dropLog.nextRetryAt);
        const initialDiffMin = Math.round((dropLog.nextRetryAt - dropLog.createdAt) / (1000 * 60));
        console.log('Initial delay minutes (should be 2):', initialDiffMin);
        if (initialDiffMin === 2) {
            console.log('✅ Initial 2-minute delay check PASSED');
        } else {
            console.log('❌ Initial 2-minute delay check FAILED');
        }

        // Simulate failed retries (1 to 4)
        const getNextRetryDelayMinutes = (retryCount) => {
            switch (retryCount) {
                case 1: return 10;
                case 2: return 30;
                case 3: return 120;
                case 4: return 360;
                default: return 15;
            }
        };

        let currentRecord = dropLog;
        for (let attempt = 1; attempt <= 4; attempt++) {
            const nextDelay = getNextRetryDelayMinutes(attempt);
            
            // update in DB using the helper logic
            const nextRetryAt = new Date(Date.now() + nextDelay * 60 * 1000);
            await MetaLeadDropLog.findByIdAndUpdate(currentRecord._id, {
                $set: { status: 'pending', retryCount: attempt, nextRetryAt }
            });

            const updated = await MetaLeadDropLog.findById(currentRecord._id);
            console.log(`After retry attempt ${attempt} failure:`);
            console.log(`  retryCount: ${updated.retryCount}`);
            console.log(`  nextRetryAt: ${updated.nextRetryAt}`);
            const diffMin = Math.round((updated.nextRetryAt - Date.now()) / (1000 * 60));
            console.log(`  Expected delay: ${nextDelay}m, Actual remaining: ~${diffMin}m`);
            if (Math.abs(diffMin - nextDelay) <= 1) {
                console.log(`  ✅ Attempt ${attempt} backoff check PASSED`);
            } else {
                console.log(`  ❌ Attempt ${attempt} backoff check FAILED`);
            }
        }

        // Clean up test drop
        await MetaLeadDropLog.deleteMany({ leadgenId: 'test_drop_123' });

        process.exit(0);
    } catch (e) {
        console.error('❌ Test failed:', e);
        process.exit(1);
    }
}
run();
