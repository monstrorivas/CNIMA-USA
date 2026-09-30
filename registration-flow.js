// CNIMA USA 2027 - navigation behavior + registration/payment flow.
// Replaces the old script.js registration handling (which relied on a
// full-page redirect + ?success=true query param). This flow never
// navigates away from the page: the form submits via fetch, and Stripe/
// PayPal render inline once Netlify confirms the registration.

// ---- Pricing shown to the user. Keep this in sync with the text in
// components/workshop.html, components/register.html, and the
// authoritative server-side prices in netlify/functions/_shared/workshop-2027.js
// once that exists. Amounts are in whole US dollars.
const WORKSHOP_PRICING = {
    week1: { earlybird: 675, full: 799 },
    week2: { earlybird: 675, full: 799 },
    both: { earlybird: 1350, full: 1598 }
};

// Public, non-secret identifiers only (safe to ship in client JS).
// Replace with real values once Stripe/PayPal are set up; left as
// placeholders for now, the flow degrades gracefully until then.
const STRIPE_PUBLISHABLE_KEY = 'REPLACE_WITH_STRIPE_PUBLISHABLE_KEY';
const PAYPAL_CLIENT_ID = 'REPLACE_WITH_PAYPAL_CLIENT_ID';

function isConfigured(value) {
    return typeof value === 'string' && !value.startsWith('REPLACE_WITH_');
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

function initRegistrationFlow() {
    const form = document.getElementById('registration-form');
    if (!form) return; // register.html not loaded yet or not on this page

    const submitBtn = document.getElementById('registration-submit');
    const errorEl = document.getElementById('registration-error');
    const paymentStep = document.getElementById('payment-step');
    const amountDisplay = document.getElementById('payment-amount-display');
    const successEl = document.getElementById('form-success');
    const unavailableEl = document.getElementById('payment-unavailable');

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

            if (!response.ok) {
                throw new Error(`Netlify Forms responded ${response.status}`);
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
        const stripeReady = isConfigured(STRIPE_PUBLISHABLE_KEY);
        const paypalReady = isConfigured(PAYPAL_CLIENT_ID);

        if (!stripeReady && !paypalReady) {
            unavailableEl.classList.remove('hidden');
            return;
        }

        if (stripeReady) {
            try {
                await initStripeEmbeddedCheckout({ amount, formData });
            } catch (error) {
                console.error('Stripe init failed:', error);
            }
        }

        if (paypalReady) {
            try {
                await initPaypalButtons({ amount, formData });
            } catch (error) {
                console.error('PayPal init failed:', error);
            }
        }
    }

    async function initStripeEmbeddedCheckout({ amount, formData }) {
        await loadScriptOnce('https://js.stripe.com/v3/');
        const stripe = Stripe(STRIPE_PUBLISHABLE_KEY);

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

    async function initPaypalButtons({ amount, formData }) {
        await loadScriptOnce(`https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&currency=USD`);

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
                const { orderId } = await res.json();
                return orderId;
            },
            onApprove: async (data) => {
                const res = await fetch('/.netlify/functions/capture-paypal-order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ orderId: data.orderID })
                });
                if (res.ok) {
                    showSuccess();
                }
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
