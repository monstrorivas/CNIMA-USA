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

function getPrice(workshop, paymentOption) {
    const price = PRICING[workshop] && PRICING[workshop][paymentOption];
    if (!price) {
        throw new Error(`Unknown workshop/paymentOption combination: ${workshop}/${paymentOption}`);
    }
    return price;
}

module.exports = { PRICING, WORKSHOP_LABELS, getPrice };
