// Read-only — preview impact before applying TTL fix
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

(async () => {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;
    const coll = db.collection('activitylogs');

    const total = await coll.countDocuments();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const wouldDelete = await coll.countDocuments({ timestamp: { $lt: cutoff } });
    const wouldKeep = total - wouldDelete;

    console.log(`Total activitylogs:           ${total}`);
    console.log(`Cutoff date (90 days ago):    ${cutoff.toISOString()}`);
    console.log(`Would be auto-deleted by TTL: ${wouldDelete}`);
    console.log(`Would be kept:                ${wouldKeep}`);

    // Existing index details
    const indexes = await coll.indexes();
    const tsIndex = indexes.find(i => i.name === 'timestamp_1');
    console.log(`\nCurrent timestamp_1 index:`);
    console.log(JSON.stringify(tsIndex, null, 2));

    await mongoose.disconnect();
    process.exit(0);
})();
