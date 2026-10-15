const { getAccessToken } = require('./google-sheets-client');
const { updatePaymentWithRetry } = require('./registrations-sheet');
const { updatePaymentInWeekSheets } = require('./week-sheets');
const { DEPOSIT_AMOUNT, getBalanceAmount } = require('./workshop-2027');

// A balance paid by a different method than the deposit lists both.
function addProvider(provider) {
    return (current) => {
        if (!current || !provider) return current || provider || '';
        return current.split('+').includes(provider) ? current : `${current}+${provider}`;
    };
}

// The sheet values a payment leads to. Every value is absolute rather than
// added onto what's in the row, so writing the same payment twice is
// harmless. amount_paid is the running total; paid only reads "yes" once
// nothing is owed.
function paymentFields({ paymentType, provider, amount, workshop, depositAcknowledgedAt }, now = new Date()) {
    const at = now.toISOString();

    if (paymentType === 'deposit') {
        let balanceDue = '';
        try {
            balanceDue = getBalanceAmount(workshop, now);
        } catch {
            // Unknown workshop - leave the balance blank for a human to fill in.
        }
        return {
            paid: '',
            payment_provider: provider || '',
            amount_paid: amount != null ? amount : '',
            paid_at: at,
            payment_status: 'deposit',
            balance_due: balanceDue,
            deposit_acknowledged_at: depositAcknowledgedAt || ''
        };
    }

    if (paymentType === 'balance') {
        return {
            paid: 'yes',
            payment_provider: addProvider(provider),
            amount_paid: amount != null ? DEPOSIT_AMOUNT + amount : '',
            payment_status: 'paid',
            balance_due: 0,
            balance_paid_at: at
        };
    }

    return {
        paid: 'yes',
        payment_provider: provider || '',
        amount_paid: amount != null ? amount : '',
        paid_at: at,
        payment_status: 'paid',
        balance_due: 0
    };
}

// Records a confirmed payment in the master sheet and, when
// GOOGLE_WEEKS_SHEET_ID is set, in the week sheet(s) too. The two documents
// are independent: one failing is logged and never blocks the other, and
// nothing here throws - the registrant's success screen must not depend on
// spreadsheet bookkeeping. Resolves to whether every write succeeded.
async function recordPaymentInSheets(payment, now = new Date()) {
    let accessToken;
    try {
        accessToken = await getAccessToken();
    } catch (error) {
        console.error('Google auth failed - payment not recorded in Sheets:', error);
        return false;
    }

    const { registrationId, workshop, fallbackData } = payment;
    const fields = paymentFields(payment, now);
    const tasks = [{
        label: 'master sheet',
        run: () => updatePaymentWithRetry(process.env.GOOGLE_SHEET_ID, accessToken, {
            registrationId, fields, fallbackData
        })
    }];

    if (process.env.GOOGLE_WEEKS_SHEET_ID) {
        tasks.push({
            label: 'week sheets',
            run: () => updatePaymentInWeekSheets(process.env.GOOGLE_WEEKS_SHEET_ID, accessToken, {
                registrationId, workshop, fields, fallbackData
            })
        });
    }

    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    results.forEach((result, i) => {
        if (result.status === 'rejected') {
            console.error(`Recording payment failed (${tasks[i].label}):`, result.reason);
        }
    });
    return results.every((result) => result.status === 'fulfilled');
}

module.exports = { recordPaymentInSheets, paymentFields };
