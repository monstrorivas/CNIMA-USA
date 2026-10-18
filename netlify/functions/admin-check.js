const Stripe = require('stripe');
const { checkAdmin, json, redact } = require('./_shared/admin-auth');
const { getAccessToken: getPayPalToken } = require('./_shared/paypal-client');
const { getAccessToken: getGoogleToken, sheetsRequest } = require('./_shared/google-sheets-client');

// Admin-only, read-only health check of the payment/export/email setup.
// Reports modes, masked key prefixes and pass/fail details - never a secret
// value. The only thing it creates anywhere is a Stripe Checkout Session
// that it expires immediately.
const SHEET_DOCS = [
    { label: 'Master sheet', idVar: 'GOOGLE_SHEET_ID', required: true, tabs: ['Registrations'] },
    { label: 'Week sheet', idVar: 'GOOGLE_WEEKS_SHEET_ID', required: false, tabs: ['Week 1', 'Week 2'] }
];

const row = (group, label, status, detail) => ({ group, label, status, detail });

function keyInfo(raw, types) {
    const match = /^(sk|rk|pk)_(test|live)_/.exec(raw || '');
    if (!match || !types.includes(match[1])) return null;
    return { type: match[1], mode: match[2], masked: `${match[1]}_${match[2]}_…` };
}

function paypalMode() {
    return process.env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox';
}

async function stripeChecks() {
    const group = 'Stripe';
    const rows = [];
    const sk = keyInfo(process.env.STRIPE_SECRET_KEY, ['sk', 'rk']);
    const pk = keyInfo(process.env.STRIPE_PUBLISHABLE_KEY, ['pk']);

    if (!sk) {
        rows.push(row(group, 'Secret key', 'fail', process.env.STRIPE_SECRET_KEY
            ? 'STRIPE_SECRET_KEY is not a recognizable secret (sk_) or restricted (rk_) key.'
            : 'STRIPE_SECRET_KEY is not set.'));
        return rows;
    }
    const restricted = sk.type === 'rk' ? ', restricted key' : '';
    rows.push(row(group, 'Secret key', 'pass', `${sk.masked} (${sk.mode.toUpperCase()} mode${restricted})`));

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    try {
        const account = await stripe.accounts.retrieve();
        const name = (account.settings && account.settings.dashboard && account.settings.dashboard.display_name)
            || (account.business_profile && account.business_profile.name)
            || '(no name set)';
        rows.push(row(group, 'Account', 'pass', `${name} (${account.id})`));
        const notReady = sk.mode === 'live' ? 'fail' : 'warn';
        rows.push(row(group, 'Charges enabled', account.charges_enabled ? 'pass' : notReady,
            account.charges_enabled ? 'Yes' : 'No - the account cannot accept payments yet.'));
        rows.push(row(group, 'Payouts enabled', account.payouts_enabled ? 'pass' : notReady,
            account.payouts_enabled ? 'Yes' : 'No - the account cannot pay out to a bank yet.'));
    } catch (error) {
        rows.push(row(group, 'Account', 'warn', `Could not read the account (does the key allow it?): ${redact(error.message)}`));
    }

    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
        rows.push(row(group, 'Publishable key', 'fail', 'STRIPE_PUBLISHABLE_KEY is not set.'));
    } else if (!pk) {
        rows.push(row(group, 'Publishable key', 'fail', 'STRIPE_PUBLISHABLE_KEY is not a recognizable publishable (pk_) key.'));
    } else if (pk.mode !== sk.mode) {
        rows.push(row(group, 'Publishable key', 'fail', `${pk.masked} is ${pk.mode.toUpperCase()} but the secret key is ${sk.mode.toUpperCase()}.`));
    } else {
        rows.push(row(group, 'Publishable key', 'pass', `${pk.masked} (${pk.mode.toUpperCase()} mode, matches the secret key)`));
    }

    let session;
    try {
        session = await stripe.checkout.sessions.create({
            ui_mode: 'embedded',
            mode: 'payment',
            payment_method_types: ['card'],
            redirect_on_completion: 'never',
            line_items: [{
                price_data: { currency: 'usd', unit_amount: 100, product_data: { name: 'CNIMA USA admin health check' } },
                quantity: 1
            }],
            metadata: { adminCheck: 'true' }
        });
        rows.push(row(group, 'Create Checkout Session', 'pass', 'The key can create Checkout Sessions (Checkout Sessions: Write).'));
    } catch (error) {
        rows.push(row(group, 'Create Checkout Session', 'fail', redact(error.message)));
        return rows;
    }

    if (pk && pk.mode === sk.mode) {
        rows.push(await publishableKeyAccountCheck(session.id));
    }

    try {
        const expired = await stripe.checkout.sessions.expire(session.id);
        rows.push(row(group, 'Expire Checkout Session', expired.status === 'expired' ? 'pass' : 'warn',
            expired.status === 'expired' ? 'The test session was expired immediately; nothing can be paid.' : `Session status is "${expired.status}".`));
    } catch (error) {
        rows.push(row(group, 'Expire Checkout Session', 'warn', `Could not expire the test session (it lapses on its own after 24h): ${redact(error.message)}`));
    }
    return rows;
}

