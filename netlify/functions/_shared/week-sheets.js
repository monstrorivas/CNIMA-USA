const {
    appendRegistrationIfNew,
    updatePaymentWithRetry,
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
// the two rows (the deposit-locked, early-bird and full totals for "both"
// are all split the same way). Summing the Week 1 and Week 2 tabs then
// matches what was actually collected, and still owed, instead of counting
// it twice.
const SPLIT_FIELDS = ['amount_paid', 'balance_due'];

function splitAcrossWeeks(fields, weekCount) {
    const split = { ...fields };
    SPLIT_FIELDS.forEach((field) => {
        if (typeof split[field] === 'number') split[field] = split[field] / weekCount;
    });
    return split;
}

async function updatePaymentInWeekSheets(sheetId, accessToken, { registrationId, workshop, fields, fallbackData }) {
    const weeks = weeksFor(workshop);
    const fieldsPerWeek = splitAcrossWeeks(fields, weeks.length);
    return settleAll(
        weeks.map((week) =>
            updatePaymentWithRetry(
                sheetId,
                accessToken,
                { registrationId, fields: fieldsPerWeek, fallbackData },
                editableTarget(WEEK_TABS[week])
            )
        )
    );
}

module.exports = { appendToWeekSheets, updatePaymentInWeekSheets, weeksFor, WEEK_TABS };
