const { PAYPAL_API_BASE, getAccessToken } = require('./_shared/paypal-client');
const { checkAdmin, json, redact, ADMIN_TEST_PAYPAL_CUSTOM_ID } = require('./_shared/admin-auth');

// Admin-only: captures an approved $1 admin test order and returns what the
// owner needs to find and refund it in PayPal. Refuses any order that isn't
// one of this tool's own $1 test orders, so it can't be pointed at a real
// registration payment.
function describe(order, mode) {
    const unit = (order.purchase_units || [])[0] || {};
    const capture = ((unit.payments && unit.payments.captures) || [])[0] || {};
    return {
        completed: order.status === 'COMPLETED',
        status: order.status,
        mode,
        captureId: capture.id || null,
        amount: capture.amount ? capture.amount.value : null,
        currency: capture.amount ? capture.amount.currency_code : null,
        payerEmail: (order.payer && order.payer.email_address) || null
    };
}

exports.handler = async (event) => {
    const denied = checkAdmin(event, 'POST');
    if (denied) return denied;

    let orderId;
    try {
        orderId = JSON.parse(event.body || '{}').orderId;
    } catch {
        return json(400, { error: 'Invalid JSON' });
    }
    if (typeof orderId !== 'string' || !/^[A-Za-z0-9]{8,40}$/.test(orderId)) {
        return json(400, { error: 'Missing or malformed orderId' });
    }

    const mode = process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';

    try {
        const accessToken = await getAccessToken();
        const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

        const lookup = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}`, { headers });
        if (!lookup.ok) {
            return json(404, { error: `PayPal does not know that order (HTTP ${lookup.status}).` });
        }
        const order = await lookup.json();
        const unit = (order.purchase_units || [])[0] || {};
        if (unit.custom_id !== ADMIN_TEST_PAYPAL_CUSTOM_ID || !unit.amount || unit.amount.value !== '1.00') {
            return json(400, { error: 'That order is not an admin test order.' });
        }

        // A double click must not fail just because the first one captured it.
        if (order.status === 'COMPLETED') {
            return json(200, describe(order, mode));
        }

        const res = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
            method: 'POST',
            headers,
            body: JSON.stringify({})
        });
        const captured = await res.json();
        if (!res.ok) {
            const issue = (captured.details && captured.details[0] && captured.details[0].issue) || captured.name || `HTTP ${res.status}`;
            return json(409, {
                error: issue === 'ORDER_NOT_APPROVED'
                    ? 'The PayPal order has not been approved yet.'
                    : `PayPal could not capture the order: ${redact(issue)}`
            });
        }
        return json(200, describe(captured, mode));
    } catch (error) {
        console.error('Admin PayPal test capture failed:', redact(error.message));
        return json(500, { error: `Could not capture the PayPal test order: ${redact(error.message)}` });
    }
};
