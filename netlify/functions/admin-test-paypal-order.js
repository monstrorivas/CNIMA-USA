const { PAYPAL_API_BASE, getAccessToken } = require('./_shared/paypal-client');
const { checkAdmin, json, redact, ADMIN_TEST_PAYPAL_CUSTOM_ID } = require('./_shared/admin-auth');

// Admin-only. GET reports whether PayPal is in sandbox or live mode so the
// page can say so before anyone pays; POST creates a PayPal order for exactly
// $1.00. Like the Stripe test it has no registration data, writes nothing to
// Google Sheets and sends no emails.
exports.handler = async (event) => {
    const denied = checkAdmin(event, event.httpMethod === 'GET' ? 'GET' : 'POST');
    if (denied) return denied;

    const mode = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
    if (event.httpMethod === 'GET') {
        return json(200, { mode });
    }

    try {
        const accessToken = await getAccessToken();
        const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [{
                    description: 'CNIMA USA admin test payment ($1)',
                    custom_id: ADMIN_TEST_PAYPAL_CUSTOM_ID,
                    amount: { currency_code: 'USD', value: '1.00' }
                }]
            })
        });
        if (!res.ok) {
            throw new Error(`PayPal order creation failed: HTTP ${res.status}`);
        }
        const order = await res.json();
        return json(200, { orderId: order.id, mode });
    } catch (error) {
        console.error('Admin PayPal test order creation failed:', redact(error.message));
        return json(500, { error: `Could not create the PayPal test order: ${redact(error.message)}` });
    }
};
