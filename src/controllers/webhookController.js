require('dotenv').config();
const axios = require('axios'); // 👈 IMPORT KIYA
const Lead = require('../models/Lead');
const User = require('../models/User');

// 1. Verification
// src/controllers/webhookController.js

// ... imports same rahenge ...

const verifyWebhook = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    
    // 👇 .env se token uthao (trim() lagaya taaki extra space hat jaye)
    const MY_VERIFY_TOKEN = (process.env.VERIFY_TOKEN || "").trim();

    console.log("---------------------------------");
    console.log("📡 Webhook Verification Hit!");
    console.log("🔑 Mode:", mode);
    console.log("🔑 Token Received from Meta:", token);
    console.log("🔐 Token in .env File:", MY_VERIFY_TOKEN ? "✅ Set" : "❌ Missing");
    console.log("🔑 Challenge:", challenge);
    console.log("❓ Match Status:", token === MY_VERIFY_TOKEN ? "✅ MATCH" : "❌ MISMATCH");
    console.log("---------------------------------");

    // Meta expects 'subscribe' mode during verification
    if (mode === 'subscribe' && token === MY_VERIFY_TOKEN) {
        console.log("✅ Webhook verified successfully!");
        res.status(200).send(challenge);
    } else {
        console.log("⛔ 403 Forbidden - Verification failed");
        console.log("   Mode check:", mode === 'subscribe' ? "✅" : "❌");
        console.log("   Token check:", token === MY_VERIFY_TOKEN ? "✅" : "❌");
        res.sendStatus(403);
    }
};

// ... baki functions same rahenge ...

