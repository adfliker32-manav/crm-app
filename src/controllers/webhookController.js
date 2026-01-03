require('dotenv').config();
const Lead = require('../models/Lead');
const User = require('../models/User');

// 1. Verification (Same as before)
const verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const MY_VERIFY_TOKEN = process.env.VERIFY_TOKEN;

    if (mode && token === MY_VERIFY_TOKEN) {
        console.log('✅ WEBHOOK_VERIFIED');
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
};

// 2. Incoming Messages Handle Karna (UPDATED LOGIC 🛠️)
const handleWebhook = async (req, res) => {
    const body = req.body;
    try {
        if (body.object) {
            if (
                body.entry &&
                body.entry[0].changes &&
                body.entry[0].changes[0].value.messages &&
                body.entry[0].changes[0].value.messages[0]
            ) {
                const value = body.entry[0].changes[0].value;
                const messageObj = value.messages[0];
                const contactObj = value.contacts[0];
                const businessId = value.metadata.phone_number_id;

                const from = messageObj.from;
                const msgBody = messageObj.text.body;
                const name = contactObj.profile.name;

                console.log(`📩 Msg from ${name}: ${msgBody}`);

                // Step A: Owner dhoondo
                const ownerUser = await User.findOne({ waBusinessId: businessId });
                if (!ownerUser) {
                    console.log("❌ SaaS User not found for this Business ID");
                    return res.sendStatus(200);
                }

                // Step B: Lead check karo
                let lead = await Lead.findOne({ phone: from, userId: ownerUser._id });

                // Message ka object taiyar karo
                const newMessage = {
                    text: msgBody,
                    from: 'lead', // Customer ne bheja hai
                    timestamp: new Date()
                };

                if (lead) {
                    // 👉 OLD LEAD: Message list mein add karo
                    lead.messages.push(newMessage);
                    await lead.save();
                    console.log("✅ Message added to existing Lead!");
                } else {
                    // 👉 NEW LEAD: Nayi lead banao message ke sath
                    lead = new Lead({
                        userId: ownerUser._id,
                        name: name,
                        phone: from,
                        email: `${from}@whatsapp.user`,
                        status: 'New',
                        source: 'WhatsApp',
                        messages: [newMessage] // Pehla message add kiya
                    });
                    await lead.save();
                    console.log("✅ New Lead Created with Message!");
                }
            }
            res.sendStatus(200);
        } else {
            res.sendStatus(404);
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
        res.sendStatus(500);
    }
};

// 3. Frontend Data Fetching (Keep the Fix)
const getWhatsAppLeads = async (req, res) => {
    try {
        // ID Resolve Logic (Jo humne fix kiya tha)
        const currentUserId = req.user.userId || req.user._id || req.user.id;

        if (!currentUserId) {
            return res.status(401).json({ message: "Invalid Token Data" });
        }

        const leads = await Lead.find({ 
            userId: currentUserId, 
            source: 'WhatsApp' 
        }).sort({ updatedAt: -1 }); // Jiska message abhi aaya wo sabse upar

        res.status(200).json(leads);

    } catch (error) {
        console.error("❌ Error fetching WA leads:", error);
        res.status(500).json({ message: "Server Error" });
    }
};

module.exports = { verifyWebhook, handleWebhook, getWhatsAppLeads };