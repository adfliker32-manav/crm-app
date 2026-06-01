require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set. Add it to your .env before running this script.');
  process.exit(1);
}

mongoose.connect(MONGO_URI)
.then(async () => {
  const collections = await mongoose.connection.db.listCollections().toArray();
  console.log('--- COLLECTIONS ---');
  let totalDataSize = 0;
  for (let c of collections) {
      if (c.type === 'view') continue;
      try {
        const stats = await mongoose.connection.db.command({ collStats: c.name });
        console.log(`${c.name}: count: ${stats.count}, avg size: ${stats.avgObjSize || 0} bytes, data size: ${stats.size || 0} bytes`);
        totalDataSize += stats.size || 0;
      } catch (e) {
        console.log(`Failed to get stats for ${c.name}: ${e.message}`);
      }
  }
  console.log(`\nTotal Data Size of Collections: ${totalDataSize} bytes`);
  process.exit(0);
})
.catch(err => {
  console.error(err);
  process.exit(1);
});
