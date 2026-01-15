const { sendWhatsAppMessage } = require('../src/services/whatsappService');

const phone = process.argv[2];
const name = process.argv[3] || 'Test';

if (!phone) {
    console.error('Usage: node test-send.js <phone-with-country-code> [name]');
    process.exit(1);
}

(async () => {
    try {
        const res = await sendWhatsAppMessage(phone, name);
        console.log('Message sent:', res);
    } catch (err) {
        console.error('Send failed:', err.response ? err.response.data : err.message);
    }
})();
