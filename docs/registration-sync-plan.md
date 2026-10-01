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

## Why a URL-embedded secret instead of a signing header

Netlify doesn't sign outgoing form webhook payloads the way some other platforms sign theirs (no HMAC header to verify against) — the current, well-understood alternative is a shared secret in the URL that only Netlify's notification config and the function itself know. It's a narrow, single-purpose credential: it can only ever be used to call this one function, and that function can only ever append a row to this one sheet — nothing like the account-wide reach a Netlify API token would have had.

## Testing

- **Unit-level** (no real credentials needed): confirmed the function correctly rejects requests with a missing/wrong secret (401), rejects malformed JSON (400), rejects a payload missing a submission ID (400), and fails gracefully with a logged error when Google credentials aren't real yet (500, not a crash).
- **End-to-end**: needs an actual deploy, since the webhook URL has to be real before Netlify will accept it in the notification config, and Netlify doesn't offer a "send me a test delivery" button for form webhooks the way some other platforms do — the real first test will be submitting the actual registration form once deployed and checking the sheet.

## Open questions

- **Missed deliveries**: webhooks can occasionally fail to deliver (cold start timeout, transient network issue). There's currently no backup reconciliation path for a dropped delivery — worth deciding later whether that risk is acceptable for this volume, or whether a periodic (e.g. weekly, not daily) manual cross-check against the Netlify Forms dashboard is worth doing by hand rather than reintroducing an API token.
- **Volume**: Netlify's free tier caps Forms at 100 submissions/month — worth checking actual plan/volume expectations.
