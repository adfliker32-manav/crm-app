// Loads Razorpay Checkout JS on demand and opens the subscription mandate popup.
//
// How this SDK works:
//   - Opens a POPUP (not a page redirect). The page does NOT reload.
//   - handler(response) fires on success — no return URL redirect needed.
//   - modal.ondismiss fires when the user closes the popup without paying.
//   - subscription_id = Razorpay's sub_XXXXXXX (passed at checkout init).

let sdkPromise = null;

const loadRazorpaySdk = () => {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.async = true;
        s.onload  = () => window.Razorpay
            ? resolve(window.Razorpay)
            : reject(new Error('Razorpay SDK loaded but global Razorpay() is missing'));
        s.onerror = () => {
            sdkPromise = null;
            reject(new Error('Failed to load Razorpay Checkout SDK'));
        };
        document.head.appendChild(s);
    });
    return sdkPromise;
};

/**
 * Opens the Razorpay subscription mandate popup.
 *
 * @param {string}   razorpaySubscriptionId  sub_XXXXXXX returned by the backend
 * @param {string}   keyId                   RAZORPAY_KEY_ID (rzp_test_... or rzp_live_...)
 * @param {string}   [planName]              Shown in popup header
 * @param {string}   [customerName]
 * @param {string}   [customerEmail]
 * @param {string}   [customerPhone]         10-digit mobile
 * @param {Function} [onSuccess]             Called with Razorpay response on mandate success
 * @param {Function} [onDismiss]             Called when user closes popup
 * @returns {Promise<object>}               Resolves with Razorpay response or rejects on dismiss
 */
export const openSubscriptionCheckout = async ({
    razorpaySubscriptionId,
    keyId,
    planName = 'CRM Subscription',
    customerName  = '',
    customerEmail = '',
    customerPhone = '',
    onSuccess,
    onDismiss
}) => {
    if (!razorpaySubscriptionId) throw new Error('Missing razorpaySubscriptionId');
    if (!keyId)                  throw new Error('Missing Razorpay key_id');

    const RazorpayFactory = await loadRazorpaySdk();

    return new Promise((resolve, reject) => {
        const rzp = new RazorpayFactory({
            key:             keyId,
            subscription_id: razorpaySubscriptionId,
            name:            'Adfliker CRM',
            description:     planName,
            prefill: {
                name:    customerName,
                email:   customerEmail,
                contact: customerPhone
            },
            theme: { color: '#6366f1' },
            handler: (response) => {
                // Called on successful mandate authorization / first payment.
                // response = { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
                onSuccess?.(response);
                resolve(response);
            },
            modal: {
                ondismiss: () => {
                    onDismiss?.();
                    reject(new Error('Razorpay Checkout closed by user'));
                },
                // Escape key and backdrop click both call ondismiss
                escape: true,
                backdropclose: false
            }
        });
        rzp.open();
    });
};

/**
 * Opens the Razorpay Checkout popup for a ONE-TIME Order (e.g. AI credit top-up).
 *
 * Differs from openSubscriptionCheckout by passing `order_id` instead of
 * `subscription_id`. On success the handler receives:
 *   { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * which the caller sends to the backend /ai-credits/verify to be signature-checked
 * and fulfilled. The server order is authoritative for the amount — the `amount`
 * passed here is display-only.
 *
 * @param {string}   orderId        order_XXXXXXX returned by the backend
 * @param {string}   keyId          RAZORPAY_KEY_ID
 * @param {number}   [amount]       amount in PAISE (display only)
 * @param {string}   [description]  shown in popup header
 * @param {string}   [customerName]
 * @param {string}   [customerEmail]
 * @param {string}   [customerPhone]
 * @param {Function} [onSuccess]
 * @param {Function} [onDismiss]
 * @returns {Promise<object>}       resolves with Razorpay response, rejects on dismiss
 */
export const openOrderCheckout = async ({
    orderId,
    keyId,
    amount,
    description   = 'AI Credit Top-up',
    customerName  = '',
    customerEmail = '',
    customerPhone = '',
    onSuccess,
    onDismiss
}) => {
    if (!orderId) throw new Error('Missing orderId');
    if (!keyId)   throw new Error('Missing Razorpay key_id');

    const RazorpayFactory = await loadRazorpaySdk();

    return new Promise((resolve, reject) => {
        const rzp = new RazorpayFactory({
            key:      keyId,
            order_id: orderId,
            amount,               // paise — display only; server order is authoritative
            currency: 'INR',
            name:     'Adfliker CRM',
            description,
            prefill: {
                name:    customerName,
                email:   customerEmail,
                contact: customerPhone
            },
            theme: { color: '#6366f1' },
            handler: (response) => {
                // response = { razorpay_payment_id, razorpay_order_id, razorpay_signature }
                onSuccess?.(response);
                resolve(response);
            },
            modal: {
                ondismiss: () => {
                    onDismiss?.();
                    reject(new Error('Razorpay Checkout closed by user'));
                },
                escape: true,
                backdropclose: false
            }
        });
        rzp.open();
    });
};

export default { openSubscriptionCheckout, openOrderCheckout };
