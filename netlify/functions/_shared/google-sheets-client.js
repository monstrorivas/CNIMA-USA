const crypto = require('crypto');

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// Google service accounts authenticate via a self-signed JWT exchanged for
// an access token - no external auth library needed, Node's built-in
// crypto module can sign it directly.
async function getAccessToken() {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT' };
    const claims = {
        iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
    };

    const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    // Netlify env vars are single-line, so a literal \n in the key needs to
    // be un-escaped back into real newlines before it can be used to sign.
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    const signature = base64url(crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey));
    const jwt = `${unsigned}.${signature}`;

    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });

    if (!res.ok) {
        throw new Error(`Google auth failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.access_token;
}

async function sheetsRequest(pathAndQuery, accessToken, options = {}) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${pathAndQuery}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        throw new Error(`Sheets API error: ${res.status} ${await res.text()}`);
    }
    return res.json();
}

module.exports = { getAccessToken, sheetsRequest };
