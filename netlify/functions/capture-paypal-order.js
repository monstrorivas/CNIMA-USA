const { PAYPAL_API_BASE, getAccessToken } = require('./_shared/paypal-client');
const { processPayment } = require('./_shared/process-payment');
const { fromPaypalCustomId, findRegistration } = require('./_shared/resolve-payment');

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

    const { orderId, email: formEmail } = payload;
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
        let paymentType;

        if (completed) {
            // What was paid for and how much come from PayPal's own record
            // of the order (custom_id was set server-side at creation), and
            // so do the payer details - never from what the client claims,
            // same principle as never trusting a client-supplied price.
            const unit = (capture.purchase_units || [])[0] || {};
            const captured = ((unit.payments && unit.payments.captures) || [])[0] || {};
            const order = fromPaypalCustomId(unit.custom_id || captured.custom_id);
            const workshop = order.workshop || payload.workshop;
            const registrationId = order.registrationId || payload.registrationId;
            paymentType = order.paymentType || 'full';
            const amount = captured.amount ? Number(captured.amount.value) : null;

            const payer = capture.payer || {};
            let name = [payer.name && payer.name.given_name, payer.name && payer.name.surname]
                .filter(Boolean)
                .join(' ');
            let registeredEmail = formEmail;
            if (paymentType === 'balance') {
                try {
                    const registration = await findRegistration(registrationId);
                    if (registration) {
                        registeredEmail = registration.email;
                        name = `${registration.firstName} ${registration.lastName}`.trim() || name;
                    }
                } catch (error) {
                    console.error('Could not look up the registration for this balance payment:', error);
                }
            }

            await processPayment({
                ref: orderId,
                provider: 'paypal',
                paymentType,
                registrationId,
                workshop,
                amount,
                name,
                // PayPal's own payer email, plus whatever was typed into our
                // registration form - the sandbox/real buyer's PayPal account
                // can genuinely be a different address than the form, unlike
                // Stripe's prefilled-and-locked email field.
                email: [payer.email_address, registeredEmail],
                depositAcknowledgedAt: order.depositAcknowledgedAt,
                fallbackData: {
                    firstName: payer.name && payer.name.given_name,
                    lastName: payer.name && payer.name.surname,
                    email: payer.email_address || registeredEmail,
                    workshop,
                    paymentOption: paymentType === 'deposit' ? 'deposit' : payload.paymentOption
                }
            });
        }

        return {
            statusCode: completed ? 200 : 402,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                success: completed,
                status: capture.status,
                paymentType,
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
