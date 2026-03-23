require('dotenv').config();
const axios = require('axios');

async function testSend() {
    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID || process.env.Phone_Number_ID;
    const accessToken = process.env.WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
    const to = "919024097437"; // Assuming this is the test number based on the error or a generic one. Let's ask user or just put an empty string and let meta complain about that if the token is valid. Let's use 919876543210.

    console.log("Phone ID:", phoneNumberId);
    console.log("Token starts with:", accessToken?.substring(0, 10));

    const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
            name: "hello_world",
            language: { code: "en_US" }
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("Success:", response.data);
    } catch (error) {
        console.error("Error Status:", error.response?.status);
        console.error("Error Data:", JSON.stringify(error.response?.data, null, 2));
    }
}

testSend();
