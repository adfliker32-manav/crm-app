// Read-only — uses $indexStats to find unused / dead indexes
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

(async () => {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    const targets = ['leads', 'tasks', 'whatsappmessages', 'whatsapplogs', 'whatsappconversations', 'users', 'activitylogs', 'auditlogs'];
    for (const name of targets) {
        try {
            const stats = await db.collection(name).aggregate([{ $indexStats: {} }]).toArray();
            const collStats = await db.command({ collStats: name });
            console.log(`\n=== ${name} (${collStats.count} docs, ${stats.length} indexes) ===`);
            stats
                .sort((a, b) => b.accesses.ops - a.accesses.ops)
                .forEach(s => {
                    const since = s.accesses.since;
                    const used = s.accesses.ops;
                    const flag = used === 0 ? '⚠ NEVER USED' : '';
                    const keyStr = Object.entries(s.key).map(([k, v]) => `${k}:${v}`).join(', ');
                    console.log(`  ${used.toString().padStart(8)} ops  | ${s.name.padEnd(40)} | { ${keyStr} } ${flag}`);
                });
        } catch (e) {
            console.log(`Failed ${name}: ${e.message}`);
        }
    }

    await mongoose.disconnect();
    process.exit(0);
})();
