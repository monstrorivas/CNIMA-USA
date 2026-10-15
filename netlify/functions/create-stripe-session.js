const Stripe = require('stripe');
const { resolvePayment, PaymentRequestError } = require('./_shared/resolve-payment');
const { balanceLinkQuery } = require('./_shared/balance-link');

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
        return { statusCode: 500, body: 'Could not create Stripe session' };
    }

    const email = payment.email || payload.email;
    const name = payment.name || payload.name;
    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = event.headers.origin || `https://${event.headers.host}`;
    // The balance page comes back to itself; everything else to the
    // registration section.
    const returnPage = payment.paymentType === 'balance'
        ? `/pay-balance.html?${balanceLinkQuery(payment.registrationId)}&`
        : '/?';

    try {
        const session = await stripe.checkout.sessions.create({
            ui_mode: 'embedded',
            mode: 'payment',
            // This box is explicitly labeled "Pay by Card" (PayPal is its own
            // separate flow below it) - without this, Stripe auto-enables
            // whatever's turned on in the Dashboard (Link, Cash App, Affirm,
            // Klarna...) and picks its own default/ordering, which is how
            // Link ends up pre-selected ahead of the card form.
            payment_method_types: ['card'],
            customer_email: email || undefined,
            line_items: [{
                price_data: {
                    currency: 'usd',
                    unit_amount: payment.amount * 100,
                    product_data: { name: payment.description }
                },
                quantity: 1
            }],
            metadata: {
                name: name || '',
                workshop: payment.workshop,
                paymentOption: payment.paymentOption || '',
                paymentType: payment.paymentType,
                registrationId: payment.registrationId || '',
                depositAcknowledgedAt: payment.depositAcknowledgedAt || ''
            },
            // Embedded Checkout requires a return_url - Stripe always
            // redirects the whole page here once payment completes, even
            // in embedded mode. The {CHECKOUT_SESSION_ID} placeholder is
            // replaced by Stripe with the real session ID before redirecting,
            // which the page uses to verify and show a success state.
            return_url: `${origin}${returnPage}session_id={CHECKOUT_SESSION_ID}${payment.paymentType === 'balance' ? '' : '#register'}`
        });

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientSecret: session.client_secret, amount: payment.amount })
        };
    } catch (error) {
        console.error('Stripe session creation failed:', error);
        return { statusCode: 500, body: 'Could not create Stripe session' };
    }
};
