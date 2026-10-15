const Stripe = require('stripe');
const { checkAdmin, json, redact } = require('./_shared/admin-auth');

// Admin-only, read-only: confirms an admin test session was paid and returns
// what the owner needs to find and refund it in the Stripe dashboard.
// Refuses any session that isn't marked as an admin test.
exports.handler = async (event) => {
    const denied = checkAdmin(event, 'GET');
    if (denied) return denied;

    const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;
    if (!sessionId) {
        return json(400, { error: 'Missing session_id' });
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (!session.metadata || session.metadata.adminTest !== 'true') {
            return json(400, { error: 'That session is not an admin test session.' });
        }

        const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : null;
        return json(200, {
            paid: session.payment_status === 'paid',
            status: session.status,
            livemode: session.livemode,
            amount: session.amount_total,
            currency: session.currency,
            paymentIntentId,
            dashboardUrl: paymentIntentId
                ? `https://dashboard.stripe.com/${session.livemode ? '' : 'test/'}payments/${paymentIntentId}`
                : null
        });
    } catch (error) {
        console.error('Admin test verification failed:', redact(error.message));
        return json(500, { error: `Could not verify the test session: ${redact(error.message)}` });
    }
};
