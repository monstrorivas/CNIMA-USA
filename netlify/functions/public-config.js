const { isEarlyBird } = require('./_shared/workshop-2027');

// Exposes the two PUBLIC (non-secret) identifiers the front-end needs to
// initialize Stripe.js and the PayPal SDK. Publishable keys and client IDs
// are meant to be public - this just avoids hardcoding them in a committed
// JS file, so switching test/live only means changing environment
// variables, not editing code. earlyBirdOpen lets the form offer exactly
// the options the server will still charge for.
exports.handler = async () => {
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify({
            stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
            paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
            earlyBirdOpen: isEarlyBird(new Date())
        })
    };
};
