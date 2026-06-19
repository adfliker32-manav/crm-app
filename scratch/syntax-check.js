try {
    require('../src/controllers/metaWebhookController');
    require('../src/controllers/metaDropLogController');
    require('../src/services/metaLeadRecoveryService');
    require('../src/services/leadAlertService');
    console.log('✅ Syntax compilation PASSED for modified controllers and services');
    process.exit(0);
} catch (e) {
    console.error('❌ Syntax compilation FAILED:', e);
    process.exit(1);
}
