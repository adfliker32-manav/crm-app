/**
 * MIGRATION SCRIPT: Approve All Existing Users
 *
 * Run this ONCE immediately after deploying the new approval system.
 * It sets is_active=true, approved_by_admin=true, status='approved'
 * for ALL existing managers and agencies so they don't get locked out.
 *
 * Usage:
 *   node scripts/migrateApproveExistingUsers.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) {
    console.error('❌ MONGO_URI not found in .env');
    process.exit(1);
}

async function migrate() {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const result = await mongoose.connection.collection('users').updateMany(
        {
            role: { $in: ['manager', 'agency'] },
            // Only update users that haven't been touched by the new system yet
            $or: [
                { is_active: { $exists: false } },
                { approved_by_admin: { $exists: false } },
                { status: { $exists: false } }
            ]
        },
        {
            $set: {
                is_active: true,
                approved_by_admin: true,
                status: 'approved'
            }
        }
    );

    console.log(`✅ Migration complete!`);
    console.log(`   Matched:  ${result.matchedCount} users`);
    console.log(`   Modified: ${result.modifiedCount} users`);
    console.log(`\n👉 All existing managers and agencies are now approved.`);
    console.log(`   New accounts created after this migration will require manual approval.`);

    await mongoose.disconnect();
    process.exit(0);
}

migrate().catch(err => {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
});
