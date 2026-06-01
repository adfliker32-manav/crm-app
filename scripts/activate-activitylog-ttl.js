// One-time fix — adds expireAfterSeconds to the existing timestamp_1 index
// on activitylogs via collMod (non-destructive, no index rebuild).
// MongoDB's TTL monitor will then auto-delete docs older than 90 days.
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

const NINETY_DAYS_SECONDS = 90 * 24 * 60 * 60;

(async () => {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    // Snapshot before
    const before = await db.collection('activitylogs').countDocuments();
    console.log(`Before: ${before} activitylogs`);

    // Apply TTL to the existing { timestamp: 1 } index
    const result = await db.command({
        collMod: 'activitylogs',
        index: {
            keyPattern: { timestamp: 1 },
            expireAfterSeconds: NINETY_DAYS_SECONDS
        }
    });
    console.log('\ncollMod result:', JSON.stringify(result, null, 2));

    // Verify
    const indexes = await db.collection('activitylogs').indexes();
    const tsIndex = indexes.find(i => i.name === 'timestamp_1');
    console.log('\nUpdated index:', JSON.stringify(tsIndex, null, 2));

    if (tsIndex.expireAfterSeconds === NINETY_DAYS_SECONDS) {
        console.log(`\n✓ TTL is now active. MongoDB's TTL monitor will start deleting docs older than 90 days within ~60 seconds.`);
    } else {
        console.log(`\n⚠ TTL did not apply correctly. Check the index above.`);
    }

    await mongoose.disconnect();
    process.exit(0);
})();