// Stripe.js loads a session by posting the publishable key to the
// payment_pages API; a key from a different account is rejected there.
async function publishableKeyAccountCheck(sessionId) {
    const group = 'Stripe';
    const label = 'Publishable key belongs to this account';
    try {
        const res = await fetch(`https://api.stripe.com/v1/payment_pages/${sessionId}/init`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key: process.env.STRIPE_PUBLISHABLE_KEY, eid: 'NA', browser_locale: 'en-US' })
        });
        if (res.ok) {
            return row(group, label, 'pass', 'Stripe.js can load a session created with the secret key.');
        }
        if (res.status === 401 || res.status === 404) {
            return row(group, label, 'fail', 'Stripe rejected the publishable key for a session from the secret key\'s account - they appear to belong to different accounts.');
        }
        return row(group, label, 'warn', `Could not determine (Stripe answered ${res.status}).`);
    } catch (error) {
        return row(group, label, 'warn', `Could not determine: ${redact(error.message)}`);
    }
}

async function paypalChecks() {
    const group = 'PayPal';
    const mode = paypalMode();
    const rows = [];

    const configured = process.env.PAYPAL_MODE;
    if (configured && !['live', 'sandbox'].includes(configured)) {
        rows.push(row(group, 'Mode', 'warn', `PAYPAL_MODE is "${redact(configured)}"; anything other than "live" is treated as SANDBOX.`));
    } else if (!configured) {
        rows.push(row(group, 'Mode', 'warn', 'PAYPAL_MODE is not set; defaulting to SANDBOX.'));
    } else {
        rows.push(row(group, 'Mode', 'pass', mode.toUpperCase()));
    }

    if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
        rows.push(row(group, 'Credentials', 'fail', 'PAYPAL_CLIENT_ID and/or PAYPAL_CLIENT_SECRET is not set.'));
        return rows;
    }
    try {
        await getPayPalToken();
        rows.push(row(group, 'OAuth token', 'pass', `Authenticated against PayPal ${mode.toUpperCase()} (client ID ${process.env.PAYPAL_CLIENT_ID.slice(0, 6)}…).`));
    } catch (error) {
        rows.push(row(group, 'OAuth token', 'fail', `${redact(error.message)} - check that the credentials match PAYPAL_MODE.`));
    }
    return rows;
}

function sheetProblem(error, email) {
    const message = String(error.message);
    if (message.includes(': 404')) return 'Spreadsheet not found - check the ID.';
    if (message.includes(': 403')) return `Not shared with ${email} (it needs Editor access).`;
    return redact(message);
}

async function sheetsChecks() {
    const group = 'Google Sheets';
    const rows = [];
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;

    if (!email || !process.env.GOOGLE_PRIVATE_KEY) {
        rows.push(row(group, 'Service account', 'fail', 'GOOGLE_SERVICE_ACCOUNT_EMAIL and/or GOOGLE_PRIVATE_KEY is not set.'));
        return rows;
    }
    let token;
    try {
        token = await getGoogleToken();
        rows.push(row(group, 'Service account', 'pass', `Authenticated as ${email}.`));
    } catch (error) {
        rows.push(row(group, 'Service account', 'fail', redact(error.message)));
        return rows;
    }

    for (const doc of SHEET_DOCS) {
        const id = process.env[doc.idVar];
        if (!id) {
            rows.push(row(group, doc.label, doc.required ? 'fail' : 'warn',
                doc.required ? `${doc.idVar} is not set.` : `${doc.idVar} is not set - the week sheet is skipped (optional).`));
            continue;
        }
        try {
            const meta = await sheetsRequest(`${encodeURIComponent(id)}?fields=properties.title,sheets.properties.title`, token);
            const found = (meta.sheets || []).map((sheet) => sheet.properties.title);
            const missing = doc.tabs.filter((tab) => !found.includes(tab));
            rows.push(missing.length
                ? row(group, doc.label, 'fail', `"${meta.properties.title}" is readable but is missing the tab(s) ${missing.map((tab) => `"${tab}"`).join(', ')}. Tabs found: ${found.join(', ') || 'none'}.`)
                : row(group, doc.label, 'pass', `"${meta.properties.title}" is readable; tab(s) found: ${doc.tabs.join(', ')}.`));
        } catch (error) {
            rows.push(row(group, doc.label, 'fail', sheetProblem(error, email)));
        }
    }
    return rows;
}

