const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const cashfreeService = require('../src/services/cashfreeService');

// Cashfree sandbox smoke test. Creates ONE real subscription against the
// sandbox and dumps the raw response so we can confirm the exact field names
// (auth link, subscription_id echo, etc.) and lock the mappings in
// subscriptionService / billingController.
//
// Prereqs: set CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=sandbox in .env
// Run:     node scripts/cashfree-smoke-test.js
//
// It does NOT touch the database — it only calls the Cashfree API.
const run = async () => {
    if (!cashfreeService.isConfigured()) {
        console.error('❌ Cashfree not configured. Set CASHFREE_APP_ID + CASHFREE_SECRET_KEY in .env first.');
        process.exit(1);
    }
    console.log(`🌐 Cashfree env: ${process.env.CASHFREE_ENV || 'sandbox'}\n`);

    const testId = `smoke_${Date.now()}`;
    console.log('📤 Creating test subscription…');
    let resp;
    try {
        resp = await cashfreeService.createSubscription({
            subscriptionId: testId,
            customerName: 'Smoke Test',
            customerEmail: 'smoketest@example.com',
            customerPhone: '9999999999',
            planName: 'Smoke Test Plan (monthly)',
            amount: 1,                 // ₹1 so a real sandbox charge is harmless
            cycle: 'monthly',
            returnUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing?cf_return=1`,
            notifyUrl: `${process.env.SERVER_URL || process.env.FRONTEND_URL || 'http://localhost:5000'}/api/billing/cashfree/webhook`
        });
    } catch (err) {
        console.error('❌ createSubscription failed:', err.message);
        if (err.payload) console.error('   Cashfree said:', JSON.stringify(err.payload, null, 2));
        process.exit(1);
    }

    console.log('\n✅ RAW createSubscription response:\n');
    console.log(JSON.stringify(resp, null, 2));

    // Mirror the exact extraction subscriptionService uses, so we can confirm it works.
    const sessionId = resp.subscription_session_id || resp.data?.subscription_session_id || null;

    console.log('\n──────── extraction check ────────');
    console.log('subscription_id echoed   :', resp.subscription_id || resp.data?.subscription_id || '(NOT FOUND — check field path)');
    console.log('subscription_session_id  :', sessionId || '(NOT FOUND — adjust mapping in subscriptionService.js)');
    console.log('cf_subscription_id       :', resp.cf_subscription_id || resp.data?.cf_subscription_id || '(none)');
    console.log('\n→ Frontend opens the mandate via JS SDK: cashfree.subscriptionsCheckout({ subsSessionId })');

    console.log('\n📥 Fetching the subscription back (GET) to see its shape…');
    try {
        const got = await cashfreeService.getSubscription(testId);
        console.log('\n✅ RAW getSubscription response:\n');
        console.log(JSON.stringify(got, null, 2));
    } catch (err) {
        console.warn('⚠️ getSubscription failed (non-fatal):', err.message);
    }

    console.log('\n🎯 Next: open the authLink above in a browser, authorize the test mandate,');
    console.log('   then watch your server logs for the webhook to confirm event names +');
    console.log('   payload paths (SUBSCRIPTION_ACTIVATED / SUBSCRIPTION_PAYMENT_SUCCESS, cf_payment_id).\n');
};

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
