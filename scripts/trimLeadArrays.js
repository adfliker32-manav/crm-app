const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Lead = require('../src/models/Lead');

const MAX_HISTORY = 100;
const MAX_MESSAGES = 100;
const MAX_NOTES = 50;
const MAX_FOLLOWUPS = 50;
const BATCH_SIZE = 500;

async function run() {
    const isDryRun = process.argv.includes('--dry-run');
    
    console.log(`\n🚀 Starting Lead Array Maintenance Script`);
    console.log(`MODE: ${isDryRun ? '🔍 DRY-RUN (No changes applied)' : '⚠️ EXECUTION (Irreversible!)'}`);
    
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!MONGO_URI) {
        console.error("❌ Database connection string missing from .env");
        process.exit(1);
    }
    
    try {
        await mongoose.connect(MONGO_URI);
        console.log(`✅ Connected to Database`);
        
        // Find oversized documents directly
        const oversizedCondition = {
            $or: [
                { [`history.${MAX_HISTORY}`]: { $exists: true } },
                { [`messages.${MAX_MESSAGES}`]: { $exists: true } },
                { [`notes.${MAX_NOTES}`]: { $exists: true } },
                { [`followUpHistory.${MAX_FOLLOWUPS}`]: { $exists: true } }
            ]
        };
        
        const count = await Lead.countDocuments(oversizedCondition);
        console.log(`📊 Found ${count} existing Lead documents with arrays exceeding boundaries.`);
        
        if (count === 0) {
            console.log(`🎉 Database is already fully optimized. Safely exiting.`);
            process.exit(0);
        }
        
        if (isDryRun) {
            console.log(`🔍 [DRY-RUN] Simulating data cleanup...`);
            let simulatedBatches = Math.ceil(count / BATCH_SIZE);
            console.log(`[DRY-RUN] Will process ${simulatedBatches} batches to slice oversize arrays using atomic $set operator.`);
            process.exit(0);
        }
        
        // Execute proper batches using $set to safely slice existing document properties
        console.log(`⚠️  [EXECUTION] Beginning document transformations...`);
        let processed = 0;
        let cursor = Lead.find(oversizedCondition).select('_id history messages notes followUpHistory').cursor();
        
        const bulkOperations = [];
        
        for await (const lead of cursor) {
            const setObj = {};
            
            // $set correctly truncates elements from the end to match constraints
            if (lead.history && lead.history.length > MAX_HISTORY) {
                setObj.history = lead.history.slice(-MAX_HISTORY);
            }
            if (lead.messages && lead.messages.length > MAX_MESSAGES) {
                setObj.messages = lead.messages.slice(-MAX_MESSAGES);
            }
            if (lead.notes && lead.notes.length > MAX_NOTES) {
                setObj.notes = lead.notes.slice(-MAX_NOTES);
            }
            if (lead.followUpHistory && lead.followUpHistory.length > MAX_FOLLOWUPS) {
                setObj.followUpHistory = lead.followUpHistory.slice(-MAX_FOLLOWUPS);
            }
            
            if (Object.keys(setObj).length > 0) {
                bulkOperations.push({
                    updateOne: {
                        filter: { _id: lead._id },
                        update: { $set: setObj }
                    }
                });
            }
            
            if (bulkOperations.length >= BATCH_SIZE) {
                await Lead.bulkWrite(bulkOperations);
                processed += bulkOperations.length;
                console.log(`   [Action] Trimmed a batch of ${bulkOperations.length} leads... (${processed}/${count})`);
                bulkOperations.length = 0; // Clear for next batch
            }
        }
        
        // Final batch
        if (bulkOperations.length > 0) {
            await Lead.bulkWrite(bulkOperations);
            processed += bulkOperations.length;
            console.log(`   [Action] Trimmed final batch of ${bulkOperations.length} leads... (${processed}/${count})`);
        }
        
        console.log(`\n🎉 Execution Complete!`);
        console.log(`Total Documents Safely Trimmed: ${processed}`);
        
        // Final Database Size check reminder
        console.log(`\n======================================================`);
        console.log(`🔍 POST-EXECUTION VERIFICATION:`);
        console.log(`   1. Check MongoDB Atlas for document size reductions.`);
        console.log(`   2. Test the frontend Lead Board for UI stability.`);
        console.log(`======================================================\n`);

        process.exit(0);
        
    } catch (err) {
        console.error("❌ Migration Error:", err);
        process.exit(1);
    }
}

run();
