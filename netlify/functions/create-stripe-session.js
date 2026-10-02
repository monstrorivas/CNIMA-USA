const Stripe = require('stripe');
const { getPrice, WORKSHOP_LABELS } = require('./_shared/workshop-2027');

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

    const { workshop, paymentOption, email, name, registrationId } = payload;

    let amount;
    try {
        amount = getPrice(workshop, paymentOption);
    } catch (error) {
        return { statusCode: 400, body: error.message };
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = event.headers.origin || `https://${event.headers.host}`;

    try {
        const session = await stripe.checkout.sessions.create({
            ui_mode: 'embedded',
            mode: 'payment',
            customer_email: email || undefined,
            line_items: [{
                price_data: {
                    currency: 'usd',
                    unit_amount: amount * 100,
                    product_data: {
                        name: `CNIMA USA 2027 Workshop - ${WORKSHOP_LABELS[workshop]}`
                    }
                },
                quantity: 1
            }],
            metadata: { name: name || '', workshop, paymentOption, registrationId: registrationId || '' },
            // Embedded Checkout requires a return_url - Stripe always
            // redirects the whole page here once payment completes, even
            // in embedded mode. The {CHECKOUT_SESSION_ID} placeholder is
            // replaced by Stripe with the real session ID before redirecting,
            // which the page uses to verify and show a success state.
            return_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}#register`
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientSecret: session.client_secret })
        };
    } catch (error) {
        console.error('Stripe session creation failed:', error);
        return { statusCode: 500, body: 'Could not create Stripe session' };
    }
};
