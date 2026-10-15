const Stripe = require('stripe');
const { checkAdmin, json, redact } = require('./_shared/admin-auth');

// Admin-only: creates an embedded Checkout Session for exactly $1 so the
// owner can prove a real card payment works end to end. Deliberately has no
// registration data, writes nothing to Google Sheets and sends no emails.
exports.handler = async (event) => {
    const denied = checkAdmin(event, 'POST');
    if (denied) return denied;

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    try {
        const session = await stripe.checkout.sessions.create({
            ui_mode: 'embedded',
            mode: 'payment',
            payment_method_types: ['card'],
            // The page learns about completion through Stripe.js's onComplete
            // callback instead of a redirect, then verifies server-side.
            redirect_on_completion: 'never',
            line_items: [{
                price_data: {
                    currency: 'usd',
                    unit_amount: 100,
                    product_data: { name: 'CNIMA USA admin test payment ($1) - refund me' }
                },
                quantity: 1
            }],
            metadata: { adminTest: 'true' },
            payment_intent_data: {
                description: 'CNIMA USA admin test payment - refund me',
                metadata: { adminTest: 'true' }
            }
        });

        return json(200, { clientSecret: session.client_secret, sessionId: session.id });
    } catch (error) {
        console.error('Admin test session creation failed:', redact(error.message));
        return json(500, { error: `Could not create the test session: ${redact(error.message)}` });
    }
};
