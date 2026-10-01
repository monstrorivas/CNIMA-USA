const { getPrice, WORKSHOP_LABELS } = require('./_shared/workshop-2027');
const { PAYPAL_API_BASE, getAccessToken } = require('./_shared/paypal-client');
const { notifyPaymentComplete } = require('./_shared/notify-payment-complete');

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

    const { orderId, workshop, paymentOption } = payload;
    if (!orderId) {
        return { statusCode: 400, body: 'Missing orderId' };
    }

    try {
        const accessToken = await getAccessToken();
        const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            // PayPal's capture endpoint can reject a request that declares
            // JSON content-type but sends zero bytes - an empty object body
            // is the documented way to call this with no extra parameters.
            body: JSON.stringify({})
        });

        const capture = await res.json();

        if (!res.ok) {
            console.error('PayPal capture request failed:', res.status, JSON.stringify(capture));
        }

        const completed = res.ok && capture.status === 'COMPLETED';

        if (completed) {
            // Use PayPal's own confirmed payer details rather than trusting
            // whatever the client claims - same principle as never trusting
            // a client-supplied price.
            const payer = capture.payer || {};
            const name = [payer.name && payer.name.given_name, payer.name && payer.name.surname]
                .filter(Boolean)
                .join(' ');
            let amount = null;
            try {
                amount = getPrice(workshop, paymentOption);
            } catch {
                // Unknown workshop/paymentOption combo - still notify, just without an amount.
            }

            await notifyPaymentComplete({
                provider: 'paypal',
                name,
                email: payer.email_address,
                workshop,
                workshopLabel: workshop ? WORKSHOP_LABELS[workshop] : undefined,
                paymentOption,
                amount
            });
        }

        return {
            statusCode: completed ? 200 : 402,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: completed,
                status: capture.status,
                // PayPal's own error name/detail, not sensitive - useful for
                // diagnosing a failed capture from the browser console.
                details: completed ? undefined : (capture.name || capture.message)
            })
        };
    } catch (error) {
        console.error('PayPal capture failed:', error);
        return { statusCode: 500, body: 'Could not capture PayPal order' };
    }
};
