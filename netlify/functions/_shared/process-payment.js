const { getAccessToken } = require('./google-sheets-client');
const { claimOnce } = require('./payment-log');
const { notifyPaymentComplete } = require('./notify-payment-complete');
const { recordPaymentInSheets } = require('./record-payment');

const PAYMENT_TYPES = ['deposit', 'full', 'balance'];

// Records a confirmed payment and sends its email exactly once, however
// many times and from however many places it is reported (Stripe webhook,
// the browser's return trip, a page reload). Resolves to {duplicate,
// recorded}: recorded is false while the work is unfinished or failed, which
// the Stripe webhook turns into a 500 so Stripe retries later. If the
// payment log itself can't be reached, deferOnClaimError leaves everything
// for that retry; otherwise it goes ahead, since a duplicate email beats a
// lost payment.
async function claimPayment(payment) {
    const accessToken = await getAccessToken();
    return claimOnce(process.env.GOOGLE_SHEET_ID, accessToken, {
        ref: `${payment.provider}:${payment.ref}`,
        registrationId: payment.registrationId,
        type: payment.paymentType,
        detail: payment.amount
    });
}

async function processPayment(payment, { deferOnClaimError = false } = {}) {
    let claim;
    try {
        claim = await claimPayment(payment).catch((error) => {
            console.warn('Payment log claim failed, retrying once:', error.message);
            return claimPayment(payment);
        });
    } catch (error) {
        console.error('Payment log unavailable:', error);
        if (deferOnClaimError) return { duplicate: false, recorded: false };
        claim = { won: true, attempt: 1, settle: async () => {} };
    }

    if (!claim.won) {
        return { duplicate: true, recorded: claim.settled };
    }

    const paidAt = new Date();
    const [, recorded] = await Promise.all([
        // A retry after a failed sheet write only redoes the sheets - the
        // email already went out on the first attempt.
        claim.attempt === 1 ? notifyPaymentComplete({ ...payment, paidAt }) : null,
        recordPaymentInSheets(payment, paidAt)
    ]);
    await claim.settle(recorded ? 'done' : 'failed');
    return { duplicate: false, recorded };
}

// Sessions created before deposits existed carry no paymentType and were
// always full payments.
function paymentFromStripeSession(session) {
    const metadata = session.metadata || {};
    const email = (session.customer_details && session.customer_details.email) || session.customer_email;
    const [firstName, ...rest] = (metadata.name || '').trim().split(' ');
    return {
        ref: session.id,
        provider: 'stripe',
        paymentType: metadata.paymentType || 'full',
        registrationId: metadata.registrationId,
        workshop: metadata.workshop,
        amount: session.amount_total != null ? session.amount_total / 100 : null,
        name: metadata.name,
        email,
        depositAcknowledgedAt: metadata.depositAcknowledgedAt,
        fallbackData: { firstName, lastName: rest.join(' '), email, workshop: metadata.workshop, paymentOption: metadata.paymentOption }
    };
}

module.exports = { processPayment, paymentFromStripeSession, PAYMENT_TYPES };
