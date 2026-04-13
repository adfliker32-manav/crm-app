require('dotenv').config();
const axios = require('axios'); // 👈 IMPORT KIYA
const Lead = require('../models/Lead');
const User = require('../models/User');
const WhatsAppConversation = require('../models/WhatsAppConversation');
const WhatsAppMessage = require('../models/WhatsAppMessage');

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
                            for (const statusObj of value.statuses) {
                                console.log(`📊 Status update: ${statusObj.status} for ${statusObj.id}`);
                                try {
                                    // Update the message status in the database
                                    await WhatsAppMessage.findOneAndUpdate(
                                        { waMessageId: statusObj.id },
                                        { $set: { status: statusObj.status, updatedAt: new Date() } }
                                    );
                                } catch (err) {
                                    console.error('Error updating message status:', err.message);
                                }
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

        // Find the tenant who owns this phone number via IntegrationConfig (proper multi-tenant lookup)
        const IntegrationConfig = require('../models/IntegrationConfig');
        const config = await IntegrationConfig.findOne({ "whatsapp.waPhoneNumberId": phoneNumberId })
            .populate('userId', 'email role parentId');
        let ownerUser = config?.userId || null;

        if (!ownerUser) {
            console.log(`⚠️  No tenant found for phone number ID: ${phoneNumberId}`);
            return;
        }

        // Normalize phone number (remove + and spaces)
        const normalizedPhone = from.replace(/[^0-9]/g, '');

        // Find lead using exact match (not regex — prevents ReDoS and collection scans)
        let lead = await Lead.findOne({ 
            phone: normalizedPhone,
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

        // ============================================
        // Sync to New Conversation Data Model
        // ⚠️ SECURITY FIX: Must set waContactId (required field)
        // ⚠️ PERFORMANCE FIX: Use indexed field (waContactId) not unindexed (phone)
        // ============================================
        const waMessageId = messageObj.id;

        let conversation = await WhatsAppConversation.findOne({
            userId: ownerUser._id,
            waContactId: normalizedPhone
        });

        if (!conversation) {
            conversation = new WhatsAppConversation({
                userId: ownerUser._id,
                leadId: lead._id,
                waContactId: normalizedPhone,
                phone: normalizedPhone,
                displayName: name,
                status: 'active',
                unreadCount: 0,
                metadata: { totalMessages: 0, totalInbound: 0, totalOutbound: 0 }
            });
        }

        // Ensure leadId is attached if it wasn't before
        if (!conversation.leadId && lead._id) {
            conversation.leadId = lead._id;
        }

        // Create Message
        const messageRecord = new WhatsAppMessage({
            conversationId: conversation._id,
            userId: ownerUser._id,
            waMessageId: waMessageId,
            direction: 'inbound',
            type: messageType,
            content: { text: msgBody },
            status: 'delivered',  // Inbound is delivered by definition
            timestamp: new Date(),
            isAutomated: false
        });

        // Avoid duplicate saves if Meta sends the same webhook
        const existingMsg = await WhatsAppMessage.findOne({ waMessageId: waMessageId });
        if (!existingMsg) {
            await messageRecord.save();

            // Update Conversation using atomic query to prevent race conditions
            await WhatsAppConversation.findByIdAndUpdate(conversation._id, {
                $set: {
                    lastMessage: msgBody.substring(0, 100),
                    lastMessageAt: new Date(),
                    lastMessageDirection: 'inbound'
                },
                $inc: { 
                    unreadCount: 1,
                    'metadata.totalMessages': 1,
                    'metadata.totalInbound': 1
                }
            });
            console.log(`✅ Synced into WhatsAppConversation DB: ${conversation._id}`);
        } else {
            console.log(`⚠️ Duplicate webhook message id ${waMessageId} ignored.`);
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

        // Get user credentials (per-tenant, no .env fallback)
        const userId = req.user?.userId || req.user?.id;
        const { getUserWhatsAppCredentials } = require('../utils/whatsappUtils');
        
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const userCredentials = await getUserWhatsAppCredentials(userId);
        if (!userCredentials || !userCredentials.phoneNumberId || !userCredentials.accessToken) {
            return res.status(400).json({ 
                success: false, 
                message: 'WhatsApp not configured. Go to Settings → WhatsApp Config to set up your credentials.'
            });
        }

        const { phoneNumberId, accessToken } = userCredentials;
        
        const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
        
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
        let errorMsg = error.message;
        if (error.response && error.response.data && error.response.data.error) {
            const metaError = error.response.data.error;
            errorMsg = metaError.message || metaError.error_user_msg || 'WhatsApp API Error';
            if (metaError.code === 131009) {
                errorMsg = "User must register a valid template format before sending (Wait for approval)";
            } else if (metaError.code === 131026) {
                errorMsg = "Message undeliverable. User has not interacted with the business or is outside the 24h window.";
            } else if (metaError.code) {
                errorMsg = `Meta API Error (${metaError.code}): ${errorMsg}`;
            }
        }
        console.error("❌ Send Error:", errorMsg);
        res.status(error.response?.status || 500).json({ 
            success: false, 
            message: `Failed to send: ${errorMsg}` 
        });
    }
};

module.exports = { verifyWebhook, handleWebhook, getWhatsAppLeads, sendReply };