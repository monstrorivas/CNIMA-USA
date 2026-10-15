const { sheetsRequest } = require('./google-sheets-client');

const DATA_FIELDS = [
    'firstName', 'lastName', 'email', 'phone', 'address', 'city', 'state',
    'postcode', 'country', 'skillLevel', 'workshop', 'paymentOption',
    'howDidYouHear', 'message'
];
// submission_id/synced_at keep their original positions so rows written
// before payment tracking existed stay aligned under the current header -
// every column added later (registrationId onward) is appended after them
// rather than inserted in between.
const TRACKING_FIELDS = ['submission_id', 'synced_at'];
const PAYMENT_FIELDS = ['registrationId', 'paid', 'payment_provider', 'amount_paid', 'paid_at'];
// Deposit/balance tracking, appended after paid_at for the same reason.
const BALANCE_FIELDS = ['payment_status', 'balance_due', 'balance_paid_at', 'deposit_acknowledged_at'];
const HEADERS = [...DATA_FIELDS, ...TRACKING_FIELDS, ...PAYMENT_FIELDS, ...BALANCE_FIELDS];

function columnLetter(index) {
    return String.fromCharCode(65 + index);
}

const LAST_COLUMN = columnLetter(HEADERS.length - 1); // Y for 25 columns
const REGISTRATION_ID_COL = HEADERS.indexOf('registrationId');
// Everything a payment can change lives in one contiguous block, paid..Y.
const FIRST_PAYMENT_COL = HEADERS.indexOf('paid');

// Where rows get written. The master "Registrations" tab is the read-only
// source of truth, so this code owns its header row and keeps it current.
// Tabs in a human-edited sheet are different: their header text, colors and
// any extra columns belong to the editors, so rows are only ever appended
// or updated by column position and row 1 is never touched (apart from
// seeding a completely empty tab).
const MASTER_TARGET = { tab: 'Registrations', ownsHeader: true };

function editableTarget(tab) {
    return { tab, ownsHeader: false };
}

// Tab names with spaces ("Week 1") must be single-quoted in A1 notation.
function a1(tab, cells) {
    return `'${tab.replace(/'/g, "''")}'!${cells}`;
}

async function readSheet(sheetId, accessToken, target) {
    const existing = await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(a1(target.tab, `A:${LAST_COLUMN}`))}`,
        accessToken
    );
    const rows = existing.values || [];
    // Row 1 counts as our header only if its first cell literally reads
    // "firstName" - a real registrant's own first name would have to
    // collide with that exact string to be mistaken for one.
    const looksLikeHeader = (rows[0] || [])[0] === DATA_FIELDS[0];
    return { rows, looksLikeHeader };
}

async function writeHeader(sheetId, accessToken, target) {
    await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(a1(target.tab, 'A1'))}?valueInputOption=RAW`,
        accessToken,
        { method: 'PUT', body: JSON.stringify({ values: [HEADERS] }) }
    );
}

async function ensureHeader(sheetId, accessToken, target, rows, looksLikeHeader) {
    if (!target.ownsHeader) {
        if (rows.length === 0) {
            await writeHeader(sheetId, accessToken, target);
        }
        return;
    }

    // Compare the whole row, not just the first cell, so a header left over
    // from an older schema (fewer trailing columns) is detected and fixed.
    const currentHeader = rows[0] || [];
    const headerMatches = looksLikeHeader && HEADERS.every((h, i) => currentHeader[i] === h);
    if (!headerMatches) {
        await writeHeader(sheetId, accessToken, target);
    }
}

