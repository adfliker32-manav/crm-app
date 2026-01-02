const axios = require('axios');

const sendWhatsAppMessage = async (to, name) => {
    try {
        const token = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_ID;

        if (!token || !phoneId) {
            console.log("❌ WhatsApp Token or ID missing in .env");
            return;
        }

        await axios({
            method: 'POST',
            url: `https://graph.facebook.com/v17.0/${phoneId}/messages`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: to, // User ka number
                type: 'template',
                template: {
                    name: 'hello_world', // Meta ka free template
                    language: { code: 'en_US' }
                }
            }
        });

        console.log(`✅ WhatsApp sent to ${name}`);
    } catch (error) {
        console.error('❌ WhatsApp Error:', error.response ? error.response.data : error.message);
    }
};

module.exports = { sendWhatsAppMessage };