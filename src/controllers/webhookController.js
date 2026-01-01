// src/controllers/webhookController.js

// 1. Facebook se dosti karne wala function (Verify Token)
exports.verifyWebhook = (req, res) => {
    // Facebook ye teen cheezein bhejta hai check karne ke liye
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // Hum check karenge ki password (token) match ho raha hai ya nahi
    if (mode && token === process.env.VERIFY_TOKEN) {
        console.log('✅ WEBHOOK_VERIFIED');
        res.status(200).send(challenge); // Facebook ko wapas 'challenge' code bhejna padta hai
    } else {
        res.sendStatus(403); // Agar password galat hai to bhaga do
    }
};

// 2. Lead aane par kya karna hai?
exports.handleWebhook = (req, res) => {
    const body = req.body;

    console.log('📩 New Data Received from Facebook:', JSON.stringify(body, null, 2));

    // Facebook ko batao ki humne data le liya (warna wo baar baar bhejta rahega)
    res.status(200).send('EVENT_RECEIVED');
};