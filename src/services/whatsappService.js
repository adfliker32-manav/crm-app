const axios = require('axios');

const sendWhatsAppMessage = async (to, name) => {
    // 1. Check karein ki function call hua ya nahi
    console.log(`🚀 TRYING TO SEND MESSAGE to ${to}`);
    console.log(`🔑 Token Check: ${process.env.WHATSAPP_TOKEN ? "Exists ✅" : "Missing ❌"}`);
    console.log(`🆔 ID Check: ${process.env.WHATSAPP_PHONE_ID ? "Exists ✅" : "Missing ❌"}`);

    try {
        const token = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_ID;

        if (!token || !phoneId) {
            console.log("❌ Error: Token or ID missing in Environment Variables");
            return;
        }

        const url = `https://graph.facebook.com/v17.0/${phoneId}/messages`;
        
        const response = await axios({
            method: 'POST',
            url: url,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            data: {
                messaging_product: 'whatsapp',
                to: to,
                type: 'template',
                template: {
                    name: 'hello_world',
                    language: { code: 'en_US' }
                }
            }
        });

        console.log(`✅ SUCCESS: Message Sent! Response ID: ${response.data.messages[0].id}`);
    } catch (error) {
        // Yahan asli error pakda jayega
        console.error('❌ FAILED TO SEND WHATSAPP:');
        if (error.response) {
            console.error('👉 Facebook Error Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('👉 Network Error:', error.message);
        }
    }
};

module.exports = { sendWhatsAppMessage };