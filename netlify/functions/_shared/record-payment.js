const { getAccessToken } = require('./google-sheets-client');
const { markRegistrationPaidWithRetry } = require('./registrations-sheet');
const { markPaidInWeekSheets } = require('./week-sheets');

// Marks a confirmed payment as paid in the master sheet and, when
// GOOGLE_WEEKS_SHEET_ID is set, in the week sheet(s) too. The two documents
// are independent: one failing is logged and never blocks the other, and
// nothing here throws - the registrant's success screen must not depend on
// spreadsheet bookkeeping.
async function recordPaymentInSheets({ registrationId, provider, amount, workshop, fallbackData }) {
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (error) {
        console.error('Google auth failed - payment not recorded in Sheets:', error);
        return;
    }

    const tasks = [{
        label: 'master sheet',
        run: () => markRegistrationPaidWithRetry(process.env.GOOGLE_SHEET_ID, accessToken, {
            registrationId, provider, amount, fallbackData
        })
    }];

    if (process.env.GOOGLE_WEEKS_SHEET_ID) {
        tasks.push({
            label: 'week sheets',
            run: () => markPaidInWeekSheets(process.env.GOOGLE_WEEKS_SHEET_ID, accessToken, {
                registrationId, provider, amount, workshop, fallbackData
            })
        });
    }

    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            console.error(`Marking registration paid failed (${tasks[i].label}):`, result.reason);
        }
    });
}

module.exports = { recordPaymentInSheets };
