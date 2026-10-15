const {
    WORKSHOP_LABELS,
    DEPOSIT_AMOUNT,
    EARLYBIRD_DEADLINE_LABEL,
    getPrice,
    getBalanceAmount,
    isEarlyBird
} = require('./workshop-2027');
const { balanceLinkUrl } = require('./balance-link');

const RESEND_API_URL = 'https://api.resend.com/emails';

// User-facing correspondence address is registrations@ - it's cc'd (visible
// to the registrant) so it has its own copy in the thread, while cnimausa@
// is bcc'd (admin-only visibility, not shown to the registrant or exposed
// on reply-all). Both get a copy of payment emails specifically (not via a
// second, submission-triggered Netlify Forms notification) because these
// only ever fire once payment is actually confirmed - a submission-triggered
// notification would fire for anyone who registered but abandoned payment,
// putting it out of sync with what this confirmation email represents.
// Reminders and re-sent links go to the registrant alone.
const REPLY_TO = 'registrations@cnimausa.com';
const ADMIN_COPIES = { cc: 'registrations@cnimausa.com', bcc: 'cnimausa@gmail.com' };

const SIGN_OFF = `If you have any questions in the meantime, just reply to this email or reach us at registrations@cnimausa.com.

See you soon,
CNIMA USA`;

function money(amount) {
    return `$${Number(amount).toLocaleString('en-US')}`;
}

function firstNameOf(name) {
    return (name || '').trim().split(' ')[0] || 'there';
}

function workshopTextOf(workshop) {
    return WORKSHOP_LABELS[workshop] || 'the CNIMA USA Accordion Workshop';
}

// `email` can be a single address or an array - PayPal's buyer can approve
// payment while logged into a PayPal account whose email differs from the
// one typed into our own registration form (unlike Stripe, which locks the
// prefilled email field), so capture-paypal-order.js passes both and this
// sends to whichever of them are actually present, deduped.
function recipientsOf(email) {
    const byLowercase = new Map();
    [].concat(email).filter(Boolean).forEach((address) => {
        const trimmed = address.trim();
        if (trimmed && !byLowercase.has(trimmed.toLowerCase())) byLowercase.set(trimmed.toLowerCase(), trimmed);
    });
    return [...byLowercase.values()];
}

function balanceLinkOrNull(registrationId) {
    try {
        return registrationId ? balanceLinkUrl(registrationId) : null;
    } catch (error) {
        console.error('Could not build balance link:', error);
        return null;
    }
}

// Sends one or more emails (Resend's batch endpoint for several). Never
// throws: a failed email shouldn't break the payment response the user
// actually sees, so every failure is caught and logged and reported as
// false instead.
async function sendEmails(emails) {
    const apiKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM_EMAIL;

    if (!apiKey || !fromAddress) {
        console.warn('RESEND_API_KEY or RESEND_FROM_EMAIL not set - skipping email.');
        return false;
    }
    if (emails.length === 0) return true;

    const payload = emails.map((email) => ({ from: fromAddress, reply_to: REPLY_TO, ...email }));
    try {
        const res = await fetch(payload.length === 1 ? RESEND_API_URL : `${RESEND_API_URL}/batch`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload.length === 1 ? payload[0] : payload)
        });

        if (!res.ok) {
            console.error('Resend email failed:', res.status, await res.text());
            return false;
        }
        return true;
    } catch (error) {
        console.error('Resend email request failed:', error);
        return false;
    }
}

function depositText({ name, workshop, amount, provider, registrationId, paidAt }) {
    const viaText = provider === 'paypal' ? ', via PayPal' : '';
    const link = balanceLinkOrNull(registrationId);
    let balanceNow = null;
    let balanceLater = null;
    try {
        balanceNow = getBalanceAmount(workshop, paidAt);
        balanceLater = getPrice(workshop, 'full') - DEPOSIT_AMOUNT;
    } catch {
        // Unknown workshop - the email still goes out, just without amounts.
    }
    const locked = isEarlyBird(paidAt);
    const linkText = link
        ? `Pay it any time with your personal payment link (by card, digital wallet, or PayPal):\n${link}\n\nThe link is just for you, so please don't share it.`
        : 'Reply to this email and we will send you a link to pay it.';

    const balanceLine = balanceNow == null
        ? `Your remaining balance is due by ${EARLYBIRD_DEADLINE_LABEL}.`
        : locked
            ? `Remaining balance: ${money(balanceNow)}, due by ${EARLYBIRD_DEADLINE_LABEL}.`
            : `Remaining balance: ${money(balanceNow)}.`;
    const lateLine = locked && balanceLater != null
        ? `\n\nAfter ${EARLYBIRD_DEADLINE_LABEL} you can still pay with the same link, but the balance will be based on full tuition (${money(balanceLater)}).`
        : '';

    return `Hi ${firstNameOf(name)},

We've received your non-refundable deposit (${money(amount || DEPOSIT_AMOUNT)}${viaText}) for ${workshopTextOf(workshop)}. Your spot${locked ? ' and the early-bird rate are' : ' is'} locked in.

${balanceLine}

${linkText}${lateLine}

${SIGN_OFF}`;
}

