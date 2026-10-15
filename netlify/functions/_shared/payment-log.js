const crypto = require('crypto');
const { sheetsRequest } = require('./google-sheets-client');
const { a1 } = require('./registrations-sheet');

// An append-only "Payment log" tab in the master spreadsheet that makes
// one-time side effects (recording a payment, sending a reminder) happen
// exactly once even when two callers race - e.g. the Stripe webhook and the
// browser's return trip landing at the same moment. Each caller appends its
// own claim row for a ref and then reads the log back: Sheets serializes
// appends, so every caller agrees the first row for that ref is the winner.
// It doubles as an audit trail of every payment and email the site sent.
const LOG_TARGET = { tab: 'Payment log' };
const LOG_HEADERS = ['ref', 'claim_id', 'registrationId', 'type', 'detail', 'claimed_at', 'status'];
const STATUS_COL = 'G';
// A claim whose work failed (or that has sat unfinished long enough that
// its function must have died) may be retried under ref#2, ref#3 - each
// retry is itself claimed the same way.
const MAX_ATTEMPTS = 3;
const STALE_CLAIM_MS = 15 * 60 * 1000;

function attemptRef(ref, attempt) {
    return attempt === 1 ? ref : `${ref}#${attempt}`;
}

function isRetryable(row) {
    return row[6] === 'failed' || (row[6] === 'claimed' && Date.now() - Date.parse(row[5]) > STALE_CLAIM_MS);
}

// The ref to claim next or, when there is none, whether an earlier claim
// finished the work (settled) or is still on it.
function nextAttempt(rows, ref) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const candidate = attemptRef(ref, attempt);
        const first = rows.find((row) => row[0] === candidate);
        if (!first) return { ref: candidate, attempt };
        if (!isRetryable(first)) return { settled: first[6] === 'done' };
    }
    console.error(`Giving up on ${ref} after ${MAX_ATTEMPTS} failed attempts - see the Payment log tab.`);
    return { settled: true };
}

async function readLog(sheetId, accessToken, target) {
    const res = await sheetsRequest(`${sheetId}/values/${encodeURIComponent(a1(target.tab, 'A:G'))}`, accessToken);
    return res.values || [];
}

// Creates the tab and its header in one atomic batchUpdate, so a racing
// claim can never land in row 1 before the header does. The tab id is
// derived from its name: Sheets rejects a second tab with the same id, but
// two concurrent creates with different ids both succeed (the second one
// renamed "..._conflict123"). Whoever loses that race just carries on.
async function createLogTab(sheetId, accessToken, target) {
    const tabId = crypto.createHash('sha256').update(target.tab).digest().readUInt32BE(0) % (2 ** 31 - 2) + 1;
    try {
        await sheetsRequest(`${sheetId}:batchUpdate`, accessToken, {
            method: 'POST',
            body: JSON.stringify({
                requests: [
                    { addSheet: { properties: { sheetId: tabId, title: target.tab } } },
                    {
                        appendCells: {
                            sheetId: tabId,
                            rows: [{ values: LOG_HEADERS.map((h) => ({ userEnteredValue: { stringValue: h } })) }],
                            fields: 'userEnteredValue'
                        }
                    }
                ]
            })
        });
    } catch (error) {
        console.warn(`Creating the "${target.tab}" tab failed, most likely because a concurrent request just created it:`, error.message);
    }
}

async function appendClaims(sheetId, accessToken, target, rows) {
    const path = `${sheetId}/values/${encodeURIComponent(a1(target.tab, 'A1'))}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const options = { method: 'POST', body: JSON.stringify({ values: rows }) };
    try {
        await sheetsRequest(path, accessToken, options);
    } catch (error) {
        if (!/Unable to parse range/i.test(error.message)) throw error;
        await createLogTab(sheetId, accessToken, target);
        await sheetsRequest(path, accessToken, options);
    }
}

// Rows are found by claim id rather than by the row number an append
// reports: concurrent appends can land in a different order than their
// responses say.
function statusUpdates(rows, updates, target) {
    return updates.flatMap(({ claimId, status }) => {
        const index = rows.findIndex((row) => row[1] === claimId);
        return index === -1 ? [] : [{ range: a1(target.tab, `${STATUS_COL}${index + 1}`), values: [[status]] }];
    });
}

async function writeStatuses(sheetId, accessToken, rows, updates, target) {
    const data = statusUpdates(rows, updates, target);
    if (data.length === 0) return;
    await sheetsRequest(`${sheetId}/values:batchUpdate`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data })
    });
}

async function setStatuses(sheetId, accessToken, updates, target = LOG_TARGET) {
    if (updates.length === 0) return;
    await writeStatuses(sheetId, accessToken, await readLog(sheetId, accessToken, target), updates, target);
}

// Claims many refs with one append and one read. Returns, in the same
// order as entries, {won, attempt, claimId} for winners - only they may
// act - and {won: false, settled} for everyone else.
async function claimMany(sheetId, accessToken, entries, target = LOG_TARGET) {
    const existing = await readLog(sheetId, accessToken, target).catch((error) => {
        if (/Unable to parse range/i.test(error.message)) return [];
        throw error;
    });

    const pending = [];
    const results = entries.map((entry) => {
        const next = nextAttempt(existing, entry.ref);
        if (!next.ref) return { won: false, settled: next.settled };
        const claim = { ...entry, ...next, claimId: crypto.randomUUID() };
        pending.push(claim);
        return claim;
    });
    if (pending.length === 0) return results;

    const claimedAt = new Date().toISOString();
    await appendClaims(sheetId, accessToken, target, pending.map((claim) => [
        claim.ref, claim.claimId, claim.registrationId || '', claim.type || '', String(claim.detail ?? ''), claimedAt, 'claimed'
    ]));

    const after = await readLog(sheetId, accessToken, target);
    const losers = [];
    pending.forEach((claim) => {
        const first = after.find((row) => row[0] === claim.ref);
        // Our own row missing from the read-back shouldn't happen; if it
        // ever does, acting twice beats never acting on a real payment.
        claim.won = !first || first[1] === claim.claimId;
        if (!claim.won) {
            claim.settled = first[6] === 'done';
            losers.push({ claimId: claim.claimId, status: 'duplicate' });
        }
    });
    await writeStatuses(sheetId, accessToken, after, losers, target).catch((error) => console.error('Could not mark duplicate claims:', error));

    return results.map((r) => {
        if (!r.claimId) return r;
        return r.won ? { won: true, attempt: r.attempt, claimId: r.claimId } : { won: false, settled: r.settled };
    });
}

async function claimOnce(sheetId, accessToken, entry, target = LOG_TARGET) {
    const [claim] = await claimMany(sheetId, accessToken, [entry], target);
    return {
        ...claim,
        settle: async (status) => {
            if (!claim.won) return;
            await setStatuses(sheetId, accessToken, [{ claimId: claim.claimId, status }], target)
                .catch((error) => console.error(`Could not mark ${entry.ref} as ${status}:`, error));
        }
    };
}

module.exports = { claimOnce, claimMany, setStatuses, LOG_TARGET, LOG_HEADERS };
