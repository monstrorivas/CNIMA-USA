const RESEND_API_URL = 'https://api.resend.com/emails';

// Fires exactly once, at the moment a payment is confirmed complete (never
// on form submission alone) - sends the confirmation email directly via
// Resend. Never throws: a failed notification shouldn't break the payment
// success response the user actually sees, so every failure is caught and
// logged instead.
//
// `email` can be a single address or an array - PayPal's buyer can approve
// payment while logged into a PayPal account whose email differs from the
// one typed into our own registration form (unlike Stripe, which locks the
// prefilled email field), so capture-paypal-order.js passes both and this
// sends to whichever of them are actually present, deduped.
async function notifyPaymentComplete({ name, email, workshopLabel, amount, provider }) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM_EMAIL;

    if (!apiKey || !fromAddress) {
        console.warn('RESEND_API_KEY or RESEND_FROM_EMAIL not set - skipping payment-complete email.');
        return;
    }
    const recipients = [...new Set([].concat(email).filter(Boolean))];
    if (recipients.length === 0) {
        console.warn('No registrant email available - skipping payment-complete email.');
        return;
    }

    const firstName = (name || '').trim().split(' ')[0] || 'there';
    const amountText = amount ? `$${amount}` : 'your registration fee';
    const methodText = provider === 'paypal' ? 'PayPal' : 'card';
    const workshopText = workshopLabel || 'the CNIMA USA Accordion Workshop';

    const text = `Hi ${firstName},

Your registration and payment (${amountText}, via ${methodText}) for ${workshopText} are confirmed.

We can't wait to see you in New Orleans! If you have any questions in the meantime, just reply to this email or reach us at registrations@cnimausa.com.

See you soon,
CNIMA USA`;

    try {
        const res = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: fromAddress,
                to: recipients,
                // User-facing correspondence address is registrations@ - it's
                // cc'd (visible to the registrant) so it has its own copy in
                // the thread, while cnimausa@ is bcc'd (admin-only visibility,
                // not shown to the registrant or exposed on reply-all). Both
                // get a copy here specifically (not via a second,
                // submission-triggered Netlify Forms notification) because
                // this only ever fires once payment is actually confirmed -
                // a submission-triggered notification would fire for anyone
                // who registered but abandoned payment, putting it out of
                // sync with what this confirmation email represents.
                reply_to: 'registrations@cnimausa.com',
                cc: 'registrations@cnimausa.com',
                bcc: 'cnimausa@gmail.com',
                subject: "You're confirmed for CNIMA USA 2027!",
                text
            })
        });

        if (!res.ok) {
            console.error('Resend email failed:', res.status, await res.text());
        }
    } catch (error) {
        console.error('Resend email request failed:', error);
    }
}

module.exports = { notifyPaymentComplete };
