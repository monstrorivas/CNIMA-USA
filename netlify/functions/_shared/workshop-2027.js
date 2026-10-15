// Single source of truth for 2027 workshop pricing. registration-flow.js
// keeps its own copy for display purposes only - this file is what
// actually determines the amount charged, since a client-supplied amount
// can never be trusted. Keep both in sync when pricing changes.
const PRICING = {
    week1: { earlybird: 699, full: 799 },
    week2: { earlybird: 699, full: 799 },
    both: { earlybird: 1398, full: 1598 }
};

const WORKSHOP_LABELS = {
    week1: 'Week 1 (May 3-8, 2027)',
    week2: 'Week 2 (May 10-15, 2027)',
    both: 'Both Weeks (May 3-15, 2027)'
};

// Flat per registration, "both weeks" included. Paying it locks the
// early-bird total as long as the balance is paid by the deadline.
const DEPOSIT_AMOUNT = 200;

// Early bird runs through the end of this day, New Orleans time.
const EARLYBIRD_DEADLINE = '2027-02-01';
const EARLYBIRD_DEADLINE_LABEL = 'February 1, 2027';
const TIME_ZONE = 'America/Chicago';

function getPrice(workshop, paymentOption) {
    const price = PRICING[workshop] && PRICING[workshop][paymentOption];
    if (!price) {
        throw new Error(`Unknown workshop/paymentOption combination: ${workshop}/${paymentOption}`);
    }
    return price;
}

// YYYY-MM-DD as seen on a wall clock in New Orleans, so the deadline flips
// at local midnight regardless of daylight saving or the server's zone.
function localDate(date) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(date);
}

// The one deadline check everything else goes through. Takes the time to
// check explicitly, so both sides of the cutoff can be tested directly.
function isEarlyBird(now) {
    return localDate(now) <= EARLYBIRD_DEADLINE;
}

function daysUntilDeadline(now) {
    return Math.round((Date.parse(EARLYBIRD_DEADLINE) - Date.parse(localDate(now))) / 86400000);
}

// "earlybird" only buys the early-bird price while it is still open; after
// the deadline it is charged (and recorded) as full tuition.
function effectivePaymentOption(paymentOption, now) {
    return paymentOption === 'earlybird' && !isEarlyBird(now) ? 'full' : paymentOption;
}

// What is still owed after the deposit: the early-bird total while the
// deadline hasn't passed, the full-tuition total after it.
function getBalanceAmount(workshop, now) {
    return getPrice(workshop, isEarlyBird(now) ? 'earlybird' : 'full') - DEPOSIT_AMOUNT;
}

module.exports = {
    PRICING,
    WORKSHOP_LABELS,
    DEPOSIT_AMOUNT,
    EARLYBIRD_DEADLINE_LABEL,
    getPrice,
    isEarlyBird,
    daysUntilDeadline,
    effectivePaymentOption,
    getBalanceAmount
};
