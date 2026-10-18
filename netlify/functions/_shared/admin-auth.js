const crypto = require('crypto');

const SECRET_ENV_NAMES = [
    'ADMIN_CHECK_SECRET',
    'STRIPE_SECRET_KEY',
    'PAYPAL_CLIENT_SECRET',
    'GOOGLE_PRIVATE_KEY',
    'RESEND_API_KEY',
    'REGISTRATION_WEBHOOK_SECRET'
];

function json(statusCode, body) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body)
    };
}

function digest(value) {
    return crypto.createHash('sha256').update(String(value)).digest();
}

// Shared by every admin-only function. Returns an error response when the
// request must not proceed, or null when it is authorized. Hashing both sides
// first gives timingSafeEqual equal-length inputs without leaking the
// secret's length.
function checkAdmin(event, method) {
    const expected = process.env.ADMIN_CHECK_SECRET;
    if (!expected) {
        return json(404, { error: 'Admin tools are disabled: ADMIN_CHECK_SECRET is not set on this deployment.' });
    }

    const provided = (event.headers && event.headers['x-admin-secret']) || '';
    if (!crypto.timingSafeEqual(digest(provided), digest(expected))) {
        return json(401, { error: 'Missing or incorrect admin secret.' });
    }

    if (event.httpMethod !== method) {
        return json(405, { error: 'Method Not Allowed' });
    }
    return null;
}

// Error messages from Stripe/Google/PayPal can echo parts of credentials
// back, so anything reported to the admin page or logged goes through here.
function redact(text) {
    let out = String(text);
    for (const name of SECRET_ENV_NAMES) {
        const value = process.env[name];
        if (!value || value.length < 8) continue;
        for (const variant of new Set([value, value.replace(/\\n/g, '\n')])) {
            out = out.split(variant).join('[redacted]');
        }
    }
    return out
        .replace(/\b([sr]k|pk)_(test|live)_[A-Za-z0-9*_]+/g, '$1_$2_…')
        .replace(/\bre_[A-Za-z0-9_]{8,}/g, 're_…')
        .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[redacted key]')
        .slice(0, 300);
}

module.exports = { checkAdmin, json, redact };
