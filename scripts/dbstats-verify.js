// Read-only — reproduces the SuperAdmin "Database Size" number
const mongoose = require('mongoose');
const MONGO_URI = 'mongodb+srv://adfliker32_db_user:ZI6MC0UABVQ4XH8l@cluster0.jxpsfb0.mongodb.net/crm?retryWrites=true&w=majority&appName=Cluster0';

const fmt = (b) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

(async () => {
    await mongoose.connect(MONGO_URI);
    const db = mongoose.connection.db;

    // What SuperAdmin reports
    const dbStats = await db.stats();
    console.log('=== Exactly what SuperAdmin reports ===');
    console.log(`  dataSize:        ${fmt(dbStats.dataSize)}`);
    console.log(`  indexSize:       ${fmt(dbStats.indexSize)}`);
    console.log(`  totalUsedBytes:  ${fmt(dbStats.dataSize + dbStats.indexSize)}   ← this is the 11 MB number`);
    console.log(`  storageSize:     ${fmt(dbStats.storageSize)}   (actual disk after compression)`);

    // Per-collection: data + indexes
    console.log('\n=== Per-collection (data + indexes) ===');
    const colls = await db.listCollections().toArray();
    const rows = [];
    for (const c of colls) {
        if (c.type === 'view') continue;
        try {
            const s = await db.command({ collStats: c.name });
            rows.push({
                name: c.name,
                count: s.count,
                data: s.size || 0,
                indexes: s.totalIndexSize || 0,
                total: (s.size || 0) + (s.totalIndexSize || 0)
            });
        } catch (e) { /* skip */ }
    }
    rows.sort((a, b) => b.total - a.total);
    console.log('Collection'.padEnd(28) + 'Docs'.padStart(8) + 'Data'.padStart(12) + 'Indexes'.padStart(12) + 'Total'.padStart(12));
    let totalData = 0, totalIdx = 0;
    for (const r of rows) {
        totalData += r.data;
        totalIdx += r.indexes;
        console.log(
            r.name.padEnd(28) +
            String(r.count).padStart(8) +
            fmt(r.data).padStart(12) +
            fmt(r.indexes).padStart(12) +
            fmt(r.total).padStart(12)
        );
    }
    console.log('-'.repeat(72));
    console.log('TOTAL'.padEnd(28) + ''.padStart(8) + fmt(totalData).padStart(12) + fmt(totalIdx).padStart(12) + fmt(totalData + totalIdx).padStart(12));

    await mongoose.disconnect();
    process.exit(0);
})();
