const { loadBalance, PaymentRequestError } = require('./_shared/resolve-payment');
const {
    WORKSHOP_LABELS,
    DEPOSIT_AMOUNT,
    EARLYBIRD_DEADLINE_LABEL,
    getPrice,
    isEarlyBird
} = require('./_shared/workshop-2027');

// What the pay-balance page shows for a signed personal link: who it is
// for and what is still owed today. Only the name leaves the server - the
// rest of the registration stays in the sheet.
exports.handler = async (event) => {
    const { r: registrationId, s: signature } = event.queryStringParameters || {};

    try {
        const now = new Date();
        const { registration, status, amount } = await loadBalance(registrationId, signature, now);
        const earlyBird = isEarlyBird(now);
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
            body: JSON.stringify({
                name: `${registration.firstName} ${registration.lastName}`.trim(),
                workshopLabel: WORKSHOP_LABELS[registration.workshop] || '',
                status,
                amountDue: amount,
                depositPaid: status === 'deposit' ? DEPOSIT_AMOUNT : undefined,
                earlyBird,
                deadlineLabel: EARLYBIRD_DEADLINE_LABEL,
                lateAmount: status === 'deposit' && earlyBird ? getPrice(registration.workshop, 'full') - DEPOSIT_AMOUNT : undefined
            })
        };
    } catch (error) {
        if (error instanceof PaymentRequestError) {
            return { statusCode: error.statusCode, body: error.message };
        }
        console.error('Balance lookup failed:', error);
        return { statusCode: 500, body: 'Could not look up this registration' };
    }
};
