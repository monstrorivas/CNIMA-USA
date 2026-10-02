const { sheetsRequest } = require('./google-sheets-client');

const SHEET_TAB = 'Registrations';
const DATA_FIELDS = [
    'firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state',
    'postcode', 'country', 'skillLevel', 'workshop', 'paymentOption',
    'howDidYouHear', 'message'
];
// submission_id/synced_at keep their original positions so rows written
// before this feature existed stay aligned under the new header - every
// column added for payment tracking (registrationId onward) is appended
// after them rather than inserted in between.
const TRACKING_FIELDS = ['submission_id', 'synced_at'];
const PAYMENT_FIELDS = ['registrationId', 'paid', 'payment_provider', 'amount_paid', 'paid_at'];
const HEADERS = [...DATA_FIELDS, ...TRACKING_FIELDS, ...PAYMENT_FIELDS];
const SHEET_RANGE = `${SHEET_TAB}!A:${String.fromCharCode(64 + HEADERS.length)}`; // A:U for 21 columns

function columnLetter(index) {
    return String.fromCharCode(65 + index);
}

async function readSheet(sheetId, accessToken) {
    const existing = await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(SHEET_RANGE)}`,
        accessToken
    );
    const rows = existing.values || [];
    // Row 1 is treated as a header only if its first cell literally reads
    // "firstName" - a real registrant's own first name would have to
    // collide with that exact string to be mistaken for one.
    const looksLikeHeader = (rows[0] || [])[0] === DATA_FIELDS[0];
    return { rows, looksLikeHeader };
}

// Writes/overwrites row 1 with the current HEADERS whenever it's missing or
// stale (e.g. a prior deploy's schema, before payment-tracking columns
// existed) - comparing only the first cell wouldn't catch a header that's
// short a few trailing columns, so this compares the whole row.
async function ensureHeader(sheetId, accessToken, rows, looksLikeHeader) {
    const currentHeader = rows[0] || [];
    const headerMatches = looksLikeHeader && HEADERS.every((h, i) => currentHeader[i] === h);
    if (headerMatches) return;

    await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}?valueInputOption=RAW`,
        accessToken,
        { method: 'PUT', body: JSON.stringify({ values: [HEADERS] }) }
    );
}

function buildDataRow(registrationId, submissionId, data) {
    return [
        ...DATA_FIELDS.map((field) => data[field] || ''),
        submissionId || '',
        new Date().toISOString(),
        registrationId || '',
        '', '', '', '' // paid, payment_provider, amount_paid, paid_at - blank until paid
    ];
}

// Appends one registration row if its submission ID isn't already present -
// safe to call more than once for the same submission (Netlify can retry a
// webhook delivery), and preserves any columns added by hand in the sheet
// (e.g. notes) since it only ever appends, never overwrites existing rows.
// Written at submission time, before payment - paid/payment fields start
// blank and are filled in later by markRegistrationPaidWithRetry.
async function appendRegistrationIfNew(sheetId, accessToken, { submissionId, data }) {
    const { rows, looksLikeHeader } = await readSheet(sheetId, accessToken);
    const submissionIdCol = HEADERS.indexOf('submission_id');

    await ensureHeader(sheetId, accessToken, rows, looksLikeHeader);

    const alreadySynced = (looksLikeHeader ? rows.slice(1) : rows).some(
        (row) => row[submissionIdCol] === submissionId
    );
    if (alreadySynced) {
        return { appended: false };
    }

    const row = buildDataRow(data.registrationId, submissionId, data);

    await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}:append?valueInputOption=RAW`,
        accessToken,
        { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );

    return { appended: true };
}

// Finds the row written at submission time (by registrationId) and marks it
// paid in place. Returns {updated: false} if no matching row exists yet
// (e.g. the submission webhook hasn't landed) rather than creating one
// itself - markRegistrationPaidWithRetry decides whether to retry or fall
// back to appending.
async function markRegistrationPaid(sheetId, accessToken, { registrationId, provider, amount }) {
    if (!registrationId) {
        return { updated: false };
    }

    const { rows, looksLikeHeader } = await readSheet(sheetId, accessToken);
    const registrationIdCol = HEADERS.indexOf('registrationId');
    const paidCol = HEADERS.indexOf('paid');
    const startRow = looksLikeHeader ? 1 : 0;

    for (let i = startRow; i < rows.length; i++) {
        if (rows[i][registrationIdCol] === registrationId) {
            const sheetRowNumber = i + 1; // rows is 0-indexed, sheet rows are 1-indexed
            const range = `${SHEET_TAB}!${columnLetter(paidCol)}${sheetRowNumber}:${columnLetter(paidCol + 3)}${sheetRowNumber}`;
            await sheetsRequest(
                `${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
                accessToken,
                {
                    method: 'PUT',
                    body: JSON.stringify({
                        values: [['yes', provider || '', amount != null ? amount : '', new Date().toISOString()]]
                    })
                }
            );
            return { updated: true };
        }
    }

    return { updated: false };
}

// Retries briefly in case the submission webhook hasn't written the row yet
// (payment can complete fast), then falls back to appending a brand-new row
// rather than ever silently losing a confirmed payment. In practice the
// submission webhook has almost always already run by the time payment
// completes - this is a safety net, not the common path, so a few seconds
// of retry budget rarely actually gets used. The fallback row won't have
// the registrant's full form data (address, skill level, etc.) - only
// whatever's passed in fallbackData - since that's all that's known if the
// original row truly never shows up.
async function markRegistrationPaidWithRetry(sheetId, accessToken, { registrationId, provider, amount, fallbackData = {} }) {
    const maxAttempts = 3;
    const delayMs = 1500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { updated } = await markRegistrationPaid(sheetId, accessToken, { registrationId, provider, amount });
        if (updated) {
            return { updated: true, appendedFallback: false };
        }
        if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    console.warn(`No Sheet row found for registrationId ${registrationId} after ${maxAttempts} attempts - appending a fallback row instead of losing this payment.`);

    const row = buildDataRow(registrationId, '', fallbackData);
    const paidCol = HEADERS.indexOf('paid');
    row[paidCol] = 'yes';
    row[paidCol + 1] = provider || '';
    row[paidCol + 2] = amount != null ? amount : '';
    row[paidCol + 3] = new Date().toISOString();

    const { rows, looksLikeHeader } = await readSheet(sheetId, accessToken);
    await ensureHeader(sheetId, accessToken, rows, looksLikeHeader);
    await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(`${SHEET_TAB}!A1`)}:append?valueInputOption=RAW`,
        accessToken,
        { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );

    return { updated: false, appendedFallback: true };
}

module.exports = {
    appendRegistrationIfNew,
    markRegistrationPaidWithRetry,
    DATA_FIELDS,
    HEADERS
};
