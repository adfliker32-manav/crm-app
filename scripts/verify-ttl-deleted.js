// Poll activitylogs count until TTL monitor finishes its sweep
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

(async () => {
    await mongoose.connect(MONGO_URI);
    const coll = mongoose.connection.db.collection('activitylogs');
    const STARTING = 847;
    const TARGET = 179; // what should remain after TTL

    for (let i = 0; i < 6; i++) {
        const n = await coll.countDocuments();
        const deleted = STARTING - n;
        console.log(`[t+${i * 30}s] count=${n}  deleted=${deleted}  (target=${TARGET})`);
        if (n <= TARGET + 10) {
            console.log('✓ TTL sweep complete');
            break;
        }
        await new Promise(r => setTimeout(r, 30000));
    }

    await mongoose.disconnect();
    process.exit(0);
})();
