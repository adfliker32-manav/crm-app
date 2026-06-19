require('dotenv').config();
const mongoose = require('mongoose');
const WorkspaceSettings = require('../src/models/WorkspaceSettings');

// Import services to monkey-patch BEFORE importing leadAlertService
const whatsappService = require('../src/services/whatsappService');
const socketService = require('../src/services/socketService');

let lastWaSend = null;
let lastSocketEmit = null;

// Monkey-patch functions for testing
whatsappService.sendWhatsAppTextMessage = async (phone, msg, userId) => {
    lastWaSend = { phone, msg, userId };
    return { success: true };
};

socketService.emitToUser = (userId, event, payload) => {
    lastSocketEmit = { userId, event, payload };
};

// Now import leadAlertService so it destructures the mocked functions
const leadAlertService = require('../src/services/leadAlertService');

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        const testUserId = new mongoose.Types.ObjectId();

        // 1. Create a test workspace setting
        console.log('📝 Creating test WorkspaceSettings...');
        await WorkspaceSettings.deleteMany({ userId: testUserId });
        const ws = await WorkspaceSettings.create({
            userId: testUserId,
            leadAlertWhatsappEnabled: true,
            leadAlertWhatsappNumber: '919876543210',
            leadAlertWhatsappSources: ['Meta', 'Web', 'WhatsApp']
        });
        console.log('✅ Test WorkspaceSettings created:', ws.leadAlertWhatsappSources);

        // --- TEST CASE 1: Meta lead ---
        console.log('\n--- Test 1: Lead source Meta ---');
        lastWaSend = null;
        lastSocketEmit = null;
        await leadAlertService.sendLeadArrivalAlert({
            _id: new mongoose.Types.ObjectId(),
            userId: testUserId,
            name: 'Rahul Sharma',
            phone: '9876543210',
            email: 'rahul@gmail.com',
            source: 'Meta'
        });

        console.log('Socket emitted:', !!lastSocketEmit);
        console.log('WA sent:', !!lastWaSend);
        if (lastSocketEmit && lastWaSend && lastWaSend.phone === '919876543210' && lastWaSend.msg.includes('*Source:* Meta')) {
            console.log('✅ Test 1 PASSED');
        } else {
            console.error('❌ Test 1 FAILED');
        }

        // --- TEST CASE 2: Web lead (Landing Page normalization) ---
        console.log('\n--- Test 2: Lead source Landing Page (should normalize to Web and trigger) ---');
        lastWaSend = null;
        lastSocketEmit = null;
        await leadAlertService.sendLeadArrivalAlert({
            _id: new mongoose.Types.ObjectId(),
            userId: testUserId,
            name: 'Amit Patel',
            phone: '8888888888',
            email: 'amit@gmail.com',
            source: 'Landing Page'
        });

        console.log('Socket emitted:', !!lastSocketEmit);
        console.log('WA sent:', !!lastWaSend);
        if (lastSocketEmit && lastWaSend && lastWaSend.msg.includes('*Source:* Landing Page')) {
            console.log('✅ Test 2 PASSED');
        } else {
            console.error('❌ Test 2 FAILED');
        }

        // --- TEST CASE 3: Manual lead (not enabled in sources) ---
        console.log('\n--- Test 3: Lead source Manual (not enabled in sources, should bypass WA, keep socket) ---');
        lastWaSend = null;
        lastSocketEmit = null;
        await leadAlertService.sendLeadArrivalAlert({
            _id: new mongoose.Types.ObjectId(),
            userId: testUserId,
            name: 'Vikram Singh',
            phone: '7777777777',
            source: 'Manual'
        });

        console.log('Socket emitted:', !!lastSocketEmit);
        console.log('WA sent (should be false):', !!lastWaSend);
        if (lastSocketEmit && !lastWaSend) {
            console.log('✅ Test 3 PASSED');
        } else {
            console.error('❌ Test 3 FAILED');
        }

        // --- TEST CASE 4: skipWhatsApp option ---
        console.log('\n--- Test 4: Option skipWhatsApp = true ---');
        lastWaSend = null;
        lastSocketEmit = null;
        await leadAlertService.sendLeadArrivalAlert({
            _id: new mongoose.Types.ObjectId(),
            userId: testUserId,
            name: 'Sonia Sen',
            phone: '6666666666',
            source: 'Meta'
        }, { skipWhatsApp: true });

        console.log('Socket emitted:', !!lastSocketEmit);
        console.log('WA sent (should be false):', !!lastWaSend);
        if (lastSocketEmit && !lastWaSend) {
            console.log('✅ Test 4 PASSED');
        } else {
            console.error('❌ Test 4 FAILED');
        }

        // Cleanup
        await WorkspaceSettings.deleteMany({ userId: testUserId });
        console.log('\n🧹 Test WorkspaceSettings cleaned up.');

        console.log('👋 Done!');
        process.exit(0);
    } catch (err) {
        console.error('❌ Test execution error:', err);
        process.exit(1);
    }
}

run();
