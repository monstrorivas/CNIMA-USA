# Admin payment check

An unlinked, admin-only page for verifying the payment/export/email setup on any deployment (local, deploy preview or production) - handy right after switching to the real Stripe and PayPal accounts.

| Piece | File |
|---|---|
| Page (not linked anywhere, `noindex`) | `admin-test.html` at `/admin-test.html` |
| Read-only health check | `netlify/functions/admin-check.js` |
| Creates the $1 embedded Checkout Session | `netlify/functions/admin-test-session.js` |
| Confirms the $1 payment, returns PaymentIntent id + dashboard link | `netlify/functions/admin-test-verify.js` |
| Secret check, redaction | `netlify/functions/_shared/admin-auth.js` |

None of it touches the registration functions, writes to Google Sheets or sends email.

## Setup

1. Generate a secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

2. Set it as `ADMIN_CHECK_SECRET` in Netlify (Site settings -> Environment variables) and redeploy. Locally, add it to `.env`.
3. Open `https://<your-site>/admin-test.html`, paste the secret into the password field.

Until `ADMIN_CHECK_SECRET` is set, all three functions answer `404` ("Admin tools are disabled"). A missing or wrong secret answers `401`. The secret is compared in constant time, travels only in an `X-Admin-Secret` header (never the URL, which would end up in logs) and is not stored by the page.

## 1. Health check

Run health check shows green PASS / amber WARN / red FAIL rows:

- **Stripe** - key mode (test/live, masked prefix only), account name, `charges_enabled`, `payouts_enabled`, publishable key present and in the same mode as the secret key, and whether the publishable key belongs to the same account. It also creates a Checkout Session and expires it straight away, which proves a restricted key has *Checkout Sessions: Write*. (`Charges/Payouts enabled` are warnings in test mode, failures in live mode.)
- **PayPal** - sandbox or live, and a successful OAuth token.
- **Google Sheets** - service account can authenticate, can read `GOOGLE_SHEET_ID` (tab `Registrations`) and `GOOGLE_WEEKS_SHEET_ID` (tabs `Week 1`, `Week 2`). Reads only; it cannot prove the service account has *Editor* access, since that would need a write.
- **Email (Resend)** - key and `RESEND_FROM_EMAIL` present and well-formed; the sending domain's verification status when the key is allowed to list domains (a send-only key gives a warning instead). No mail is sent.
- **Consistency** - warns when Stripe and PayPal are in different modes.

Responses contain masked prefixes and modes only, never secret values.

## 2. $1 test payment

Start $1 test mounts the same embedded Stripe Checkout used for registration, for exactly $1.00. The page says whether it is TEST or LIVE mode first (live asks for confirmation).

- Test mode: card `4242 4242 4242 4242`, any future expiry, any CVC and ZIP.
- After paying, the page shows the PaymentIntent id and a link to it in the Stripe dashboard.
- **Live mode: refund the $1 in the Stripe dashboard** (open the link -> Refund). The app deliberately doesn't ask for Refunds permission.
- The payment is tagged `adminTest=true` (session and PaymentIntent metadata) so it is easy to find. Stripe may email its own receipt to the address entered at checkout; the site sends nothing.

## Checklist for going live

1. Switch `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `PAYPAL_MODE=live` in Netlify.
2. Set `ADMIN_CHECK_SECRET` and redeploy.
3. Run the health check: everything PASS, "Stripe and PayPal modes agree".
4. Run the $1 test with a real card, then refund it.
5. Optionally unset `ADMIN_CHECK_SECRET` afterwards to disable the tools again.
