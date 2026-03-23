const { Cashfree } = require('cashfree-pg');
const crypto = require('crypto');

// Initialize Cashfree SDK Environment
Cashfree.XClientId = process.env.CASHFREE_APP_ID || 'TEST_APP_ID';
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY || 'TEST_SECRET_KEY';
Cashfree.XEnvironment = process.env.NODE_ENV === 'production' ? Cashfree.Environment.PRODUCTION : Cashfree.Environment.SANDBOX;

class CashfreeService {
    
    /**
     * Initializes a recurring SaaS subscription on Cashfree.
     * @param {Object} plan Details of the plan (name, monthlyCost)
     * @param {Object} customer Details of the customer (email, phone, name)
     * @returns {Object} Checkout Session Data
     */
    static async createSubscriptionCheckout(plan, customer) {
        try {
            // Generates a mock checkout payload since actual Subscriptions require specific Cashfree API v3 headers.
            // Using the Orders API payload format commonly adapted for unified checkouts.
            const request = {
                order_amount: plan.monthlyCost,
                order_currency: "INR",
                customer_details: {
                    customer_id: `cust_${customer._id.toString()}`,
                    customer_name: customer.name,
                    customer_email: customer.email,
                    customer_phone: customer.phone || '9999999999'
                },
                order_meta: {
                    return_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/agency/dashboard?session_id={order_id}`,
                    notify_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/webhooks/cashfree`
                },
                order_note: `Subscription: ${plan.name} Tier`
            };

            const response = await Cashfree.PGCreateOrder("2023-08-01", request);
            return response.data;
        } catch (error) {
            console.error('Cashfree SDK Error:', error.response?.data || error.message);
            throw new Error('Failed to initialize Cashfree Gateway.');
        }
    }

    /**
     * Verifies the Webhook HMAC Signature from Cashfree.
     * @param {String} signature The header signature.
     * @param {String} rawBody The raw stringified JSON body of the request.
     * @param {String} timestamp The header timestamp.
     * @returns {Boolean}
     */
    static verifyWebhookSignature(signature, rawBody, timestamp) {
        try {
            const body = timestamp + rawBody;
            const secretKey = Cashfree.XClientSecret;
            const generatedSignature = crypto.createHmac('sha256', secretKey).update(body).digest('base64');
            return generatedSignature === signature;
        } catch (error) {
            return false;
        }
    }
}

module.exports = CashfreeService;
