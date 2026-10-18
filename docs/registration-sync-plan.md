# Registration → Google Sheets sync

**Status:** Implemented in `netlify/functions/handle-registration-webhook.js` + `netlify/functions/_shared/google-sheets-client.js` + `netlify/functions/_shared/registrations-sheet.js`. Code-complete and unit-tested (auth check, payload parsing, missing-field handling, graceful failure all verified without real credentials). Not yet verified against a real Google Sheet or a real deployed Netlify webhook delivery — needs `REGISTRATION_WEBHOOK_SECRET`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` in `.env` (see `.env.example`), plus the one manual dashboard step below once the site is deployed.

This superseded an earlier daily-batch design (see git history for the original version of this doc) that pulled all submissions via the Netlify API once a day. That design was dropped specifically because it required a Netlify Personal Access Token, which is account-wide — on an account with other, unrelated Netlify projects, that token could read/act on those other sites too, not just this one. Switching to a push model removes that credential entirely.

## Decisions made

| Question | Decision |
|---|---|
| Granularity | Full registrant records (name, email, workshop week, payment option, etc.) |
| Destination | Google Sheets |
| Timing | **Real-time**, pushed the moment someone registers — not a daily batch |
| Duplicate handling | Append-only with dedup by submission ID, so manually-added columns (e.g. "paid?", "contacted?") survive every sync |
| Netlify credential | **None.** No Netlify API token of any kind. Authenticity is checked via a shared secret in the webhook URL itself, scoped to nothing but "is this request genuine" |

## Architecture

```
Someone submits the registration form
        │
        ▼
Netlify Forms (processes the submission, as it always does)
        │
        │  Outgoing webhook notification (configured in the Netlify
        │  dashboard, not in code - see "One-time setup" below)
        ▼
netlify/functions/handle-registration-webhook.js
        │
        │  1. Check ?secret=... query param matches REGISTRATION_WEBHOOK_SECRET
        │  2. Parse the submission payload
        │  3. Append the row if its submission ID isn't already in the sheet
        ▼
Google Sheet (one tab: "Registrations")
        - Editable by humans at any time
        - Service account has Editor access, nothing else
        - Header row is written automatically on the very first delivery
```

## One-time setup

1. **Google Cloud service account** (same as before)
   - Create/reuse a Google Cloud project, enable the **Google Sheets API**.
   - Create a service account, generate a JSON key.
   - Set as Netlify environment variables: `GOOGLE_SERVICE_ACCOUNT_EMAIL` (the `client_email`) and `GOOGLE_PRIVATE_KEY` (the `private_key` — env vars are single-line, so the `\n` sequences in the key must stay literal text; the code un-escapes them back into real newlines before using it to sign).

2. **Create the Google Sheet**
   - Can start completely empty — a tab named `Registrations`, nothing else needed. The function writes the header row itself on first delivery.
   - Share it with the service account's email as **Editor**.
   - Set `GOOGLE_SHEET_ID` (the long ID in the sheet's URL) as an environment variable.

3. **Generate the webhook secret**
   - Any long random string, e.g. `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
   - Set it as `REGISTRATION_WEBHOOK_SECRET`.

4. **Wire up the webhook itself — this is the one step that can't be done in code**, since the site needs a real deployed URL before Netlify can be told to send webhooks to it:
   - Once deployed: Netlify dashboard → Site settings → **Forms** → **Form notifications** → **Add notification** → **Outgoing webhook**.
   - Form: `registration`.
   - URL: `https://<your-site>/.netlify/functions/handle-registration-webhook?secret=<REGISTRATION_WEBHOOK_SECRET>` (the same secret value as step 3, in the URL itself).

5. **Optional: the per-week spreadsheet** (for the people running each week)
   - Create a second Google Sheet with two tabs named exactly `Week 1` and `Week 2`, and share it with the same service account as **Editor**.
   - Set `GOOGLE_WEEKS_SHEET_ID` to its ID. Leave it unset to skip this feature entirely.
   - Every registration also gets a row in the tab for its week; "both weeks" gets a row in each. When payment completes, those rows are marked paid, and the amount for a "both weeks" payment is split evenly across the two rows so the tabs add up to what was actually collected (the master sheet keeps the full amount on its single row).
   - This sheet is meant to be edited by people, so the code treats it differently from the master: it never rewrites the header row, and writes by column **position**, not header text. Editors can rename headers, recolor, add columns to the right and add manual rows or notes. They should not reorder or delete columns A–Y (hide them instead) or rename the two tabs, and any columns of their own belong to the right of Y.
   - Rows deleted by an editor are fine: new registrations simply append. If a deleted row's registrant later pays, a paid row is added back so a confirmed payment never goes missing.
   - If the weeks write fails, the webhook returns 500 and Netlify retries; both sheets dedupe on the submission ID, so a retry only fills in what is missing.

