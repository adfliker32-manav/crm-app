const mongoose = require('mongoose');
require('dotenv').config();

async function run() {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/crm-app');
    const WorkspaceSettings = require('./src/models/WorkspaceSettings');
    const { FEATURE_REGISTRY, applyValues, diffOverrides, encodeOverrides, resolveValues, resolveEffective } = require('./src/constants/featureRegistry');

    const ws = await WorkspaceSettings.findOne({}).exec();
    if(!ws) return console.log("No ws found");

    console.log("Initial ws planFeatures:", ws.planFeatures);
    
    const values = resolveValues(ws.toObject());
    values['leads.metaSync'] = true;
    values['whatsapp.broadcast'] = true;
    values['whatsapp.chatbot.ai'] = true;
    
    const baselineSource = { activeModules: ['leads', 'team', 'reports'], planFeatures: {}, featureFlags: {} };
    const baselineValues = resolveValues(baselineSource);
    
    const overrides = encodeOverrides(diffOverrides(values, baselineValues));
    console.log("Overrides generated:", overrides);
    
    const eff = resolveEffective(baselineSource, overrides, ws.toObject());
    console.log("Effective planFeatures:", eff.planFeatures);
    
    ws.overrides = overrides;
    ws.activeModules = eff.activeModules;
    Object.assign(ws.planFeatures, eff.planFeatures);
    ws.featureFlags = eff.featureFlags;
    
    ws.markModified('overrides');
    ws.markModified('featureFlags');
    ws.markModified('planFeatures');
    
    await ws.save();
    console.log("Saved. Fetching again...");
    
    const fetchedWs = await WorkspaceSettings.findOne({_id: ws._id}).lean();
    console.log("Fetched planFeatures:", fetchedWs.planFeatures);
    
    process.exit(0);
}
run();
