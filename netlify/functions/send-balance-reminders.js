const { getAccessToken } = require('./_shared/google-sheets-client');
const { readRegistrations, paymentStatusOf } = require('./_shared/registrations-sheet');
const { claimMany, setStatuses } = require('./_shared/payment-log');
const { sendEmails, balanceReminderEmail } = require('./_shared/notify-payment-complete');
const { PRICING, daysUntilDeadline } = require('./_shared/workshop-2027');

// Days before the early-bird deadline on which everyone still at
// payment_status "deposit" is reminded. Each reminder is also allowed the
// day after, so one missed daily run doesn't skip it.
const REMINDER_DAYS = [30, 7, 2];
// Resend's batch endpoint takes at most 100 emails per call.
const BATCH_SIZE = 100;

// Scheduled daily in netlify.toml. Safe to run any number of times: each
// (registration, reminder) pair is claimed in the Payment log before its
// email goes out, so nobody gets the same reminder twice.
async function runReminders(now = new Date()) {
    const daysLeft = daysUntilDeadline(now);
    const reminder = REMINDER_DAYS.find((days) => daysLeft === days || daysLeft === days - 1);
    if (!reminder) {
        return { reminder: null, daysLeft, sent: 0 };
    }

    const sheetId = process.env.GOOGLE_SHEET_ID;
    const accessToken = await getAccessToken();
    const due = (await readRegistrations(sheetId, accessToken)).filter((registration) =>
        paymentStatusOf(registration) === 'deposit' && registration.registrationId && registration.email &&
        Object.hasOwn(PRICING, registration.workshop)
    );

    let sent = 0;
    for (let start = 0; start < due.length; start += BATCH_SIZE) {
        const batch = due.slice(start, start + BATCH_SIZE);
        const claims = await claimMany(sheetId, accessToken, batch.map((registration) => ({
            ref: `reminder-${reminder}:${registration.registrationId}`,
            registrationId: registration.registrationId,
            type: 'reminder',
            detail: reminder
        })));
        const won = batch.map((registration, i) => ({ registration, claim: claims[i] })).filter(({ claim }) => claim.won);
        if (won.length === 0) continue;

        const ok = await sendEmails(won.map(({ registration }) => balanceReminderEmail({
            name: registration.firstName,
            email: registration.email,
            workshop: registration.workshop,
            registrationId: registration.registrationId,
            daysLeft,
            now
        })));
        await setStatuses(sheetId, accessToken, won.map(({ claim }) => ({ claimId: claim.claimId, status: ok ? 'done' : 'failed' })));
        if (ok) sent += won.length;
    }

    return { reminder, daysLeft, due: due.length, sent };
}

exports.handler = async () => {
    try {
        const result = await runReminders();
        console.log('Balance reminders:', JSON.stringify(result));
        return { statusCode: 200, body: JSON.stringify(result) };
    } catch (error) {
        console.error('Balance reminders failed:', error);
        return { statusCode: 500, body: 'Reminders failed' };
    }
};

exports.runReminders = runReminders;
