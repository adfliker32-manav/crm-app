const mongoose = require('mongoose');

/**
 * DB INDEXES — Run once to create all performance indexes.
 * Safe to re-run (createIndex is idempotent).
 *
 * Run with: node scripts/createIndexes.js
 */

require('dotenv').config();
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('❌ MONGO_URI missing'); process.exit(1); }

const Lead      = require('../src/models/Lead');
const User      = require('../src/models/User');
const UsageLog  = require('../src/models/UsageLog');
const AuditLog  = require('../src/models/AuditLog');
const ActivityLog = require('../src/models/ActivityLog');
const WhatsAppMessage = require('../src/models/WhatsAppMessage');
const EmailLog  = require('../src/models/EmailLog');

const createIndexes = async () => {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // ── LEADS ──────────────────────────────────────────────
    // Most critical: every tenant query is { userId, createdAt }
    await Lead.collection.createIndex({ userId: 1, createdAt: -1 }, { background: true });
    await Lead.collection.createIndex({ userId: 1, status: 1 },     { background: true });
    await Lead.collection.createIndex({ userId: 1, assignedTo: 1 }, { background: true });
    await Lead.collection.createIndex({ userId: 1, phone: 1 },      { background: true }); // Dup check
    await Lead.collection.createIndex({ userId: 1, email: 1 },      { background: true }); // Dup check
    await Lead.collection.createIndex({ userId: 1, nextFollowUpDate: 1 }, { background: true }); // Follow-up queries
    await Lead.collection.createIndex({ userId: 1, wonAt: -1 }, { background: true }); // Closed-won revenue reporting
    await Lead.collection.createIndex({ userId: 1, lostAt: -1 }, { background: true }); // Closed-lost revenue reporting
    console.log('✅ Lead indexes created');

    // ── USERS ──────────────────────────────────────────────
    await User.collection.createIndex({ email: 1 },               { unique: true, background: true });
    await User.collection.createIndex({ parentId: 1, role: 1 },   { background: true }); // Agent lookup
    await User.collection.createIndex({ role: 1, subscriptionStatus: 1 }, { background: true }); // Cron job
    await User.collection.createIndex({ planExpiryDate: 1, subscriptionStatus: 1 }, { background: true }); // Expiry scan
    console.log('✅ User indexes created');

    // ── USAGE LOGS ─────────────────────────────────────────
    // Already has unique index via schema, confirm it exists
    await UsageLog.collection.createIndex({ workspaceId: 1, date: 1 }, { unique: true, background: true });
    console.log('✅ UsageLog indexes created');

    // ── AUDIT / ACTIVITY ───────────────────────────────────
    await AuditLog.collection.createIndex({ companyId: 1, createdAt: -1 }, { background: true });
    await ActivityLog.collection.createIndex({ companyId: 1, createdAt: -1 }, { background: true });
    console.log('✅ AuditLog / ActivityLog indexes created');

    // ── WHATSAPP ───────────────────────────────────────────
    await WhatsAppMessage.collection.createIndex({ userId: 1, createdAt: -1 }, { background: true });
    await WhatsAppMessage.collection.createIndex({ userId: 1, from: 1 },       { background: true });
    console.log('✅ WhatsAppMessage indexes created');

    // ── EMAIL ──────────────────────────────────────────────
    await EmailLog.collection.createIndex({ userId: 1, sentAt: -1 }, { background: true });
    console.log('✅ EmailLog indexes created');

    console.log('\n🎉 All indexes created successfully!');
    await mongoose.disconnect();
};

createIndexes().catch(err => {
    console.error('❌ Index creation failed:', err);
    mongoose.disconnect();
    process.exit(1);
});
