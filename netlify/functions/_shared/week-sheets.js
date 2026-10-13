const {
    appendRegistrationIfNew,
    markRegistrationPaidWithRetry,
    editableTarget
} = require('./registrations-sheet');

// Tab names inside the human-edited week spreadsheet. Editors can rename
// columns, recolor and add columns freely, but these two tab names are how
// rows find their way to the right place, so they must stay as they are.
const WEEK_TABS = { week1: 'Week 1', week2: 'Week 2' };

// A "both weeks" registrant gets a row in each week's tab.
function weeksFor(workshop) {
    if (workshop === 'both') return ['week1', 'week2'];
    return Object.hasOwn(WEEK_TABS, workshop) ? [workshop] : [];
}

// Runs every task to completion before reporting a failure, so one tab
// failing never cuts the other short mid-write.
async function settleAll(promises) {
    const results = await Promise.allSettled(promises);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    return results.map((r) => r.value);
}

async function appendToWeekSheets(sheetId, accessToken, { submissionId, data }) {
    return settleAll(
        weeksFor(data.workshop).map((week) =>
            appendRegistrationIfNew(sheetId, accessToken, { submissionId, data }, editableTarget(WEEK_TABS[week]))
        )
    );
}

// The registrant paid once, so a both-weeks payment is split evenly across
// the two rows (the early-bird and full prices for "both" are exactly twice
// a single week). Summing the Week 1 and Week 2 tabs then matches what was
// actually collected instead of counting it twice.
async function markPaidInWeekSheets(sheetId, accessToken, { registrationId, provider, amount, workshop, fallbackData }) {
    const weeks = weeksFor(workshop);
    const amountPerWeek = amount != null ? amount / weeks.length : amount;
    return settleAll(
        weeks.map((week) =>
            markRegistrationPaidWithRetry(
                sheetId,
                accessToken,
                { registrationId, provider, amount: amountPerWeek, fallbackData },
                editableTarget(WEEK_TABS[week])
            )
        )
    );
}

module.exports = { appendToWeekSheets, markPaidInWeekSheets, weeksFor, WEEK_TABS };
