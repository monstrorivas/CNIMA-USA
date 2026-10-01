const Stripe = require('stripe');

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
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                paid: session.payment_status === 'paid',
                workshop: session.metadata && session.metadata.workshop
            })
        };
    } catch (error) {
        console.error('Stripe session verification failed:', error);
        return { statusCode: 500, body: 'Could not verify Stripe session' };
    }
};
