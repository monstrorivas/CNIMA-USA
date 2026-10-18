const Stripe = require('stripe');
const { processPayment, paymentFromStripeSession, PAYMENT_TYPES } = require('./_shared/process-payment');

// Stripe -> Developers -> Webhooks endpoint for checkout.session.completed,
// so a payment is recorded and confirmed even if the registrant closes the
// tab before Stripe's redirect brings them back to verify-stripe-session.
// Both paths go through processPayment, which lets only one of them act.
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        console.error('STRIPE_WEBHOOK_SECRET not set - rejecting webhook.');
        return { statusCode: 500, body: 'Webhook not configured' };
    }

    // The signature covers the exact raw bytes Stripe sent.
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const signature = event.headers['stripe-signature'];

    let stripeEvent;
    try {
        stripeEvent = Stripe(process.env.STRIPE_SECRET_KEY).webhooks.constructEvent(rawBody, signature, secret);
    } catch (error) {
        console.warn('Stripe webhook signature check failed:', error.message);
        return { statusCode: 400, body: 'Invalid signature' };
    }

    if (stripeEvent.type !== 'checkout.session.completed') {
        return { statusCode: 200, body: 'Ignored' };
    }

    const session = stripeEvent.data.object;
    const metadata = session.metadata || {};
    // The same Stripe account can complete checkouts that aren't
    // registrations (e.g. admin test payments) - leave those alone.
    if (!PAYMENT_TYPES.includes(metadata.paymentType) || !metadata.workshop) {
        return { statusCode: 200, body: 'Not a registration payment' };
    }
    if (session.payment_status !== 'paid') {
        return { statusCode: 200, body: 'Not paid' };
    }

    try {
        const { duplicate, recorded } = await processPayment(paymentFromStripeSession(session), { deferOnClaimError: true });
        if (!recorded) {
            return { statusCode: 500, body: 'Not recorded yet - retry later' };
        }
        return { statusCode: 200, body: duplicate ? 'Already recorded' : 'Recorded' };
    } catch (error) {
        console.error('Stripe webhook processing failed:', error);
        return { statusCode: 500, body: 'Processing failed' };
    }
};