async function emailChecks() {
    const group = 'Email (Resend)';
    const rows = [];
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;

    if (!apiKey) {
        rows.push(row(group, 'API key', 'fail', 'RESEND_API_KEY is not set.'));
    } else if (!apiKey.startsWith('re_')) {
        rows.push(row(group, 'API key', 'warn', 'RESEND_API_KEY is set but does not start with "re_".'));
    } else {
        rows.push(row(group, 'API key', 'pass', 're_… is set.'));
    }

    const address = from && (/<([^>]+)>/.exec(from) || [null, from.trim()])[1];
    if (!from) {
        rows.push(row(group, 'From address', 'fail', 'RESEND_FROM_EMAIL is not set.'));
        return rows;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
        rows.push(row(group, 'From address', 'fail', 'RESEND_FROM_EMAIL is not a valid address or "Name <address>".'));
        return rows;
    }
    rows.push(row(group, 'From address', 'pass', from));

    if (apiKey) {
        rows.push(await resendDomainCheck(apiKey, address.split('@')[1].toLowerCase()));
    }
    return rows;
}

async function resendDomainCheck(apiKey, domain) {
    const group = 'Email (Resend)';
    const label = 'Sending domain verified';
    try {
        const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${apiKey}` } });
        if (res.status === 401 || res.status === 403) {
            return row(group, label, 'warn', 'Could not check: the key may be send-only (or invalid). Verify the domain in the Resend dashboard.');
        }
        if (!res.ok) {
            return row(group, label, 'warn', `Could not check (Resend answered ${res.status}).`);
        }
        const { data = [] } = await res.json();
        const match = data.find((entry) => entry.name.toLowerCase() === domain);
        if (!match) {
            return row(group, label, 'fail', `${domain} is not among the domains in this Resend account.`);
        }
        return match.status === 'verified'
            ? row(group, label, 'pass', `${domain} is verified.`)
            : row(group, label, 'fail', `${domain} is "${match.status}" in Resend, not verified.`);
    } catch (error) {
        return row(group, label, 'warn', `Could not check: ${redact(error.message)}`);
    }
}

function deploymentChecks(event) {
    const group = 'Deployment';
    const origin = `${event.headers['x-forwarded-proto'] || 'https'}://${event.headers.host}`;
    return [
        row(group, 'This deployment', 'pass', `${origin} (context: ${process.env.CONTEXT || 'unknown'})`),
        row(group, 'Registration webhook secret', process.env.REGISTRATION_WEBHOOK_SECRET ? 'pass' : 'fail',
            process.env.REGISTRATION_WEBHOOK_SECRET ? 'REGISTRATION_WEBHOOK_SECRET is set.' : 'REGISTRATION_WEBHOOK_SECRET is not set.')
    ];
}

function consistencyChecks() {
    const sk = keyInfo(process.env.STRIPE_SECRET_KEY, ['sk', 'rk']);
    if (!sk) return [];
    const matches = (sk.mode === 'live') === (paypalMode() === 'live');
    return [row('Consistency', 'Stripe and PayPal modes agree', matches ? 'pass' : 'warn',
        matches ? `Both are ${sk.mode === 'live' ? 'LIVE' : 'test/sandbox'}.`
            : `Stripe is ${sk.mode.toUpperCase()} but PayPal is ${paypalMode().toUpperCase()}.`)];
}

async function guarded(group, fn) {
    try {
        return await fn();
    } catch (error) {
        console.error(`admin-check "${group}" failed:`, redact(error.message));
        return [row(group, 'Unexpected error', 'fail', redact(error.message))];
    }
}

exports.handler = async (event) => {
    const denied = checkAdmin(event, 'GET');
    if (denied) return denied;

    const groups = await Promise.all([
        guarded('Deployment', () => deploymentChecks(event)),
        guarded('Stripe', stripeChecks),
        guarded('PayPal', paypalChecks),
        guarded('Google Sheets', sheetsChecks),
        guarded('Email (Resend)', emailChecks),
        guarded('Consistency', consistencyChecks)
    ]);
    const checks = groups.flat();
    const count = (status) => checks.filter((check) => check.status === status).length;

    return json(200, {
        ok: count('fail') === 0,
        summary: { pass: count('pass'), warn: count('warn'), fail: count('fail') },
        checkedAt: new Date().toISOString(),
        checks
    });
};
