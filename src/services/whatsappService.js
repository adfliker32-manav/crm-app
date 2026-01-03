const axios = require('axios');
require('dotenv').config(); // Ensure env vars are loaded

const sendWhatsAppMessage = async (to, templateName = 'hello_world') => {
    try {
        console.log("------------------------------------------------");
        console.log("🕵️  DEBUGGING WHATSAPP CREDENTIALS:");
        console.log("👉 Phone ID:", process.env.WA_PHONE_NUMBER_ID ? "✅ Loaded" : "❌ MISSING (Check .env)");
        console.log("👉 Token:", process.env.WA_ACCESS_TOKEN ? "✅ Loaded" : "❌ MISSING (Check .env)");
        console.log("------------------------------------------------");

        const url = `https://graph.facebook.com/v17.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;
        
        const data = {
            messaging_product: "whatsapp",
            to: to,
            type: "template",
            template: {
                name: templateName,
                language: {
                    code: "en_US"
                }
            }
        };

        const config = {
            headers: {
                'Authorization': `Bearer ${process.env.WA_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        };

        const response = await axios.post(url, data, config);

        console.log(`✅ SUCCESS: Message Sent! Response ID: ${response.data.messages[0].id}`);
        return response.data;

    } catch (error) {
        console.error('❌ FAILED TO SEND WHATSAPP:');
        if (error.response) {
            // Facebook/Meta se error aaya
            console.error('👉 Status Code:', error.response.status);
            console.error('👉 Meta Error Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            // Network ya code error
            console.error('👉 Error Message:', error.message);
        }
        throw error;
    }
};

module.exports = { sendWhatsAppMessage };