// CNIMA USA 2027 - navigation behavior + registration/payment flow.
// Replaces the old script.js registration handling (which relied on a
// full-page redirect + ?success=true query param). This flow never
// navigates away from the page: the form submits via fetch, and Stripe/
// PayPal render inline once Netlify confirms the registration.

// ---- Pricing shown to the user, for display only. The authoritative
// amount actually charged comes from netlify/functions/_shared/workshop-2027.js
// server-side - keep both in sync when pricing changes. Amounts are in
// whole US dollars.
const WORKSHOP_PRICING = {
    week1: { earlybird: 699, full: 799 },
    week2: { earlybird: 699, full: 799 },
    both: { earlybird: 1398, full: 1598 }
};

// Public, non-secret identifiers (publishable key / client ID) are fetched
// from the public-config function rather than hardcoded here, so switching
// test/live credentials is just an environment variable change on Netlify,
// not a code edit.
let publicConfigPromise = null;

function getPublicConfig() {
    if (!publicConfigPromise) {
        publicConfigPromise = fetch('/.netlify/functions/public-config')
            .then(res => res.ok ? res.json() : {})
            .catch(() => ({}));
    }
    return publicConfigPromise;
}

function initializeScripts() {
    if (window.__cnimaScriptsInitialized) return;
    window.__cnimaScriptsInitialized = true;

    // Smooth scrolling for anchor links (event delegation), skipping
    // mailto:/tel:/http(s) links so those behave normally.
    document.addEventListener('click', function (e) {
        const anchor = e.target.closest('a');
        if (!anchor) return;
        const href = anchor.getAttribute('href');
        if (!href) return;
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('http://') || href.startsWith('https://')) {
            return;
        }
        if (href.startsWith('#') && href.length > 1) {
            const target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    });

    // Active nav-link highlighting on scroll.
    function updateActiveNav() {
        const sections = document.querySelectorAll('section[id]');
        const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 120;
            if (window.pageYOffset >= sectionTop) {
                current = section.id;
            }
        });
        navLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === `#${current}`);
        });
    }
    window.addEventListener('scroll', updateActiveNav);

    initRegistrationFlow();
}

