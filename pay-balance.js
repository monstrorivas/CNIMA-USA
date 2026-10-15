// CNIMA USA 2027 - pay-balance page. The personal link emailed after a
// deposit carries the registrationId (r) and its signature (s); who the
// registration belongs to and what is owed are looked up server-side from
// those, and the payment widgets come from registration-flow.js.
(function () {
    const params = new URLSearchParams(window.location.search);
    const registrationId = params.get('r');
    const signature = params.get('s');
    const returningSessionId = params.get('session_id');

    const loadingEl = document.getElementById('balance-loading');
    const stepEl = document.getElementById('balance-step');
    const paidEl = document.getElementById('balance-paid');
    const errorEl = document.getElementById('balance-error');
    const lookupEl = document.getElementById('balance-lookup');

    function showError(message, withLookup) {
        loadingEl.classList.add('hidden');
        errorEl.textContent = message;
        errorEl.classList.remove('hidden');
        lookupEl.classList.toggle('hidden', !withLookup);
    }

    function showPaid(message) {
        loadingEl.classList.add('hidden');
        stepEl.classList.add('hidden');
        errorEl.classList.add('hidden');
        if (message) {
            document.getElementById('balance-paid-message').textContent = message;
        }
        paidEl.classList.remove('hidden');
        paidEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    document.getElementById('balance-lookup-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = document.getElementById('lookup-submit');
        button.disabled = true;
        button.textContent = 'Sending...';
        try {
            await fetch('/.netlify/functions/request-balance-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: document.getElementById('lookup-email').value })
            });
        } catch (error) {
            console.error('Balance link request failed:', error);
        }
        document.getElementById('balance-lookup-done').classList.remove('hidden');
        button.textContent = 'Email My Link';
        button.disabled = false;
    });

    async function verifyReturningSession() {
        try {
            const res = await fetch(`/.netlify/functions/verify-stripe-session?session_id=${encodeURIComponent(returningSessionId)}`);
            const { paid } = await res.json();
            params.delete('session_id');
            history.replaceState(null, '', `${window.location.pathname}?${params}`);
            return paid;
        } catch (error) {
            console.error('Stripe session verification failed:', error);
            return false;
        }
    }

    async function start() {
        if (!registrationId || !signature) {
            lookupEl.classList.remove('hidden');
            return;
        }

        loadingEl.classList.remove('hidden');

        if (returningSessionId && await verifyReturningSession()) {
            showPaid();
            return;
        }

        let info;
        try {
            const res = await fetch(`/.netlify/functions/balance-info?r=${encodeURIComponent(registrationId)}&s=${encodeURIComponent(signature)}`);
            if (res.status === 403 || res.status === 404) {
                showError("We couldn't find a registration for this link. Enter your email below and we'll send you a fresh one.", true);
                return;
            }
            if (!res.ok) throw new Error(`balance-info responded ${res.status}`);
            info = await res.json();
        } catch (error) {
            console.error('Balance lookup failed:', error);
            showError('Something went wrong looking up your registration. Please try again, or email registrations@cnimausa.com.', false);
            return;
        }

        if (info.status === 'paid') {
            showPaid('Your registration is already paid in full - nothing more is owed. See you in New Orleans!');
            return;
        }
        if (info.status !== 'deposit') {
            showError("We don't have a deposit on file for this registration. Please email registrations@cnimausa.com and we'll sort it out.", false);
            return;
        }

        document.getElementById('balance-name').textContent = info.name;
        document.getElementById('balance-workshop').textContent = info.workshopLabel;
        document.getElementById('balance-amount').textContent = `Balance due: ${formatDollars(info.amountDue)}`;
        document.getElementById('balance-note').textContent = info.earlyBird
            ? `Your ${formatDollars(info.depositPaid)} deposit is already applied. Pay by ${info.deadlineLabel} to keep the early-bird rate; after that the balance is ${formatDollars(info.lateAmount)} (full tuition).`
            : `Your ${formatDollars(info.depositPaid)} deposit is already applied. The early-bird deadline (${info.deadlineLabel}) has passed, so the balance is based on full tuition.`;

        if (returningSessionId) {
            document.getElementById('payment-error').classList.remove('hidden');
        }
        loadingEl.classList.add('hidden');
        stepEl.classList.remove('hidden');

        const balanceRequest = { paymentType: 'balance', registrationId, signature };
        await mountPaymentOptions({
            stripeRequest: balanceRequest,
            paypalRequest: balanceRequest,
            captureRequest: { registrationId },
            unavailableEl: document.getElementById('payment-unavailable'),
            errorEl: document.getElementById('payment-error'),
            onSuccess: () => showPaid()
        });
    }

    start();
})();