// 2. Incoming Messages
const handleWebhook = async (req, res) => {
    const body = req.body;
    
    // Always respond quickly to Meta (within 20 seconds)
    res.sendStatus(200);
    
    try {
        console.log("---------------------------------");
        console.log("📨 Webhook POST Received");
        console.log("📦 Object:", body.object);
        console.log("📦 Entry Count:", body.entry?.length || 0);
        console.log("---------------------------------");

        // Check if this is a WhatsApp webhook
        if (body.object !== 'whatsapp_business_account') {
            console.log("⚠️  Not a WhatsApp webhook, ignoring...");
            return;
        }

        // Process each entry
        if (body.entry && Array.isArray(body.entry)) {
            for (const entry of body.entry) {
                if (entry.changes && Array.isArray(entry.changes)) {
                    for (const change of entry.changes) {
                        const value = change.value;
                        
                        // Handle incoming messages
                        if (value.messages && Array.isArray(value.messages)) {
                            for (const messageObj of value.messages) {
                                await processIncomingMessage(messageObj, value);
                            }
                        }
                        
                        // Handle status updates (message delivery status, read receipts, etc.)
                        if (value.statuses && Array.isArray(value.statuses)) {
                            for (const status of value.statuses) {
                                console.log(`📊 Status update: ${status.status} for ${status.id}`);
                                // You can handle status updates here if needed
                            }
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error("❌ Webhook Processing Error:", error.message);
        console.error("Stack:", error.stack);
    }
};

// Helper function to process incoming messages
async function processIncomingMessage(messageObj, value) {
    try {
        const contactObj = value.contacts?.[0];
        const phoneNumberId = value.metadata?.phone_number_id;
        
        const from = messageObj.from;
        const messageType = messageObj.type;
        const msgBody = messageType === 'text' ? (messageObj.text?.body || "") : "";
        const name = contactObj?.profile?.name || "Unknown";

        console.log(`📩 Message from ${name} (${from}):`);
        console.log(`   Type: ${messageType}`);
        console.log(`   Body: ${msgBody || '(non-text message)'}`);

        // Skip if not a text message (for now)
        if (messageType !== 'text' || !msgBody) {
            console.log(`⚠️  Skipping non-text message (type: ${messageType})`);
            return;
        }

        // Find the user by phone number ID (try both waPhoneNumberId and waBusinessId)
        let ownerUser = await User.findOne({ 
            $or: [
                { waPhoneNumberId: phoneNumberId },
                { waBusinessId: phoneNumberId }
            ]
        });

        // If no user found, try to find by default phone number ID from env (for single-tenant setup)
        if (!ownerUser && phoneNumberId) {
            const envPhoneId = process.env.Phone_Number_ID || process.env.WA_PHONE_NUMBER_ID;
            if (phoneNumberId === envPhoneId) {
                // Find the first manager user (for single-tenant setup)
                ownerUser = await User.findOne({ role: 'manager' });
                if (ownerUser) {
                    // Update user with phone number ID for future lookups
                    ownerUser.waPhoneNumberId = phoneNumberId;
                    await ownerUser.save();
                    console.log(`✅ Updated user ${ownerUser.email} with phone number ID`);
                }
            }
        }

        if (!ownerUser) {
            console.log(`⚠️  No user found for phone number ID: ${phoneNumberId}`);
            console.log(`   Available users with WhatsApp config:`);
            const usersWithWA = await User.find({ 
                $or: [
                    { waPhoneNumberId: { $exists: true, $ne: null } },
                    { waBusinessId: { $exists: true, $ne: null } }
                ]
            }).select('email waPhoneNumberId waBusinessId');
            console.log(usersWithWA);
            return;
        }

        // Normalize phone number (remove + and spaces)
        const normalizedPhone = from.replace(/[+\s]/g, '');

        // Find or create lead
        let lead = await Lead.findOne({ 
            phone: { $regex: normalizedPhone.replace(/\d/g, '\\d') },
            userId: ownerUser._id 
        });

        const newMessage = { 
            text: msgBody, 
            from: 'lead', 
            timestamp: new Date() 
        };

        if (lead) {
            lead.messages.push(newMessage);
            lead.updatedAt = new Date();
            await lead.save();
            console.log(`✅ Updated existing lead: ${lead.name}`);
        } else {
            lead = new Lead({
                userId: ownerUser._id,
                name: name,
                phone: normalizedPhone,
                email: `${normalizedPhone}@whatsapp.user`,
                status: 'New',
                source: 'WhatsApp',
                messages: [newMessage]
            });
            await lead.save();
            console.log(`✅ Created new lead: ${name} (${normalizedPhone})`);
        }
    } catch (error) {
        console.error("❌ Error processing message:", error.message);
        console.error("Stack:", error.stack);
    }
}

// 3. Get Leads for Frontend
const getWhatsAppLeads = async (req, res) => {
    try {
        const currentUserId = req.user.userId || req.user._id || req.user.id;
        if (!currentUserId) return res.status(401).json({ message: "Invalid Token" });

        const leads = await Lead.find({ userId: currentUserId, source: 'WhatsApp' }).sort({ updatedAt: -1 });
        res.status(200).json(leads);
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};

// 👇 4. NEW: Send Reply Function
const sendReply = async (req, res) => {
    const { phone, message, leadId } = req.body;

    try {
        console.log(`📤 Sending reply to ${phone}: ${message}`);

        // Get user credentials
        const userId = req.user?.userId || req.user?.id;
        const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
        
        let phoneNumberId, accessToken;
        
        if (userId) {
            const userCredentials = await getUserWhatsAppCredentials(userId);
            if (userCredentials && userCredentials.phoneNumberId && userCredentials.accessToken) {
                phoneNumberId = userCredentials.phoneNumberId;
                accessToken = userCredentials.accessToken;
            }
        }
        
        // Fallback to environment variables
        if (!phoneNumberId || !accessToken) {
            phoneNumberId = process.env.Phone_Number_ID || process.env.WA_PHONE_NUMBER_ID;
            accessToken = process.env.WHATSAPP_TOKEN || process.env.WA_ACCESS_TOKEN;
        }
        
        if (!phoneNumberId || !accessToken) {
            return res.status(500).json({ 
                success: false, 
                message: userId 
                    ? "WhatsApp configuration not found. Please configure your WhatsApp settings."
                    : "WhatsApp credentials not configured"
            });
        }
        
        const url = `https://graph.facebook.com/v17.0/${phoneNumberId}/messages`;
        
        await axios.post(url, {
            messaging_product: "whatsapp",
            to: phone,
            text: { body: message }
        }, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            }
        });

        // B. Database mein Save karo (from: 'admin')
        const lead = await Lead.findById(leadId);
        if(lead) {
            lead.messages.push({
                text: message,
                from: 'admin',
                timestamp: new Date()
            });
            await lead.save();
            console.log("✅ Reply saved in DB");
        }

        res.status(200).json({ success: true, message: "Sent!" });

    } catch (error) {
        console.error("❌ Send Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, message: "Failed to send" });
    }
};

module.exports = { verifyWebhook, handleWebhook, getWhatsAppLeads, sendReply };