## Deposits and balance payments

Until the early-bird deadline, registrants can pick **"$200 deposit, balance by Feb 1"** instead of paying in full. Every amount is computed server-side in `netlify/functions/_shared/workshop-2027.js`; the browser only says what it is paying for.

**The early-bird deadline** is the end of February 1, 2027, New Orleans time (America/Chicago). Every date decision goes through one pure function, `isEarlyBird(now)`, which takes the time to check as an argument, so both sides of the cutoff can be tested directly. It is evaluated at the moment a Stripe checkout session or PayPal order is created:

- Before the deadline: Early Bird charges 699 / 699 / 1,398, and the deposit option is offered.
- After the deadline: an Early Bird request is charged and recorded as Full Tuition (799 / 799 / 1,598, `effectivePaymentOption`). The server refuses new deposits with a 400 error. Balance links that already exist keep working, at full tuition minus the $200 deposit.
- `public-config` returns `earlyBirdOpen`. The form uses it to drop the Early Bird and deposit options after the deadline, so it shows the same amount the server will charge. It checks again when the form is submitted, in case the page was opened before midnight.
- The sheets record what was actually charged: Stripe's `amount_total` and PayPal's captured amount, with `paymentOption` set to the option actually charged.

| | Week 1 / Week 2 | Both weeks |
|---|---|---|
| Deposit (non-refundable, flat) | $200 | $200 |
| Balance paid on or before Feb 1, 2027 (end of day, New Orleans time) | $499 (early-bird total $699) | $1,198 (early-bird total $1,398) |
| Balance paid after Feb 1, 2027 | $599 (full tuition $799) | $1,398 (full tuition $1,598) |

**Flow**

1. The form shows a "non-refundable" checkbox when the deposit option is chosen, and it is required. `create-stripe-session` and `create-paypal-order` also refuse a deposit without `depositAcknowledged: true`, and the time the server accepted it is recorded in `deposit_acknowledged_at`.
2. When the $200 is paid, the registrant gets a **deposit receipt** (same recipients as the confirmation: to = form email plus PayPal payer email, deduped; cc registrations@cnimausa.com; bcc cnimausa@gmail.com; reply-to registrations@) with the remaining amount, the Feb 1 deadline and a **personal payment link**: `/pay-balance.html?r=<registrationId>&s=<HMAC>`. The signature is an HMAC-SHA256 of the registrationId with `BALANCE_LINK_SECRET`, compared in constant time.
3. `/pay-balance.html` shows the registrant's name, workshop and what is owed today (looked up in the master sheet by `balance-info`), with the same embedded Stripe checkout and PayPal buttons as the registration form. Paying it marks both sheets paid in full and sends the normal "You're confirmed" email.
4. **Find my registration** (on the same page): enter an email and `request-balance-link` emails the link(s) for every registration with a deposit on file under that address. The response is always the same and always takes at least 3.5 seconds, so it never reveals whether the address exists; at most one email per registration per hour.
5. **Reminders**: `send-balance-reminders` is a Netlify scheduled function (daily at 15:00 UTC, see `netlify.toml`). On Jan 2, Jan 25 and Jan 30, 2027 (30, 7 and 2 days before the deadline) it emails everyone still at `payment_status` = `deposit`; if a daily run is missed, the next day still sends it. Reminders and re-sent links go to the registrant only (no cc/bcc).

**Stripe webhook.** `stripe-webhook` handles `checkout.session.completed`, so a card payment is recorded and confirmed even if the registrant closes the tab before Stripe redirects back. It ignores sessions without a registration `paymentType` in their metadata (e.g. admin test payments from the same Stripe account).

**Exactly once.** The webhook, the browser's return trip (`verify-stripe-session`) and page reloads can all report the same payment. Each one first claims the payment in an append-only **`Payment log`** tab in the master spreadsheet (created automatically, with its header, on the first payment). Sheets serializes appends, so whichever claim row lands first wins and only that caller sends the email and writes the sheets; the others see it and stop. Reminder emails and re-sent links are claimed the same way. If the sheet writes fail, the claim is marked `failed` and the next delivery (Stripe retries the webhook on a 500) redoes only the sheet writes, without a second email. If the log itself is unreachable, the webhook answers 500 so Stripe retries later, while the browser and PayPal paths go ahead anyway, since a duplicate email is better than a lost payment. The sheet values are absolute (never added onto the row), so writing a payment twice is harmless.

