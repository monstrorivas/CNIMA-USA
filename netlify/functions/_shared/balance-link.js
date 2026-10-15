const crypto = require('crypto');

// Personal "pay your balance" links carry the registrationId plus an HMAC of
// it, so only links this site issued are accepted and nobody can swap in
// another registrant's ID.
function signRegistrationId(registrationId) {
    const secret = process.env.BALANCE_LINK_SECRET;
    if (!secret) {
        throw new Error('BALANCE_LINK_SECRET is not set');
    }
    return crypto.createHmac('sha256', secret).update(`balance:${registrationId}`).digest('base64url');
}

function isValidSignature(registrationId, signature) {
    if (!registrationId || typeof registrationId !== 'string' || typeof signature !== 'string') {
        return false;
    }
    const expected = Buffer.from(signRegistrationId(registrationId));
    const provided = Buffer.from(signature);
    return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

// Netlify sets URL to the site's primary address on deploys and in
// `netlify dev`.
function siteUrl() {
    return (process.env.URL || 'https://cnimausa.com').replace(/\/$/, '');
}

function balanceLinkQuery(registrationId) {
    return `r=${encodeURIComponent(registrationId)}&s=${signRegistrationId(registrationId)}`;
}

function balanceLinkUrl(registrationId) {
    return `${siteUrl()}/pay-balance.html?${balanceLinkQuery(registrationId)}`;
}

module.exports = { isValidSignature, balanceLinkQuery, balanceLinkUrl };
