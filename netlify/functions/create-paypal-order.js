const { getPrice, WORKSHOP_LABELS } = require('./_shared/workshop-2027');
const { PAYPAL_API_BASE, getAccessToken } = require('./_shared/paypal-client');

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

    const { workshop, paymentOption } = payload;

    let amount;
    try {
        amount = getPrice(workshop, paymentOption);
    } catch (error) {
        return { statusCode: 400, body: error.message };
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
                    description: `CNIMA USA 2027 Workshop - ${WORKSHOP_LABELS[workshop]}`,
                    amount: { currency_code: 'USD', value: amount.toFixed(2) }
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
