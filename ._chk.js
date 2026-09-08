require('dotenv').config();
const mongoose = require('mongoose');
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const WS = require('./src/models/WorkspaceSettings');
  const { resolveValues } = require('./src/constants/featureRegistry');
  const id = require('fs').readFileSync('scripts/.env.mock-crm','utf8').match(/ADFLIKER_ACCOUNT_ID=(\S+)/)[1];
  const ws = await WS.findOne({ userId: id }).lean();
  console.log('activeModules:', ws.activeModules);
  console.log('planFeatures :', JSON.stringify(ws.planFeatures));
  console.log('featureFlags :', JSON.stringify(ws.featureFlags || {}));
  const v = resolveValues(ws);
  Object.keys(v).filter(k => k.startsWith('whatsapp')).forEach(k => console.log(' ', v[k] ? 'ON ' : 'OFF', k));
  await mongoose.disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
