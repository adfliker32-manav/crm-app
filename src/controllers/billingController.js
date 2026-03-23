const CashfreeService = require('../services/cashfreeService');
const User = require('../models/User');
const AgencySettings = require('../models/AgencySettings');
const bcrypt = require('bcryptjs');

const provisionClientSubscription = async (req, res) => {
    try {
        const { planTier, companyName, adminEmail, adminName } = req.body;

        if (!planTier || !companyName || !adminEmail) {
            return res.status(400).json({ message: "All fields are required to provision a sub-tenant." });
        }

        // 1. Resolve Pricing Tier (Mocking logic; usually tied to a Config/DB Model)
        let monthlyCost = 0;
        if (planTier === 'Basic') monthlyCost = 4900; // $49/mo -> roughly INR 4000
        if (planTier === 'Premium') monthlyCost = 14900; 
        
        // Trial logic skips gateway validation in reality, but we generate the flow regardless
        if (planTier === 'Trial') monthlyCost = 1; 

        // 2. We generate a Ghost User entity to secure the ID for Cashfree mapping
        const ghostCustomer = {
            _id: `ghost_${Date.now()}`, // Temporary sync ID. We finalize user creation in the webhook.
            name: adminName || companyName,
            email: adminEmail,
            phone: '9999999999'
        };

        const planDetails = {
            name: planTier,
            monthlyCost
        };

        // 3. Initiate Cashfree Checkout Session
        const checkoutSession = await CashfreeService.createSubscriptionCheckout(planDetails, ghostCustomer);

        res.status(200).json({
            success: true,
            checkoutUrl: checkoutSession.payment_session_id, // Returning session ID or Hosted URL
            hostedUrl: checkoutSession.payment_links?.web
        });

    } catch (error) {
        console.error("Provisioning Core Error:", error);
        res.status(500).json({ success: false, message: error.message || "Server Error" });
    }
};

const handleCashfreeWebhook = async (req, res) => {
    try {
        // Cashfree payload signature validation
        const signature = req.headers['x-webhook-signature'];
        const timestamp = req.headers['x-webhook-timestamp'];
        const rawBody = JSON.stringify(req.body);

        const isValid = CashfreeService.verifyWebhookSignature(signature, rawBody, timestamp);
        if (!isValid) {
            return res.status(401).json({ message: "Counterfeit Webhook Intercepted." });
        }

        const eventType = req.body.type;
        const payload = req.body.data;

        if (eventType === 'PAYMENT_SUCCESS_WEBHOOK') {
            const order = payload.order;
            const customer = payload.customer_details;
            console.log(`✅ Cashfree payment verified for order: ${order?.order_id}`);

            // Parse metadata from order_note: "Subscription: Trial Tier | agency:AGENCYID | email:EMAIL | company:NAME"
            const note = order?.order_note || '';
            const agencyMatch = note.match(/agency:([\w]+)/);
            const emailMatch = note.match(/email:([\S]+)/);
            const companyMatch = note.match(/company:([^|]+)/);

            const clientEmail = emailMatch?.[1] || customer?.customer_email;
            const agencyId = agencyMatch?.[1];
            const companyName = companyMatch?.[1]?.trim() || 'New Client';

            if (clientEmail) {
                // Check if this user was already created (idempotent)
                const existingUser = await User.findOne({ email: clientEmail });
                if (!existingUser) {
                    const tempPassword = Math.random().toString(36).slice(-8);
                    const hashed = await bcrypt.hash(tempPassword, 10);

                    const newClient = new User({
                        name: customer?.customer_name || companyName,
                        email: clientEmail,
                        password: hashed,
                        role: 'manager',
                        companyName,
                        agencyId: agencyId || null,
                        status: 'Active'
                    });
                    await newClient.save();

                    // Initialise their AgencySettings defaults
                    await AgencySettings.create({ agencyId: agencyId || newClient._id });

                    console.log(`✅ Auto-provisioned new CRM Manager: ${clientEmail} (pwd: ${tempPassword})`);
                    // TODO: Send welcome email with temp password via nodemailer
                } else {
                    // Reactivate if suspended
                    await User.findByIdAndUpdate(existingUser._id, { status: 'Active' });
                    console.log(`✅ Reactivated existing user: ${clientEmail}`);
                }
            }
        }

        res.status(200).send("Webhook Received.");
    } catch (error) {
        console.error("Webhook processing error:", error);
        res.status(500).send("Webhook Error");
    }
};

module.exports = {
    provisionClientSubscription,
    handleCashfreeWebhook
};