function confirmationText({ paymentType, name, workshop, amount, provider }) {
    const viaText = provider === 'paypal' ? ', via PayPal' : '';
    const amountText = amount ? money(amount) : 'your registration fee';
    const paymentText = paymentType === 'balance'
        ? `Your balance payment (${amountText}${viaText}) has been received - you are now paid in full for ${workshopTextOf(workshop)}, and your registration is confirmed.`
        : `Your registration and payment (${amountText}${viaText}) for ${workshopTextOf(workshop)} are confirmed.`;

    return `Hi ${firstNameOf(name)},

${paymentText}

We can't wait to see you in New Orleans! ${SIGN_OFF}`;
}

// Fires exactly once per payment, at the moment it is confirmed complete
// (never on form submission alone): a deposit receipt with the balance and
// personal payment link, or the full confirmation once nothing is owed.
async function notifyPaymentComplete({ paymentType = 'full', name, email, workshop, amount, provider, registrationId, paidAt = new Date() }) {
    const recipients = recipientsOf(email);
    if (recipients.length === 0) {
        console.warn('No registrant email available - skipping payment email.');
        return false;
    }

    const isDeposit = paymentType === 'deposit';
    return sendEmails([{
        to: recipients,
        ...ADMIN_COPIES,
        subject: isDeposit ? 'Deposit received - CNIMA USA 2027' : "You're confirmed for CNIMA USA 2027!",
        text: isDeposit
            ? depositText({ name, workshop, amount, provider, registrationId, paidAt })
            : confirmationText({ paymentType, name, workshop, amount, provider })
    }]);
}

function balanceReminderEmail({ name, email, workshop, registrationId, daysLeft, now = new Date() }) {
    const link = balanceLinkOrNull(registrationId);
    return {
        to: recipientsOf(email),
        subject: `Reminder: your CNIMA USA balance is due ${EARLYBIRD_DEADLINE_LABEL}`,
        text: `Hi ${firstNameOf(name)},

A friendly reminder that the remaining balance of ${money(getBalanceAmount(workshop, now))} for ${workshopTextOf(workshop)} is due by ${EARLYBIRD_DEADLINE_LABEL} (${daysLeft} day${daysLeft === 1 ? '' : 's'} from now) to keep your early-bird rate.

Pay securely by card, digital wallet, or PayPal with your personal link:
${link}

After ${EARLYBIRD_DEADLINE_LABEL} the balance will be based on full tuition (${money(getPrice(workshop, 'full') - DEPOSIT_AMOUNT)}).

If you've already paid, thank you - please disregard this email. ${SIGN_OFF}`
    };
}

// One email per address, listing a link for every registration with a
// balance due under it (e.g. someone who registered a family member too).
function balanceLinksEmail(email, registrations, now = new Date()) {
    const lines = registrations.map((registration) => {
        const who = `${registration.firstName} ${registration.lastName}`.trim();
        return `${workshopTextOf(registration.workshop)}${who ? ` - ${who}` : ''}
Balance due: ${money(getBalanceAmount(registration.workshop, now))}
${balanceLinkOrNull(registration.registrationId)}`;
    });
    const deadlineLine = isEarlyBird(now)
        ? `\n\nPay by ${EARLYBIRD_DEADLINE_LABEL} to keep your early-bird rate.`
        : '';

    return {
        to: [email],
        subject: 'Your CNIMA USA payment link',
        text: `Hi ${firstNameOf(registrations[0].firstName)},

Here is your personal link to pay the remaining balance for CNIMA USA 2027:

${lines.join('\n\n')}${deadlineLine}

If you didn't ask for this link, you can ignore this email. ${SIGN_OFF}`
    };
}

module.exports = { notifyPaymentComplete, sendEmails, balanceReminderEmail, balanceLinksEmail };
