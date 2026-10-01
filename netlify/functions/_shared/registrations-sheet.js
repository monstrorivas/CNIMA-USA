const { sheetsRequest } = require('./google-sheets-client');

const SHEET_TAB = 'Registrations';
const DATA_FIELDS = [
    'firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state',
    'postcode', 'country', 'skillLevel', 'workshop', 'paymentOption',
    'howDidYouHear', 'message'
];
const HEADERS = [...DATA_FIELDS, 'submission_id', 'synced_at'];
const SHEET_RANGE = `${SHEET_TAB}!A:${String.fromCharCode(64 + HEADERS.length)}`; // A:P for 16 columns

// Appends one registration row if its submission ID isn't already present -
// safe to call more than once for the same submission (Netlify can retry a
// webhook delivery), and preserves any columns added by hand in the sheet
// (e.g. "paid?", notes) since it only ever appends, never overwrites.
async function appendRegistrationIfNew(sheetId, accessToken, { submissionId, data }) {
    const existing = await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(SHEET_RANGE)}`,
        accessToken
    );
    const rows = existing.values || [];
    const hasHeader = rows.length > 0 && rows[0][0] === HEADERS[0];
    const submissionIdCol = HEADERS.indexOf('submission_id');

    if (!hasHeader) {
        await sheetsRequest(
            `${sheetId}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}:append?valueInputOption=RAW`,
            accessToken,
            { method: 'POST', body: JSON.stringify({ values: [HEADERS] }) }
        );
    }

    const alreadySynced = (hasHeader ? rows.slice(1) : rows).some(
        (row) => row[submissionIdCol] === submissionId
    );
    if (alreadySynced) {
        return { appended: false };
    }

    const row = [...DATA_FIELDS.map((field) => data[field] || ''), submissionId, new Date().toISOString()];

    await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}:append?valueInputOption=RAW`,
        accessToken,
        { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );

    return { appended: true };
}

module.exports = { appendRegistrationIfNew, DATA_FIELDS, HEADERS };
