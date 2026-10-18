const { getAccessToken } = require('./google-sheets-client');
const { readRegistrations, paymentStatusOf } = require('./registrations-sheet');
const { isValidSignature } = require('./balance-link');
const {
    WORKSHOP_LABELS,
    DEPOSIT_AMOUNT,
    getPrice,
    getBalanceAmount,
    isEarlyBird,
    effectivePaymentOption
} = require('./workshop-2027');

class PaymentRequestError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}

async function findRegistration(registrationId) {
    const accessToken = await getAccessToken();
    const registrations = await readRegistrations(process.env.GOOGLE_SHEET_ID, accessToken);
    return registrations.find((registration) => registration.registrationId === registrationId) || null;
}

// The registration behind a signed balance link, with what is owed today.
async function loadBalance(registrationId, signature, now = new Date()) {
    if (!isValidSignature(registrationId, signature)) {
        throw new PaymentRequestError(403, 'Invalid payment link');
    }
    const registration = await findRegistration(registrationId);
    if (!registration) {
        throw new PaymentRequestError(404, 'Registration not found');
    }
    const status = paymentStatusOf(registration);
    let amount = null;
    if (status === 'deposit') {
        try {
            amount = getBalanceAmount(registration.workshop, now);
        } catch {
            throw new PaymentRequestError(409, 'This registration needs a hand from us - please email registrations@cnimausa.com');
        }
    }
    return { registration, status, amount };
}

// What a checkout session or PayPal order should charge, worked out
// entirely server-side from the workshop, the payment option or the master
// sheet - the client only says which of those it is asking about.
async function resolvePayment(payload, now = new Date()) {
    const { workshop, paymentOption, registrationId } = payload;

    if (payload.paymentType === 'balance') {
        const { registration, status, amount } = await loadBalance(registrationId, payload.signature, now);
        if (status !== 'deposit') {
            throw new PaymentRequestError(409, status === 'paid' ? 'This registration is already paid in full' : 'No deposit on file for this registration');
        }
        return {
            paymentType: 'balance',
            workshop: registration.workshop,
            paymentOption: registration.paymentOption,
            amount,
            registrationId,
            email: registration.email,
            name: `${registration.firstName} ${registration.lastName}`.trim(),
            description: `CNIMA USA 2027 Workshop - ${WORKSHOP_LABELS[registration.workshop]} - Balance`
        };
    }

    if (paymentOption === 'deposit') {
        if (!Object.hasOwn(WORKSHOP_LABELS, workshop)) {
            throw new PaymentRequestError(400, `Unknown workshop: ${workshop}`);
        }
        if (!isEarlyBird(now)) {
            throw new PaymentRequestError(400, 'The deposit option closed on February 1, 2027 - please choose Full Tuition');
        }
        if (payload.depositAcknowledged !== true) {
            throw new PaymentRequestError(400, 'The non-refundable deposit must be acknowledged');
        }
        return {
            paymentType: 'deposit',
            workshop,
            paymentOption,
            amount: DEPOSIT_AMOUNT,
            registrationId,
            depositAcknowledgedAt: now.toISOString(),
            description: `CNIMA USA 2027 Workshop - ${WORKSHOP_LABELS[workshop]} - Non-refundable deposit`
        };
    }

    const chargedOption = effectivePaymentOption(paymentOption, now);
    let amount;
    try {
        amount = getPrice(workshop, chargedOption);
    } catch (error) {
        throw new PaymentRequestError(400, error.message);
    }
    return {
        paymentType: 'full',
        workshop,
        paymentOption: chargedOption,
        amount,
        registrationId,
        description: `CNIMA USA 2027 Workshop - ${WORKSHOP_LABELS[workshop]}`
    };
}

// PayPal has no metadata, only a free-text custom_id (max 255 chars) that
// comes back on capture - enough for what the capture needs to record.
function toPaypalCustomId({ paymentType, workshop, registrationId, depositAcknowledgedAt }) {
    return [paymentType, workshop, registrationId || '', depositAcknowledgedAt || ''].join('|');
}

function fromPaypalCustomId(customId) {
    const [paymentType, workshop, registrationId, depositAcknowledgedAt] = (customId || '').split('|');
    return { paymentType, workshop, registrationId, depositAcknowledgedAt };
}

module.exports = {
    resolvePayment,
    loadBalance,
    findRegistration,
    toPaypalCustomId,
    fromPaypalCustomId,
    PaymentRequestError
};
