const { getAccessToken } = require('./_shared/google-sheets-client');
const { readRegistrations, paymentStatusOf } = require('./_shared/registrations-sheet');
const { claimMany, setStatuses } = require('./_shared/payment-log');
const { sendEmails, balanceLinksEmail } = require('./_shared/notify-payment-complete');
const { PRICING } = require('./_shared/workshop-2027');

// Every response takes at least this long and reads the same, so neither
// the wording nor the timing tells a visitor whether an email is on file.
const MIN_RESPONSE_MS = 3500;
const RESPONSE = {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true })
};

// "Find my registration": re-sends the personal balance link(s) to the
// address on file - never to anyone else, and never revealing whether the
// address matched. At most one email per registration per hour, so the
// form can't be used to flood someone's inbox.
async function sendLinks(email) {
    const accessToken = await getAccessToken();
    const registrations = (await readRegistrations(process.env.GOOGLE_SHEET_ID, accessToken)).filter((registration) =>
        registration.email.trim().toLowerCase() === email &&
        registration.registrationId &&
        paymentStatusOf(registration) === 'deposit' &&
        Object.hasOwn(PRICING, registration.workshop)
    );
    if (registrations.length === 0) return;

    const hour = new Date().toISOString().slice(0, 13);
    const claims = await claimMany(process.env.GOOGLE_SHEET_ID, accessToken, registrations.map((registration) => ({
        ref: `link:${registration.registrationId}:${hour}`,
        registrationId: registration.registrationId,
        type: 'balance-link'
    })));
    const toSend = registrations.filter((_, i) => claims[i].won);
    if (toSend.length === 0) return;

    const sent = await sendEmails([balanceLinksEmail(registrations[0].email.trim(), toSend)]);
    await setStatuses(process.env.GOOGLE_SHEET_ID, accessToken, claims
        .filter((claim) => claim.won)
        .map((claim) => ({ claimId: claim.claimId, status: sent ? 'done' : 'failed' })));
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const started = Date.now();
    let email = '';
    try {
        email = String(JSON.parse(event.body || '{}').email || '').trim().toLowerCase();
    } catch {
        // Treated like an unknown address below.
    }

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        try {
            await sendLinks(email);
        } catch (error) {
            console.error('Balance link request failed:', error);
        }
    }

    await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_RESPONSE_MS - (Date.now() - started))));
    return RESPONSE;
};