async function appendRow(sheetId, accessToken, target, row) {
    // INSERT_ROWS on editable tabs so notes someone typed below the table
    // are pushed down rather than overwritten.
    const insertOption = target.ownsHeader ? '' : '&insertDataOption=INSERT_ROWS';
    await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(a1(target.tab, 'A1'))}:append?valueInputOption=RAW${insertOption}`,
        accessToken,
        { method: 'POST', body: JSON.stringify({ values: [row] }) }
    );
}

function buildDataRow(registrationId, submissionId, data) {
    const row = HEADERS.map(() => '');
    DATA_FIELDS.forEach((field, i) => {
        row[i] = data[field] || '';
    });
    row[HEADERS.indexOf('submission_id')] = submissionId || '';
    row[HEADERS.indexOf('synced_at')] = new Date().toISOString();
    row[REGISTRATION_ID_COL] = registrationId || '';
    row[HEADERS.indexOf('payment_status')] = 'unpaid';
    return row;
}

// A field value can be a function of the cell's current text, for values
// that build on what is already there (e.g. the provider list).
function resolveField(fields, header, current) {
    if (!Object.hasOwn(fields, header)) return current;
    const value = fields[header];
    return typeof value === 'function' ? value(current) : value;
}

function applyPaymentFields(row, fields) {
    return HEADERS.slice(FIRST_PAYMENT_COL).map((header, i) =>
        resolveField(fields, header, row[FIRST_PAYMENT_COL + i] || '')
    );
}

// Appends one registration row if its submission ID isn't already present -
// safe to call more than once for the same submission (Netlify can retry a
// webhook delivery), and preserves anything added by hand in the sheet
// since it only ever appends, never overwrites existing rows. Written at
// submission time, before payment - the payment fields start blank (status
// "unpaid") and are filled in later by updatePaymentWithRetry.
async function appendRegistrationIfNew(sheetId, accessToken, { submissionId, data }, target = MASTER_TARGET) {
    const { rows, looksLikeHeader } = await readSheet(sheetId, accessToken, target);
    const submissionIdCol = HEADERS.indexOf('submission_id');

    await ensureHeader(sheetId, accessToken, target, rows, looksLikeHeader);

    if (rows.some((row) => row[submissionIdCol] === submissionId)) {
        return { appended: false };
    }

    await appendRow(sheetId, accessToken, target, buildDataRow(data.registrationId, submissionId, data));
    return { appended: true };
}

// Finds the row written at submission time (by registrationId) and writes
// the given payment fields into it in place, leaving the other payment
// columns as they are. Returns {updated: false} if no matching row exists
// yet (e.g. the submission webhook hasn't landed) rather than creating one
// itself - updatePaymentWithRetry decides whether to retry or fall back to
// appending.
async function updatePayment(sheetId, accessToken, { registrationId, fields }, target = MASTER_TARGET) {
    if (!registrationId) {
        return { updated: false };
    }

    const { rows } = await readSheet(sheetId, accessToken, target);
    const rowIndex = rows.findIndex((row) => row[REGISTRATION_ID_COL] === registrationId);
    if (rowIndex === -1) {
        return { updated: false };
    }

    const sheetRowNumber = rowIndex + 1; // rows is 0-indexed, sheet rows are 1-indexed
    const range = a1(target.tab, `${columnLetter(FIRST_PAYMENT_COL)}${sheetRowNumber}:${LAST_COLUMN}${sheetRowNumber}`);
    await sheetsRequest(
        `${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
        accessToken,
        { method: 'PUT', body: JSON.stringify({ values: [applyPaymentFields(rows[rowIndex], fields)] }) }
    );
    return { updated: true };
}

// Retries briefly in case the submission webhook hasn't written the row yet
// (payment can complete fast), then falls back to appending a brand-new row
// rather than ever silently losing a confirmed payment. In practice the
// submission webhook has almost always already run by the time payment
// completes - this is a safety net, not the common path. The fallback row
// won't have the registrant's full form data (address, skill level, etc.) -
// only whatever's passed in fallbackData - since that's all that's known if
// the original row truly never shows up.
async function updatePaymentWithRetry(sheetId, accessToken, { registrationId, fields, fallbackData = {} }, target = MASTER_TARGET) {
    const maxAttempts = 3;
    const delayMs = 1500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const { updated } = await updatePayment(sheetId, accessToken, { registrationId, fields }, target);
        if (updated) {
            return { updated: true, appendedFallback: false };
        }
        if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    console.warn(`No row found in "${target.tab}" for registrationId ${registrationId} after ${maxAttempts} attempts - appending a fallback row instead of losing this payment.`);

    const row = buildDataRow(registrationId, '', fallbackData);
    row.splice(FIRST_PAYMENT_COL, HEADERS.length - FIRST_PAYMENT_COL, ...applyPaymentFields(row, fields));

    const { rows, looksLikeHeader } = await readSheet(sheetId, accessToken, target);
    await ensureHeader(sheetId, accessToken, target, rows, looksLikeHeader);
    await appendRow(sheetId, accessToken, target, row);

    return { updated: false, appendedFallback: true };
}

// Every row below the header as {header: value}, plus its sheet row number.
async function readRegistrations(sheetId, accessToken, target = MASTER_TARGET) {
    const { rows, looksLikeHeader } = await readSheet(sheetId, accessToken, target);
    const firstDataRow = looksLikeHeader ? 1 : 0;
    return rows.slice(firstDataRow).map((row, i) => ({
        rowNumber: firstDataRow + i + 1,
        ...Object.fromEntries(HEADERS.map((header, j) => [header, row[j] || '']))
    }));
}

// Rows written before deposits existed have no payment_status, only paid.
function paymentStatusOf(registration) {
    return registration.payment_status || (registration.paid === 'yes' ? 'paid' : 'unpaid');
}

module.exports = {
    appendRegistrationIfNew,
    updatePaymentWithRetry,
    readRegistrations,
    paymentStatusOf,
    MASTER_TARGET,
    editableTarget,
    a1,
    DATA_FIELDS,
    HEADERS
};
