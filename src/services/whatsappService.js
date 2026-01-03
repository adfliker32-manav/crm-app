const axios = require('axios');

async function sendWhatsAppMessage(phoneNumber, name) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;

    if (!token || !phoneId) {
        throw new Error('WhatsApp credentials missing');
    }

    const url = `https://graph.facebook.com/v16.0/${phoneId}/messages`;
    const payload = {
        messaging_product: 'whatsapp',
        to: phoneNumber,
        type: 'template',
        template: {
            name: 'welcome_template',
            language: { code: 'en_US' },
            components: [{ type: 'body', parameters: [{ type: 'text', text: name }] }]
        }
    };

    const res = await axios.post(url, payload, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    return res.data;
}

module.exports = { sendWhatsAppMessage };