### New columns (appended after U; A–U are unchanged)

| Col | Header | Meaning |
|---|---|---|
| V | `payment_status` | `unpaid` (registered, nothing paid), `deposit` ($200 paid, balance owed) or `paid` (nothing owed). Rows written before this existed are blank here; they read as `paid` when `paid` = yes. |
| W | `balance_due` | What is still owed: the early-bird balance at the time of the deposit, `0` once paid. After Feb 1 the pay page charges the full-tuition balance, which is $100 per week more than this column shows. |
| X | `balance_paid_at` | When the balance was paid. |
| Y | `deposit_acknowledged_at` | When the registrant ticked "non-refundable" and the server accepted it. |

Changes to existing columns: `amount_paid` is now the running total (200 after a deposit, the whole tuition once the balance is paid). `paid` reads `yes` only when nothing is owed. `paid_at` is when the first payment (deposit or full) arrived. `payment_provider` lists both providers (`stripe+paypal`) when deposit and balance were paid differently. In the week tabs, `amount_paid` and `balance_due` for a both-weeks registrant are split evenly across the two rows, as before.

The master header row is updated automatically on the next submission. The week tabs' header row is never rewritten by code (it belongs to the editors), so in a week tab that already has a header the four new columns arrive without headers: add `payment_status`, `balance_due`, `balance_paid_at`, `deposit_acknowledged_at` to V1:Y1 by hand. A tab that is still completely empty gets the full header automatically.

### Manual steps

1. **Netlify environment variables** (Site settings → Environment variables), for production and for deploy previews if you test there:
   - `BALANCE_LINK_SECRET`: a long random string (see `.env.example`). Keep it stable: changing it invalidates links already emailed.
   - `STRIPE_WEBHOOK_SECRET`: the signing secret from step 2.
   - Netlify sets `URL` itself; it is used to build the payment links in emails.
2. **Stripe webhook endpoint**: Stripe Dashboard → Developers → Webhooks → Add endpoint → URL `https://cnimausa.com/.netlify/functions/stripe-webhook`, event `checkout.session.completed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Do this in test mode for testing and again in live mode for production: each has its own secret.
3. **Week tabs**: if they already have a header row by then, add the four new headers to V1:Y1 (see above).
4. **Scheduled function**: nothing to configure. It only runs on the published production deploy. To check it, open Netlify → Functions → `send-balance-reminders` after a run, or trigger it locally with `npx netlify functions:invoke send-balance-reminders`.
5. **Resend**: the reminder and link emails use the existing `RESEND_API_KEY` / `RESEND_FROM_EMAIL`.

## Why a URL-embedded secret instead of a signing header

Netlify doesn't sign outgoing form webhook payloads the way some other platforms sign theirs (no HMAC header to verify against) — the current, well-understood alternative is a shared secret in the URL that only Netlify's notification config and the function itself know. It's a narrow, single-purpose credential: it can only ever be used to call this one function, and that function can only ever append a row to this one sheet — nothing like the account-wide reach a Netlify API token would have had.

## Testing

- **Unit-level** (no real credentials needed): confirmed the function correctly rejects requests with a missing/wrong secret (401), rejects malformed JSON (400), rejects a payload missing a submission ID (400), and fails gracefully with a logged error when Google credentials aren't real yet (500, not a crash).
- **End-to-end**: needs an actual deploy, since the webhook URL has to be real before Netlify will accept it in the notification config, and Netlify doesn't offer a "send me a test delivery" button for form webhooks the way some other platforms do — the real first test will be submitting the actual registration form once deployed and checking the sheet.

## Open questions

- **Missed deliveries**: webhooks can occasionally fail to deliver (cold start timeout, transient network issue). There's currently no backup reconciliation path for a dropped delivery — worth deciding later whether that risk is acceptable for this volume, or whether a periodic (e.g. weekly, not daily) manual cross-check against the Netlify Forms dashboard is worth doing by hand rather than reintroducing an API token.
- **Volume**: Netlify's free tier caps Forms at 100 submissions/month — worth checking actual plan/volume expectations.