// Both loader.js and this file's own fallback bootstrap call
// initializeScripts(), and on a real network the fallback can fire before
// loader.js has finished fetching components/register.html - so this can't
// just bail out on the first "not found yet" check (that's what caused
// submissions to fall through to a native, unhandled form POST on the
// deployed preview, even though it worked every time locally where fetches
// are near-instant). Poll briefly instead, and use its own completion flag
// separate from the nav-level one so a premature call never blocks the
// later, correctly-timed one from actually attaching the listener.
async function initRegistrationFlow() {
    if (window.__cnimaRegistrationFlowInitialized) return;

    let form = document.getElementById('registration-form');
    let retries = 0;
    while (!form && retries < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        form = document.getElementById('registration-form');
        retries++;
    }
    if (!form) return; // genuinely not on this page

    window.__cnimaRegistrationFlowInitialized = true;

    const submitBtn = document.getElementById('registration-submit');
    const errorEl = document.getElementById('registration-error');
    const paymentStep = document.getElementById('payment-step');
    const amountDisplay = document.getElementById('payment-amount-display');
    const successEl = document.getElementById('form-success');
    const unavailableEl = document.getElementById('payment-unavailable');

    // Stripe's embedded checkout requires a return_url and always redirects
    // the whole page there once payment completes - there's no way to avoid
    // that round trip. So on load, check whether we're coming back from one
    // (a session_id in the URL) and verify it server-side before showing
    // success, rather than just landing back on a blank, unexplained form.
    const returningSessionId = new URLSearchParams(window.location.search).get('session_id');
    if (returningSessionId) {
        form.classList.add('hidden');
        paymentStep.classList.add('hidden');
        fetch(`/.netlify/functions/verify-stripe-session?session_id=${encodeURIComponent(returningSessionId)}`)
            .then(res => res.json())
            .then(({ paid }) => {
                history.replaceState(null, '', window.location.pathname + window.location.hash);
                if (paid) {
                    successEl.classList.remove('hidden');
                    successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                } else {
                    form.classList.remove('hidden');
                    errorEl.textContent = "It looks like your payment didn't go through. Please try again below, or email ";
                    const mailLink = document.createElement('a');
                    mailLink.href = 'mailto:cnimausa@gmail.com';
                    mailLink.textContent = 'cnimausa@gmail.com';
                    errorEl.appendChild(mailLink);
                    errorEl.append('.');
                    errorEl.classList.remove('hidden');
                }
            })
            .catch(error => {
                console.error('Stripe session verification failed:', error);
                form.classList.remove('hidden');
                errorEl.classList.remove('hidden');
            });
    }

    // Netlify Forms only actually processes submissions on a real deploy -
    // it never works against a local server, including `netlify dev`. So a
    // Forms failure here is expected (and must still block checkout) on the
    // real site, but would make it impossible to test Stripe/PayPal locally
    // if treated the same way. On localhost only, log it and continue so
    // the payment step itself can still be tested.
    const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorEl.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        const formData = new FormData(form);
        const workshop = formData.get('workshop');
        const paymentOption = formData.get('paymentOption');
        const amount = WORKSHOP_PRICING[workshop] && WORKSHOP_PRICING[workshop][paymentOption];

        try {
            const encoded = new URLSearchParams(formData).toString();
            const response = await fetch('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: encoded
            });

            if (!response.ok && !isLocalDev) {
                throw new Error(`Netlify Forms responded ${response.status}`);
            }
            if (!response.ok) {
                console.warn(`Netlify Forms responded ${response.status} - expected on localhost, continuing to payment for testing.`);
            }

            form.classList.add('hidden');
            paymentStep.classList.remove('hidden');
            amountDisplay.textContent = amount ? `Amount due: $${amount.toLocaleString()}` : '';
            paymentStep.scrollIntoView({ behavior: 'smooth', block: 'start' });

            await initPaymentOptions({ amount, formData });
        } catch (error) {
            console.error('Registration submission failed:', error);
            errorEl.classList.remove('hidden');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continue to Payment';
        }
    });

    async function initPaymentOptions({ amount, formData }) {
        const config = await getPublicConfig();
        const stripeReady = !!config.stripePublishableKey;
        const paypalReady = !!config.paypalClientId;

        if (!stripeReady && !paypalReady) {
            unavailableEl.classList.remove('hidden');
            return;
        }

        if (stripeReady) {
            try {
                await initStripeEmbeddedCheckout({ amount, formData, publishableKey: config.stripePublishableKey });
            } catch (error) {
                console.error('Stripe init failed:', error);
            }
        }

        if (paypalReady) {
            try {
                await initPaypalButtons({ amount, formData, clientId: config.paypalClientId });
            } catch (error) {
                console.error('PayPal init failed:', error);
            }
        }
    }

    async function initStripeEmbeddedCheckout({ amount, formData, publishableKey }) {
        await loadScriptOnce('https://js.stripe.com/v3/');
        const stripe = Stripe(publishableKey);

        const checkout = await stripe.initEmbeddedCheckout({
            fetchClientSecret: async () => {
                const res = await fetch('/.netlify/functions/create-stripe-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workshop: formData.get('workshop'),
                        paymentOption: formData.get('paymentOption'),
                        email: formData.get('email'),
                        name: `${formData.get('firstName')} ${formData.get('lastName')}`
                    })
                });
                if (!res.ok) throw new Error('Could not create Stripe session');
                const { clientSecret } = await res.json();
                return clientSecret;
            }
        });

        checkout.mount('#stripe-checkout-container');
    }

    async function initPaypalButtons({ amount, formData, clientId }) {
        await loadScriptOnce(`https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD`);

        const paypalErrorEl = document.getElementById('payment-error');

        paypal.Buttons({
            createOrder: async () => {
                const res = await fetch('/.netlify/functions/create-paypal-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        workshop: formData.get('workshop'),
                        paymentOption: formData.get('paymentOption')
                    })
                });
                if (!res.ok) throw new Error(`Could not create PayPal order (${res.status})`);
                const { orderId } = await res.json();
                return orderId;
            },
            onApprove: async (data) => {
                try {
                    const res = await fetch('/.netlify/functions/capture-paypal-order', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ orderId: data.orderID })
                    });
                    const result = await res.json();
                    if (res.ok && result.success) {
                        paypalErrorEl.classList.add('hidden');
                        showSuccess();
                    } else {
                        console.error('PayPal capture did not complete:', result);
                        paypalErrorEl.classList.remove('hidden');
                    }
                } catch (error) {
                    console.error('PayPal capture request failed:', error);
                    paypalErrorEl.classList.remove('hidden');
                }
            },
            onError: (error) => {
                console.error('PayPal button error:', error);
                paypalErrorEl.classList.remove('hidden');
            }
        }).render('#paypal-button-container');
    }

    function showSuccess() {
        paymentStep.classList.add('hidden');
        successEl.classList.remove('hidden');
        successEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // Stripe's embedded checkout calls this via its own return/complete
    // flow in a full implementation; exposed here so create-stripe-session's
    // companion webhook/redirect handling can call it if wired up that way.
    window.__cnimaShowRegistrationSuccess = showSuccess;
}

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.head.appendChild(script);
    });
}

// Fallback bootstrap in case this script loads after the DOM/components are ready.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(initializeScripts, 100);
} else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(initializeScripts, 100));
}
