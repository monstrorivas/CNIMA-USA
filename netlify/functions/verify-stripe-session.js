const Stripe = require('stripe');
const { notifyPaymentComplete } = require('./_shared/notify-payment-complete');
const { getPrice, WORKSHOP_LABELS } = require('./_shared/workshop-2027');

// Called when the page reloads after Stripe's required return_url redirect,
// to confirm the session actually completed before showing a success state -
// never trust that redirect alone, since a URL can be visited without paying.
exports.handler = async (event) => {
    const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;
    if (!sessionId) {
        return { statusCode: 400, body: 'Missing session_id' };
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const paid = session.payment_status === 'paid';
        const { name, workshop, paymentOption } = session.metadata || {};

        if (paid) {
            const email = (session.customer_details && session.customer_details.email) || session.customer_email;
            let amount = null;
            try {
                amount = getPrice(workshop, paymentOption);
            } catch {
                // Unknown workshop/paymentOption combo - still notify, just without an amount.
            }

            await notifyPaymentComplete({
                provider: 'stripe',
                name,
                email,
                workshop,
                workshopLabel: WORKSHOP_LABELS[workshop],
                paymentOption,
                amount
            });
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paid, workshop })
        };
    } catch (error) {
        console.error('Stripe session verification failed:', error);
        return { statusCode: 500, body: 'Could not verify Stripe session' };
    }
};
