const { getAccessToken } = require('./_shared/google-sheets-client');
const { appendRegistrationIfNew } = require('./_shared/registrations-sheet');

// Receives Netlify's outgoing webhook notification the moment someone
// submits the registration form, and appends that one registrant to the
// Google Sheet immediately - no daily batch job, no broad account-wide
// Netlify API token. Wired up in the Netlify dashboard (Site settings ->
// Forms -> Form notifications -> Add notification -> Outgoing webhook),
// not in code, since that URL only exists once the site is deployed.
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Netlify doesn't sign form webhook payloads (no HMAC header the way
    // e.g. Stripe/GitHub do), so the webhook URL itself carries a shared
    // secret as a query param instead - set when adding the notification:
    // https://<site>/.netlify/functions/handle-registration-webhook?secret=...
    const providedSecret = event.queryStringParameters && event.queryStringParameters.secret;
    if (!providedSecret || providedSecret !== process.env.REGISTRATION_WEBHOOK_SECRET) {
        return { statusCode: 401, body: 'Unauthorized' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: 'Invalid JSON' };
    }

    // Netlify's documented webhook payload is the submission object itself,
    // but handling a {payload: {...}} wrapper too costs nothing and avoids
    // a surprise if that shape differs from what's expected.
    const submission = body.payload || body;
    const data = submission.data || {};
    const submissionId = submission.id;

    if (!submissionId) {
        console.error('Webhook payload missing submission id:', JSON.stringify(body).slice(0, 500));
        return { statusCode: 400, body: 'Missing submission id' };
    }

    try {
        const accessToken = await getAccessToken();
        const { appended } = await appendRegistrationIfNew(process.env.GOOGLE_SHEET_ID, accessToken, {
            submissionId,
            data
        });
        return { statusCode: 200, body: appended ? 'Synced' : 'Already synced' };
    } catch (error) {
        console.error('Registration webhook sync failed:', error);
        return { statusCode: 500, body: 'Sync failed' };
    }
};
