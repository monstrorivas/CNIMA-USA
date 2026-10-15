const { PAYPAL_API_BASE, getAccessToken } = require('./_shared/paypal-client');
const { resolvePayment, toPaypalCustomId, PaymentRequestError } = require('./_shared/resolve-payment');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    let payment;
    try {
        payment = await resolvePayment(payload);
    } catch (error) {
        if (error instanceof PaymentRequestError) {
            return { statusCode: error.statusCode, body: error.message };
        }
        console.error('Could not work out the amount to charge:', error);
        return { statusCode: 500, body: 'Could not create PayPal order' };
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
                    description: payment.description,
                    custom_id: toPaypalCustomId(payment),
                    amount: { currency_code: 'USD', value: payment.amount.toFixed(2) }
                }]
            })
        });

        if (!res.ok) {
            throw new Error(`PayPal order creation failed: ${res.status}`);
        }

        const order = await res.json();
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id })
        };
    } catch (error) {
        console.error('PayPal order creation failed:', error);
        return { statusCode: 500, body: 'Could not create PayPal order' };
    }
};
